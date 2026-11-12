package app.auralis.ui.screens

import android.animation.ValueAnimator
import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SpeakerPhone
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.auralis.R
import app.auralis.audio.AudioCaptureMode
import app.auralis.data.UserSettingsState
import app.auralis.model.RecognitionState
import app.auralis.ui.RecognitionUiState
import app.auralis.ui.theme.AuralisColors
import app.auralis.ui.theme.AuralisMark
import kotlin.math.max

@Composable
fun ListenScreen(
    uiState: RecognitionUiState,
    settings: UserSettingsState,
    onStartListenClick: () -> Unit,
    onCancelClick: () -> Unit,
    onSelectCaptureMode: (AudioCaptureMode) -> Unit,
    onSwitchToMicAndRetry: () -> Unit,
    onOpenMatchedResult: () -> Unit,
    modifier: Modifier = Modifier
) {
    // Respect system animator duration scale (reduced motion)
    val animationsEnabled = remember {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ValueAnimator.areAnimatorsEnabled()
        } else {
            true
        }
    }

    val scrollState = rememberScrollState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Top Brand Header + Mode Switcher
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                AuralisMark(size = 34.dp)
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(
                        text = stringResource(R.string.app_name),
                        style = MaterialTheme.typography.headlineSmall,
                        color = AuralisColors.TextPrimary
                    )
                    Text(
                        text = stringResource(R.string.tagline),
                        style = MaterialTheme.typography.labelMedium,
                        color = AuralisColors.Cyan
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Capture mode selector pills (Microphone vs Device Audio)
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                FilterChip(
                    selected = settings.captureMode == AudioCaptureMode.MICROPHONE,
                    onClick = {
                        if (!uiState.state.isActiveCaptureOrProcessing) {
                            onSelectCaptureMode(AudioCaptureMode.MICROPHONE)
                        }
                    },
                    label = { Text("Microphone") },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Mic,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                    },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = AuralisColors.ElectricBlue.copy(alpha = 0.22f),
                        selectedLabelColor = AuralisColors.TextPrimary,
                        selectedLeadingIconColor = AuralisColors.Cyan
                    )
                )

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    FilterChip(
                        selected = settings.captureMode == AudioCaptureMode.PLAYBACK,
                        onClick = {
                            if (!uiState.state.isActiveCaptureOrProcessing) {
                                onSelectCaptureMode(AudioCaptureMode.PLAYBACK)
                            }
                        },
                        label = { Text("Device Audio") },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.SpeakerPhone,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                        },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AuralisColors.ElectricBlue.copy(alpha = 0.22f),
                            selectedLabelColor = AuralisColors.TextPrimary,
                            selectedLeadingIconColor = AuralisColors.Cyan
                        )
                    )
                }
            }

            // Honest disclosure when Device Audio (PlaybackCapture) mode is active
            AnimatedVisibility(visible = settings.captureMode == AudioCaptureMode.PLAYBACK) {
                Surface(
                    color = AuralisColors.Charcoal,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, AuralisColors.Line),
                    modifier = Modifier
                        .padding(top = 10.dp)
                        .fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.VolumeUp,
                            contentDescription = null,
                            tint = AuralisColors.Cyan,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "Captures audio playing on this device (Android 10+). Note: apps that set allowAudioPlaybackCapture=false cannot be captured directly — Auralis will suggest Microphone mode if silent.",
                            style = MaterialTheme.typography.labelMedium,
                            color = AuralisColors.TextMuted
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Center Circular Audio-Reactive Listen Button
        AudioReactiveListenOrb(
            state = uiState.state,
            normalizedRms = uiState.liveLevel.normalizedRms,
            peak = uiState.liveLevel.peak,
            elapsedMs = uiState.elapsedMs,
            targetMs = uiState.targetMs,
            animationsEnabled = animationsEnabled,
            onOrbClick = {
                if (uiState.state.isActiveCaptureOrProcessing) {
                    onCancelClick()
                } else {
                    onStartListenClick()
                }
            }
        )

        Spacer(modifier = Modifier.height(16.dp))

        // State Status Card & Controls
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth()
        ) {
            StateBadgePill(state = uiState.state)

            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text = uiState.state.title,
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
                color = AuralisColors.TextPrimary
            )

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = uiState.statusDetail ?: uiState.state.subtitle,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = AuralisColors.TextMuted,
                modifier = Modifier.padding(horizontal = 12.dp)
            )

            // Live RMS dBFS & elapsed timer during LISTENING
            if (uiState.state == RecognitionState.LISTENING) {
                Spacer(modifier = Modifier.height(12.dp))
                val elapsedSec = uiState.elapsedMs / 1000.0
                val targetSec = max(1L, uiState.targetMs / 1000L)
                val dbfsText = if (uiState.liveLevel.rmsDbfs <= -95.0) {
                    "-∞ dBFS"
                } else {
                    "%.1f dBFS".format(uiState.liveLevel.rmsDbfs)
                }
                Text(
                    text = "%.1fs / %ds  •  Input level: %s".format(elapsedSec, targetSec, dbfsText),
                    style = MaterialTheme.typography.labelMedium,
                    color = AuralisColors.Cyan
                )

                // Reduced-motion level bar (also helpful for everyone)
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { uiState.liveLevel.normalizedRms.coerceIn(0f, 1f) },
                    modifier = Modifier
                        .width(200.dp)
                        .height(6.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = AuralisColors.Cyan,
                    trackColor = AuralisColors.Charcoal
                )
            }

            // Distortion / clipping warning banner (clippingRatio > 0.05)
            val clippingHint = uiState.clippingHint
            if (!clippingHint.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Surface(
                    color = AuralisColors.Warn.copy(alpha = 0.14f),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, AuralisColors.Warn.copy(alpha = 0.6f)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.WarningAmber,
                            contentDescription = null,
                            tint = AuralisColors.Warn
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = clippingHint,
                            style = MaterialTheme.typography.bodyMedium,
                            color = AuralisColors.Warn
                        )
                    }
                }
            }

            // Silent Playback Capture automatic fallback suggestion
            if (!uiState.silentPlaybackFallbackPrompt.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(14.dp))
                Button(
                    onClick = onSwitchToMicAndRetry,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = AuralisColors.ElectricBlue,
                        contentColor = AuralisColors.TextPrimary
                    ),
                    shape = RoundedCornerShape(24.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Mic,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Switch to Microphone & Listen")
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Action Buttons by State
            when {
                uiState.state.isActiveCaptureOrProcessing -> {
                    OutlinedButton(
                        onClick = onCancelClick,
                        border = BorderStroke(1.dp, AuralisColors.Danger.copy(alpha = 0.7f)),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = AuralisColors.Danger
                        ),
                        shape = RoundedCornerShape(24.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Cancel")
                    }
                }

                uiState.state == RecognitionState.MATCHED && uiState.matchedItem != null -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(
                            onClick = onOpenMatchedResult,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = AuralisColors.ElectricBlue
                            ),
                            shape = RoundedCornerShape(24.dp)
                        ) {
                            Text("View Match Details")
                        }
                        OutlinedButton(
                            onClick = onStartListenClick,
                            border = BorderStroke(1.dp, AuralisColors.Line),
                            shape = RoundedCornerShape(24.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Identify Another")
                        }
                    }
                }

                uiState.state != RecognitionState.IDLE -> {
                    Button(
                        onClick = onStartListenClick,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = AuralisColors.ElectricBlue,
                            contentColor = AuralisColors.TextPrimary
                        ),
                        shape = RoundedCornerShape(24.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Try Again")
                    }
                }
            }
        }
    }
}

