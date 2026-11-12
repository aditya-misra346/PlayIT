package app.auralis

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.auralis.audio.AudioCaptureMode
import app.auralis.ui.AuralisViewModel
import app.auralis.ui.screens.LibraryScreen
import app.auralis.ui.screens.ListenScreen
import app.auralis.ui.screens.ResultScreen
import app.auralis.ui.screens.SettingsScreen
import app.auralis.ui.theme.AuralisColors
import app.auralis.ui.theme.AuralisMark
import app.auralis.ui.theme.AuralisTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class TopLevelDestination(val label: String, val icon: ImageVector) {
    LISTEN("Listen", Icons.Default.GraphicEq),
    LIBRARY("Library", Icons.Default.LibraryMusic),
    SETTINGS("Settings", Icons.Default.Settings)
}

class MainActivity : ComponentActivity() {

    private val viewModel: AuralisViewModel by viewModels()

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val windowSizeClass = calculateWindowSizeClass(this)
            AuralisTheme {
                AuralisAppRoot(
                    viewModel = viewModel,
                    widthSizeClass = windowSizeClass.widthSizeClass
                )
            }
        }
    }
}

@Composable
fun AuralisAppRoot(
    viewModel: AuralisViewModel,
    widthSizeClass: WindowWidthSizeClass
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val coroutineScope = rememberCoroutineScope()

    val uiState by viewModel.recognitionUi.collectAsState()
    val settings by viewModel.settingsState.collectAsState()
    val libraryItems by viewModel.filteredLibraryItems.collectAsState()
    val distinctArtists by viewModel.distinctArtists.collectAsState()
    val filterState by viewModel.libraryFilter.collectAsState()

    var currentDest by rememberSaveable { mutableStateOf(TopLevelDestination.LISTEN) }
    var showCompactResultOverlay by rememberSaveable { mutableStateOf(false) }

    val isExpandedOrMedium = widthSizeClass != WindowWidthSizeClass.Compact
    val snackbarHostState = remember { SnackbarHostState() }

    // Stop active recording immediately when activity hits ON_STOP (no background recording)
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                viewModel.onAppStopped()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    // Show snackbar when bannerMessage arrives
    LaunchedEffect(uiState.bannerMessage) {
        val msg = uiState.bannerMessage
        if (!msg.isNullOrBlank()) {
            snackbarHostState.showSnackbar(msg)
            viewModel.clearBannerMessage()
        }
    }

    // Automatically open result overlay on compact screens when a new match arrives
    LaunchedEffect(uiState.matchedItem?.id) {
        if (uiState.matchedItem != null && !isExpandedOrMedium) {
            showCompactResultOverlay = true
        }
    }

    // MediaProjection launcher for Android 10+ PlaybackCapture
    val mediaProjectionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { activityResult ->
        val data = activityResult.data
        if (activityResult.resultCode == Activity.RESULT_OK && data != null) {
            viewModel.startPlaybackRecognition(activityResult.resultCode, data)
        } else {
            viewModel.onMicrophonePermissionDenied()
        }
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { _ ->
        // Even if notification permission is declined, start MediaProjection consent dialog
        val mpManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjectionLauncher.launch(mpManager.createScreenCaptureIntent())
    }

    fun requestPlaybackCaptureConsent() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Toast.makeText(context, "Device Audio requires Android 10+.", Toast.LENGTH_SHORT).show()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            val mpManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjectionLauncher.launch(mpManager.createScreenCaptureIntent())
        }
    }

    // Microphone permission launcher
    val micPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            if (settings.captureMode == AudioCaptureMode.PLAYBACK && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                requestPlaybackCaptureConsent()
            } else {
                viewModel.startMicrophoneRecognition()
            }
        } else {
            viewModel.onMicrophonePermissionDenied()
        }
    }

    fun triggerStartListening() {
        val hasRecordAudio = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasRecordAudio) {
            viewModel.onRequestingMicrophonePermission()
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            return
        }

        if (settings.captureMode == AudioCaptureMode.PLAYBACK && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            requestPlaybackCaptureConsent()
        } else {
            viewModel.startMicrophoneRecognition()
        }
    }

    // SAF JSON export launcher
    val exportJsonLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri != null) {
            coroutineScope.launch {
                val jsonContent = viewModel.exportLibraryJson()
                val result = runCatching {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { out ->
                            out.write(jsonContent.toByteArray(Charsets.UTF_8))
                        }
                    }
                }
                if (result.isSuccess) {
                    Toast.makeText(context, "Exported library JSON.", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(context, "Export failed.", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    val activeDetailItem = uiState.selectedDetailItem ?: uiState.matchedItem

    if (!isExpandedOrMedium && showCompactResultOverlay && activeDetailItem != null) {
        BackHandler {
            showCompactResultOverlay = false
        }
    }

    Scaffold(
        containerColor = AuralisColors.Midnight,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        bottomBar = {
            if (!isExpandedOrMedium) {
                NavigationBar(
                    containerColor = AuralisColors.Deep,
                    contentColor = AuralisColors.TextPrimary
                ) {
                    TopLevelDestination.entries.forEach { dest ->
                        NavigationBarItem(
                            selected = currentDest == dest && !showCompactResultOverlay,
                            onClick = {
                                showCompactResultOverlay = false
                                currentDest = dest
                            },
                            icon = { Icon(imageVector = dest.icon, contentDescription = dest.label) },
                            label = { Text(dest.label) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = AuralisColors.Cyan,
                                selectedTextColor = AuralisColors.TextPrimary,
                                indicatorColor = AuralisColors.ElectricBlue.copy(alpha = 0.22f),
                                unselectedIconColor = AuralisColors.TextMuted,
                                unselectedTextColor = AuralisColors.TextMuted
                            )
                        )
                    }
                }
            }
        },
        modifier = Modifier
            .fillMaxSize()
            .background(AuralisColors.Midnight)
            .systemBarsPadding()
    ) { innerPadding ->
        if (isExpandedOrMedium) {
            // Adaptive Tablet / Expanded Layout: NavigationRail + Two-Pane Master/Detail
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
                NavigationRail(
                    containerColor = AuralisColors.Deep,
                    contentColor = AuralisColors.TextPrimary,
                    header = {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(vertical = 12.dp)
                        ) {
                            AuralisMark(size = 32.dp)
                        }
                    }
                ) {
                    Spacer(modifier = Modifier.height(8.dp))
                    TopLevelDestination.entries.forEach { dest ->
                        NavigationRailItem(
                            selected = currentDest == dest,
                            onClick = { currentDest = dest },
                            icon = { Icon(imageVector = dest.icon, contentDescription = dest.label) },
                            label = { Text(dest.label) },
                            colors = NavigationRailItemDefaults.colors(
                                selectedIconColor = AuralisColors.Cyan,
                                selectedTextColor = AuralisColors.TextPrimary,
                                indicatorColor = AuralisColors.ElectricBlue.copy(alpha = 0.22f),
                                unselectedIconColor = AuralisColors.TextMuted,
                                unselectedTextColor = AuralisColors.TextMuted
                            )
                        )
                    }
                }

                VerticalDivider(color = AuralisColors.Line, modifier = Modifier.fillMaxHeight())

                // Left / Primary Pane
                Box(
                    modifier = Modifier
                        .weight(1.05f)
                        .fillMaxHeight()
                ) {
                    PrimaryDestinationContent(
                        destination = currentDest,
                        uiState = uiState,
                        settings = settings,
                        libraryItems = libraryItems,
                        distinctArtists = distinctArtists,
                        filterState = filterState,
                        selectedItemId = activeDetailItem?.id,
                        onStartListen = ::triggerStartListening,
                        onCancelListen = { viewModel.cancelActiveRecognition() },
                        onSwitchToMicAndRetry = { viewModel.switchToMicrophoneAndRetry() },
                        onOpenMatchedResult = {
                            uiState.matchedItem?.let { viewModel.selectLibraryItem(it) }
                        },
                        onLibraryItemClick = { item -> viewModel.selectLibraryItem(item) },
                        onExportJson = { exportJsonLauncher.launch("auralis-library.json") },
                        viewModel = viewModel
                    )
                }

                VerticalDivider(color = AuralisColors.Line, modifier = Modifier.fillMaxHeight())

                // Right / Detail Pane (shows current/selected TrackMatch or empty prompt)
                Box(
                    modifier = Modifier
                        .weight(0.95f)
                        .fillMaxHeight()
                ) {
                    val detailItem = activeDetailItem ?: libraryItems.firstOrNull()
                    if (detailItem != null) {
                        ResultScreen(
                            item = detailItem,
                            onToggleFavorite = { viewModel.toggleFavorite(it) },
                            onIdentifyAnother = {
                                currentDest = TopLevelDestination.LISTEN
                                triggerStartListening()
                            },
                            onBackClick = null
                        )
                    } else {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .fillMaxSize()
                                .background(AuralisColors.Midnight)
                                .padding(32.dp)
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                AuralisMark(size = 52.dp)
                                Spacer(modifier = Modifier.height(14.dp))
                                Text(
                                    text = "Track Details",
                                    style = MaterialTheme.typography.titleLarge,
                                    color = AuralisColors.TextPrimary
                                )
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "Identify a song or select an item from your Library to inspect its metadata, timecode, and listening links.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = AuralisColors.TextMuted
                                )
                            }
                        }
                    }
                }
            }
        } else {
            // Compact Phone Layout
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
                if (showCompactResultOverlay && activeDetailItem != null) {
                    ResultScreen(
                        item = activeDetailItem,
                        onToggleFavorite = { viewModel.toggleFavorite(it) },
                        onIdentifyAnother = {
                            showCompactResultOverlay = false
                            currentDest = TopLevelDestination.LISTEN
                            viewModel.resetToIdle()
                            triggerStartListening()
                        },
                        onBackClick = { showCompactResultOverlay = false }
                    )
                } else {
                    PrimaryDestinationContent(
                        destination = currentDest,
                        uiState = uiState,
                        settings = settings,
                        libraryItems = libraryItems,
                        distinctArtists = distinctArtists,
                        filterState = filterState,
                        selectedItemId = activeDetailItem?.id,
                        onStartListen = ::triggerStartListening,
                        onCancelListen = { viewModel.cancelActiveRecognition() },
                        onSwitchToMicAndRetry = { viewModel.switchToMicrophoneAndRetry() },
                        onOpenMatchedResult = {
                            uiState.matchedItem?.let {
                                viewModel.selectLibraryItem(it)
                                showCompactResultOverlay = true
                            }
                        },
                        onLibraryItemClick = { item ->
                            viewModel.selectLibraryItem(item)
                            showCompactResultOverlay = true
                        },
                        onExportJson = { exportJsonLauncher.launch("auralis-library.json") },
                        viewModel = viewModel
                    )
                }
            }
        }
    }
}

