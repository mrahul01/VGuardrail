// Error tagging for the `(Data?, String?)` XPC reply convention.
//
// `AgentControl.submitScan` reports failures through a bare error *string*, which
// otherwise erases the distinction between "the policy engine is unreachable"
// (an availability condition the connector should fail-closed *and* surface as
// such) and any other daemon-side error. The daemon tags engine-availability
// failures with a stable sentinel prefix; the connector bridge recognises it and
// maps it back to a structured `UNAVAILABLE` code. Keep this contract in lockstep
// with the bridge's `mapAgentError`.

import Foundation

public enum XPCErrorWire {
    /// Prefix marking an error reply as "the policy engine (`pe-engined`) is
    /// unreachable". Sentinel text, never request-derived, so it carries no
    /// prompt content.
    public static let unavailablePrefix = "ENGINE_UNAVAILABLE: "

    /// Tags `detail` as an engine-unavailable failure for the wire.
    public static func encodeUnavailable(_ detail: String) -> String {
        unavailablePrefix + detail
    }

    /// Returns the detail when `message` is an engine-unavailable sentinel, else
    /// `nil` (an ordinary daemon error string).
    public static func unavailableDetail(_ message: String) -> String? {
        guard message.hasPrefix(unavailablePrefix) else { return nil }
        return String(message.dropFirst(unavailablePrefix.count))
    }
}
