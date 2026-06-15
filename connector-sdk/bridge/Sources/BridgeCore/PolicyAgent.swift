// The narrow seam the dispatcher calls. In production it is satisfied by the
// agent's own `AgentXPCClient` (which holds the NSXPCConnection to
// com.vguardrail.agent.xpc); in tests it is satisfied by a fake. This keeps the
// dispatcher free of any real IPC so the whole protocol stack is testable
// without a daemon.

import VGCore
import VGXPCProtocol

/// The four operations of the daemon's `AgentControl` interface.
public protocol PolicyAgent: Sendable {
    func submitScan(_ request: ScanRequest) async throws -> Decision
    func status() async throws -> AgentStatus
    func recentDecisions(limit: Int) async throws -> [DecisionSummary]
    func acknowledgeWarning(eventID: String, accepted: Bool) async throws -> Bool
}

// `AgentXPCClient` already vends exactly these methods over XPC; conform it so
// the production binary needs no adapter and there is no second code path.
extension AgentXPCClient: PolicyAgent {}
