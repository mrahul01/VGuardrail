// Wire constants for the SDK ↔ bridge protocol. These MUST match
// the protocol constants below.

import Foundation

public enum BridgeProtocol {
    /// Bridge protocol version carried in every envelope's `v` field.
    public static let version = 1

    /// Model schema the bridge speaks. Must equal the Swift agent's
    /// `AuditEvent.schema` ("vguardrail.event/v1"); `schemaMatchesAgentModels()`
    /// asserts this at runtime so the constant can never silently drift.
    public static let schema = "vguardrail.event/v1"

    /// Protocol versions this bridge can speak (newest first).
    public static let supportedProtocols: [Int] = [1]

    /// Hard cap on a single frame (8 MiB) — identical to the SDK's MAX_FRAME_BYTES.
    public static let maxFrameBytes = 8 * 1024 * 1024

    /// Agent identifier surfaced in the `hello` reply (informational).
    public static let agentIdentifier = "vguardrail-xpc-bridge/1.0.0"

    /// Method names — exactly the SDK's `Method` set.
    public enum Method {
        public static let hello = "hello"
        public static let submitScan = "submitScan"
        public static let getStatus = "getStatus"
        public static let acknowledgeWarning = "acknowledgeWarning"
        public static let recentDecisions = "recentDecisions"
    }

    /// Defensive upper bound on `recentDecisions(limit:)` so a hostile/huge
    /// value cannot ask the daemon (or this process) to marshal an unbounded
    /// list. The daemon caps its own log well below this.
    public static let maxRecentLimit = 10_000
}
