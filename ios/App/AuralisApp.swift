import SwiftUI
import AuralisCore

@main
struct AuralisApp: App {
    @StateObject private var stateMachine = RecognitionStateMachine()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootAdaptiveView(stateMachine: stateMachine)
                .preferredColorScheme(.dark)
                .onChange(of: scenePhase) { newPhase in
                    if newPhase == .background {
                        // Never record in the background per CONTRACT.md
                        stateMachine.handleSceneBackgrounded()
                    }
                }
        }
    }
}
