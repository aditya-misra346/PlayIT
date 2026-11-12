package app.auralis.ui

import android.app.Application
import android.content.Intent
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.auralis.AuralisApp
import app.auralis.audio.AudioCaptureMode
import app.auralis.audio.AudioCaptureProgressListener
import app.auralis.audio.AudioCaptureResult
import app.auralis.audio.AudioInputDevice
import app.auralis.data.UserSettingsState
import app.auralis.dsp.AudioDsp
import app.auralis.dsp.AudioQualityMetrics
import app.auralis.dsp.LiveLevel
import app.auralis.model.LibraryItem
import app.auralis.model.ProviderConfigInfo
import app.auralis.model.RecognitionState
import app.auralis.model.TrackMatch
import app.auralis.recognition.RecognitionOutcome
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.temporal.ChronoUnit

enum class DateRangeFilter(val label: String, val daysBack: Long?) {
    ALL("All time", null),
    TODAY("Today", 1L),
    LAST_7_DAYS("Last 7 days", 7L),
    LAST_30_DAYS("Last 30 days", 30L)
}

enum class LibraryTab(val label: String) {
    ALL("All History"),
    FAVORITES("Favorites")
}

data class RecognitionUiState(
    val state: RecognitionState = RecognitionState.IDLE,
    val statusDetail: String? = null,
    val liveLevel: LiveLevel = LiveLevel.SILENT,
    val elapsedMs: Long = 0L,
    val targetMs: Long = 10_000L,
    val lastMetrics: AudioQualityMetrics? = null,
    val clippingHint: String? = null,
    val silentPlaybackFallbackPrompt: String? = null,
    val matchedItem: LibraryItem? = null,
    val selectedDetailItem: LibraryItem? = null,
    val availableInputDevices: List<AudioInputDevice> = emptyList(),
    val serverProviders: List<ProviderConfigInfo> = emptyList(),
    val shazamKitAvailableOnDevice: Boolean = false,
    val serverShazamKitTokensConfigured: Boolean = false,
    val isBusyAuthOrSync: Boolean = false,
    val bannerMessage: String? = null
)

data class LibraryFilterState(
    val tab: LibraryTab = LibraryTab.ALL,
    val searchQuery: String = "",
    val selectedArtist: String? = null,
    val dateRange: DateRangeFilter = DateRangeFilter.ALL
)

class AuralisViewModel(application: Application) : AndroidViewModel(application) {

    private val app: AuralisApp = application as AuralisApp
    private val prefs = app.preferences
    private val libraryRepo = app.libraryRepository
    private val apiClient = app.apiClient
    private val micCapture = app.microphoneCapture
    private val playbackCapture = app.playbackCapture

    val settingsState: StateFlow<UserSettingsState> = prefs.settingsState

    private val _recognitionUi = MutableStateFlow(
        RecognitionUiState(
            shazamKitAvailableOnDevice = app.shazamKitProvider.isAvailable
        )
    )
    val recognitionUi: StateFlow<RecognitionUiState> = _recognitionUi.asStateFlow()

    private val _libraryFilter = MutableStateFlow(LibraryFilterState())
    val libraryFilter: StateFlow<LibraryFilterState> = _libraryFilter.asStateFlow()