@Composable
private fun AudioReactiveListenOrb(
    state: RecognitionState,
    normalizedRms: Float,
    peak: Float,
    elapsedMs: Long,
    targetMs: Long,
    animationsEnabled: Boolean,
    onOrbClick: () -> Unit
) {
    val smoothedRms by animateFloatAsState(
        targetValue = if (state == RecognitionState.LISTENING) normalizedRms.coerceIn(0f, 1f) else 0f,
        animationSpec = tween(durationMillis = if (animationsEnabled) 75 else 0),
        label = "rms_level"
    )

    val smoothedPeak by animateFloatAsState(
        targetValue = if (state == RecognitionState.LISTENING) peak.coerceIn(0f, 1f) else 0f,
        animationSpec = tween(durationMillis = if (animationsEnabled) 90 else 0),
        label = "peak_level"
    )

    val infiniteTransition = rememberInfiniteTransition(label = "orb_pulse")
    val breathingPhase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = if (state.isActiveCaptureOrProcessing) 1400 else 2800,
                easing = FastOutSlowInEasing
            ),
            repeatMode = RepeatMode.Reverse
        ),
        label = "breathing_phase"
    )

    val sweepAngleAnim by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1600, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "spinner_angle"
    )

    val effectiveBreath = if (animationsEnabled) breathingPhase else 0.3f
    val interactionSource = remember { MutableInteractionSource() }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .size(290.dp)
            .semantics {
                contentDescription = if (state.isActiveCaptureOrProcessing) {
                    "Cancel audio recognition"
                } else {
                    "Tap to identify music with Auralis"
                }
            }
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Button,
                onClick = onOrbClick
            )
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val baseRadius = size.minDimension * 0.29f

            // Three concentric audio-reactive sound rings driven by REAL AudioRecord RMS & Peak
            if (state == RecognitionState.LISTENING) {
                val outerScale1 = 1.15f + smoothedRms * 0.35f + (if (animationsEnabled) effectiveBreath * 0.06f else 0f)
                val outerScale2 = 1.32f + smoothedRms * 0.55f + smoothedPeak * 0.15f
                val outerScale3 = 1.50f + smoothedRms * 0.72f + smoothedPeak * 0.22f

                drawCircle(
                    color = AuralisColors.Teal.copy(alpha = (0.12f + smoothedRms * 0.20f).coerceAtMost(0.4f)),
                    radius = baseRadius * outerScale3,
                    center = center
                )
                drawCircle(
                    color = AuralisColors.Cyan.copy(alpha = (0.18f + smoothedRms * 0.25f).coerceAtMost(0.5f)),
                    radius = baseRadius * outerScale2,
                    center = center,
                    style = Stroke(width = 3.dp.toPx())
                )
                drawCircle(
                    color = AuralisColors.ElectricBlue.copy(alpha = (0.28f + smoothedRms * 0.35f).coerceAtMost(0.7f)),
                    radius = baseRadius * outerScale1,
                    center = center,
                    style = Stroke(width = 4.dp.toPx())
                )

                // Elapsed capture progress arc
                val progress = if (targetMs > 0L) {
                    (elapsedMs.toFloat() / targetMs.toFloat()).coerceIn(0f, 1f)
                } else {
                    0f
                }
                val arcRadius = baseRadius * 1.10f
                drawArc(
                    brush = Brush.sweepGradient(
                        listOf(AuralisColors.ElectricBlue, AuralisColors.Cyan, AuralisColors.Teal, AuralisColors.ElectricBlue)
                    ),
                    startAngle = -90f,
                    sweepAngle = 360f * progress,
                    useCenter = false,
                    topLeft = Offset(center.x - arcRadius, center.y - arcRadius),
                    size = Size(arcRadius * 2f, arcRadius * 2f),
                    style = Stroke(width = 5.dp.toPx(), cap = StrokeCap.Round)
                )
            } else if (state == RecognitionState.ANALYZING || state == RecognitionState.IDENTIFYING) {
                val ringRadius = baseRadius * 1.16f
                drawCircle(
                    color = AuralisColors.Line,
                    radius = ringRadius,
                    center = center,
                    style = Stroke(width = 4.dp.toPx())
                )
                val startDeg = if (animationsEnabled) sweepAngleAnim else -90f
                drawArc(
                    color = AuralisColors.Cyan,
                    startAngle = startDeg,
                    sweepAngle = 110f,
                    useCenter = false,
                    topLeft = Offset(center.x - ringRadius, center.y - ringRadius),
                    size = Size(ringRadius * 2f, ringRadius * 2f),
                    style = Stroke(width = 5.dp.toPx(), cap = StrokeCap.Round)
                )
            } else {
                // Idle / terminal state subtle halo rings
                val idleScale = 1.14f + (if (animationsEnabled) effectiveBreath * 0.05f else 0f)
                drawCircle(
                    color = AuralisColors.ElectricBlue.copy(alpha = 0.14f),
                    radius = baseRadius * (idleScale + 0.14f),
                    center = center
                )
                drawCircle(
                    color = AuralisColors.Cyan.copy(alpha = 0.22f),
                    radius = baseRadius * idleScale,
                    center = center,
                    style = Stroke(width = 2.dp.toPx())
                )
            }
        }

        // Core button circle with signature gradient
        val coreSize = 168.dp
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(coreSize)
                .clip(CircleShape)
                .background(
                    brush = when (state) {
                        RecognitionState.MIC_UNAVAILABLE,
                        RecognitionState.CONNECTION_ERROR,
                        RecognitionState.SERVICE_UNAVAILABLE -> Brush.linearGradient(
                            colors = listOf(AuralisColors.Charcoal, AuralisColors.Danger.copy(alpha = 0.45f))
                        )
                        RecognitionState.TOO_QUIET,
                        RecognitionState.NO_MATCH -> Brush.linearGradient(
                            colors = listOf(AuralisColors.Charcoal, AuralisColors.Warn.copy(alpha = 0.40f))
                        )
                        else -> AuralisColors.signatureGradient()
                    }
                )
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                val icon = when (state) {
                    RecognitionState.LISTENING -> Icons.Default.GraphicEq
                    RecognitionState.MIC_UNAVAILABLE -> Icons.Default.MicOff
                    RecognitionState.CONNECTION_ERROR -> Icons.Default.WifiOff
                    RecognitionState.SERVICE_UNAVAILABLE -> Icons.Default.ErrorOutline
                    else -> null
                }
                if (icon != null) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = AuralisColors.TextPrimary,
                        modifier = Modifier.size(48.dp)
                    )
                } else {
                    // Draw high-contrast Auralis mark in white/midnight inside the core button
                    AuralisOrbCenterMark(size = 56.dp)
                }

                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = when {
                        state == RecognitionState.LISTENING -> "LISTENING"
                        state == RecognitionState.ANALYZING -> "ANALYZING"
                        state == RecognitionState.IDENTIFYING -> "MATCHING"
                        else -> "IDENTIFY"
                    },
                    style = MaterialTheme.typography.labelLarge.copy(
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.4.sp
                    ),
                    color = AuralisColors.TextPrimary
                )
            }
        }
    }
}

