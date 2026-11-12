package app.auralis.audio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import app.auralis.R
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.atomic.AtomicReference

/**
 * Foreground service of type `mediaProjection` required on Android 10+ (and strictly enforced on
 * Android 14 / API 34+) to hold a user-approved [MediaProjection] session while Auralis captures
 * internal device playback audio.
 *
 * Never records in the background: starts immediately before a 10-second capture and stops as soon
 * as capture finishes or is cancelled.
 */
class PlaybackCaptureService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopProjectionAndSelf()
            return START_NOT_STICKY
        }

        ensureNotificationChannel()
        val notification = buildNotification()

        try {
            val fgType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, fgType)
        } catch (t: Throwable) {
            pendingProjectionDeferred.getAndSet(null)?.completeExceptionally(t)
            stopSelf()
            return START_NOT_STICKY
        }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        if (resultData == null || resultCode == 0) {
            pendingProjectionDeferred.getAndSet(null)?.completeExceptionally(
                IllegalStateException("Missing MediaProjection consent data.")
            )
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            val mpManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val projection = mpManager.getMediaProjection(resultCode, resultData)
            if (projection != null) {
                activeProjection.set(projection)
                pendingProjectionDeferred.getAndSet(null)?.complete(projection)
            } else {
                pendingProjectionDeferred.getAndSet(null)?.completeExceptionally(
                    IllegalStateException("MediaProjectionManager returned null projection.")
                )
                stopSelf()
            }
        } catch (t: Throwable) {
            pendingProjectionDeferred.getAndSet(null)?.completeExceptionally(t)
            stopSelf()
        }

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseActiveProjection()
        super.onDestroy()
    }

    private fun stopProjectionAndSelf() {
        releaseActiveProjection()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.capture_channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.capture_channel_desc)
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.capture_notification_title))
            .setContentText(getString(R.string.capture_notification_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "auralis_playback_capture"
        private const val NOTIFICATION_ID = 4102
        private const val ACTION_START = "app.auralis.action.START_PLAYBACK_CAPTURE"
        private const val ACTION_STOP = "app.auralis.action.STOP_PLAYBACK_CAPTURE"
        private const val EXTRA_RESULT_CODE = "extra_result_code"
        private const val EXTRA_RESULT_DATA = "extra_result_data"

        private val activeProjection = AtomicReference<MediaProjection?>(null)
        private val pendingProjectionDeferred = AtomicReference<CompletableDeferred<MediaProjection>?>(null)

        suspend fun startAndAwaitProjection(
            context: Context,
            resultCode: Int,
            resultData: Intent
        ): MediaProjection {
            val deferred = CompletableDeferred<MediaProjection>()
            pendingProjectionDeferred.getAndSet(deferred)?.cancel()

            val intent = Intent(context, PlaybackCaptureService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, resultData)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            return deferred.await()
        }

        fun stopServiceAndRelease(context: Context) {
            releaseActiveProjection()
            runCatching {
                val stopIntent = Intent(context, PlaybackCaptureService::class.java).apply {
                    action = ACTION_STOP
                }
                context.stopService(stopIntent)
            }
        }

        private fun releaseActiveProjection() {
            activeProjection.getAndSet(null)?.let { proj ->
                runCatching { proj.stop() }
            }
        }
    }
}
