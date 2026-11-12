import SwiftUI
import AuralisCore

public enum AuralisNavigationTab: String, CaseIterable, Identifiable {
    case listen
    case library
    case settings

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .listen:
            return "Listen"
        case .library:
            return "Library"
        case .settings:
            return "Settings"
        }
    }

    public var systemImage: String {
        switch self {
        case .listen:
            return "waveform.circle.fill"
        case .library:
            return "music.note.list"
        case .settings:
            return "slider.horizontal.3"
        }
    }
}

public struct RootAdaptiveView: View {
    @ObservedObject public var stateMachine: RecognitionStateMachine
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var selectedTab: AuralisNavigationTab = .listen
    @State private var presentedResultTrack: TrackMatch? = nil
    @State private var iPadDetailSelection: AuralisNavigationTab = .library

    public init(stateMachine: RecognitionStateMachine) {
        self.stateMachine = stateMachine
    }

    public var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                iPadTwoColumnSplitView
            } else {
                compactTabView
            }
        }
        .tint(AuralisBrand.cyan)
        .background(AuralisBrand.midnightBg.ignoresSafeArea())
        .onChange(of: stateMachine.matchedTrack) { newMatch in
            if let track = newMatch {
                presentedResultTrack = track
            }
        }
        .sheet(item: $presentedResultTrack) { track in
            NavigationStack {
                ResultDetailView(
                    track: track,
                    libraryStore: stateMachine.libraryStore,
                    onIdentifyAnother: {
                        presentedResultTrack = nil
                        stateMachine.resetToIdle()
                    }
                )
            }
            .preferredColorScheme(.dark)
        }
    }

    // MARK: - Compact (iPhone / Slide-Over) TabView

    private var compactTabView: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                ListenView(
                    stateMachine: stateMachine,
                    onOpenResult: { track in
                        presentedResultTrack = track
                    }
                )
            }
            .tabItem {
                Label(AuralisNavigationTab.listen.title, systemImage: AuralisNavigationTab.listen.systemImage)
            }
            .tag(AuralisNavigationTab.listen)

            NavigationStack {
                LibraryView(
                    libraryStore: stateMachine.libraryStore,
                    onSelectTrack: { track in
                        presentedResultTrack = track
                    }
                )
            }
            .tabItem {
                Label(AuralisNavigationTab.library.title, systemImage: AuralisNavigationTab.library.systemImage)
            }
            .tag(AuralisNavigationTab.library)

            NavigationStack {
                SettingsView(stateMachine: stateMachine)
            }
            .tabItem {
                Label(AuralisNavigationTab.settings.title, systemImage: AuralisNavigationTab.settings.systemImage)
            }
            .tag(AuralisNavigationTab.settings)
        }
    }

    // MARK: - Regular (iPad) Two-Column NavigationSplitView

    private var iPadTwoColumnSplitView: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                ListenView(
                    stateMachine: stateMachine,
                    onOpenResult: { track in
                        presentedResultTrack = track
                    }
                )

                Divider()
                    .overlay(AuralisBrand.lineBorder)

                HStack(spacing: 12) {
                    Button {
                        iPadDetailSelection = .library
                    } label: {
                        Label("Library", systemImage: "music.note.list")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(iPadDetailSelection == .library ? AuralisBrand.charcoalElevated : Color.clear)
                            )
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(iPadDetailSelection == .library ? AuralisBrand.cyan : AuralisBrand.mutedText)

                    Button {
                        iPadDetailSelection = .settings
                    } label: {
                        Label("Settings", systemImage: "slider.horizontal.3")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(iPadDetailSelection == .settings ? AuralisBrand.charcoalElevated : Color.clear)
                            )
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(iPadDetailSelection == .settings ? AuralisBrand.cyan : AuralisBrand.mutedText)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(AuralisBrand.deepSurface)
            }
            .navigationSplitViewColumnWidth(min: 360, ideal: 420, max: 480)
        } detail: {
            NavigationStack {
                switch iPadDetailSelection {
                case .library, .listen:
                    if let matched = stateMachine.matchedTrack {
                        ResultDetailView(
                            track: matched,
                            libraryStore: stateMachine.libraryStore,
                            onIdentifyAnother: {
                                stateMachine.resetToIdle()
                            }
                        )
                    } else {
                        LibraryView(
                            libraryStore: stateMachine.libraryStore,
                            onSelectTrack: { track in
                                presentedResultTrack = track
                            }
                        )
                    }
                case .settings:
                    SettingsView(stateMachine: stateMachine)
                }
            }
        }
    }
}
