import SwiftUI
import AuralisCore

public struct LibraryView: View {
    @ObservedObject public var libraryStore: LibraryStore
    public var onSelectTrack: (TrackMatch) -> Void

    @State private var showClearAllConfirmation: Bool = false

    public init(
        libraryStore: LibraryStore,
        onSelectTrack: @escaping (TrackMatch) -> Void
    ) {
        self.libraryStore = libraryStore
        self.onSelectTrack = onSelectTrack
    }

    public var body: some View {
        VStack(spacing: 0) {
            filterHeaderBar

            if libraryStore.filteredItems.isEmpty {
                emptyStateView
            } else {
                libraryListView
            }
        }
        .background(AuralisBrand.midnightBg.ignoresSafeArea())
        .navigationTitle("Library")
        .searchable(
            text: $libraryStore.searchQuery,
            prompt: "Search songs, artists, albums, ISRC…"
        )
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                ShareLink(
                    item: libraryStore.exportJSONString(),
                    subject: Text("Auralis Library Export"),
                    message: Text("Exported Auralis song recognition metadata (JSON)"),
                    preview: SharePreview("auralis-library.json")
                ) {
                    Label("Export JSON", systemImage: "square.and.arrow.up")
                }
                .disabled(libraryStore.activeItems.isEmpty)

                Button(role: .destructive) {
                    showClearAllConfirmation = true
                } label: {
                    Label("Clear All", systemImage: "trash")
                }
                .disabled(libraryStore.activeItems.isEmpty)
            }
        }
        .confirmationDialog(
            "Clear all recognized songs from your Auralis Library?",
            isPresented: $showClearAllConfirmation,
            titleVisibility: .visible
        ) {
            Button("Clear All History", role: .destructive) {
                libraryStore.clearAll(keepTombstonesForSync: true)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes all saved song metadata from local history.")
        }
    }

    // MARK: - Filter Header Bar (Favorites, Artist Filter, Date Filter)

    private var filterHeaderBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                // Favorites Filter Toggle
                Button {
                    libraryStore.favoritesOnly.toggle()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: libraryStore.favoritesOnly ? "heart.fill" : "heart")
                            .font(.caption.weight(.bold))
                        Text("Favorites")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(libraryStore.favoritesOnly ? AuralisBrand.midnightBg : AuralisBrand.primaryText)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(
                        Capsule()
                            .fill(libraryStore.favoritesOnly ? AuralisBrand.cyan : AuralisBrand.charcoalElevated)
                    )
                }
                .buttonStyle(.plain)

                // Artist Filter Menu
                Menu {
                    Button {
                        libraryStore.selectedArtist = nil
                    } label: {
                        HStack {
                            Text("All Artists")
                            if libraryStore.selectedArtist == nil {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    Divider()
                    ForEach(libraryStore.availableArtists, id: \.self) { artist in
                        Button {
                            libraryStore.selectedArtist = artist
                        } label: {
                            HStack {
                                Text(artist)
                                if libraryStore.selectedArtist == artist {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "person.2.fill")
                            .font(.caption2)
                        Text(libraryStore.selectedArtist ?? "All Artists")
                            .font(.caption.weight(.semibold))
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                    }
                    .foregroundStyle(libraryStore.selectedArtist != nil ? AuralisBrand.midnightBg : AuralisBrand.primaryText)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(
                        Capsule()
                            .fill(libraryStore.selectedArtist != nil ? AuralisBrand.cyan : AuralisBrand.charcoalElevated)
                    )
                }

                // Date Filter Menu
                Menu {
                    ForEach(LibraryDateFilter.allCases) { filter in
                        Button {
                            libraryStore.dateFilter = filter
                        } label: {
                            HStack {
                                Text(filter.displayName)
                                if libraryStore.dateFilter == filter {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar")
                            .font(.caption2)
                        Text(libraryStore.dateFilter.displayName)
                            .font(.caption.weight(.semibold))
                        Image(systemName: "chevron.down")
                            .font(.caption2)
                    }
                    .foregroundStyle(libraryStore.dateFilter != .all ? AuralisBrand.midnightBg : AuralisBrand.primaryText)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(
                        Capsule()
                            .fill(libraryStore.dateFilter != .all ? AuralisBrand.cyan : AuralisBrand.charcoalElevated)
                    )
                }

                if hasActiveFilters {
                    Button {
                        libraryStore.searchQuery = ""
                        libraryStore.selectedArtist = nil
                        libraryStore.dateFilter = .all
                        libraryStore.favoritesOnly = false
                    } label: {
                        Text("Reset")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AuralisBrand.warning)
                            .padding(.horizontal, 8)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(AuralisBrand.deepSurface)
    }

    private var hasActiveFilters: Bool {
        !libraryStore.searchQuery.isEmpty
            || libraryStore.selectedArtist != nil
            || libraryStore.dateFilter != .all
            || libraryStore.favoritesOnly
    }

    // MARK: - Library List with Swipe-to-Delete

    private var libraryListView: some View {
        List {
            ForEach(libraryStore.filteredItems) { item in
                LibraryItemRow(
                    item: item,
                    onTap: {
                        onSelectTrack(item.track)
                    },
                    onToggleFavorite: {
                        libraryStore.toggleFavorite(itemId: item.id)
                    }
                )
                .listRowBackground(AuralisBrand.deepSurface)
                .listRowSeparatorTint(AuralisBrand.lineBorder)
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        libraryStore.deleteItem(id: item.id)
                    } label: {
                        Label("Delete", systemImage: "trash.fill")
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 14) {
            Spacer()
            AuralisBrandMarkView(size: 56, foregroundColor: AuralisBrand.mutedText)
            Text(hasActiveFilters ? "No Matching Songs" : "Your Library is Empty")
                .font(.title3.weight(.bold))
                .foregroundStyle(AuralisBrand.primaryText)
            Text(
                hasActiveFilters
                ? "Try clearing your search or filter criteria."
                : "Songs you identify with Auralis are saved here automatically (metadata only — raw audio is never stored)."
            )
            .font(.subheadline)
            .foregroundStyle(AuralisBrand.mutedText)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 36)
            Spacer()
        }
    }
}

private struct LibraryItemRow: View {
    let item: AuralisCore.LibraryItem
    let onTap: () -> Void
    let onToggleFavorite: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onTap) {
                HStack(spacing: 12) {
                    thumbnailView

                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.track.title)
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(AuralisBrand.primaryText)
                            .lineLimit(1)

                        Text(item.track.artist)
                            .font(.subheadline)
                            .foregroundStyle(AuralisBrand.cyan)
                            .lineLimit(1)

                        HStack(spacing: 8) {
                            Text(item.track.match.providerDisplayName)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(
                                    Capsule().fill(AuralisBrand.charcoalElevated)
                                )
                                .foregroundStyle(AuralisBrand.mutedText)

                            Text(formattedTimestamp(item.createdAt))
                                .font(.caption2)
                                .foregroundStyle(AuralisBrand.mutedText)
                        }
                    }

                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button(action: onToggleFavorite) {
                Image(systemName: item.favorite ? "heart.fill" : "heart")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(item.favorite ? AuralisBrand.danger : AuralisBrand.mutedText)
                    .padding(6)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.favorite ? "Remove from Favorites" : "Add to Favorites")
        }
        .padding(.vertical, 4)
    }

    private var thumbnailView: some View {
        ZStack {
            if let urlStr = item.track.artwork?.thumbUrl ?? item.track.artwork?.url,
               let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } else {
                        placeholderThumb
                    }
                }
            } else {
                placeholderThumb
            }
        }
        .frame(width: 54, height: 54)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var placeholderThumb: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(AuralisBrand.charcoalElevated)
            Image(systemName: "music.note")
                .foregroundStyle(AuralisBrand.cyan)
        }
    }

    private func formattedTimestamp(_ iso: String) -> String {
        guard let date = LibraryStore.parseISO8601(iso) else { return iso }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