@Composable
private fun AuralisOrbCenterMark(size: androidx.compose.ui.unit.Dp) {
    Canvas(modifier = Modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height
        val center = Offset(w * 0.35f, h * 0.5f)
        val dotRadius = w * 0.16f

        drawCircle(
            color = Color.White,
            radius = dotRadius,
            center = center
        )

        val strokeWidth = (w * 0.08f).coerceAtLeast(2.5f)
        val radii = listOf(w * 0.28f, w * 0.41f, w * 0.54f)
        radii.forEach { r ->
            val topLeft = Offset(center.x - r, center.y - r)
            drawArc(
                color = Color.White,
                startAngle = -52f,
                sweepAngle = 104f,
                useCenter = false,
                topLeft = topLeft,
                size = Size(r * 2f, r * 2f),
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
            )
        }
    }
}

@Composable
private fun StateBadgePill(state: RecognitionState) {
    val badgeColor = when (state) {
        RecognitionState.MATCHED -> AuralisColors.Teal
        RecognitionState.LISTENING,
        RecognitionState.ANALYZING,
        RecognitionState.IDENTIFYING -> AuralisColors.Cyan
        RecognitionState.TOO_QUIET,
        RecognitionState.NO_MATCH,
        RecognitionState.REQUESTING_PERMISSION -> AuralisColors.Warn
        RecognitionState.MIC_UNAVAILABLE,
        RecognitionState.CONNECTION_ERROR,
        RecognitionState.SERVICE_UNAVAILABLE -> AuralisColors.Danger
        RecognitionState.IDLE -> AuralisColors.TextMuted
    }

    Surface(
        color = badgeColor.copy(alpha = 0.14f),
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.dp, badgeColor.copy(alpha = 0.45f))
    ) {
        Text(
            text = state.wireName.uppercase(),
            style = MaterialTheme.typography.labelMedium.copy(
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp
            ),
            color = badgeColor,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
        )
    }
}
