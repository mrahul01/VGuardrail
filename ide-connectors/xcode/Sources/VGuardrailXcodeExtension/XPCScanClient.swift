// XPCScanClient — self-contained XPC client for the VGuardrail agent daemon.
//
// Talks directly to vguardiand over NSXPCConnection (mach service
// com.vguardrail.agent.xpc) — no framework import, no Node bridge. The @objc
// protocol below is a verbatim mirror of the daemon's exported interface
// (agent/Sources/VGXPCProtocol/AgentControl.swift); the Objective-C selectors
// must match exactly. Only `submitScan` is exercised by this client.
//
// Fail-closed: any failure — daemon missing, connection invalidated, malformed
// reply, 5 s timeout — yields a synthetic BLOCK verdict, never an allow.
// Engine-down errors (the daemon's ENGINE_UNAVAILABLE sentinel) and transport
// errors surface as "policy engine unavailable"; other daemon errors as
// "connector error; fail-closed block" — matching the Safari handler
// (browser-connectors/safari/swift/SafariWebExtensionHandler.swift).
//
// No prompt content is ever logged; only decision metadata reaches os_log.

import Foundation
import os

/// Mirror of `AgentControl` (agent/Sources/VGXPCProtocol/AgentControl.swift).
@objc protocol AgentControl {
    func submitScan(
        _ requestData: Data,
        withReply reply: @escaping (Data?, String?) -> Void
    )

    func getStatus(withReply reply: @escaping (Data) -> Void)

    func acknowledgeWarning(
        _ eventID: String,
        accepted: Bool,
        withReply reply: @escaping (Bool) -> Void
    )

    func recentDecisions(limit: Int, withReply reply: @escaping (Data) -> Void)
}

/// The decision slice the Xcode command needs, decoded from the daemon's
/// snake_case Decision JSON (agent/Sources/VGCore/Decision.swift).
struct ScanVerdict {
    enum Action: String {
        case allow
        case warn
        case block
    }

    var action: Action
    var reason: String
    /// Distinct `findings[].category` wire names, order-preserving.
    var categories: [String]
    /// True when this verdict is a synthetic fail-closed block (engine or
    /// transport failure), not a policy decision.
    var fromFallback: Bool

    static func failClosed(_ reason: String) -> ScanVerdict {
        ScanVerdict(action: .block, reason: reason, categories: [], fromFallback: true)
    }
}

/// Invokes the wrapped completion exactly once. The XPC reply block, the XPC
/// error handler, and the safety timeout can race; only the first wins.
private final class ReplyOnce {
    private let lock = NSLock()
    private var done = false
    private let completion: (ScanVerdict) -> Void

    init(_ completion: @escaping (ScanVerdict) -> Void) {
        self.completion = completion
    }

    func callAsFunction(_ verdict: ScanVerdict) {
        lock.lock()
        let first = !done
        done = true
        lock.unlock()
        if first { completion(verdict) }
    }
}

final class XPCScanClient {
    /// Must match the daemon's MachServices key (VGXPCProtocol.agentXPCMachServiceName).
    static let machServiceName = "com.vguardrail.agent.xpc"
    /// Mirror of XPCErrorWire.unavailablePrefix.
    private static let engineUnavailablePrefix = "ENGINE_UNAVAILABLE: "
    /// Deadline after which the scan fails closed (Xcode commands must finish).
    static let timeout: TimeInterval = 5
    private static let log = Logger(subsystem: "com.vguardrail.xcode-connector", category: "xpc")

    static let engineUnavailableReason = "policy engine unavailable"
    static let connectorErrorReason = "connector error; fail-closed block"

