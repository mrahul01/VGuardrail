// Error taxonomy + mapping. Codes match the SDK's ConnectorErrorCode vocabulary
//. The SDK reconstructs a typed error
// from the `code` on each `ok:false` reply (see `connectorErrorFromWire`), so the
// code is load-bearing — an `UNAVAILABLE` reply feeds the fail-closed fallback,
// a `REMOTE` reply does not. Keep it precise and stable.

import Foundation
import VGXPCProtocol

/// Error codes emitted in `{ ok:false, error:{ code, message } }` replies.
public enum BridgeErrorCode: String, Sendable {
    case validation = "VALIDATION"
    case remote = "REMOTE"
    case unavailable = "UNAVAILABLE"
    case transport = "TRANSPORT"
    case notConnected = "NOT_CONNECTED"
    case timeout = "TIMEOUT"
    case versionMismatch = "VERSION_MISMATCH"
}

/// A bridge-level failure carrying a wire `code` + a safe `message`.
///
/// Invariant: `message` must never contain prompt content, findings, or secrets.
/// Messages are fixed strings or values sourced from the daemon's own error
/// channel (which the SDK already treats as an error string), never from request
/// payloads.
public struct BridgeError: Error, Sendable, Equatable {
    public let code: BridgeErrorCode
    public let message: String

    public init(code: BridgeErrorCode, message: String) {
        self.code = code
        self.message = message
    }
}

/// Maps an error thrown by the `PolicyAgent` (i.e. the XPC round-trip) to a
/// `BridgeError` with a precise code and a payload-free message.
public func mapAgentError(_ error: Error) -> BridgeError {
    if let xpc = error as? XPCClientError {
        switch xpc {
        case .notConnected:
            return BridgeError(code: .notConnected, message: "agent is not reachable")
        case .remote(let message):
            // The daemon's own error string, part of the documented (Data?,
            // String?) reply convention. An engine-availability failure is tagged
            // with a stable sentinel (see XPCErrorWire) — surface it as a
            // structured UNAVAILABLE so the connector fails closed *and* can say
            // "policy engine unavailable" rather than an opaque error.
            if XPCErrorWire.unavailableDetail(message) != nil {
                return BridgeError(code: .unavailable, message: "policy engine unavailable")
            }
            return BridgeError(code: .remote, message: message)
        case .malformedReply:
            return BridgeError(code: .transport, message: "malformed reply from agent")
        }
    }
    if let bridgeError = error as? BridgeError {
        return bridgeError
    }
    if error is CancellationError {
        return BridgeError(code: .timeout, message: "request cancelled")
    }
    // NSXPCConnection delivers connection failures as generic NSErrors. We do
    // not forward their details (they are not request-derived, but we keep the
    // surface minimal and stable).
    return BridgeError(code: .transport, message: "xpc transport error")
}
