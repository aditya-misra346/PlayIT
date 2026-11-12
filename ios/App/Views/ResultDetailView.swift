import SwiftUI
import AuralisCore

public struct ResultDetailView: View {
    public let track: TrackMatch
    @ObservedObject public var libraryStore: LibraryStore
    public var onIdentifyAnother: () -> Void

    @State private var copiedFeedback: Bool = false

    public init(
        track: TrackMatch,
        libraryStore: LibraryStore,
        onIdentifyAnother: @escaping () -> Void
    ) {
        self.track = track
        self.libraryStore = libraryStore
        self.onIdentifyAnother = onIdentifyAnother
    }

    private var isFavorite: Bool {
        libraryStore.isTrackFavorited(trackId: track.id)
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                artworkHeroSection

                titleAndArtistSection

                badgesRow

                metadataGridSection

                if !track.links.isEmpty {
                    listeningLinksSection
                }

                actionsSection

                CreatorFooterView()
            }
            .padding(20)
        }
        .background(
            ZStack {
                AuralisBrand.midnightBg.ignoresSafeArea()
                blurredArtworkBackdrop
            }
        )
        .navigationTitle("Song Result")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    // MARK: - Blurred Backdrop + Large Artwork (AsyncImage, Aspect Fit)

    @ViewBuilder
    private var blurredArtworkBackdrop: some View {
        if let urlString = track.artwork?.url, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                if case .success(let image) = phase {
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .blur(radius: 64)
                        .opacity(0.24)
                        .ignoresSafeArea()
                }
            }
        }
    }

    private var artworkHeroSection: some View {
        ZStack {
            if let urlString = track.artwork?.url, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: 20))
                            .shadow(color: Color.black.opacity(0.55), radius: 24, x: 0, y: 12)
                    case .empty:
                        artworkPlaceholder(showSpinner: true)
                    case .failure:
                        artworkPlaceholder(showSpinner: false)
                    @unknown default:
                        artworkPlaceholder(showSpinner: false)
                    }
                }
            } else {
                artworkPlaceholder(showSpinner: false)
            }
        }
        .frame(maxWidth: 300, maxHeight: 300)
    }

    private func artworkPlaceholder(showSpinner: Bool) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .fill(AuralisBrand.charcoalElevated)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                )
                .frame(width: 260, height: 260)

            if showSpinner {
                ProgressView()
                    .tint(AuralisBrand.cyan)
            } else {
                VStack(spacing: 12) {
                    AuralisBrandMarkView(size: 64, foregroundColor: AuralisBrand.cyan)
                    Text(AuralisBrand.productName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AuralisBrand.mutedText)
                }
            }
        }
    }

    // MARK: - Title & Artist Hierarchy

    private var titleAndArtistSection: some View {
        VStack(spacing: 8) {
            Text(track.title)
                .font(.system(size: 26, weight: .bold))
                .tracking(-0.4)
                .foregroundStyle(AuralisBrand.primaryText)
                .multilineTextAlignment(.center)

            Text(track.artist)
                .font(.title3.weight(.semibold))
                .foregroundStyle(AuralisBrand.cyan)
                .multilineTextAlignment(.center)

            if track.artists.count > 1 {
                Text(track.artists.joined(separator: " • "))
                    .font(.caption)
                    .foregroundStyle(AuralisBrand.mutedText)
                    .multilineTextAlignment(.center)
            }
        }
    }

    // MARK: - Provider, Confidence (Only When Non-Null), and Timecode Badges

    private var badgesRow: some View {
        HStack(spacing: 10) {
            // Provider Badge
            HStack(spacing: 5) {
                Image(systemName: "waveform.badge.magnifyingglass")
                    .font(.caption2.weight(.bold))
                Text(track.match.providerDisplayName)
                    .font(.caption.weight(.bold))
            }
            .foregroundStyle(AuralisBrand.primaryText)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                Capsule()
                    .fill(AuralisBrand.charcoalElevated)
                    .overlay(
                        Capsule().strokeBorder(AuralisBrand.electricBlue.opacity(0.6), lineWidth: 1)
                    )
            )

            // Confidence Badge — ONLY rendered when non-null per CONTRACT.md
            if let confidence = track.match.confidence {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.shield.fill")
                        .font(.caption2.weight(.bold))
                    Text("Confidence \(confidence.formattedPercentage)")
                        .font(.caption.weight(.bold))
                }
                .foregroundStyle(AuralisBrand.teal)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    Capsule()
                        .fill(AuralisBrand.teal.opacity(0.15))
                        .overlay(
                            Capsule().strokeBorder(AuralisBrand.teal.opacity(0.5), lineWidth: 1)
                        )
                )
            }

            // Timecode Badge
            if let timecode = track.match.timecode {
                HStack(spacing: 5) {
                    Image(systemName: "clock.fill")
                        .font(.caption2)
                    Text("At \(timecode)")
                        .font(.caption.monospacedDigit().weight(.semibold))
                }
                .foregroundStyle(AuralisBrand.cyan)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    Capsule()
                        .fill(AuralisBrand.deepSurface)
                        .overlay(
                            Capsule().strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                        )
                )
            }
        }
    }

    // MARK: - Metadata Grid (Album, Year, Genre, Label, ISRC, Timecode)

    private var metadataGridSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Track Details")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(AuralisBrand.mutedText)

            VStack(spacing: 10) {
                if let album = track.album, !album.isEmpty {
                    metadataRow(label: "Album", value: album, icon: "opticaldisc.fill")
                }

                if let year = track.year {
                    metadataRow(label: "Release Year", value: "\(year)", icon: "calendar")
                } else if let releaseDate = track.releaseDate, !releaseDate.isEmpty {
                    metadataRow(label: "Released", value: releaseDate, icon: "calendar")
                }

                if !track.genres.isEmpty {
                    metadataRow(
                        label: "Genre",
                        value: track.genres.joined(separator: ", "),
                        icon: "guitars.fill"
                    )
                }

                if let label = track.label, !label.isEmpty {
                    metadataRow(label: "Label", value: label, icon: "building.2.fill")
                }

                if let timecode = track.match.timecode {
                    metadataRow(label: "Matched Timecode", value: timecode, icon: "timer")
                }

                if let isrc = track.isrc, !isrc.isEmpty {
                    metadataRow(label: "ISRC", value: isrc, icon: "barcode")
                }
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(AuralisBrand.deepSurface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                    )
            )
        }
    }

    private func metadataRow(label: String, value: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(AuralisBrand.cyan)
                .frame(width: 18)

            Text(label)
                .font(.subheadline)
                .foregroundStyle(AuralisBrand.mutedText)

            Spacer()

            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AuralisBrand.primaryText)
                .multilineTextAlignment(.trailing)
        }
    }

    // MARK: - Listening Links (Only Those Returned by Provider)

    private var listeningLinksSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Listen On")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(AuralisBrand.mutedText)

            ForEach(track.links) { link in
                if let destination = URL(string: link.url) {
                    Link(destination: destination) {
                        HStack(spacing: 12) {
                            Image(systemName: iconForService(link.service))
                                .font(.body.weight(.semibold))
                                .foregroundStyle(AuralisBrand.cyan)
                                .frame(width: 28, height: 28)
                                .background(
                                    Circle().fill(AuralisBrand.midnightBg)
                                )

                            Text(link.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(AuralisBrand.primaryText)

                            Spacer()

                            Image(systemName: "arrow.up.right")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AuralisBrand.mutedText)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(AuralisBrand.charcoalElevated)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                                )
                        )
                    }
                }
            }
        }
    }

    private func iconForService(_ service: String) -> String {
        switch service.lowercased() {
        case "apple_music":
            return "music.note"
        case "spotify":
            return "dot.radiowaves.left.and.right"
        case "youtube", "youtube_music":
            return "play.rectangle.fill"
        case "deezer":
            return "waveform"
        case "shazam":
            return "waveform.circle"
        default:
            return "link"
        }
    }

    // MARK: - Favorite, ShareLink, Copy Song Info, and "Identify Another"

    private var actionsSection: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                // Favorite Toggle
                Button {
                    libraryStore.setFavorite(forTrackId: track.id, favorite: !isFavorite)
                } label: {
                    Label(
                        isFavorite ? "Favorited" : "Favorite",
                        systemImage: isFavorite ? "heart.fill" : "heart"
                    )
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isFavorite ? AuralisBrand.danger : AuralisBrand.primaryText)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(AuralisBrand.charcoalElevated)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(
                                        isFavorite ? AuralisBrand.danger.opacity(0.6) : AuralisBrand.lineBorder,
                                        lineWidth: 1
                                    )
                            )
                    )
                }
                .buttonStyle(.plain)

                // ShareLink
                ShareLink(
                    item: track.shareFormattedSummary,
                    subject: Text("\(track.title) — \(track.artist)"),
                    message: Text(track.shareFormattedSummary)
                ) {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AuralisBrand.primaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(AuralisBrand.charcoalElevated)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                                )
                        )
                }
                .buttonStyle(.plain)

                // Copy Song Info
                Button {
                    copySongInfoToClipboard()
                } label: {
                    Label(
                        copiedFeedback ? "Copied!" : "Copy Info",
                        systemImage: copiedFeedback ? "checkmark.circle.fill" : "doc.on.doc"
                    )
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(copiedFeedback ? AuralisBrand.teal : AuralisBrand.primaryText)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(AuralisBrand.charcoalElevated)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
            }

            // Identify Another Button
            Button {
                onIdentifyAnother()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "waveform.circle.fill")
                        .font(.headline)
                    Text("Identify Another")
                        .font(.headline.weight(.bold))
                }
                .foregroundStyle(AuralisBrand.midnightBg)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(
                    RoundedRectangle(cornerRadius: 14)
                        .fill(AuralisBrand.signatureGradient)
                )
            }
            .buttonStyle(.plain)
        }
    }

    private func copySongInfoToClipboard() {
        #if os(iOS)
        UIPasteboard.general.string = track.shareFormattedSummary
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(track.shareFormattedSummary, forType: .string)
        #endif
        copiedFeedback = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            copiedFeedback = false
        }
    }
}
