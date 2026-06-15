// Observable view model bridging the menu bar UI to the agent daemon over XPC.

import Foundation
import Observation
import VGCore
import VGXPCProtocol

@MainActor
@Observable
final class AgentViewModel {
    var status: AgentStatus?
    var decisions: [DecisionSummary] = []
    var lastError: String?
    var busy = false

    private let client = AgentXPCClient()

    /// Refreshes status + recent decisions from the daemon.
    func refresh() async {
        do {
            status = try await client.status()
            decisions = try await client.recentDecisions(limit: 20)
            lastError = nil
        } catch {
            lastError = "agent unavailable: \(error)"
        }
    }

    /// Submits a developer test prompt and refreshes.
    func sendTestPrompt() async {
        busy = true
        defer { busy = false }
        let request = ScanRequest(
            text: "test prompt with AKIAIOSFODNN7EXAMPLE",
            context: ScanContext(source: .api, provider: "openai", app: "VGuardrailMenuBar",
                                 user: UserContext(userID: NSUserName()))
        )
        do {
            _ = try await client.submitScan(request)
            await refresh()
        } catch {
            lastError = "submit failed: \(error)"
        }
    }
}
