// A dev/test PolicyEngineClient that does not talk to the engine.
//
// It is **fail-safe, not permissive**: with no engine to consult it returns a
// WARN decision by default (never a silent ALLOW). `vguardiand` refuses to use it
// in production unless VG_ALLOW_LOOPBACK is explicitly set, so it can never
// silently disable enforcement.

import Foundation
import VGCore

public struct LoopbackPolicyEngineClient: PolicyEngineClient {
    /// Produces the decision for a request. Defaults to a fail-safe WARN.
    private let decide: @Sendable (ScanRequest) -> Decision

    public init(decide: @escaping @Sendable (ScanRequest) -> Decision = LoopbackPolicyEngineClient.failSafeWarn) {
        self.decide = decide
    }

    /// The default decision: WARN, with a reason that makes the loopback obvious.
    public static let failSafeWarn: @Sendable (ScanRequest) -> Decision = { request in
        Decision(
            requestID: UUIDv7.generate(),
            action: .warn,
            riskLevel: .medium,
            classification: .internal,
            reason: "loopback client: no policy engine consulted (fail-safe WARN)"
        )
    }

    public func evaluate(_ request: ScanRequest) async throws -> Decision {
        decide(request)
    }

    public func loadPolicy(_ bundleJSON: Data) async throws -> LoadPolicyResult {
        LoadPolicyResult(accepted: false, activeVersion: 0, rejectReason: "loopback client cannot load policy")
    }

    public func health() async throws -> EngineHealth {
        EngineHealth(serving: false, activePolicyVersion: 0, queuedEvents: 0, engineVersion: "loopback")
    }
}
