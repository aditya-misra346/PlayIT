package app.auralis.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.auralis.BuildConfig
import app.auralis.audio.AudioCaptureMode
import app.auralis.model.ServerConfigResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID

private val Context.auralisDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "auralis_preferences"
)

data class UserSettingsState(
    val installId: String = "",
    val apiBaseUrl: String = BuildConfig.API_BASE,
    val captureMode: AudioCaptureMode = AudioCaptureMode.MICROPHONE,
    val preferredMicDeviceId: Int? = null,
    val selectedProvider: String = "server",
    val targetSeconds: Int = 10,
    val disclosureText: String = ServerConfigResponse.DEFAULT_DISCLOSURE,
    val authToken: String? = null,
    val userId: String? = null,
    val userEmail: String? = null,
    val lastSyncServerTime: String? = null
) {
    val isSignedIn: Boolean
        get() = !authToken.isNullOrBlank() && !userEmail.isNullOrBlank()
}

class AuralisPreferences(context: Context) {

    private val dataStore = context.applicationContext.auralisDataStore
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile
    private var cachedInstallId: String = UUID.randomUUID().toString()

    val settingsFlow: Flow<UserSettingsState> = dataStore.data.map { prefs ->
        val storedInstall = prefs[KEY_INSTALL_ID]
        if (!storedInstall.isNullOrBlank()) {
            cachedInstallId = storedInstall
        }
        val modeStr = prefs[KEY_CAPTURE_MODE]
        val mode = AudioCaptureMode.entries.firstOrNull { it.name == modeStr }
            ?: AudioCaptureMode.MICROPHONE

        UserSettingsState(
            installId = storedInstall ?: cachedInstallId,
            apiBaseUrl = prefs[KEY_API_BASE]?.takeIf { it.isNotBlank() } ?: BuildConfig.API_BASE,
            captureMode = mode,
            preferredMicDeviceId = prefs[KEY_PREFERRED_MIC_ID],
            selectedProvider = prefs[KEY_SELECTED_PROVIDER] ?: "server",
            targetSeconds = (prefs[KEY_TARGET_SECONDS] ?: 10).coerceIn(4, 12),
            disclosureText = prefs[KEY_DISCLOSURE] ?: ServerConfigResponse.DEFAULT_DISCLOSURE,
            authToken = prefs[KEY_AUTH_TOKEN],
            userId = prefs[KEY_USER_ID],
            userEmail = prefs[KEY_USER_EMAIL],
            lastSyncServerTime = prefs[KEY_LAST_SYNC_TIME]
        )
    }

    val settingsState: StateFlow<UserSettingsState> = settingsFlow.stateIn(
        scope = scope,
        started = SharingStarted.Eagerly,
        initialValue = UserSettingsState(installId = cachedInstallId)
    )

    init {
        scope.launch {
            dataStore.edit { prefs ->
                val current = prefs[KEY_INSTALL_ID]
                if (current.isNullOrBlank()) {
                    prefs[KEY_INSTALL_ID] = cachedInstallId
                } else {
                    cachedInstallId = current
                }
            }
        }
    }

    fun currentInstallId(): String = settingsState.value.installId.ifBlank { cachedInstallId }

    fun currentApiBaseUrl(): String = settingsState.value.apiBaseUrl.ifBlank { BuildConfig.API_BASE }

    fun currentAuthToken(): String? = settingsState.value.authToken

    suspend fun setApiBaseUrl(url: String) {
        val cleaned = url.trim().trimEnd('/').ifEmpty { BuildConfig.API_BASE }
        dataStore.edit { it[KEY_API_BASE] = cleaned }
    }

    suspend fun resetApiBaseUrl() {
        dataStore.edit { it.remove(KEY_API_BASE) }
    }

    suspend fun setCaptureMode(mode: AudioCaptureMode) {
        dataStore.edit { it[KEY_CAPTURE_MODE] = mode.name }
    }

    suspend fun setPreferredMicDeviceId(deviceId: Int?) {
        dataStore.edit { prefs ->
            if (deviceId == null) {
                prefs.remove(KEY_PREFERRED_MIC_ID)
            } else {
                prefs[KEY_PREFERRED_MIC_ID] = deviceId
            }
        }
    }

    suspend fun setSelectedProvider(providerId: String) {
        dataStore.edit { it[KEY_SELECTED_PROVIDER] = providerId }
    }

    suspend fun updateFromServerConfig(config: ServerConfigResponse) {
        dataStore.edit { prefs ->
            prefs[KEY_TARGET_SECONDS] = config.capture.targetSeconds.coerceIn(4, 12)
            if (config.disclosure.isNotBlank()) {
                prefs[KEY_DISCLOSURE] = config.disclosure
            }
        }
    }

    suspend fun saveAuthSession(token: String, userId: String, email: String) {
        dataStore.edit { prefs ->
            prefs[KEY_AUTH_TOKEN] = token
            prefs[KEY_USER_ID] = userId
            prefs[KEY_USER_EMAIL] = email
        }
    }

    suspend fun clearAuthSession() {
        dataStore.edit { prefs ->
            prefs.remove(KEY_AUTH_TOKEN)
            prefs.remove(KEY_USER_ID)
            prefs.remove(KEY_USER_EMAIL)
            prefs.remove(KEY_LAST_SYNC_TIME)
        }
    }

    suspend fun saveLastSyncServerTime(serverTime: String) {
        dataStore.edit { it[KEY_LAST_SYNC_TIME] = serverTime }
    }

    companion object {
        private val KEY_INSTALL_ID = stringPreferencesKey("install_id")
        private val KEY_API_BASE = stringPreferencesKey("api_base_url")
        private val KEY_CAPTURE_MODE = stringPreferencesKey("capture_mode")
        private val KEY_PREFERRED_MIC_ID = intPreferencesKey("preferred_mic_device_id")
        private val KEY_SELECTED_PROVIDER = stringPreferencesKey("selected_provider")
        private val KEY_TARGET_SECONDS = intPreferencesKey("target_seconds")
        private val KEY_DISCLOSURE = stringPreferencesKey("disclosure_text")
        private val KEY_AUTH_TOKEN = stringPreferencesKey("auth_token")
        private val KEY_USER_ID = stringPreferencesKey("user_id")
        private val KEY_USER_EMAIL = stringPreferencesKey("user_email")
        private val KEY_LAST_SYNC_TIME = stringPreferencesKey("last_sync_server_time")
    }
}