    /// Evaluates `text` against the local policy engine. The completion is
    /// invoked exactly once, on an arbitrary queue, never later than
    /// `timeout` seconds, and never with an allow on failure.
    func scan(text: String, fileName: String?, completion: @escaping (ScanVerdict) -> Void) {
        guard let requestData = Self.encodeScanRequest(text: text, fileName: fileName) else {
            completion(.failClosed(Self.connectorErrorReason))
            return
        }

        let connection = Self.makeConnection()
        let reply = ReplyOnce { verdict in
            connection.invalidate()
            completion(verdict)
        }
        let failClosed: (String) -> Void = { reason in
            Self.log.error("scan failed closed: \(reason, privacy: .public)")
            reply(.failClosed(reason))
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + Self.timeout) {
            failClosed(Self.engineUnavailableReason)
        }

        guard let proxy = connection.remoteObjectProxyWithErrorHandler({ _ in
            failClosed(Self.engineUnavailableReason)
        }) as? AgentControl else {
            failClosed(Self.engineUnavailableReason)
            return
        }

        proxy.submitScan(requestData) { decisionData, errorMessage in
            if let decisionData, let verdict = Self.decodeVerdict(fromWire: decisionData) {
                reply(verdict)
            } else if let errorMessage, errorMessage.hasPrefix(Self.engineUnavailablePrefix) {
                failClosed(Self.engineUnavailableReason)
            } else {
                failClosed(Self.connectorErrorReason)
            }
        }
    }

    // ── XPC plumbing ───────────────────────────────────────────────────────

    private static func makeConnection() -> NSXPCConnection {
        // `.privileged`: the daemon registers its mach service in the system
        // domain (root LaunchDaemon) — same option every other client uses.
        let connection = NSXPCConnection(machServiceName: machServiceName, options: [.privileged])
        connection.remoteObjectInterface = NSXPCInterface(with: AgentControl.self)
        connection.resume()
        return connection
    }

    // ── wire encoding (VGCore snake_case ScanRequest) ──────────────────────

    /// Builds the daemon's `ScanRequest` JSON. The acting user comes from
    /// ~/.vguardrail/connector.json when readable (inside an app-sandboxed
    /// extension that resolves to the container home), else the OS user.
    private static func encodeScanRequest(text: String, fileName: String?) -> Data? {
        let identity = loadIdentity()
        var scanContext: [String: Any] = [
            "source": "ide",
            "app": "xcode",
            "user": [
                "user_id": identity.userID,
                "role": identity.role,
                "groups": identity.groups,
            ],
        ]
        if let fileName, !fileName.isEmpty {
            var file: [String: Any] = ["path": fileName]
            let ext = (fileName as NSString).pathExtension
            if !ext.isEmpty { file["file_extension"] = ext }
            scanContext["file"] = file
        }

        let request: [String: Any] = ["text": text, "context": scanContext]
        return try? JSONSerialization.data(withJSONObject: request)
    }

    private struct ConnectorIdentity {
        var userID: String
        var role: String
        var groups: [String]
    }

    private static let validRoles: Set<String> = [
        "super_admin", "security_admin", "auditor", "manager", "user",
    ]

    /// Mirror of the other connectors' identity loading — never fails,
    /// degrades to the OS user with role "user".
    private static func loadIdentity() -> ConnectorIdentity {
        let fallback = ConnectorIdentity(userID: NSUserName(), role: "user", groups: [])
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".vguardrail/connector.json")
        guard let data = try? Data(contentsOf: url),
              let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            return fallback
        }
        let userID = (parsed["userId"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? fallback.userID
        let role = (parsed["role"] as? String).flatMap { validRoles.contains($0) ? $0 : nil } ?? "user"
        let groups = (parsed["groups"] as? [Any])?.compactMap { $0 as? String } ?? []
        return ConnectorIdentity(userID: userID, role: role, groups: groups)
    }

    // ── wire decoding (snake_case Decision → ScanVerdict) ──────────────────

    /// Returns nil on malformed JSON or an unknown action so the caller fails
    /// closed.
    private static func decodeVerdict(fromWire data: Data) -> ScanVerdict? {
        guard let wire = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let actionRaw = wire["action"] as? String,
              let action = ScanVerdict.Action(rawValue: actionRaw)
        else {
            return nil
        }

        let findings = wire["findings"] as? [[String: Any]] ?? []
        var categories: [String] = []
        for finding in findings {
            if let category = finding["category"] as? String, !categories.contains(category) {
                categories.append(category)
            }
        }

        return ScanVerdict(
            action: action,
            reason: (wire["reason"] as? String) ?? "",
            categories: categories,
            fromFallback: false
        )
    }
}
