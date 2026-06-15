// Runtime checks for VGEventQueue (async; runs on the MainActor executor so the
// non-Sendable Checker never crosses an isolation boundary).

import Foundation
import VGCore
import VGEventQueue

private func sampleEvent(_ id: String) -> AuditEvent {
    AuditEvent.make(
        type: .policyEvaluated, eventID: id, timestampMs: 1_700_000_000_000,
        context: ScanContext(provider: "openai", app: "Cursor", user: UserContext(userID: "u1")),
        deviceID: "dev-1",
        decision: Decision(requestID: id, action: .block, riskLevel: .critical, classification: .restricted)
    )
}

@MainActor
func checkVGEventQueue(_ c: Checker) async {
    c.section("VGEventQueue — enqueue / claim / ack")
    do {
        let q = try EventQueue.inMemory()
        try await q.enqueue(sampleEvent("e1"), signature: "s1")
        try await q.enqueue(sampleEvent("e2"), signature: "s2")
        let depth = try await q.queueDepth()
        let batch = try await q.claimBatch(limit: 10, nowMillis: 1_000)
        let inflight = try await q.count(status: .inflight)
        let reclaim = try await q.claimBatch(limit: 10, nowMillis: 1_000)
        try await q.markUploaded(batch.map(\.eventID))
        let afterDepth = try await q.queueDepth()
        let purged = try await q.purgeUploaded()
        c.expect(depth == 2 && batch.count == 2 && inflight == 2 && reclaim.isEmpty
                 && afterDepth == 0 && purged == 2, "full pending→inflight→uploaded→purge cycle")
    } catch { c.expect(false, "queue cycle: \(error)") }

    c.section("VGEventQueue — payload stays redacted")
    do {
        let q = try EventQueue.inMemory()
        let ev = AuditEvent.make(
            type: .promptBlocked, eventID: "e1", timestampMs: 1,
            context: ScanContext(user: UserContext(userID: "u")), deviceID: "d",
            decision: Decision(
                requestID: "r", action: .block, riskLevel: .critical, classification: .restricted,
                findings: [Finding(detectorID: "secret.aws_access_key", category: .secret,
                                   kind: "aws_access_key", spanStart: 0, spanEnd: 20,
                                   confidence: 0.99, severity: .critical, redactedPreview: "AKIA…MPLE")])
        )
        try await q.enqueue(ev, signature: "sig")
        let batch = try await q.claimBatch(limit: 1, nowMillis: 1)
        let json = String(decoding: batch[0].payload, as: UTF8.self)
        c.expect(!json.contains("AKIAIOSFODNN7EXAMPLE") && json.contains("AKIA…MPLE"),
                 "claimed payload has no raw secret")
    } catch { c.expect(false, "redaction: \(error)") }

    c.section("VGEventQueue — backoff then dead")
    do {
        let q = try EventQueue.inMemory()
        try await q.enqueue(sampleEvent("e1"), signature: "s")
        _ = try await q.claimBatch(limit: 10, nowMillis: 0)
        let s1 = try await q.markFailed(eventID: "e1", error: "net", nowMillis: 1_000, baseBackoffMillis: 100, maxAttempts: 3)
        let earlyEmpty = try await q.claimBatch(limit: 10, nowMillis: 1_050).isEmpty
        let retried = try await q.claimBatch(limit: 10, nowMillis: 2_000).count
        _ = try await q.markFailed(eventID: "e1", error: "net", nowMillis: 2_000, baseBackoffMillis: 100, maxAttempts: 3)
        _ = try await q.claimBatch(limit: 10, nowMillis: 100_000)
        let s3 = try await q.markFailed(eventID: "e1", error: "net", nowMillis: 100_000, baseBackoffMillis: 100, maxAttempts: 3)
        let deadEmpty = try await q.claimBatch(limit: 10, nowMillis: 1_000_000).isEmpty
        c.expect(s1 == .failed && earlyEmpty && retried == 1 && s3 == .dead && deadEmpty,
                 "retry backoff escalates to dead, dead never reclaimed")
    } catch { c.expect(false, "backoff: \(error)") }

    c.section("VGEventQueue — unknown event fails closed")
    do {
        let q = try EventQueue.inMemory()
        _ = try await q.markFailed(eventID: "nope", error: "x", nowMillis: 0, baseBackoffMillis: 1, maxAttempts: 3)
        c.expect(false, "markFailed on unknown event should throw")
    } catch is EventQueueError {
        c.expect(true, "markFailed on unknown event throws EventQueueError")
    } catch { c.expect(false, "wrong error: \(error)") }

    c.section("VGEventQueue — device & decision log")
    do {
        let q = try EventQueue.inMemory()
        let d = DeviceRecord(deviceID: "dev-1", hostname: "mac", agentVersion: "0.1.0", registered: true)
        try await q.saveDevice(d)
        let loaded = try await q.loadDevice()
        for i in 0..<5 {
            try await q.logDecision(DecisionSummary(requestID: "r\(i)", timestampMs: Int64(i),
                                                    action: .allow, riskLevel: .low,
                                                    matchedRuleID: nil, provider: "p", app: "a"))
        }
        let recent = try await q.recentDecisions(limit: 3)
        c.expect(loaded == d && recent.count == 3 && recent.first?.requestID == "r4",
                 "device round-trips and decision log rolls newest-first")
    } catch { c.expect(false, "device/log: \(error)") }
}
