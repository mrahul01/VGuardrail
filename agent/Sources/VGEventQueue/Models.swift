// Row models for the agent's local store.

import Foundation

/// Lifecycle status of a queued event.
public enum EventStatus: String, Sendable, Equatable, CaseIterable {
    case pending
    case inflight
    case uploaded
    case failed
    case dead
}

/// An event claimed from the queue for upload.
public struct QueuedEvent: Sendable, Equatable {
    public let eventID: String
    public let type: String
    public let createdAt: String
    public let payload: [UInt8]
    public let payloadSignature: String

    public init(eventID: String, type: String, createdAt: String, payload: [UInt8], payloadSignature: String) {
        self.eventID = eventID
        self.type = type
        self.createdAt = createdAt
        self.payload = payload
        self.payloadSignature = payloadSignature
    }
}

/// Persisted device identity/registration state (singleton row).
public struct DeviceRecord: Sendable, Equatable {
    public var deviceID: String
    public var hostname: String
    public var agentVersion: String
    public var registered: Bool
    public var lastPolicySync: String?
    public var lastSeen: String?

    public init(
        deviceID: String, hostname: String, agentVersion: String,
        registered: Bool = false, lastPolicySync: String? = nil, lastSeen: String? = nil
    ) {
        self.deviceID = deviceID
        self.hostname = hostname
        self.agentVersion = agentVersion
        self.registered = registered
        self.lastPolicySync = lastPolicySync
        self.lastSeen = lastSeen
    }
}

/// Outcome of an upload batch.
public enum UploadOutcome: String, Sendable, Equatable {
    case success
    case failure
    case partial
}

/// A record of one upload attempt.
public struct UploadRecord: Sendable, Equatable {
    public var batchID: String
    public var startedAt: String
    public var finishedAt: String?
    public var eventCount: Int
    public var accepted: Int?
    public var rejected: Int?
    public var outcome: UploadOutcome

    public init(
        batchID: String, startedAt: String, finishedAt: String? = nil,
        eventCount: Int, accepted: Int? = nil, rejected: Int? = nil, outcome: UploadOutcome
    ) {
        self.batchID = batchID
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.eventCount = eventCount
        self.accepted = accepted
        self.rejected = rejected
        self.outcome = outcome
    }
}

/// Errors from the event queue.
public enum EventQueueError: Error, Equatable {
    case unknownEvent(String)
}
