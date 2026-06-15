// A configurable in-memory PolicyAgent used by the selfcheck and the test
// target, so the entire protocol stack can be verified without a daemon. It is
// shipped in the library (not test-only) so the runnable `xpc-bridge-selfcheck`
// executable can use it under the Command Line Tools.

import Foundation
import VGCore
import VGXPCProtocol

public actor FakePolicyAgent: PolicyAgent {
    /// How the fake behaves on every call.
    public enum Behavior: Sendable {
        /// Returns the canned values.
        case ok
        /// Throws `XPCClientError.notConnected` (models a down daemon).
        case unavailable
        /// Throws `XPCClientError.remote(_:)` with the given message.
        case remote(String)
        /// Sleeps for the given duration, then returns the canned values
        /// (models a slow/hung daemon for timeout tests).
        case slow(milliseconds: Int)
    }

    private let behavior: Behavior
    private let decisionValue: Decision
    private let statusValue: AgentStatus
    private let summariesValue: [DecisionSummary]
    private let ackValue: Bool

    public init(
        behavior: Behavior = .ok,
        decision: Decision = FakePolicyAgent.sampleBlockDecision,
        status: AgentStatus = FakePolicyAgent.sampleStatus,
        summaries: [DecisionSummary] = FakePolicyAgent.sampleSummaries,
        ack: Bool = true
    ) {
        self.behavior = behavior
        self.decisionValue = decision
        self.statusValue = status
        self.summariesValue = summaries
        self.ackValue = ack
    }

    private func gate() async throws {
        switch behavior {
        case .ok:
            return
        case .unavailable:
            throw XPCClientError.notConnected
        case .remote(let message):
            throw XPCClientError.remote(message)
        case .slow(let ms):
            try await Task.sleep(nanoseconds: UInt64(max(0, ms)) * 1_000_000)
        }
    }

    public func submitScan(_ request: ScanRequest) async throws -> Decision {
        try await gate()
        return decisionValue
    }

    public func status() async throws -> AgentStatus {
        try await gate()
        return statusValue
    }

    public func recentDecisions(limit: Int) async throws -> [DecisionSummary] {
        try await gate()
        return Array(summariesValue.prefix(max(0, limit)))
    }

    public func acknowledgeWarning(eventID: String, accepted: Bool) async throws -> Bool {
        try await gate()
        return ackValue
    }

    // ── Canned values ──────────────────────────────────────────────────────────

    public static let sampleBlockDecision = Decision(
        requestID: "req-block-1",
        action: .block,
        riskLevel: .critical,
        classification: .restricted,
        matchedRuleID: "rule.secret.aws",
        severity: .critical,
        findings: [
            Finding(
                detectorID: "secret.aws_access_key",
                category: .secret,
                kind: "aws_access_key",
                spanStart: 10,
                spanEnd: 30,
                confidence: 0.99,
                severity: .critical,
                redactedPreview: "AKIA****************",
                meta: ["line": "3"]
            )
        ],
        reason: "blocked by rule.secret.aws",
        policyVersion: 7,
        elapsedMicros: 4300,
        incomplete: false
    )

    public static let sampleStatus = AgentStatus(
        engineServing: true,
        activePolicyVersion: 7,
        queuedEvents: 3,
        lastUploadOutcome: "success",
        engineConnected: true,
        agentVersion: "1.2.0"
    )

    public static let sampleSummaries = [
        DecisionSummary(
            requestID: "req-block-1",
            timestampMs: 1_717_600_000_000,
            action: .block,
            riskLevel: .critical,
            matchedRuleID: "rule.secret.aws",
            provider: "openai",
            app: "chatgpt"
        ),
        DecisionSummary(
            requestID: "req-allow-1",
            timestampMs: 1_717_600_001_000,
            action: .allow,
            riskLevel: .low,
            matchedRuleID: nil,
            provider: nil,
            app: nil
        ),
    ]
}
