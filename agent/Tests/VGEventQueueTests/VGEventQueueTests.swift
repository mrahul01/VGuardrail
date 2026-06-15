import Foundation
import Testing
@testable import VGCore
@testable import VGEventQueue

@Suite struct EventQueueTests {
    private func sampleEvent(_ id: String) -> AuditEvent {
        AuditEvent.make(
            type: .policyEvaluated,
            eventID: id,
            timestampMs: 1_700_000_000_000,
            context: ScanContext(provider: "openai", app: "Cursor", user: UserContext(userID: "u1")),
            deviceID: "dev-1",
            decision: Decision(requestID: id, action: .block, riskLevel: .critical, classification: .restricted)
        )
    }

    @Test func enqueueClaimAndAck() async throws {
        let q = try EventQueue.inMemory()
        try await q.enqueue(sampleEvent("e1"), signature: "sig1")
        try await q.enqueue(sampleEvent("e2"), signature: "sig2")
        #expect(try await q.queueDepth() == 2)

        let batch = try await q.claimBatch(limit: 10, nowMillis: 1_000)
        #expect(batch.count == 2)
        #expect(try await q.count(status: .inflight) == 2)
        // Claiming again returns nothing (all inflight).
        #expect(try await q.claimBatch(limit: 10, nowMillis: 1_000).isEmpty)

        try await q.markUploaded(batch.map(\.eventID))
        #expect(try await q.count(status: .uploaded) == 2)
        #expect(try await q.queueDepth() == 0)
        #expect(try await q.purgeUploaded() == 2)
    }

    @Test func payloadRoundTripsRedacted() async throws {
        let q = try EventQueue.inMemory()
        let event = AuditEvent.make(
            type: .promptBlocked, eventID: "e1", timestampMs: 1,
            context: ScanContext(user: UserContext(userID: "u")),
            deviceID: "d",
            decision: Decision(
                requestID: "r", action: .block, riskLevel: .critical, classification: .restricted,
                findings: [Finding(detectorID: "secret.aws_access_key", category: .secret,
                                   kind: "aws_access_key", spanStart: 0, spanEnd: 20,
                                   confidence: 0.99, severity: .critical, redactedPreview: "AKIA…MPLE")]
            )
        )
        try await q.enqueue(event, signature: "sig")
        let batch = try await q.claimBatch(limit: 1, nowMillis: 1)
        let json = String(decoding: batch[0].payload, as: UTF8.self)
        #expect(!json.contains("AKIAIOSFODNN7EXAMPLE"))
        #expect(json.contains("AKIA…MPLE"))
        #expect(batch[0].payloadSignature == "sig")
    }

    @Test func failureBackoffThenDead() async throws {
        let q = try EventQueue.inMemory()
        try await q.enqueue(sampleEvent("e1"), signature: "s")
        _ = try await q.claimBatch(limit: 10, nowMillis: 0)

        let s1 = try await q.markFailed(eventID: "e1", error: "net", nowMillis: 1_000, baseBackoffMillis: 100, maxAttempts: 3)
        #expect(s1 == .failed)
        // Not retryable before backoff elapses (1000 + 100*2^0 = 1100).
        #expect(try await q.claimBatch(limit: 10, nowMillis: 1_050).isEmpty)
        #expect(try await q.claimBatch(limit: 10, nowMillis: 2_000).count == 1)

        _ = try await q.markFailed(eventID: "e1", error: "net", nowMillis: 2_000, baseBackoffMillis: 100, maxAttempts: 3)
        _ = try await q.claimBatch(limit: 10, nowMillis: 100_000)
        let s3 = try await q.markFailed(eventID: "e1", error: "net", nowMillis: 100_000, baseBackoffMillis: 100, maxAttempts: 3)
        #expect(s3 == .dead)
        #expect(try await q.count(status: .dead) == 1)
        // Dead events are never reclaimed.
        #expect(try await q.claimBatch(limit: 10, nowMillis: 1_000_000).isEmpty)
    }

    @Test func markFailedUnknownEventThrows() async throws {
        let q = try EventQueue.inMemory()
        await #expect(throws: EventQueueError.self) {
            _ = try await q.markFailed(eventID: "nope", error: "x", nowMillis: 0, baseBackoffMillis: 1, maxAttempts: 3)
        }
    }

    @Test func deviceStateRoundTrips() async throws {
        let q = try EventQueue.inMemory()
        #expect(try await q.loadDevice() == nil)
        let d = DeviceRecord(deviceID: "dev-1", hostname: "mac", agentVersion: "0.1.0",
                             registered: true, lastPolicySync: "t", lastSeen: nil)
        try await q.saveDevice(d)
        #expect(try await q.loadDevice() == d)
        // Singleton: second save replaces.
        var d2 = d; d2.registered = false
        try await q.saveDevice(d2)
        #expect(try await q.loadDevice()?.registered == false)
    }

    @Test func uploadRecordPersists() async throws {
        let q = try EventQueue.inMemory()
        let rec = UploadRecord(batchID: "b1", startedAt: "t0", finishedAt: "t1",
                               eventCount: 10, accepted: 9, rejected: 1, outcome: .partial)
        try await q.recordUpload(rec)
        #expect(try await q.lastUpload() == rec)
    }

    @Test func decisionLogIsRollingAndOrdered() async throws {
        let q = try EventQueue.inMemory()
        for i in 0..<5 {
            try await q.logDecision(DecisionSummary(
                requestID: "r\(i)", timestampMs: Int64(i),
                action: .allow, riskLevel: .low, matchedRuleID: nil, provider: "p", app: "a"
            ))
        }
        let recent = try await q.recentDecisions(limit: 3)
        #expect(recent.count == 3)
        #expect(recent.first?.requestID == "r4") // newest first
    }

    @Test func migrationsAreIdempotentOnDisk() async throws {
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent("vg-q-\(UUID().uuidString).db").path
        defer { try? FileManager.default.removeItem(atPath: path) }
        do {
            let q = try EventQueue(path: path)
            try await q.enqueue(sampleEvent("e1"), signature: "s")
        }
        // Re-opening re-runs migrations without error and preserves data.
        let q2 = try EventQueue(path: path)
        #expect(try await q2.queueDepth() == 1)
    }
}
