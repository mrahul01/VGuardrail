// The XPC contract between the agent daemon (listener) and its clients (the menu
// bar app, `vgctl`, and future connectors).
//
// NSXPCConnection requires an `@objc` interface. To avoid per-type
// NSSecureCoding boilerplate, payloads cross as `Data` (JSON of the VGCore
// Codable models); `XPCCodec` encodes/decodes them.

import Foundation

/// Mach service the daemon registers (must match the LaunchDaemon plist
/// `MachServices` key and the clients' `NSXPCConnection`).
public let agentXPCMachServiceName = "com.vguardrail.agent.xpc"

/// The remote interface vended by the agent daemon.
@objc public protocol AgentControl {
    /// Submit a prompt for evaluation.
    /// - Parameters:
    ///   - requestData: JSON of `ScanRequest`.
    ///   - reply: `(decisionData, errorMessage)` — exactly one is non-nil.
    ///            `decisionData` is JSON of `Decision`.
    func submitScan(
        _ requestData: Data,
        withReply reply: @escaping (Data?, String?) -> Void
    )

    /// OCR an image on disk (Apple Vision) and submit the recognized text for
    /// evaluation. Lets a caller that only has a file path get a decision
    /// without doing OCR itself.
    /// - Parameters:
    ///   - imagePath: absolute path to an image file.
    ///   - reply: `(decisionData, errorMessage)` — exactly one is non-nil.
    ///            `decisionData` is JSON of `Decision`.
    func submitImageScan(
        _ imagePath: String,
        withReply reply: @escaping (Data?, String?) -> Void
    )

    /// Current agent + engine health. `reply` carries JSON of `AgentStatus`.
    func getStatus(withReply reply: @escaping (Data) -> Void)

    /// Record a user's response to a WARN decision.
    /// - Parameters:
    ///   - eventID: the decision/request id being acknowledged.
    ///   - accepted: true if the user continued, false if they cancelled.
    func acknowledgeWarning(
        _ eventID: String,
        accepted: Bool,
        withReply reply: @escaping (Bool) -> Void
    )

    /// Recent decisions for the menu bar. `reply` carries JSON of `[DecisionSummary]`.
    func recentDecisions(limit: Int, withReply reply: @escaping (Data) -> Void)
}

/// XPC wiring helpers.
public enum AgentXPC {
    /// The configured Mach service name.
    public static let machServiceName = agentXPCMachServiceName

    /// Builds the `NSXPCInterface` for `AgentControl`.
    public static func interface() -> NSXPCInterface {
        NSXPCInterface(with: AgentControl.self)
    }
}
