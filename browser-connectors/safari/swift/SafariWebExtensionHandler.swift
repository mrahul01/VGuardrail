// SafariWebExtensionHandler — the native side of the Safari connector.
//
// Safari routes `browser.runtime.sendNativeMessage(...)` from the extension's
// background page to this handler inside the containing app; there is no
// separate native-messaging host process on Safari. The handler forwards `scan`
// requests over XPC to the running vguardiand (mach service
// com.vguardrail.agent.xpc — the same daemon the Chromium native host reaches
// via connector-sdk → xpc-bridge) and replies with the Decision JSON in the
// extension's camelCase shape (extension/src/shared/contract.ts).
//
// Fail-closed: any XPC failure — daemon missing, connection invalidated,
// malformed reply, timeout — yields a synthetic BLOCK decision, never an allow.
// Engine-down errors (the daemon's ENGINE_UNAVAILABLE sentinel) and transport
// errors surface as "policy engine unavailable"; other daemon errors as
// "connector error; fail-closed block" — matching the native host's handlers.
//
// Wire contracts mirrored here (keep in lockstep):
//   - agent/Sources/VGXPCProtocol/AgentControl.swift   (XPC protocol + selectors)
//   - agent/Sources/VGXPCProtocol/XPCErrorWire.swift   (ENGINE_UNAVAILABLE prefix)
//   - agent/Sources/VGCore/{ScanRequest,Decision}.swift (snake_case JSON)
//   - chrome/extension/src/shared/protocol.ts          (request/response envelope)
//
// No prompt content is ever logged; only decision metadata reaches os_log.

import Foundation
import SafariServices
import os

/// Mirror of `AgentControl` (agent/Sources/VGXPCProtocol/AgentControl.swift).
/// The Objective-C selectors must match the daemon's exported interface
/// exactly; only the methods this handler calls are exercised.
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

/// Invokes the wrapped completion exactly once. The XPC reply block, the XPC
/// error handler, and the safety timeout can race; only the first wins.
private final class ReplyOnce {
    private let lock = NSLock()
    private var done = false
    private let completion: ([String: Any]) -> Void

    init(_ completion: @escaping ([String: Any]) -> Void) {
        self.completion = completion
    }

