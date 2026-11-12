package app.auralis

import android.app.Application
import app.auralis.audio.MicrophoneCapture
import app.auralis.audio.PlaybackCapture
import app.auralis.data.AuralisDatabase
import app.auralis.data.AuralisPreferences
import app.auralis.data.LibraryRepository
import app.auralis.recognition.AuralisApiClient
import app.auralis.recognition.ServerRecognitionProvider
import app.auralis.recognition.shazamkit.ShazamKitProvider

/**
 * Application singleton holding Auralis repositories, preferences, audio capture adapters,
 * and recognition providers.
 */
class AuralisApp : Application() {

    lateinit var preferences: AuralisPreferences
        private set

    lateinit var database: AuralisDatabase
        private set

    lateinit var libraryRepository: LibraryRepository
        private set

    lateinit var apiClient: AuralisApiClient
        private set

    lateinit var serverRecognitionProvider: ServerRecognitionProvider
        private set

    lateinit var shazamKitProvider: ShazamKitProvider
        private set

    lateinit var microphoneCapture: MicrophoneCapture
        private set

    lateinit var playbackCapture: PlaybackCapture
        private set

    override fun onCreate() {
        super.onCreate()
        preferences = AuralisPreferences(this)
        database = AuralisDatabase.getInstance(this)
        libraryRepository = LibraryRepository(database.libraryDao())

        apiClient = AuralisApiClient(
            baseUrlProvider = { preferences.currentApiBaseUrl() },
            installIdProvider = { preferences.currentInstallId() },
            authTokenProvider = { preferences.currentAuthToken() },
            clientVersion = BuildConfig.VERSION_NAME
        )

        serverRecognitionProvider = ServerRecognitionProvider(apiClient)
        shazamKitProvider = ShazamKitProvider(apiClient)
        microphoneCapture = MicrophoneCapture(this)
        playbackCapture = PlaybackCapture(this)
    }
}
