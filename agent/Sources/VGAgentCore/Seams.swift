// Dependency-inversion seams: the protocols AgentCore depends on. Concrete
// implementations (gRPC client, HTTP upload, file policy source) are injected, so
// AgentCore is fully testable with in-memory doubles.

import Foundation
import VGCore
import VGEventQueue

/// Result of a policy load on the engine.
public struct LoadPolicyResult: Sendable, Equatable {
    public var accepted: Bool
    public var activeVersion: UInt32
    public var rejectReason: String

    public init(accepted: Bool, activeVersion: UInt32, rejectReason: String) {
        self.accepted = accepted
        self.activeVersion = activeVersion
        self.rejectReason = rejectReason
    }
}

/// Engine health snapshot.
public struct EngineHealth: Sendable, Equatable {
    public var serving: Bool
    public var activePolicyVersion: UInt32
    public var queuedEvents: UInt64
    public var engineVersion: String

    public init(serving: Bool, activePolicyVersion: UInt32, queuedEvents: UInt64, engineVersion: String) {
        self.serving = serving
        self.activePolicyVersion = activePolicyVersion
        self.queuedEvents = queuedEvents
        self.engineVersion = engineVersion
    }
}

/// The engine RPC surface the agent consumes (implemented by `VGGRPCClient` in
/// full builds, and by doubles in tests).
public protocol PolicyEngineClient: Sendable {
    func evaluate(_ request: ScanRequest) async throws -> Decision
    func loadPolicy(_ bundleJSON: Data) async throws -> LoadPolicyResult
    func health() async throws -> EngineHealth
}

/// Result of an upload batch.
public struct UploadResult: Sendable, Equatable {
    public var accepted: Int
    public var rejected: Int

    public init(accepted: Int, rejected: Int) {
        self.accepted = accepted
        self.rejected = rejected
    }
}

/// The audit backend upload surface.
public protocol UploadClient: Sendable {
    /// Uploads a batch of queued events. Throws on transport/server failure so
    /// the caller keeps them queued (offline-first).
    func upload(_ events: [QueuedEvent]) async throws -> UploadResult
}

/// A source of signed policy bundles to push to the engine.
public protocol PolicySource: Sendable {
    /// Returns the latest signed bundle bytes, or nil if none is available.
    func currentBundle() async throws -> Data?
}

/// Errors surfaced by the agent core.
public enum AgentError: Error, Equatable {
    case engineUnavailable(String)
}
