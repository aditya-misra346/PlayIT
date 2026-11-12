package app.auralis.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.auralis.model.LibraryItem
import app.auralis.ui.DateRangeFilter
import app.auralis.ui.LibraryFilterState
import app.auralis.ui.LibraryTab
import app.auralis.ui.theme.AuralisColors
import app.auralis.ui.theme.AuralisMark
import coil.compose.AsyncImage
import coil.request.ImageRequest

@Composable
fun LibraryScreen(
    items: List<LibraryItem>,
    distinctArtists: List<String>,
    filterState: LibraryFilterState,
    selectedItemId: String?,
    onTabSelected: (LibraryTab) -> Unit,
    onSearchQueryChange: (String) -> Unit,
    onArtistSelected: (String?) -> Unit,
    onDateRangeSelected: (DateRangeFilter) -> Unit,
    onItemClick: (LibraryItem) -> Unit,
    onToggleFavorite: (LibraryItem) -> Unit,
    onDeleteItem: (LibraryItem) -> Unit,
    onClearAllConfirmed: () -> Unit,
    onExportJsonClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showClearConfirmDialog by remember { mutableStateOf(false) }

    if (showClearConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showClearConfirmDialog = false },
            containerColor = AuralisColors.Charcoal,
            titleContentColor = AuralisColors.TextPrimary,
            textContentColor = AuralisColors.TextMuted,
            title = { Text("Clear Recognition History?") },
            text = {
                Text("This removes all saved tracks and favorites from your library. This action cannot be undone.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showClearConfirmDialog = false
                        onClearAllConfirmed()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = AuralisColors.Danger)
                ) {
                    Text("Clear All")
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearConfirmDialog = false }) {
                    Text("Cancel", color = AuralisColors.TextPrimary)
                }
            }
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(AuralisColors.Midnight)
    ) {
        // Header + Export JSON & Clear All buttons
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "Library",
                    style = MaterialTheme.typography.headlineMedium,
                    color = AuralisColors.TextPrimary
                )
                Text(
                    text = "${items.size} track${if (items.size == 1) "" else "s"} • Metadata only",
                    style = MaterialTheme.typography.labelMedium,
                    color = AuralisColors.TextMuted
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onExportJsonClick,
                    border = BorderStroke(1.dp, AuralisColors.Line),
                    shape = RoundedCornerShape(20.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.FileDownload,
                        contentDescription = null,
                        tint = AuralisColors.Cyan,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Export JSON", style = MaterialTheme.typography.labelLarge)
                }

                IconButton(
                    onClick = { showClearConfirmDialog = true },
                    enabled = items.isNotEmpty()
                ) {
                    Icon(
                        imageVector = Icons.Default.DeleteSweep,
                        contentDescription = "Clear all history",
                        tint = if (items.isNotEmpty()) AuralisColors.Danger else AuralisColors.TextMuted
                    )
                }
            }
        }

        // Tabs: All History vs Favorites
        TabRow(
            selectedTabIndex = filterState.tab.ordinal,
            containerColor = AuralisColors.Deep,
            contentColor = AuralisColors.Cyan
        ) {
            LibraryTab.entries.forEach { tab ->
                Tab(
                    selected = filterState.tab == tab,
                    onClick = { onTabSelected(tab) },
                    text = {
                        Text(
                            text = tab.label,
                            style = MaterialTheme.typography.labelLarge,
                            color = if (filterState.tab == tab) AuralisColors.TextPrimary else AuralisColors.TextMuted
                        )
                    }
                )
            }
        }

        // Search bar
        OutlinedTextField(
            value = filterState.searchQuery,
            onValueChange = onSearchQueryChange,
            placeholder = { Text("Search title, artist, or album…") },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Default.Search,
                    contentDescription = null,
                    tint = AuralisColors.TextMuted
                )
            },
            trailingIcon = {
                if (filterState.searchQuery.isNotEmpty()) {
                    IconButton(onClick = { onSearchQueryChange("") }) {
                        Icon(
                            imageVector = Icons.Default.Clear,
                            contentDescription = "Clear search",
                            tint = AuralisColors.TextMuted
                        )
                    }
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = AuralisColors.Cyan,
                unfocusedBorderColor = AuralisColors.Line,
                focusedContainerColor = AuralisColors.Deep,
                unfocusedContainerColor = AuralisColors.Deep
            ),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 10.dp)
        )

        // Date Range Filter Chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            DateRangeFilter.entries.forEach { range ->
                FilterChip(
                    selected = filterState.dateRange == range,
                    onClick = { onDateRangeSelected(range) },
                    label = { Text(range.label) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = AuralisColors.ElectricBlue.copy(alpha = 0.24f),
                        selectedLabelColor = AuralisColors.TextPrimary
                    )
                )
            }
        }

        // Artist Filter Chips
        if (distinctArtists.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = filterState.selectedArtist == null,
                    onClick = { onArtistSelected(null) },
                    label = { Text("All Artists") },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = AuralisColors.Teal.copy(alpha = 0.22f),
                        selectedLabelColor = AuralisColors.TextPrimary
                    )
                )
                distinctArtists.forEach { artist ->
                    val isSelected = filterState.selectedArtist.equals(artist, ignoreCase = true)
                    FilterChip(
                        selected = isSelected,
                        onClick = { onArtistSelected(if (isSelected) null else artist) },
                        label = { Text(artist) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AuralisColors.Teal.copy(alpha = 0.22f),
                            selectedLabelColor = AuralisColors.TextPrimary
                        )
                    )
                }
            }
        }

        // Track List or Empty State
        if (items.isEmpty()) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp)
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Default.LibraryMusic,
                        contentDescription = null,
                        tint = AuralisColors.TextMuted,
                        modifier = Modifier.size(48.dp)
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = if (filterState.tab == LibraryTab.FAVORITES) {
                            "No favorite tracks yet"
                        } else {
                            "No recognized songs match your filters"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = AuralisColors.TextPrimary
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Identify music from the Listen tab to build your history.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = AuralisColors.TextMuted
                    )
                }
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(items, key = { it.id }) { item ->
                    LibraryItemRow(
                        item = item,
                        isSelected = item.id == selectedItemId,
                        onClick = { onItemClick(item) },
                        onToggleFavorite = { onToggleFavorite(item) },
                        onDelete = { onDeleteItem(item) }
                    )
                }
            }
        }
    }
}

