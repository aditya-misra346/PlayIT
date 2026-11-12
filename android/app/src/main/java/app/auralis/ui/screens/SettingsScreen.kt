package app.auralis.ui.screens

import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.auralis.BuildConfig
import app.auralis.audio.AudioCaptureMode
import app.auralis.audio.AudioInputDevice
import app.auralis.data.UserSettingsState
import app.auralis.ui.RecognitionUiState
import app.auralis.ui.components.CreatorFooter
import app.auralis.ui.theme.AuralisColors

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    settings: UserSettingsState,
    uiState: RecognitionUiState,
    onSelectCaptureMode: (AudioCaptureMode) -> Unit,
    onSelectMicDevice: (Int?) -> Unit,
    onRefreshMicDevices: () -> Unit,
    onSelectProvider: (String) -> Unit,
    onSaveApiBaseUrl: (String) -> Unit,
    onResetApiBaseUrl: () -> Unit,
    onRegisterAccount: (String, String) -> Unit,
    onLoginAccount: (String, String) -> Unit,
    onSyncNow: () -> Unit,
    onSignOut: () -> Unit,
    onDeleteAccount: () -> Unit,
    modifier: Modifier = Modifier
) {
    var apiBaseDraft by rememberSaveable(settings.apiBaseUrl) { mutableStateOf(settings.apiBaseUrl) }
    var emailInput by rememberSaveable { mutableStateOf("") }
    var passwordInput by rememberSaveable { mutableStateOf("") }
    var showDeleteAccountConfirm by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        onRefreshMicDevices()
    }

    if (showDeleteAccountConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteAccountConfirm = false },
            containerColor = AuralisColors.Charcoal,
            titleContentColor = AuralisColors.TextPrimary,
            textContentColor = AuralisColors.TextMuted,
            title = { Text("Delete Account Permanently?") },
            text = {
                Text("This calls DELETE /api/v1/account and permanently deletes your user account and all synced library items.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDeleteAccountConfirm = false
                        onDeleteAccount()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = AuralisColors.Danger)
                ) {
                    Text("Delete Account")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteAccountConfirm = false }) {
                    Text("Cancel", color = AuralisColors.TextPrimary)
                }
            }
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AuralisColors.Midnight)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text(
            text = "Settings",
            style = MaterialTheme.typography.headlineMedium,
            color = AuralisColors.TextPrimary
        )

        // 1. Audio Capture Mode & Microphone Picker
        SettingsSectionCard(
            title = "Audio Capture & Microphone",
            icon = Icons.Default.Mic
        ) {
            Text(
                text = "Capture Mode",
                style = MaterialTheme.typography.titleMedium,
                color = AuralisColors.TextPrimary
            )
            Spacer(modifier = Modifier.height(8.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = settings.captureMode == AudioCaptureMode.MICROPHONE,
                    onClick = { onSelectCaptureMode(AudioCaptureMode.MICROPHONE) },
                    label = { Text("Microphone (Unprocessed)") },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = AuralisColors.ElectricBlue.copy(alpha = 0.24f),
                        selectedLabelColor = AuralisColors.TextPrimary
                    )
                )

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    FilterChip(
                        selected = settings.captureMode == AudioCaptureMode.PLAYBACK,
                        onClick = { onSelectCaptureMode(AudioCaptureMode.PLAYBACK) },
                        label = { Text("Device Audio (Android 10+)") },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AuralisColors.ElectricBlue.copy(alpha = 0.24f),
                            selectedLabelColor = AuralisColors.TextPrimary
                        )
                    )
                }
            }

            if (settings.captureMode == AudioCaptureMode.PLAYBACK) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Uses AudioPlaybackCaptureConfiguration via MediaProjection. Source apps that set allowAudioPlaybackCapture=\"false\" (ALLOW_CAPTURE_BY_NONE) will produce silence; Auralis will automatically prompt you to switch to Microphone mode.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AuralisColors.TextMuted
                )
            }

            Spacer(modifier = Modifier.height(14.dp))
            HorizontalDivider(color = AuralisColors.Line)
            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Preferred Microphone Input",
                    style = MaterialTheme.typography.titleMedium,
                    color = AuralisColors.TextPrimary
                )
                IconButton(onClick = onRefreshMicDevices) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Refresh input devices",
                        tint = AuralisColors.Cyan
                    )
                }
            }

            MicDeviceRadioOption(
                title = "System Default Microphone",
                subtitle = "Uses Android's default music-grade input routing",
                selected = settings.preferredMicDeviceId == null,
                onClick = { onSelectMicDevice(null) }
            )

            uiState.availableInputDevices.forEach { device: AudioInputDevice ->
                MicDeviceRadioOption(
                    title = device.name,
                    subtitle = buildString {
                        append("Device ID ${device.id}")
                        if (device.isBluetoothSco) append(" • Bluetooth SCO")
                        if (device.isDefault) append(" • Built-in")
                    },
                    selected = settings.preferredMicDeviceId == device.id,
                    onClick = { onSelectMicDevice(device.id) }
                )
            }
        }

        // 2. Recognition Server & Provider Selection
        SettingsSectionCard(
            title = "Recognition Server & Providers",
            icon = Icons.Default.Info
        ) {
            Text(
                text = "API Base URL",
                style = MaterialTheme.typography.titleMedium,
                color = AuralisColors.TextPrimary
            )
            Spacer(modifier = Modifier.height(6.dp))
            OutlinedTextField(
                value = apiBaseDraft,
                onValueChange = { apiBaseDraft = it },
                singleLine = true,
                placeholder = { Text(BuildConfig.API_BASE) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = AuralisColors.Cyan,
                    unfocusedBorderColor = AuralisColors.Line,
                    focusedContainerColor = AuralisColors.Midnight,
                    unfocusedContainerColor = AuralisColors.Midnight
                ),
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = { onSaveApiBaseUrl(apiBaseDraft) },
                    colors = ButtonDefaults.buttonColors(containerColor = AuralisColors.ElectricBlue),
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Text("Save & Test")
                }
                OutlinedButton(
                    onClick = {
                        apiBaseDraft = BuildConfig.API_BASE
                        onResetApiBaseUrl()
                    },
                    border = BorderStroke(1.dp, AuralisColors.Line),
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Text("Reset Default")
                }
            }

            Spacer(modifier = Modifier.height(14.dp))
            HorizontalDivider(color = AuralisColors.Line)
            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text = "Recognition Provider",
                style = MaterialTheme.typography.titleMedium,
                color = AuralisColors.TextPrimary
            )
            Spacer(modifier = Modifier.height(6.dp))

            val providerOptions = listOf(
                Triple("server", "Server Primary (Auto)", "Uses the server's configured primary provider (e.g. AudD)"),
                Triple("audd", "AudD (Server)", "16 kHz mono WAV matched via AudD"),
                Triple("acrcloud", "ACRCloud (Server)", "16 kHz mono WAV matched via ACRCloud (includes confidence score)"),
                Triple(
                    "shazamkit",
                    "On-Device ShazamKit",
                    if (uiState.shazamKitAvailableOnDevice) {
                        "ShazamKit Android AAR detected • Token fetched from /api/v1/shazamkit/token"
                    } else {
                        "Optional: drop shazamkit-android-release.aar into app/libs/ to enable"
                    }
                )
            )

            providerOptions.forEach { (id, label, desc) ->
                MicDeviceRadioOption(
                    title = label,
                    subtitle = desc,
                    selected = settings.selectedProvider == id,
                    onClick = { onSelectProvider(id) }
                )
            }
        }

        // 3. Privacy Disclosure
        SettingsSectionCard(
            title = "Privacy & Audio Processing Disclosure",
            icon = Icons.Default.Security
        ) {
            Text(
                text = settings.disclosureText,
                style = MaterialTheme.typography.bodyLarge,
                color = AuralisColors.TextPrimary
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "• Never records in the background: audio capture starts only when you tap Identify and stops immediately after ${settings.targetSeconds}s or when you leave the app.\n" +
                    "• Pre-upload quality gate: silent or too-quiet clips (< -50 dBFS) are rejected locally on your device and never uploaded.\n" +
                    "• Local storage: only recognized track metadata (LibraryItem) is stored in your Room database. Raw audio is never written to disk.",
                style = MaterialTheme.typography.bodyMedium,
                color = AuralisColors.TextMuted
            )
        }

        // 4. Optional Accounts & Cloud Sync
        SettingsSectionCard(
            title = "Account & Cloud Sync (Optional)",
            icon = Icons.Default.Person
        ) {
            if (settings.isSignedIn) {
                Text(
                    text = "Signed in as ${settings.userEmail}",
                    style = MaterialTheme.typography.titleMedium,
                    color = AuralisColors.Cyan
                )
                if (!settings.lastSyncServerTime.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Last synced: ${settings.lastSyncServerTime}",
                        style = MaterialTheme.typography.labelMedium,
                        color = AuralisColors.TextMuted
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Button(
                        onClick = onSyncNow,
                        enabled = !uiState.isBusyAuthOrSync,
                        colors = ButtonDefaults.buttonColors(containerColor = AuralisColors.ElectricBlue),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.CloudSync,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Sync Library Now")
                    }

                    OutlinedButton(
                        onClick = onSignOut,
                        enabled = !uiState.isBusyAuthOrSync,
                        border = BorderStroke(1.dp, AuralisColors.Line),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Text("Sign Out")
                    }

                    OutlinedButton(
                        onClick = { showDeleteAccountConfirm = true },
                        enabled = !uiState.isBusyAuthOrSync,
                        border = BorderStroke(1.dp, AuralisColors.Danger),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = AuralisColors.Danger),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.DeleteForever,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Delete Account")
                    }
                }
            } else {
                Text(
                    text = "Local recognition history works without an account. Sign in or register to sync your library across devices.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AuralisColors.TextMuted
                )
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedTextField(
                    value = emailInput,
                    onValueChange = { emailInput = it },
                    label = { Text("Email") },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = AuralisColors.Cyan,
                        unfocusedBorderColor = AuralisColors.Line
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = passwordInput,
                    onValueChange = { passwordInput = it },
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = AuralisColors.Cyan,
                        unfocusedBorderColor = AuralisColors.Line
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { onLoginAccount(emailInput, passwordInput) },
                        enabled = !uiState.isBusyAuthOrSync && emailInput.isNotBlank() && passwordInput.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = AuralisColors.ElectricBlue),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Text("Sign In")
                    }
                    OutlinedButton(
                        onClick = { onRegisterAccount(emailInput, passwordInput) },
                        enabled = !uiState.isBusyAuthOrSync && emailInput.isNotBlank() && passwordInput.isNotBlank(),
                        border = BorderStroke(1.dp, AuralisColors.Cyan),
                        shape = RoundedCornerShape(20.dp)
                    ) {
                        Text("Create Account")
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
        CreatorFooter()
        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun SettingsSectionCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable () -> Unit
) {
    Surface(
        color = AuralisColors.Deep,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, AuralisColors.Line),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = AuralisColors.Cyan,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    color = AuralisColors.TextPrimary
                )
            }
            Spacer(modifier = Modifier.height(14.dp))
            content()
        }
    }
}

@Composable
private fun MicDeviceRadioOption(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick,
            colors = RadioButtonDefaults.colors(
                selectedColor = AuralisColors.Cyan,
                unselectedColor = AuralisColors.TextMuted
            )
        )
        Spacer(modifier = Modifier.width(6.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = AuralisColors.TextPrimary
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.labelMedium,
                color = AuralisColors.TextMuted
            )
        }
    }
}
