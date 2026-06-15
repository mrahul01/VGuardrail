// In-memory test doubles for the AgentCore seams.

import Foundation
import VGCore
import VGEventQueue
@testable import VGAgentCore

/// Returns a fixed decision and accepts policy loads.
struct StubEngineClient: PolicyEngineClient {
    let decision: Decision
    var loadAccepted = true
    var loadVersion: UInt32 = 1

    func evaluate(_ request: ScanRequest) async throws -> Decision { decision }
    func loadPolicy(_ bundleJSON: Data) async throws -> LoadPolicyResult {
        LoadPolicyResult(accepted: loadAccepted, activeVersion: loadVersion, rejectReason: loadAccepted ? "" : "rejected")
    }
    func health() async throws -> EngineHealth {
        EngineHealth(serving: true, activePolicyVersion: loadVersion, queuedEvents: 0, engineVersion: "test")
    }
}

/// Always fails to reach the engine.
struct UnavailableEngineClient: PolicyEngineClient {
    struct Boom: Error {}
    func evaluate(_ request: ScanRequest) async throws -> Decision { throw Boom() }
    func loadPolicy(_ bundleJSON: Data) async throws -> LoadPolicyResult { throw Boom() }
    func health() async throws -> EngineHealth { throw Boom() }
}

/// Succeeds or fails uploads on demand.
struct StubUploadClient: UploadClient {
    enum Mode { case succeed, fail }
    let mode: Mode
    struct Boom: Error {}
    func upload(_ events: [QueuedEvent]) async throws -> UploadResult {
        switch mode {
        case .succeed: return UploadResult(accepted: events.count, rejected: 0)
        case .fail: throw Boom()
        }
    }
}

/// Returns canned bundle bytes.
struct StubPolicySource: PolicySource {
    let bytes: Data?
    func currentBundle() async throws -> Data? { bytes }
}

enum Fixtures {
    static let identity = DeviceIdentity(deviceID: "dev-1", hostname: "host", agentVersion: "0.1.0")
    static let signer: @Sendable (Data) -> String = { _ in "test-sig" }
    static let clock: @Sendable () -> Int64 = { 1_000 }

    static func blockDecision() -> Decision {
        Decision(requestID: "r1", action: .block, riskLevel: .critical, classification: .restricted,
                 matchedRuleID: "rule_x", severity: .critical,
                 findings: [Finding(detectorID: "secret.aws_access_key", category: .secret,
                                    kind: "aws_access_key", spanStart: 0, spanEnd: 20,
                                    confidence: 0.99, severity: .critical, redactedPreview: "AKIA…MPLE")])
    }

    static func allowDecision() -> Decision {
        Decision(requestID: "r2", action: .allow, riskLevel: .low, classification: .public)
    }

    static func request() -> ScanRequest {
        ScanRequest(text: "AKIAIOSFODNN7EXAMPLE", context: ScanContext(
            source: .cli, provider: "openai", app: "claude-code",
            user: UserContext(userID: "alice", role: .user)
        ))
    }

    static func makeCore(
        client: any PolicyEngineClient,
        upload: any UploadClient,
        queue: EventQueue,
        policySource: any PolicySource = StubPolicySource(bytes: nil),
        now: @escaping @Sendable () -> Int64 = Fixtures.clock
    ) -> AgentCore {
        AgentCore(
            client: client, queue: queue, upload: upload, policySource: policySource,
            config: AgentConfig(uploadBatchSize: 100, maxUploadAttempts: 3, uploadBackoffBaseMillis: 100),
            identity: identity, sign: signer, now: now
        )
    }
}