@Composable
private fun LibraryItemRow(
    item: LibraryItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
    onDelete: () -> Unit
) {
    val context = LocalContext.current
    val track = item.track
    val artUrl = track.artwork?.thumbUrl ?: track.artwork?.url

    Surface(
        color = if (isSelected) AuralisColors.Charcoal else AuralisColors.Deep,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(
            width = 1.dp,
            color = if (isSelected) AuralisColors.Cyan else AuralisColors.Line
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Thumbnail artwork
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(58.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(AuralisColors.Charcoal)
            ) {
                if (!artUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = ImageRequest.Builder(context)
                            .data(artUrl)
                            .crossfade(true)
                            .build(),
                        contentDescription = track.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    AuralisMark(size = 28.dp)
                }
            }

            Spacer(modifier = Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = track.title,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = AuralisColors.TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = track.artist,
                    style = MaterialTheme.typography.bodyMedium,
                    color = AuralisColors.Cyan,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                val metaParts = buildList {
                    if (!track.album.isNullOrBlank()) add(track.album)
                    add(item.createdAt.take(10))
                }
                Text(
                    text = metaParts.joinToString(" • "),
                    style = MaterialTheme.typography.labelMedium,
                    color = AuralisColors.TextMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            IconButton(onClick = onToggleFavorite) {
                Icon(
                    imageVector = if (item.favorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                    contentDescription = if (item.favorite) "Unfavorite" else "Favorite",
                    tint = if (item.favorite) AuralisColors.Danger else AuralisColors.TextMuted
                )
            }

            IconButton(onClick = onDelete) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "Delete item",
                    tint = AuralisColors.TextMuted
                )
            }
        }
    }
}