    func callAsFunction(_ payload: [String: Any]) {
        lock.lock()
        let first = !done
        done = true
        lock.unlock()
        if first { completion(payload) }
    }
}

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    /// Must match the daemon's MachServices key (VGXPCProtocol.agentXPCMachServiceName).
    private static let machServiceName = "com.vguardrail.agent.xpc"
    /// Mirror of XPCErrorWire.unavailablePrefix.
    private static let engineUnavailablePrefix = "ENGINE_UNAVAILABLE: "
    /// Safety net so `beginRequest` always completes even if XPC never replies.
    private static let xpcTimeout: TimeInterval = 5
    private static let log = Logger(subsystem: "com.vguardrail.safari-connector", category: "handler")

    // ── NSExtensionRequestHandling ─────────────────────────────────────────

    func beginRequest(with context: NSExtensionContext) {
        let message = (context.inputItems.first as? NSExtensionItem)?
            .userInfo?[SFExtensionMessageKey] as? [String: Any]
        guard let message,
              let id = message["id"] as? String,
              let type = message["type"] as? String
        else {
            Self.complete(context, payload: [
                "id": (message?["id"] as? String) ?? "",
                "ok": false,
                "error": ["code": "BAD_REQUEST", "message": "malformed request"],
            ])
            return
        }

        let payload = message["payload"] as? [String: Any] ?? [:]
        switch type {
        case "scan":
            handleScan(id: id, payload: payload, context: context)
        case "ack":
            handleAck(id: id, payload: payload, context: context)
        default:
            Self.complete(context, payload: [
                "id": id,
                "ok": false,
                "error": ["code": "UNSUPPORTED", "message": "unsupported request type: \(type)"],
            ])
        }
    }

    // ── scan ───────────────────────────────────────────────────────────────

    private func handleScan(id: String, payload: [String: Any], context: NSExtensionContext) {
        guard let text = payload["text"] as? String,
              let requestData = Self.encodeScanRequest(text: text, captureContext: payload["context"] as? [String: Any] ?? [:])
        else {
            Self.complete(context, payload: Self.scanReply(id: id, reason: "connector error; fail-closed block"))
            return
        }

        let connection = Self.makeConnection()
        let reply = ReplyOnce { response in
            connection.invalidate()
            Self.complete(context, payload: response)
        }
        let failClosed: (String) -> Void = { reason in
            Self.log.error("scan failed closed: \(reason, privacy: .public)")
            reply(Self.scanReply(id: id, reason: reason))
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + Self.xpcTimeout) {
            failClosed("policy engine unavailable")
        }

        guard let proxy = connection.remoteObjectProxyWithErrorHandler({ _ in
            failClosed("policy engine unavailable")
        }) as? AgentControl else {
            failClosed("policy engine unavailable")
            return
        }

        proxy.submitScan(requestData) { decisionData, errorMessage in
            if let decisionData, let decision = Self.camelCaseDecision(fromWire: decisionData) {
                reply(["id": id, "ok": true, "type": "scan", "decision": decision])
            } else if let errorMessage, errorMessage.hasPrefix(Self.engineUnavailablePrefix) {
                failClosed("policy engine unavailable")
            } else {
                failClosed("connector error; fail-closed block")
            }
        }
    }

    // ── ack ────────────────────────────────────────────────────────────────

    private func handleAck(id: String, payload: [String: Any], context: NSExtensionContext) {
        guard let eventID = payload["eventId"] as? String,
              let accepted = payload["accepted"] as? Bool
        else {
            Self.complete(context, payload: Self.ackFailure(id: id))
            return
        }

        let connection = Self.makeConnection()
        let reply = ReplyOnce { response in
            connection.invalidate()
            Self.complete(context, payload: response)
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + Self.xpcTimeout) {
            reply(Self.ackFailure(id: id))
        }

        guard let proxy = connection.remoteObjectProxyWithErrorHandler({ _ in
            reply(Self.ackFailure(id: id))
        }) as? AgentControl else {
            reply(Self.ackFailure(id: id))
            return
        }

        proxy.acknowledgeWarning(eventID, accepted: accepted) { accepted in
            reply(["id": id, "ok": true, "type": "ack", "accepted": accepted])
        }
    }

    // ── XPC plumbing ───────────────────────────────────────────────────────

    private static func makeConnection() -> NSXPCConnection {
        // `.privileged`: the daemon registers its mach service in the system
        // domain (root LaunchDaemon) — same option the menu bar app and vgctl use.
        let connection = NSXPCConnection(machServiceName: machServiceName, options: [.privileged])
        connection.remoteObjectInterface = NSXPCInterface(with: AgentControl.self)
        connection.resume()
        return connection
    }

    // ── wire encoding (VGCore snake_case) ──────────────────────────────────

    /// Builds the daemon's `ScanRequest` JSON. The acting user comes from
    /// ~/.vguardrail/connector.json when readable (note: inside the extension
    /// sandbox that resolves to the container home), else the OS user.
    private static func encodeScanRequest(text: String, captureContext: [String: Any]) -> Data? {
        let identity = loadIdentity()
        var scanContext: [String: Any] = [
            "source": "browser",
            "app": "safari",
            "user": [
                "user_id": identity.userID,
                "role": identity.role,
                "groups": identity.groups,
            ],
        ]
        if let provider = captureContext["provider"] as? String { scanContext["provider"] = provider }
        if let model = captureContext["model"] as? String { scanContext["model"] = model }

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

    /// Mirror of chrome/native-host/src/identity.ts — never fails, degrades to
    /// the OS user with role "user".
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

    // ── wire decoding (snake_case → contract.ts camelCase) ─────────────────

    /// Re-keys the daemon's snake_case Decision JSON (VGCore) into the
    /// extension's camelCase shape (contract.ts). Returns nil on malformed
    /// JSON so the caller fails closed.
    private static func camelCaseDecision(fromWire data: Data) -> [String: Any]? {
        guard let wire = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              wire["request_id"] is String,
              wire["action"] is String
        else {
            return nil
        }

        let keyMap = [
            "request_id": "requestId",
            "risk_level": "riskLevel",
            "matched_rule_id": "matchedRuleId",
            "policy_version": "policyVersion",
            "elapsed_micros": "elapsedMicros",
        ]
        var decision: [String: Any] = [:]
        for (key, value) in wire where !(value is NSNull) {
            switch key {
            case "findings":
                decision["findings"] = (value as? [[String: Any]])?.map(camelCaseFinding) ?? []
            case "suppressions":
                decision["suppressions"] = (value as? [[String: Any]])?.map(camelCaseSuppression) ?? []
            default:
                decision[keyMap[key] ?? key] = value
            }
        }
        if decision["findings"] == nil { decision["findings"] = [[String: Any]]() }
        return decision
    }

    private static func camelCaseFinding(_ wire: [String: Any]) -> [String: Any] {
        rekey(wire, map: [
            "detector_id": "detectorId",
            "span_start": "spanStart",
            "span_end": "spanEnd",
            "redacted_preview": "redactedPreview",
        ])
    }

    private static func camelCaseSuppression(_ wire: [String: Any]) -> [String: Any] {
        rekey(wire, map: ["rule_id": "ruleId", "exception_id": "exceptionId"])
    }

    private static func rekey(_ object: [String: Any], map: [String: String]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (key, value) in object where !(value is NSNull) {
            out[map[key] ?? key] = value
        }
        return out
    }

    // ── replies ────────────────────────────────────────────────────────────

    /// A scan reply carrying a synthetic, fail-closed BLOCK — the same shape
    /// contract.ts `failClosedBlock` builds when no decision arrives at all.
    private static func scanReply(id: String, reason: String) -> [String: Any] {
        [
            "id": id,
            "ok": true,
            "type": "scan",
            "decision": [
                "requestId": "safari-\(UUID().uuidString.lowercased())",
                "action": "block",
                "riskLevel": "high",
                "findings": [[String: Any]](),
                "reason": reason,
            ] as [String: Any],
        ]
    }

    private static func ackFailure(id: String) -> [String: Any] {
        [
            "id": id,
            "ok": false,
            "error": ["code": "ACK_FAILED", "message": "acknowledge failed"],
        ]
    }

    private static func complete(_ context: NSExtensionContext, payload: [String: Any]) {
        let item = NSExtensionItem()
        item.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [item])
    }
}
