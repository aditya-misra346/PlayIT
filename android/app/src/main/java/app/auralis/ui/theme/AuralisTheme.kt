package app.auralis.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Auralis dark-only brand colors per docs/CONTRACT.md.
 */
object AuralisColors {
    val Midnight = Color(0xFF060A14)     // Background
    val Deep = Color(0xFF0B1220)         // Surface
    val Charcoal = Color(0xFF121A2B)     // Elevated surface
    val Line = Color(0xFF1E2A40)         // Borders / dividers
    val TextPrimary = Color(0xFFEAF2FF)  // Primary text
    val TextMuted = Color(0xFF8A9BB8)    // Muted text
    val ElectricBlue = Color(0xFF2F6BFF) // Primary accent
    val Cyan = Color(0xFF22D3EE)         // Secondary accent
    val Teal = Color(0xFF14B8A6)         // Tertiary accent
    val Danger = Color(0xFFFF5A6E)       // Error / destructive
    val Warn = Color(0xFFFFB547)         // Warning / distortion

    val SignatureGradientColors = listOf(ElectricBlue, Cyan, Teal)

    fun signatureGradient(
        start: Offset = Offset.Zero,
        end: Offset = Offset(800f, 800f)
    ): Brush = Brush.linearGradient(
        colors = SignatureGradientColors,
        start = start,
        end = end
    )
}

private val AuralisColorScheme = darkColorScheme(
    primary = AuralisColors.ElectricBlue,
    onPrimary = AuralisColors.TextPrimary,
    primaryContainer = AuralisColors.Charcoal,
    onPrimaryContainer = AuralisColors.TextPrimary,
    secondary = AuralisColors.Cyan,
    onSecondary = AuralisColors.Midnight,
    secondaryContainer = AuralisColors.Charcoal,
    onSecondaryContainer = AuralisColors.Cyan,
    tertiary = AuralisColors.Teal,
    onTertiary = AuralisColors.Midnight,
    background = AuralisColors.Midnight,
    onBackground = AuralisColors.TextPrimary,
    surface = AuralisColors.Deep,
    onSurface = AuralisColors.TextPrimary,
    surfaceVariant = AuralisColors.Charcoal,
    onSurfaceVariant = AuralisColors.TextMuted,
    outline = AuralisColors.Line,
    error = AuralisColors.Danger,
    onError = AuralisColors.Midnight
)

private val AuralisTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 30.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.6).sp,
        color = AuralisColors.TextPrimary
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.5).sp,
        color = AuralisColors.TextPrimary
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        letterSpacing = (-0.3).sp,
        color = AuralisColors.TextPrimary
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
        lineHeight = 24.sp,
        letterSpacing = (-0.25).sp,
        color = AuralisColors.TextPrimary
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 22.sp,
        letterSpacing = (-0.15).sp,
        color = AuralisColors.TextPrimary
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        color = AuralisColors.TextPrimary
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        color = AuralisColors.TextMuted
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        color = AuralisColors.TextPrimary
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        color = AuralisColors.TextMuted
    )
)

@Composable
fun AuralisTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = AuralisColorScheme,
        typography = AuralisTypography,
        content = content
    )
}

/**
 * PlayIT Brand Mark:
 * A modern rounded play symbol with three concentric, partially open acoustic pulse arcs offset to the right.
 */
@Composable
fun AuralisMark(
    modifier: Modifier = Modifier,
    size: Dp = 36.dp
) {
    Canvas(modifier = modifier.size(size)) {
        val w = this.size.width
        val h = this.size.height

        val playPath = Path().apply {
            moveTo(w * 0.22f, h * 0.28f)
            lineTo(w * 0.50f, h * 0.50f)
            lineTo(w * 0.22f, h * 0.72f)
            close()
        }

        drawPath(
            path = playPath,
            brush = Brush.linearGradient(
                colors = listOf(AuralisColors.ElectricBlue, AuralisColors.Cyan),
                start = Offset(w * 0.22f, h * 0.28f),
                end = Offset(w * 0.50f, h * 0.72f)
            )
        )

        val strokeWidth = (w * 0.075f).coerceAtLeast(2f)
        val radii = listOf(w * 0.26f, w * 0.38f, w * 0.50f)
        val colors = listOf(AuralisColors.ElectricBlue, AuralisColors.Cyan, AuralisColors.Teal)
        val arcCenter = Offset(w * 0.38f, h * 0.5f)

        radii.forEachIndexed { idx, r ->
            val topLeft = Offset(arcCenter.x - r, arcCenter.y - r)
            drawArc(
                color = colors[idx],
                startAngle = -48f,
                sweepAngle = 96f,
                useCenter = false,
                topLeft = topLeft,
                size = Size(r * 2f, r * 2f),
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
            )
        }
    }
}
