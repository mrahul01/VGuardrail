// Client-side helper that wraps an NSXPCConnection to the agent daemon and
// exposes async, typed calls. Shared by the menu bar app and `vgctl`.

import Foundation
import VGCore

/// Errors from the XPC client.
public enum XPCClientError: Error, Equatable {
    case notConnected
    case remote(String)
    case malformedReply
}

/// An actor wrapping a connection to `com.vguardrail.agent.xpc`. The connection
/// (a non-Sendable object) is confined to this actor.
public actor AgentXPCClient {
    private let machServiceName: String
    private let options: NSXPCConnection.Options
    private var connection: NSXPCConnection?

    public init(
        machServiceName: String = agentXPCMachServiceName,
        options: NSXPCConnection.Options = AgentXPCClient.defaultOptions()
    ) {
        self.machServiceName = machServiceName
        self.options = options
    }

    /// `.privileged` looks the service up in the **system** launchd domain —
    /// correct for the production LaunchDaemon. Local dev runs `vguardiand` as
    /// a per-user LaunchAgent instead, whose mach service only exists in the
    /// user/gui domain; `VG_XPC_USER_AGENT=1` switches the lookup there.
    public static func defaultOptions() -> NSXPCConnection.Options {
        ProcessInfo.processInfo.environment["VG_XPC_USER_AGENT"] == "1" ? [] : [.privileged]
    }

    private func ensureConnection() -> NSXPCConnection {
        if let connection { return connection }
        let conn = NSXPCConnection(machServiceName: machServiceName, options: options)
        conn.remoteObjectInterface = AgentXPC.interface()
        conn.resume()
        connection = conn
        return conn
    }

    /// Tears down the connection.
    public func invalidate() {
        connection?.invalidate()
        connection = nil
    }

    /// Submits a prompt and returns the engine's decision.
    public func submitScan(_ request: ScanRequest) async throws -> Decision {
        let requestData = try XPCCodec.encodeScanRequest(request)
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            let conn = ensureConnection()
            let proxy = conn.remoteObjectProxyWithErrorHandler { error in
                continuation.resume(throwing: error)
            } as? AgentControl
            guard let proxy else {
                continuation.resume(throwing: XPCClientError.notConnected)
                return
            }
            proxy.submitScan(requestData) { decisionData, errorMessage in
                if let decisionData {
                    continuation.resume(returning: decisionData)
                } else {
                    continuation.resume(throwing: XPCClientError.remote(errorMessage ?? "unknown error"))
                }
            }
        }
        return try XPCCodec.decodeDecision(data)
    }

    /// Asks the daemon to OCR an image at `imagePath` and evaluate its text.
    public func submitImageScan(imagePath: String) async throws -> Decision {
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            let conn = ensureConnection()
            let proxy = conn.remoteObjectProxyWithErrorHandler { error in
                continuation.resume(throwing: error)
            } as? AgentControl
            guard let proxy else {
                continuation.resume(throwing: XPCClientError.notConnected)
                return
            }
            proxy.submitImageScan(imagePath) { decisionData, errorMessage in
                if let decisionData {
                    continuation.resume(returning: decisionData)
                } else {
                    continuation.resume(throwing: XPCClientError.remote(errorMessage ?? "unknown error"))
                }
            }
        }
        return try XPCCodec.decodeDecision(data)
    }

    /// Fetches the current agent status.
    public func status() async throws -> AgentStatus {
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            let conn = ensureConnection()
            let proxy = conn.remoteObjectProxyWithErrorHandler { error in
                continuation.resume(throwing: error)
            } as? AgentControl
            guard let proxy else {
                continuation.resume(throwing: XPCClientError.notConnected)
                return
            }
            proxy.getStatus { continuation.resume(returning: $0) }
        }
        return try XPCCodec.decodeStatus(data)
    }

    /// Fetches recent decisions for display.
    public func recentDecisions(limit: Int) async throws -> [DecisionSummary] {
        let data: Data = try await withCheckedThrowingContinuation { continuation in
            let conn = ensureConnection()
            let proxy = conn.remoteObjectProxyWithErrorHandler { error in
                continuation.resume(throwing: error)
            } as? AgentControl
            guard let proxy else {
                continuation.resume(throwing: XPCClientError.notConnected)
                return
            }
            proxy.recentDecisions(limit: limit) { continuation.resume(returning: $0) }
        }
        return try XPCCodec.decodeSummaries(data)
    }

    /// Records a user's response to a WARN.
    public func acknowledgeWarning(eventID: String, accepted: Bool) async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            let conn = ensureConnection()
            let proxy = conn.remoteObjectProxyWithErrorHandler { error in
                continuation.resume(throwing: error)
            } as? AgentControl
            guard let proxy else {
                continuation.resume(throwing: XPCClientError.notConnected)
                return
            }
            proxy.acknowledgeWarning(eventID, accepted: accepted) { continuation.resume(returning: $0) }
        }
    }
}
