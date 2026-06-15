// Runtime checks for VGAgentCore using in-memory doubles.

import Foundation
import VGAgentCore
import VGCore
import VGEventQueue

private struct SCStubEngine: PolicyEngineClient {
    let decision: Decision
    func evaluate(_ request: ScanRequest) async throws -> Decision { decision }
    func loadPolicy(_ bundleJSON: Data) async throws -> LoadPolicyResult {
        LoadPolicyResult(accepted: true, activeVersion: 1, rejectReason: "")
    }
    func health() async throws -> EngineHealth {
        EngineHealth(serving: true, activePolicyVersion: 1, queuedEvents: 0, engineVersion: "test")
    }
}

private struct SCUnavailableEngine: PolicyEngineClient {
    struct Boom: Error {}
    func evaluate(_ request: ScanRequest) async throws -> Decision { throw Boom() }
    func loadPolicy(_ bundleJSON: Data) async throws -> LoadPolicyResult { throw Boom() }
    func health() async throws -> EngineHealth { throw Boom() }
}

private struct SCUpload: UploadClient {
    let fail: Bool
    struct Boom: Error {}
    func upload(_ events: [QueuedEvent]) async throws -> UploadResult {
        if fail { throw Boom() }
        return UploadResult(accepted: events.count, rejected: 0)
    }
}

private struct SCSource: PolicySource {
    let bytes: Data?
    func currentBundle() async throws -> Data? { bytes }
}

private let scIdentity = DeviceIdentity(deviceID: "dev-1", hostname: "h", agentVersion: "0.1.0")
private let scSigner: @Sendable (Data) -> String = { _ in "sig" }

private func blockDecision() -> Decision {
    Decision(requestID: "r1", action: .block, riskLevel: .critical, classification: .restricted,
             matchedRuleID: "rule_x", severity: .critical,
             findings: [Finding(detectorID: "secret.aws_access_key", category: .secret,
                                kind: "aws_access_key", spanStart: 0, spanEnd: 20,
                                confidence: 0.99, severity: .critical, redactedPreview: "AKIA…MPLE")])
}

private func request() -> ScanRequest {
    ScanRequest(text: "AKIAIOSFODNN7EXAMPLE", context: ScanContext(
        source: .cli, provider: "openai", app: "claude-code", user: UserContext(userID: "alice")))
}

private func core(_ client: any PolicyEngineClient, _ upload: any UploadClient,
                  _ queue: EventQueue, _ source: any PolicySource = SCSource(bytes: nil),
                  now: @escaping @Sendable () -> Int64 = { 1_000 }) -> AgentCore {
    AgentCore(client: client, queue: queue, upload: upload, policySource: source,
              config: AgentConfig(uploadBackoffBaseMillis: 100), identity: scIdentity, sign: scSigner, now: now)
}

@MainActor
func checkVGAgentCore(_ c: Checker) async {
    c.section("VGAgentCore — submitScan records redacted events")
    do {
        let q = try EventQueue.inMemory()
        let agent = core(SCStubEngine(decision: blockDecision()), SCUpload(fail: false), q)
        let decision = try await agent.submitScan(request())
        let depth = try await q.queueDepth()
        let batch = try await q.claimBatch(limit: 10, nowMillis: 10_000)
        let leaks = batch.contains { String(decoding: $0.payload, as: UTF8.self).contains("AKIAIOSFODNN7EXAMPLE") }
        c.expect(decision.action == .block && depth == 2 && !leaks,
                 "block → PolicyEvaluated + PromptBlocked, redacted")
    } catch { c.expect(false, "submitScan: \(error)") }

    c.section("VGAgentCore — engine failure fails closed")
    do {
        let q = try EventQueue.inMemory()
        let agent = core(SCUnavailableEngine(), SCUpload(fail: false), q)
        _ = try await agent.submitScan(request())
        c.expect(false, "should have thrown")
    } catch is AgentError {
        c.expect(true, "submitScan throws AgentError when engine is down")
    } catch { c.expect(false, "wrong error: \(error)") }

    c.section("VGAgentCore — upload worker")
    do {
        let q = try EventQueue.inMemory()
        let agent = core(SCStubEngine(decision: blockDecision()), SCUpload(fail: false), q)
        _ = try await agent.submitScan(request())
        let r = await agent.runUploadOnce()
        let depthAfter = try await q.queueDepth()
        c.expect(r?.accepted == 2 && depthAfter == 0, "success drains the queue")
    } catch { c.expect(false, "upload success: \(error)") }
    do {
        let q = try EventQueue.inMemory()
        let failing = core(SCStubEngine(decision: blockDecision()), SCUpload(fail: true), q)
        _ = try await failing.submitScan(request())
        let r = await failing.runUploadOnce()
        let stillQueued = try await q.queueDepth()
        let draining = core(SCStubEngine(decision: blockDecision()), SCUpload(fail: false), q, now: { 10_000 })
        let r2 = await draining.runUploadOnce()
        let finalDepth = try await q.queueDepth()
        c.expect(r == nil && stillQueued == 2 && r2?.accepted == 2 && finalDepth == 0,
                 "failure keeps events queued; later success drains (offline-first)")
    } catch { c.expect(false, "upload failure: \(error)") }

    c.section("VGAgentCore — policy sync & loopback safety")
    do {
        let q = try EventQueue.inMemory()
        let agent = core(SCStubEngine(decision: blockDecision()), SCUpload(fail: false), q,
                         SCSource(bytes: Data("{\"version\":1}".utf8)))
        let r = await agent.syncPolicyOnce()
        c.expect(r?.accepted == true && r?.activeVersion == 1, "policy bundle pushed to engine")
    } catch { c.expect(false, "policy sync: \(error)") }
    do {
        let decision = try await LoopbackPolicyEngineClient().evaluate(request())
        c.expect(decision.action == .warn, "loopback client fails safe to WARN")
    } catch { c.expect(false, "loopback: \(error)") }
}
