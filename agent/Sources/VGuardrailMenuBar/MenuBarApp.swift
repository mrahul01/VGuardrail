// VGuardrailMenuBar — a status-only menu bar app (LSUIElement) that shows agent
// health and recent decisions and can submit a developer test prompt, all over
// the XPC service vended by vguardiand.

import SwiftUI

@main
struct VGuardrailMenuBarApp: App {
    @State private var model = AgentViewModel()

    var body: some Scene {
        MenuBarExtra("VGuardrail", systemImage: "shield.lefthalf.filled") {
            MenuContentView(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}
