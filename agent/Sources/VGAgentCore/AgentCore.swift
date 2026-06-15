// The orchestration core: an actor that ties the engine client, the event queue,
// the upload worker, and policy sync together.
//
// It owns the agent's audit-event pipeline (locked decision: the agent builds
// events from the engine's response and owns the queue + upload). All state is
// actor-isolated; collaborators are injected via Sendable seams so the whole
// flow is testable with in-memory doubles.

import Foundation
import VGCore
import VGEventQueue

public actor AgentCore {
    private let client: any PolicyEngineClient
    private let queue: EventQueue
    private let upload: any UploadClient
    private let policySource: any PolicySource
    private let config: AgentConfig
    private let identity: DeviceIdentity
    private let sign: @Sendable (Data) -> String
    private let now: @Sendable () -> Int64

    private var lastUploadOutcome: String?
    private var engineConnected = false
    private var lastHealth: EngineHealth?

    public init(
        client: any PolicyEngineClient,
        queue: EventQueue,
        upload: any UploadClient,
        policySource: any PolicySource,
        config: AgentConfig,
        identity: DeviceIdentity,
        sign: @escaping @Sendable (Data) -> String,
        now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.client = client
        self.queue = queue
        self.upload = upload
        self.policySource = policySource
        self.config = config
        self.identity = identity
        self.sign = sign
        self.now = now
    }

    // MARK: - Lifecycle

    /// Persists device identity and records an `AgentStarted` event.
    public func bootstrap(hostname: String) async {
        let device = DeviceRecord(
            deviceID: identity.deviceID,
            hostname: hostname,
            agentVersion: identity.agentVersion,
            registered: false,
            lastPolicySync: nil,
            lastSeen: isoNow()
        )
        try? await queue.saveDevice(device)
        await enqueue(syntheticEvent(type: .agentStarted, action: .allow, requestID: UUIDv7.generate()))
    }

    // MARK: - Evaluation (the hot path)

    /// Evaluates a prompt via the engine, records audit events, and returns the
    /// decision. Throws `AgentError.engineUnavailable` if the engine call fails.
    public func submitScan(_ request: ScanRequest) async throws -> Decision {
        let decision: Decision
        do {
            decision = try await client.evaluate(request)
            engineConnected = true
        } catch {
            engineConnected = false
            throw AgentError.engineUnavailable(String(describing: error))
        }

        let timestamp = now()

        // 1. Always record that evaluation happened.
        await enqueue(AuditEvent.make(
            type: .policyEvaluated, eventID: UUIDv7.generate(), timestampMs: timestamp,
            context: request.context, deviceID: identity.deviceID, decision: decision
        ))

        // 2. A warn/block on a matched rule is also a violation.
        if decision.matchedRuleID != nil, decision.action != .allow {
            await enqueue(AuditEvent.make(
                type: EventType.primary(for: decision.action), eventID: UUIDv7.generate(),
                timestampMs: timestamp, context: request.context,
                deviceID: identity.deviceID, decision: decision
            ))
        }

        // 3. Update the rolling decision log for the UI.
        try? await queue.logDecision(DecisionSummary(
            requestID: decision.requestID, timestampMs: timestamp,
            action: decision.action, riskLevel: decision.riskLevel,
            matchedRuleID: decision.matchedRuleID,
            provider: request.context.provider, app: request.context.app
        ))

        return decision
    }

    /// Records the user's response to a WARN.
    @discardableResult
    public func acknowledgeWarning(eventID: String, accepted: Bool) async -> Bool {
        let event = syntheticEvent(
            type: accepted ? .warningAccepted : .warningRejected,
            action: accepted ? .allow : .block,
            requestID: eventID
        )
        return await enqueue(event)
    }

    // MARK: - Upload worker

    /// Claims a batch and uploads it. Returns the upload result, or nil if the
    /// queue was empty or the upload failed (events remain queued).
    @discardableResult
    public func runUploadOnce() async -> UploadResult? {
        let timestamp = now()
        let batch: [QueuedEvent]
        do {
            batch = try await queue.claimBatch(limit: config.uploadBatchSize, nowMillis: timestamp)
        } catch {
            return nil
        }
        guard !batch.isEmpty else { return nil }

        let batchID = UUIDv7.generate()
        let startedAt = isoNow()
        do {
            let result = try await upload.upload(batch)
            try? await queue.markUploaded(batch.map(\.eventID))
            try? await queue.purgeUploaded()
            lastUploadOutcome = UploadOutcome.success.rawValue
            try? await queue.recordUpload(UploadRecord(
                batchID: batchID, startedAt: startedAt, finishedAt: isoNow(),
                eventCount: batch.count, accepted: result.accepted, rejected: result.rejected,
                outcome: .success
            ))
            return result
        } catch {
            for event in batch {
                _ = try? await queue.markFailed(
                    eventID: event.eventID, error: String(describing: error), nowMillis: timestamp,
                    baseBackoffMillis: config.uploadBackoffBaseMillis, maxAttempts: config.maxUploadAttempts
                )
            }
            lastUploadOutcome = UploadOutcome.failure.rawValue
            try? await queue.recordUpload(UploadRecord(
                batchID: batchID, startedAt: startedAt, finishedAt: isoNow(),
                eventCount: batch.count, accepted: nil, rejected: nil, outcome: .failure
            ))
            return nil
        }
    }

    // MARK: - Policy sync

    /// Reads the latest bundle from the source and pushes it to the engine.
    /// Returns the engine's load result, or nil if no bundle is available.
    @discardableResult
    public func syncPolicyOnce() async -> LoadPolicyResult? {
        let bundle: Data?
        do {
            bundle = try await policySource.currentBundle()
        } catch {
            return nil
        }
        guard let bundle else { return nil }

        let result: LoadPolicyResult
        do {
            result = try await client.loadPolicy(bundle)
            engineConnected = true
        } catch {
            engineConnected = false
            return nil
        }

        if result.accepted {
            if var device = try? await queue.loadDevice() {
                device.lastPolicySync = isoNow()
                try? await queue.saveDevice(device)
            }
            var decision = syntheticDecision(action: .allow, requestID: UUIDv7.generate())
            decision.policyVersion = result.activeVersion
            await enqueue(AuditEvent.make(
                type: .policyUpdated, eventID: UUIDv7.generate(), timestampMs: now(),
                context: emptyContext(), deviceID: identity.deviceID, decision: decision
            ))
        }
        return result
    }

    // MARK: - Status

    /// Refreshes cached engine health (called periodically by the daemon).
    public func refreshHealth() async {
        do {
            lastHealth = try await client.health()
            engineConnected = true
        } catch {
            engineConnected = false
        }
    }

    /// A status snapshot for the menu bar.
    public func status() async -> AgentStatus {
        let depth = (try? await queue.queueDepth()) ?? 0
        return AgentStatus(
            engineServing: lastHealth?.serving ?? false,
            activePolicyVersion: lastHealth?.activePolicyVersion ?? 0,
            queuedEvents: depth,
            lastUploadOutcome: lastUploadOutcome,
            engineConnected: engineConnected,
            agentVersion: identity.agentVersion
        )
    }

    /// Recent decisions for the menu bar.
    public func recentDecisions(limit: Int) async -> [DecisionSummary] {
        (try? await queue.recentDecisions(limit: limit)) ?? []
    }

    // MARK: - Internals

    /// Signs and enqueues an event. Returns false if it could not be persisted
    /// (audit loss is logged, never fatal to the user's action).
    @discardableResult
    private func enqueue(_ event: AuditEvent) async -> Bool {
        do {
            let payload = try event.canonicalJSON()
            let signature = sign(payload)
            try await queue.enqueue(event, signature: signature)
            return true
        } catch {
            return false
        }
    }

    private func syntheticDecision(action: Action, requestID: String) -> Decision {
        Decision(requestID: requestID, action: action, riskLevel: .low, classification: .public)
    }

    private func syntheticEvent(type: EventType, action: Action, requestID: String) -> AuditEvent {
        AuditEvent.make(
            type: type, eventID: UUIDv7.generate(), timestampMs: now(),
            context: emptyContext(), deviceID: identity.deviceID,
            decision: syntheticDecision(action: action, requestID: requestID)
        )
    }

    private func emptyContext() -> ScanContext {
        ScanContext(user: UserContext(userID: identity.deviceID))
    }

    private func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: Double(now()) / 1000))
    }
}
