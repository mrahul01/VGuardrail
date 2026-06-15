// Runtime configuration. Only the request timeout is configurable, and only
// within safe bounds. The Mach service name is deliberately NOT configurable —
// the bridge connects exclusively to com.vguardrail.agent.xpc so an attacker who
// can set the environment cannot redirect it to a rogue service (which could
// fabricate "allow" decisions). See SECURITY.md.

import Foundation

public enum BridgeConfig {
    public static let defaultTimeoutMs = 5_000
    public static let minTimeoutMs = 100
    public static let maxTimeoutMs = 60_000
    public static let defaultMaxInFlight = 16

    /// Reads `VG_BRIDGE_TIMEOUT_MS`, clamped to `[minTimeoutMs, maxTimeoutMs]`.
    /// Falls back to `defaultTimeoutMs` when unset or unparseable.
    public static func timeoutMillisFromEnvironment(
        _ environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Int {
        guard let raw = environment["VG_BRIDGE_TIMEOUT_MS"], let value = Int(raw) else {
            return defaultTimeoutMs
        }
        return min(max(value, minTimeoutMs), maxTimeoutMs)
    }
}
