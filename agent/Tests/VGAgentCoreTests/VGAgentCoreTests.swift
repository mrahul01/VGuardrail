import Foundation
import Testing
import VGCore
import VGEventQueue
@testable import VGAgentCore

@Suite struct AgentCoreTests {

    @Test func blockDecisionEnqueuesEvaluatedAndViolation() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.blockDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue
        )
        let decision = try await core.submitScan(Fixtures.request())
        #expect(decision.action == .block)
        // PolicyEvaluated + PromptBlocked.
        #expect(try await queue.queueDepth() == 2)
        let recent = try await queue.recentDecisions(limit: 5)
        #expect(recent.first?.action == .block)
    }

    @Test func allowDecisionEnqueuesOnlyEvaluated() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.allowDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue
        )
        _ = try await core.submitScan(Fixtures.request())
        #expect(try await queue.queueDepth() == 1)
    }

    @Test func enqueuedEventStaysRedacted() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.blockDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue
        )
        _ = try await core.submitScan(Fixtures.request())
        let batch = try await queue.claimBatch(limit: 10, nowMillis: 10_000)
        for event in batch {
            let json = String(decoding: event.payload, as: UTF8.self)
            #expect(!json.contains("AKIAIOSFODNN7EXAMPLE"))
            #expect(event.payloadSignature == "test-sig")
        }
    }

    @Test func engineFailureThrowsAndQueuesNothing() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: UnavailableEngineClient(),
            upload: StubUploadClient(mode: .succeed), queue: queue
        )
        await #expect(throws: AgentError.self) {
            _ = try await core.submitScan(Fixtures.request())
        }
        #expect(try await queue.queueDepth() == 0)
    }

    @Test func uploadSuccessDrainsQueue() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.blockDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue
        )
        _ = try await core.submitScan(Fixtures.request())
        let result = await core.runUploadOnce()
        #expect(result?.accepted == 2)
        #expect(try await queue.queueDepth() == 0)
    }

    @Test func uploadFailureKeepsEventsQueued() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.blockDecision()),
            upload: StubUploadClient(mode: .fail), queue: queue
        )
        _ = try await core.submitScan(Fixtures.request())
        let result = await core.runUploadOnce()
        #expect(result == nil)
        // Events are still owed (now in 'failed' with a backoff).
        #expect(try await queue.queueDepth() == 2)
        // Offline-first: a later success drains them. core2 shares the queue but
        // runs at a later clock, past the retry backoff.
        let core2 = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.allowDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue,
            now: { 10_000 }
        )
        let drained = await core2.runUploadOnce()
        #expect(drained?.accepted == 2)
        #expect(try await queue.queueDepth() == 0)
    }

    @Test func policySyncPushesBundle() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.allowDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue,
            policySource: StubPolicySource(bytes: Data("{\"version\":1}".utf8))
        )
        let result = await core.syncPolicyOnce()
        #expect(result?.accepted == true)
        #expect(result?.activeVersion == 1)
        // A PolicyUpdated event was recorded.
        #expect(try await queue.queueDepth() == 1)
    }

    @Test func policySyncNoBundleIsNoop() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.allowDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue,
            policySource: StubPolicySource(bytes: nil)
        )
        #expect(await core.syncPolicyOnce() == nil)
        #expect(try await queue.queueDepth() == 0)
    }

    @Test func acknowledgeWarningRecordsEvent() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.allowDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue
        )
        #expect(await core.acknowledgeWarning(eventID: "r1", accepted: true))
        #expect(try await queue.queueDepth() == 1)
    }

    @Test func statusReflectsQueueAndHealth() async throws {
        let queue = try EventQueue.inMemory()
        let core = Fixtures.makeCore(
            client: StubEngineClient(decision: Fixtures.blockDecision()),
            upload: StubUploadClient(mode: .succeed), queue: queue
        )
        await core.refreshHealth()
        _ = try await core.submitScan(Fixtures.request())
        let status = await core.status()
        #expect(status.engineServing)
        #expect(status.engineConnected)
        #expect(status.queuedEvents == 2)
        #expect(status.agentVersion == "0.1.0")
    }

    @Test func loopbackClientFailsSafeToWarn() async throws {
        let client = LoopbackPolicyEngineClient()
        let decision = try await client.evaluate(Fixtures.request())
        #expect(decision.action == .warn, "loopback never silently allows")
    }
}
