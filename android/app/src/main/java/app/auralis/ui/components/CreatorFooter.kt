package app.auralis.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.auralis.ui.theme.AuralisColors

/**
 * Global reusable Creator Attribution Footer for Android Compose screens.
 * Displays the required exact text: "Made by Aditya Misra"
 */
@Composable
fun CreatorFooter(
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 28.dp, bottom = 20.dp)
    ) {
        HorizontalDivider(
            color = AuralisColors.Line.copy(alpha = 0.45f),
            thickness = 1.dp,
            modifier = Modifier
                .widthIn(max = 240.dp)
                .padding(bottom = 10.dp)
        )
        Text(
            text = "Made by Aditya Misra",
            style = MaterialTheme.typography.labelSmall.copy(
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.3.sp,
                color = AuralisColors.TextMuted.copy(alpha = 0.85f)
            ),
            textAlign = TextAlign.Center
        )
    }
}
