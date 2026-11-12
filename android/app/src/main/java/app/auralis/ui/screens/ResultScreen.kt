package app.auralis.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.auralis.model.LibraryItem
import app.auralis.model.TrackLink
import app.auralis.ui.theme.AuralisColors
import app.auralis.ui.theme.AuralisMark
import coil.compose.AsyncImage
import coil.request.ImageRequest

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ResultScreen(
    item: LibraryItem,
    onToggleFavorite: (LibraryItem) -> Unit,
    onIdentifyAnother: () -> Unit,
    onBackClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val track = item.track
    val artworkUrl = track.artwork?.url ?: track.artwork?.thumbUrl
    val scrollState = rememberScrollState()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(AuralisColors.Midnight)
    ) {
        // Blurred artwork backdrop with dark gradient scrim
        if (!artworkUrl.isNullOrBlank()) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(artworkUrl)
                    .crossfade(true)
                    .build(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(380.dp)
                    .blur(36.dp)
            )
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(400.dp)
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                AuralisColors.Midnight.copy(alpha = 0.50f),
                                AuralisColors.Midnight.copy(alpha = 0.88f),
                                AuralisColors.Midnight
                            )
                        )
                    )
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 24.dp, vertical = 18.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Top bar with optional Back button and Favorite/Share/Copy quick actions
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (onBackClick != null) {
                    IconButton(onClick = onBackClick) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = AuralisColors.TextPrimary
                        )
                    }
                } else {
                    Spacer(modifier = Modifier.width(8.dp))
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { onToggleFavorite(item) }) {
                        Icon(
                            imageVector = if (item.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                            contentDescription = if (item.favorite) "Remove from favorites" else "Add to favorites",
                            tint = if (item.favorite) AuralisColors.Danger else AuralisColors.TextPrimary
                        )
                    }
                    IconButton(onClick = { copyTrackTitleArtist(context, track.title, track.artist) }) {
                        Icon(
                            imageVector = Icons.Default.ContentCopy,
                            contentDescription = "Copy title — artist",
                            tint = AuralisColors.TextPrimary
                        )
                    }
                    IconButton(onClick = { shareTrack(context, track.title, track.artist, track.links.firstOrNull()?.url) }) {
                        Icon(
                            imageVector = Icons.Default.Share,
                            contentDescription = "Share track",
                            tint = AuralisColors.TextPrimary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Large square album artwork (Coil, no aspect distortion, crossfade)
            Surface(
                color = AuralisColors.Charcoal,
                shape = RoundedCornerShape(22.dp),
                border = BorderStroke(1.dp, AuralisColors.Line),
                shadowElevation = 14.dp,
                modifier = Modifier
                    .widthIn(max = 280.dp)
                    .fillMaxWidth(0.78f)
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(22.dp))
            ) {
                if (!artworkUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = ImageRequest.Builder(context)
                            .data(artworkUrl)
                            .crossfade(true)
                            .build(),
                        contentDescription = "${track.title} album artwork",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .fillMaxSize()
                            .background(
                                Brush.linearGradient(
                                    listOf(AuralisColors.Deep, AuralisColors.Charcoal)
                                )
                            )
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            AuralisMark(size = 64.dp)
                            Spacer(modifier = Modifier.height(10.dp))
                            Icon(
                                imageVector = Icons.Default.Album,
                                contentDescription = null,
                                tint = AuralisColors.TextMuted,
                                modifier = Modifier.size(28.dp)
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(22.dp))

            // Title & Artist hierarchy (weight 700, tight tracking)
            Text(
                text = track.title,
                style = MaterialTheme.typography.displaySmall,
                color = AuralisColors.TextPrimary,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = track.artist,
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.SemiBold,
                    color = AuralisColors.Cyan
                )
            )

            Spacer(modifier = Modifier.height(14.dp))

            // Match metadata badges: timecode, confidence (ONLY when non-null), provider attribution
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                MetadataBadge(
                    label = "Provider: ${formatProviderDisplayName(track.match.provider)}",
                    accent = AuralisColors.ElectricBlue
                )

                if (!track.match.timecode.isNullOrBlank()) {
                    MetadataBadge(
                        label = "Matched at ${track.match.timecode}",
                        accent = AuralisColors.Cyan
                    )
                }

                // Contract rule: confidence is rendered ONLY when non-null
                val confidence = track.match.confidence
                if (confidence != null) {
                    MetadataBadge(
                        label = "Confidence: ${confidence.value}/${confidence.scale}",
                        accent = AuralisColors.Teal
                    )
                }

                MetadataBadge(
                    label = "Source: ${track.match.source}",
                    accent = AuralisColors.TextMuted
                )
            }

            Spacer(modifier = Modifier.height(18.dp))

            // Track Metadata Card (Album, Year, Genres, Label, ISRC)
            Surface(
                color = AuralisColors.Deep,
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, AuralisColors.Line),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (!track.album.isNullOrBlank()) {
                        MetadataRow(title = "Album", value = track.album)
                    }
                    val yearOrDate = track.year?.toString() ?: track.releaseDate
                    if (!yearOrDate.isNullOrBlank()) {
                        MetadataRow(title = "Released", value = yearOrDate)
                    }
                    if (track.genres.isNotEmpty()) {
                        MetadataRow(title = "Genre", value = track.genres.joinToString(" • "))
                    }
                    if (!track.label.isNullOrBlank()) {
                        MetadataRow(title = "Label", value = track.label)
                    }
                    if (!track.isrc.isNullOrBlank()) {
                        MetadataRow(title = "ISRC", value = track.isrc)
                    }
                    MetadataRow(title = "Recognized", value = track.match.recognizedAt.take(19).replace('T', ' '))
                }
            }

            // Listening Links (Contract rule: ONLY include links present in `track.links`)
            if (track.links.isNotEmpty()) {
                Spacer(modifier = Modifier.height(20.dp))
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Listen On",
                        style = MaterialTheme.typography.titleMedium,
                        color = AuralisColors.TextPrimary
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        track.links.forEach { link ->
                            ListeningLinkButton(
                                link = link,
                                onClick = { openExternalLink(context, link.url) }
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(22.dp))
            HorizontalDivider(color = AuralisColors.Line)
            Spacer(modifier = Modifier.height(16.dp))

            // Primary Action Row: Copy "Title — Artist", Share, Favorite, Identify Another
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                OutlinedButton(
                    onClick = { onToggleFavorite(item) },
                    border = BorderStroke(
                        1.dp,
                        if (item.favorite) AuralisColors.Danger else AuralisColors.Line
                    ),
                    shape = RoundedCornerShape(24.dp)
                ) {
                    Icon(
                        imageVector = if (item.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        contentDescription = null,
                        tint = if (item.favorite) AuralisColors.Danger else AuralisColors.TextPrimary,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(if (item.favorite) "Favorited" else "Favorite")
                }

                OutlinedButton(
                    onClick = { copyTrackTitleArtist(context, track.title, track.artist) },
                    border = BorderStroke(1.dp, AuralisColors.Line),
                    shape = RoundedCornerShape(24.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ContentCopy,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Copy Title — Artist")
                }

                OutlinedButton(
                    onClick = { shareTrack(context, track.title, track.artist, track.links.firstOrNull()?.url) },
                    border = BorderStroke(1.dp, AuralisColors.Line),
                    shape = RoundedCornerShape(24.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Share,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Share")
                }

                Button(
                    onClick = onIdentifyAnother,
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
                    Text("Identify Another")
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun MetadataBadge(
    label: String,
    accent: androidx.compose.ui.graphics.Color
) {
    Surface(
        color = accent.copy(alpha = 0.14f),
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.dp, accent.copy(alpha = 0.45f))
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
            Icon(
                imageVector = Icons.Default.GraphicEq,
                contentDescription = null,
                tint = accent,
                modifier = Modifier.size(14.dp)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                color = AuralisColors.TextPrimary
            )
        }
    }
}

@Composable
private fun MetadataRow(title: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = AuralisColors.TextMuted,
            modifier = Modifier.width(96.dp)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
            color = AuralisColors.TextPrimary,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun ListeningLinkButton(
    link: TrackLink,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        color = AuralisColors.Charcoal,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, AuralisColors.Line)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(
                text = link.label.ifBlank { link.service },
                style = MaterialTheme.typography.labelLarge,
                color = AuralisColors.TextPrimary
            )
            Spacer(modifier = Modifier.width(6.dp))
            Icon(
                imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                contentDescription = null,
                tint = AuralisColors.Cyan,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

private fun formatProviderDisplayName(provider: String): String = when (provider.lowercase()) {
    "audd" -> "AudD"
    "acrcloud" -> "ACRCloud"
    "shazamkit" -> "ShazamKit"
    "local" -> "Local Engine"
    else -> provider
}

private fun copyTrackTitleArtist(context: Context, title: String, artist: String) {
    val formatted = "$title — $artist"
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Track", formatted))
    Toast.makeText(context, "Copied: $formatted", Toast.LENGTH_SHORT).show()
}

private fun shareTrack(context: Context, title: String, artist: String, primaryUrl: String?) {
    val body = buildString {
        append("$title — $artist")
        if (!primaryUrl.isNullOrBlank()) {
            append("\n")
            append(primaryUrl)
        }
        append("\n\nIdentified with Auralis")
    }
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, "$title — $artist")
        putExtra(Intent.EXTRA_TEXT, body)
    }
    context.startActivity(Intent.createChooser(sendIntent, "Share track"))
}

private fun openExternalLink(context: Context, url: String) {
    runCatching {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        context.startActivity(intent)
    }.onFailure {
        Toast.makeText(context, "No app found to open link.", Toast.LENGTH_SHORT).show()
    }
}
