package app.auralis.recognition

import app.auralis.dsp.AudioQualityMetrics
import app.auralis.dsp.ProcessedAudio
import app.auralis.dsp.WavEncoder
import app.auralis.model.RecognitionState
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuralisApiClientTest {

    private lateinit var server: MockWebServer
    private lateinit var apiClient: AuralisApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        apiClient = AuralisApiClient(
            baseUrlProvider = { server.url("/").toString().trimEnd('/') },
            installIdProvider = { "test-install-uuid-1234" },
            authTokenProvider = { "test-jwt-token" },
            clientVersion = "1.0.0-test"
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun dummyProcessedAudio(): ProcessedAudio {
        val samples = FloatArray(16000) { 0.4f }
        return ProcessedAudio(
            wavBytes = WavEncoder.encodePcm16MonoWav(samples, 16000),
            samples16k = samples,
            durationMs = 1000L,
            sampleRate = 16000,
            metrics = AudioQualityMetrics(
                rmsDbfs = -12.0,
                peak = 0.4,
                clippingRatio = 0.0,
                silenceRatio = 0.0
            )
        )
    }

    @Test
    fun `recognize sends contract headers and parses TrackMatch on 200 match`() = runTest {
        val mockJson = """
            {
              "status": "match",
              "requestId": "req_99",
              "latencyMs": 1420,
              "provider": { "id": "audd", "name": "AudD" },
              "result": {
                "id": "isrc:USUM71703861",
                "title": "Midnight Horizon",
                "artists": ["Aurora Pulse"],
                "artist": "Aurora Pulse",
                "album": "Nocturne Signals",
                "releaseDate": "2023-09-15",
                "year": 2023,
                "genres": ["Electronic", "Synthwave"],
                "label": "Auralis Records",
                "isrc": "USUM71703861",
                "durationMs": 215000,
                "artwork": {
                  "url": "https://example.com/art-1000.jpg",
                  "thumbUrl": "https://example.com/art-300.jpg",
                  "width": 1000,
                  "height": 1000
                },
                "previewUrl": null,
                "links": [
                  { "service": "spotify", "url": "https://open.spotify.com/track/123", "label": "Spotify" }
                ],
                "match": {
                  "provider": "audd",
                  "offsetMs": 61000,
                  "timecode": "01:01",
                  "confidence": null,
                  "recognizedAt": "2026-11-12T09:45:00Z",
                  "source": "microphone",
                  "platform": "android"
                }
              }
            }
        """.trimIndent()

        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(mockJson)
        )

        val outcome = apiClient.recognize(
            audio = dummyProcessedAudio(),
            source = "microphone"
        )

        val recorded = server.takeRequest()
        assertEquals("/api/v1/recognize", recorded.path)
        assertEquals("android/1.0.0-test", recorded.getHeader("X-Auralis-Client"))
        assertEquals("test-install-uuid-1234", recorded.getHeader("X-Auralis-Install"))
        assertEquals("Bearer test-jwt-token", recorded.getHeader("Authorization"))
        assertTrue(recorded.getHeader("Content-Type")!!.startsWith("multipart/form-data"))

        assertTrue(outcome is RecognitionOutcome.Match)
        val match = outcome as RecognitionOutcome.Match
        assertEquals(RecognitionState.MATCHED, match.toRecognitionState())
        assertEquals("Midnight Horizon", match.track.title)
        assertEquals("Aurora Pulse", match.track.artist)
        assertEquals("01:01", match.track.match.timecode)
        assertNull(match.track.match.confidence)
        assertEquals(1, match.track.links.size)
        assertEquals("spotify", match.track.links.first().service)
    }

    @Test
    fun `recognize maps 422 AUDIO_SILENT to TooQuiet state and 503 NOT_CONFIGURED to ServiceUnavailable`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(422)
                .setBody("""{"error":{"code":"AUDIO_SILENT","message":"Sample is silent","retryable":false}}""")
        )

        val silentOutcome = apiClient.recognize(dummyProcessedAudio(), "microphone")
        assertTrue(silentOutcome is RecognitionOutcome.TooQuiet)
        assertEquals(RecognitionState.TOO_QUIET, silentOutcome.toRecognitionState())

        server.enqueue(
            MockResponse()
                .setResponseCode(503)
                .setBody("""{"error":{"code":"NOT_CONFIGURED","message":"AudD API key missing","retryable":false}}""")
        )

        val unconfiguredOutcome = apiClient.recognize(dummyProcessedAudio(), "microphone")
        assertTrue(unconfiguredOutcome is RecognitionOutcome.ServiceUnavailable)
        assertEquals(RecognitionState.SERVICE_UNAVAILABLE, unconfiguredOutcome.toRecognitionState())
    }
}