    val allLibraryItems: StateFlow<List<LibraryItem>> = libraryRepo.activeItemsFlow.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = emptyList()
    )

    val distinctArtists: StateFlow<List<String>> = combine(allLibraryItems) { (items) ->
        items.map { it.track.artist.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .sorted()
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList()
    )

    val filteredLibraryItems: StateFlow<List<LibraryItem>> = combine(
        allLibraryItems,
        _libraryFilter
    ) { items, filter ->
        val now = Instant.now()
        val cutoffInstant = filter.dateRange.daysBack?.let { days ->
            now.minus(days, ChronoUnit.DAYS)
        }
        val query = filter.searchQuery.trim().lowercase()

        items.filter { item ->
            if (filter.tab == LibraryTab.FAVORITES && !item.favorite) return@filter false
            if (filter.selectedArtist != null && !item.track.artist.equals(filter.selectedArtist, ignoreCase = true)) {
                return@filter false
            }
            if (cutoffInstant != null) {
                val created = runCatching { Instant.parse(item.createdAt) }.getOrNull()
                if (created != null && created.isBefore(cutoffInstant)) return@filter false
            }
            if (query.isNotEmpty()) {
                val matchesTitle = item.track.title.lowercase().contains(query)
                val matchesArtist = item.track.artist.lowercase().contains(query)
                val matchesAlbum = item.track.album?.lowercase()?.contains(query) == true
                if (!matchesTitle && !matchesArtist && !matchesAlbum) return@filter false
            }
            true
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = emptyList()
    )

    private var activeCaptureJob: Job? = null

    init {
        refreshInputDevices()
        refreshServerConfig(silent = true)
    }

    // ---- Recognition State Machine --------------------------------------------------------------

    fun onRequestingMicrophonePermission() {
        _recognitionUi.update {
            it.copy(
                state = RecognitionState.REQUESTING_PERMISSION,
                statusDetail = RecognitionState.REQUESTING_PERMISSION.subtitle,
                clippingHint = null,
                silentPlaybackFallbackPrompt = null
            )
        }
    }

    fun onMicrophonePermissionDenied() {
        _recognitionUi.update {
            it.copy(
                state = RecognitionState.MIC_UNAVAILABLE,
                statusDetail = "Microphone permission was denied. Enable microphone access in Android Settings to identify music.",
                liveLevel = LiveLevel.SILENT
            )
        }
    }

    fun startMicrophoneRecognition() {
        cancelActiveRecognition(resetToIdle = false)
        val currentSettings = settingsState.value
        val targetSec = currentSettings.targetSeconds.coerceIn(4, 12)

        activeCaptureJob = viewModelScope.launch {
            _recognitionUi.update {
                it.copy(
                    state = RecognitionState.LISTENING,
                    statusDetail = "Listening via microphone (${targetSec}s)…",
                    liveLevel = LiveLevel.SILENT,
                    elapsedMs = 0L,
                    targetMs = targetSec * 1000L,
                    lastMetrics = null,
                    clippingHint = null,
                    silentPlaybackFallbackPrompt = null,
                    matchedItem = null
                )
            }

            val progressListener = object : AudioCaptureProgressListener {
                override fun onLevelUpdate(level: LiveLevel, elapsedMs: Long, targetMs: Long) {
                    _recognitionUi.update { prev ->
                        if (prev.state == RecognitionState.LISTENING) {
                            prev.copy(
                                liveLevel = level,
                                elapsedMs = elapsedMs,
                                targetMs = targetMs
                            )
                        } else {
                            prev
                        }
                    }
                }
            }

            try {
                val captureResult = micCapture.record(
                    targetSeconds = targetSec,
                    preferredDeviceId = currentSettings.preferredMicDeviceId,
                    listener = progressListener
                )
                handleCaptureResult(captureResult)
            } catch (ce: CancellationException) {
                throw ce
            }
        }
    }

    fun startPlaybackRecognition(resultCode: Int, resultData: Intent) {
        cancelActiveRecognition(resetToIdle = false)
        val currentSettings = settingsState.value
        val targetSec = currentSettings.targetSeconds.coerceIn(4, 12)

        activeCaptureJob = viewModelScope.launch {
            _recognitionUi.update {
                it.copy(
                    state = RecognitionState.LISTENING,
                    statusDetail = "Listening to internal device audio (${targetSec}s)…",
                    liveLevel = LiveLevel.SILENT,
                    elapsedMs = 0L,
                    targetMs = targetSec * 1000L,
                    lastMetrics = null,
                    clippingHint = null,
                    silentPlaybackFallbackPrompt = null,
                    matchedItem = null
                )
            }

            val progressListener = object : AudioCaptureProgressListener {
                override fun onLevelUpdate(level: LiveLevel, elapsedMs: Long, targetMs: Long) {
                    _recognitionUi.update { prev ->
                        if (prev.state == RecognitionState.LISTENING) {
                            prev.copy(
                                liveLevel = level,
                                elapsedMs = elapsedMs,
                                targetMs = targetMs
                            )
                        } else {
                            prev
                        }
                    }
                }
            }

            try {
                val captureResult = playbackCapture.recordFromPlayback(
                    resultCode = resultCode,
                    resultData = resultData,
                    targetSeconds = targetSec,
                    listener = progressListener
                )
                handleCaptureResult(captureResult)
            } catch (ce: CancellationException) {
                throw ce
            }
        }
    }

    private suspend fun handleCaptureResult(result: AudioCaptureResult) {
        when (result) {
            is AudioCaptureResult.Cancelled -> {
                resetToIdle()
            }
            is AudioCaptureResult.DeviceLost -> {
                refreshInputDevices()
                _recognitionUi.update {
                    it.copy(
                        state = RecognitionState.MIC_UNAVAILABLE,
                        statusDetail = result.message,
                        liveLevel = LiveLevel.SILENT
                    )
                }
            }
            is AudioCaptureResult.MicUnavailable -> {
                _recognitionUi.update {
                    it.copy(
                        state = RecognitionState.MIC_UNAVAILABLE,
                        statusDetail = result.message,
                        liveLevel = LiveLevel.SILENT
                    )
                }
            }
            is AudioCaptureResult.SilentPlaybackFallbackSuggested -> {
                _recognitionUi.update {
                    it.copy(
                        state = RecognitionState.TOO_QUIET,
                        statusDetail = result.message,
                        silentPlaybackFallbackPrompt = result.message,
                        liveLevel = LiveLevel.SILENT
                    )
                }
            }
            is AudioCaptureResult.Error -> {
                _recognitionUi.update {
                    it.copy(
                        state = RecognitionState.MIC_UNAVAILABLE,
                        statusDetail = result.message,
                        liveLevel = LiveLevel.SILENT
                    )
                }
            }
            is AudioCaptureResult.Completed -> {
                // Transition to ANALYZING (local DSP + quality gate)
                _recognitionUi.update {
                    it.copy(
                        state = RecognitionState.ANALYZING,
                        statusDetail = RecognitionState.ANALYZING.subtitle,
                        liveLevel = LiveLevel.SILENT
                    )
                }

                val processed = withContext(Dispatchers.Default) {
                    AudioDsp.preprocessAndGate(
                        pcmSamples = result.pcmSamples,
                        sampleRate = result.sampleRate,
                        channels = result.channels,
                        targetSampleRate = 16000
                    )
                }

                val metrics = processed.metrics
                if (metrics.isTooQuiet) {
                    // Contract rule: If rmsDbfs < -50 OR silenceRatio > 0.85 -> state `too_quiet`, DO NOT upload
                    _recognitionUi.update {
                        it.copy(
                            state = RecognitionState.TOO_QUIET,
                            statusDetail = metrics.tooQuietMessage,
                            lastMetrics = metrics,
                            clippingHint = null
                        )
                    }
                    return
                }

                // Contract rule: If clippingRatio > 0.05 -> still upload, show distortion hint
                val distortionHint = metrics.clippingHint
                _recognitionUi.update {
                    it.copy(
                        state = RecognitionState.IDENTIFYING,
                        statusDetail = RecognitionState.IDENTIFYING.subtitle,
                        lastMetrics = metrics,
                        clippingHint = distortionHint
                    )
                }

                val selectedProvider = settingsState.value.selectedProvider
                val outcome = if (selectedProvider == "shazamkit") {
                    app.shazamKitProvider.recognize(
                        audio = processed,
                        source = result.source
                    )
                } else {
                    val serverProviderOverride = selectedProvider.takeIf { it != "server" }
                    app.serverRecognitionProvider.recognize(
                        audio = processed,
                        source = result.source,
                        preferredServerProvider = serverProviderOverride
                    )
                }

                when (outcome) {
                    is RecognitionOutcome.Match -> {
                        val savedItem = libraryRepo.saveRecognizedTrack(outcome.track)
                        _recognitionUi.update {
                            it.copy(
                                state = RecognitionState.MATCHED,
                                statusDetail = "Identified via ${outcome.providerName}",
                                matchedItem = savedItem,
                                selectedDetailItem = savedItem
                            )
                        }
                        if (settingsState.value.isSignedIn) {
                            syncLibraryInBackground()
                        }
                    }
                    is RecognitionOutcome.NoMatch -> {
                        _recognitionUi.update {
                            it.copy(
                                state = RecognitionState.NO_MATCH,
                                statusDetail = "Checked ${outcome.providerName} — no matching song found."
                            )
                        }
                    }
                    is RecognitionOutcome.TooQuiet -> {
                        _recognitionUi.update {
                            it.copy(
                                state = RecognitionState.TOO_QUIET,
                                statusDetail = outcome.message
                            )
                        }
                    }
                    is RecognitionOutcome.ConnectionError -> {
                        _recognitionUi.update {
                            it.copy(
                                state = RecognitionState.CONNECTION_ERROR,
                                statusDetail = outcome.message
                            )
                        }
                    }
                    is RecognitionOutcome.ServiceUnavailable -> {
                        _recognitionUi.update {
                            it.copy(
                                state = RecognitionState.SERVICE_UNAVAILABLE,
                                statusDetail = outcome.message
                            )
                        }
                    }
                }
            }
        }
    }

    /**
     * Immediately stops any active capture or network recognition request.
     * Invoked on user Cancel tap and on Activity `ON_STOP` lifecycle event (no background recording).
     */
    fun cancelActiveRecognition(resetToIdle: Boolean = true) {
        activeCaptureJob?.cancel()
        activeCaptureJob = null
        if (resetToIdle) {
            resetToIdle()
        }
    }

    fun onAppStopped() {
        val currentState = _recognitionUi.value.state
        if (currentState == RecognitionState.LISTENING ||
            currentState == RecognitionState.REQUESTING_PERMISSION
        ) {
            cancelActiveRecognition(resetToIdle = true)
        }
    }

    fun resetToIdle() {
        _recognitionUi.update {
            it.copy(
                state = RecognitionState.IDLE,
                statusDetail = RecognitionState.IDLE.subtitle,
                liveLevel = LiveLevel.SILENT,
                elapsedMs = 0L,
                clippingHint = null,
                silentPlaybackFallbackPrompt = null,
                matchedItem = null
            )
        }
    }

    fun switchToMicrophoneAndRetry() {
        viewModelScope.launch {
            prefs.setCaptureMode(AudioCaptureMode.MICROPHONE)
            _recognitionUi.update { it.copy(silentPlaybackFallbackPrompt = null) }
            startMicrophoneRecognition()
        }
    }

    // ---- Detail & Library Actions ---------------------------------------------------------------

    fun selectLibraryItem(item: LibraryItem?) {
        _recognitionUi.update { it.copy(selectedDetailItem = item) }
    }

    fun toggleFavorite(item: LibraryItem) {
        viewModelScope.launch {
            val newFav = libraryRepo.toggleFavorite(item.id)
            val updated = item.copy(favorite = newFav)
            _recognitionUi.update { prev ->
                prev.copy(
                    matchedItem = if (prev.matchedItem?.id == item.id) updated else prev.matchedItem,
                    selectedDetailItem = if (prev.selectedDetailItem?.id == item.id) updated else prev.selectedDetailItem
                )
            }
            if (settingsState.value.isSignedIn) {
                syncLibraryInBackground()
            }
        }
    }

    fun deleteLibraryItem(itemId: String) {
        viewModelScope.launch {
            libraryRepo.deleteItem(itemId)
            _recognitionUi.update { prev ->
                prev.copy(
                    matchedItem = prev.matchedItem?.takeIf { it.id != itemId },
                    selectedDetailItem = prev.selectedDetailItem?.takeIf { it.id != itemId }
                )
            }
            if (settingsState.value.isSignedIn) {
                syncLibraryInBackground()
            }
        }
    }

    fun clearAllLibrary() {
        viewModelScope.launch {
            val signedIn = settingsState.value.isSignedIn
            libraryRepo.clearAll(keepTombstonesForSync = signedIn)
            _recognitionUi.update {
                it.copy(
                    matchedItem = null,
                    selectedDetailItem = null,
                    bannerMessage = "History cleared."
                )
            }
            if (signedIn) {
                apiClient.clearRemoteLibrary()
            }
        }
    }

    suspend fun exportLibraryJson(): String {
        return libraryRepo.exportActiveLibraryJson()
    }

    // ---- Library Filtering ----------------------------------------------------------------------

    fun setLibraryTab(tab: LibraryTab) {
        _libraryFilter.update { it.copy(tab = tab) }
    }

    fun setSearchQuery(query: String) {
        _libraryFilter.update { it.copy(searchQuery = query) }
    }

    fun setArtistFilter(artist: String?) {
        _libraryFilter.update { it.copy(selectedArtist = artist) }
    }

    fun setDateRangeFilter(dateRange: DateRangeFilter) {
        _libraryFilter.update { it.copy(dateRange = dateRange) }
    }

    // ---- Settings & Audio Devices ---------------------------------------------------------------

    fun refreshInputDevices() {
        val devices = micCapture.listInputDevices()
        _recognitionUi.update {
            it.copy(
                availableInputDevices = devices,
                shazamKitAvailableOnDevice = app.shazamKitProvider.isAvailable
            )
        }
    }

    fun setCaptureMode(mode: AudioCaptureMode) {
        viewModelScope.launch {
            prefs.setCaptureMode(mode)
        }
    }

    fun setPreferredMicDevice(deviceId: Int?) {
        viewModelScope.launch {
            prefs.setPreferredMicDeviceId(deviceId)
        }
    }

    fun setSelectedProvider(providerId: String) {
        viewModelScope.launch {
            prefs.setSelectedProvider(providerId)
        }
    }

    fun saveApiBaseUrl(url: String) {
        viewModelScope.launch {
            prefs.setApiBaseUrl(url)
            refreshServerConfig(silent = false)
        }
    }

    fun resetApiBaseUrl() {
        viewModelScope.launch {
            prefs.resetApiBaseUrl()
            refreshServerConfig(silent = false)
        }
    }

    fun refreshServerConfig(silent: Boolean = false) {
        viewModelScope.launch {
            val result = apiClient.fetchConfig()
            result.onSuccess { config ->
                prefs.updateFromServerConfig(config)
                _recognitionUi.update {
                    it.copy(
                        serverProviders = config.providers,
                        serverShazamKitTokensConfigured = config.shazamkitTokens,
                        bannerMessage = if (!silent) "Connected to Auralis server." else it.bannerMessage
                    )
                }
            }.onFailure { err ->
                if (!silent) {
                    _recognitionUi.update {
                        it.copy(bannerMessage = "Could not reach server: ${err.message}")
                    }
                }
            }
        }
    }

    // ---- Optional Accounts & Sync ---------------------------------------------------------------

    fun registerAccount(email: String, password: String) {
        viewModelScope.launch {
            _recognitionUi.update { it.copy(isBusyAuthOrSync = true, bannerMessage = null) }
            val res = apiClient.register(email, password)
            res.onSuccess { session ->
                prefs.saveAuthSession(session.token, session.user.id, session.user.email)
                _recognitionUi.update {
                    it.copy(isBusyAuthOrSync = false, bannerMessage = "Account created for ${session.user.email}.")
                }
                syncLibraryNow()
            }.onFailure { err ->
                _recognitionUi.update {
                    it.copy(isBusyAuthOrSync = false, bannerMessage = err.message ?: "Registration failed.")
                }
            }
        }
    }

    fun loginAccount(email: String, password: String) {
        viewModelScope.launch {
            _recognitionUi.update { it.copy(isBusyAuthOrSync = true, bannerMessage = null) }
            val res = apiClient.login(email, password)
            res.onSuccess { session ->
                prefs.saveAuthSession(session.token, session.user.id, session.user.email)
                _recognitionUi.update {
                    it.copy(isBusyAuthOrSync = false, bannerMessage = "Signed in as ${session.user.email}.")
                }
                syncLibraryNow()
            }.onFailure { err ->
                _recognitionUi.update {
                    it.copy(isBusyAuthOrSync = false, bannerMessage = err.message ?: "Sign-in failed.")
                }
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            prefs.clearAuthSession()
            _recognitionUi.update { it.copy(bannerMessage = "Signed out.") }
        }
    }

    fun syncLibraryNow() {
        viewModelScope.launch {
            _recognitionUi.update { it.copy(isBusyAuthOrSync = true) }
            val localItems = libraryRepo.getAllForSync()
            val since = settingsState.value.lastSyncServerTime
            val result = apiClient.syncLibrary(localItems, since)
            result.onSuccess { syncResp ->
                libraryRepo.mergeRemoteItems(syncResp.items)
                prefs.saveLastSyncServerTime(syncResp.serverTime)
                _recognitionUi.update {
                    it.copy(
                        isBusyAuthOrSync = false,
                        bannerMessage = "Library synced (${syncResp.items.count { !it.deleted }} tracks)."
                    )
                }
            }.onFailure { err ->
                _recognitionUi.update {
                    it.copy(
                        isBusyAuthOrSync = false,
                        bannerMessage = err.message ?: "Library sync failed."
                    )
                }
            }
        }
    }

    private fun syncLibraryInBackground() {
        viewModelScope.launch {
            val localItems = libraryRepo.getAllForSync()
            val since = settingsState.value.lastSyncServerTime
            apiClient.syncLibrary(localItems, since).onSuccess { syncResp ->
                libraryRepo.mergeRemoteItems(syncResp.items)
                prefs.saveLastSyncServerTime(syncResp.serverTime)
            }
        }
    }

    fun deleteAccountAndData() {
        viewModelScope.launch {
            _recognitionUi.update { it.copy(isBusyAuthOrSync = true) }
            val res = apiClient.deleteAccount()
            res.onSuccess {
                libraryRepo.clearAll(keepTombstonesForSync = false)
                prefs.clearAuthSession()
                _recognitionUi.update {
                    it.copy(
                        isBusyAuthOrSync = false,
                        matchedItem = null,
                        selectedDetailItem = null,
                        bannerMessage = "Your account and synced library have been permanently deleted."
                    )
                }
            }.onFailure { err ->
                _recognitionUi.update {
                    it.copy(
                        isBusyAuthOrSync = false,
                        bannerMessage = err.message ?: "Failed to delete account."
                    )
                }
            }
        }
    }

    fun clearBannerMessage() {
        _recognitionUi.update { it.copy(bannerMessage = null) }
    }
}