@Composable
private fun PrimaryDestinationContent(
    destination: TopLevelDestination,
    uiState: app.auralis.ui.RecognitionUiState,
    settings: app.auralis.data.UserSettingsState,
    libraryItems: List<app.auralis.model.LibraryItem>,
    distinctArtists: List<String>,
    filterState: app.auralis.ui.LibraryFilterState,
    selectedItemId: String?,
    onStartListen: () -> Unit,
    onCancelListen: () -> Unit,
    onSwitchToMicAndRetry: () -> Unit,
    onOpenMatchedResult: () -> Unit,
    onLibraryItemClick: (app.auralis.model.LibraryItem) -> Unit,
    onExportJson: () -> Unit,
    viewModel: AuralisViewModel
) {
    when (destination) {
        TopLevelDestination.LISTEN -> ListenScreen(
            uiState = uiState,
            settings = settings,
            onStartListenClick = onStartListen,
            onCancelClick = onCancelListen,
            onSelectCaptureMode = { viewModel.setCaptureMode(it) },
            onSwitchToMicAndRetry = onSwitchToMicAndRetry,
            onOpenMatchedResult = onOpenMatchedResult
        )

        TopLevelDestination.LIBRARY -> LibraryScreen(
            items = libraryItems,
            distinctArtists = distinctArtists,
            filterState = filterState,
            selectedItemId = selectedItemId,
            onTabSelected = { viewModel.setLibraryTab(it) },
            onSearchQueryChange = { viewModel.setSearchQuery(it) },
            onArtistSelected = { viewModel.setArtistFilter(it) },
            onDateRangeSelected = { viewModel.setDateRangeFilter(it) },
            onItemClick = onLibraryItemClick,
            onToggleFavorite = { viewModel.toggleFavorite(it) },
            onDeleteItem = { viewModel.deleteLibraryItem(it.id) },
            onClearAllConfirmed = { viewModel.clearAllLibrary() },
            onExportJsonClick = onExportJson
        )

        TopLevelDestination.SETTINGS -> SettingsScreen(
            settings = settings,
            uiState = uiState,
            onSelectCaptureMode = { viewModel.setCaptureMode(it) },
            onSelectMicDevice = { viewModel.setPreferredMicDevice(it) },
            onRefreshMicDevices = { viewModel.refreshInputDevices() },
            onSelectProvider = { viewModel.setSelectedProvider(it) },
            onSaveApiBaseUrl = { viewModel.saveApiBaseUrl(it) },
            onResetApiBaseUrl = { viewModel.resetApiBaseUrl() },
            onRegisterAccount = { email, pass -> viewModel.registerAccount(email, pass) },
            onLoginAccount = { email, pass -> viewModel.loginAccount(email, pass) },
            onSyncNow = { viewModel.syncLibraryNow() },
            onSignOut = { viewModel.signOut() },
            onDeleteAccount = { viewModel.deleteAccountAndData() }
        )
    }
}
