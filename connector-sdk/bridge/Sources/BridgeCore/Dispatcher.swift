// Method routing. Decodes typed params, calls the PolicyAgent, and returns the
// model-encoded result bytes — using the SAME `XPCCodec` the daemon uses, so the
// wire bytes are identical (no drift). All failures surface as `BridgeError`.

import Foundation
import VGCore
import VGXPCProtocol

/// Params for `acknowledgeWarning`.
private struct AckParams: Decodable {
    let eventID: String
    let accepted: Bool
}

/// Params for `recentDecisions`.
private struct RecentParams: Decodable {
    let limit: Int
}

public struct Dispatcher: Sendable {
    private let agent: any PolicyAgent

    public init(agent: any PolicyAgent) {
        self.agent = agent
    }

    /// Handles one method call, returning the result body (un-framed JSON).
    /// Throws `BridgeError` for decode failures, unknown methods, version
    /// mismatch, or a mapped agent/XPC error.
    public func handle(method: String, paramsData: Data) async throws -> Data {
        switch method {
        case BridgeProtocol.Method.hello:
            return try handleHello(paramsData)
        case BridgeProtocol.Method.submitScan:
            return try await handleSubmitScan(paramsData)
        case BridgeProtocol.Method.getStatus:
            return try await handleGetStatus()
        case BridgeProtocol.Method.acknowledgeWarning:
            return try await handleAck(paramsData)
        case BridgeProtocol.Method.recentDecisions:
            return try await handleRecent(paramsData)
        default:
            throw BridgeError(code: .validation, message: "unknown method")
        }
    }

    // ── handlers ─────────────────────────────────────────────────────────────

    private func handleHello(_ paramsData: Data) throws -> Data {
        let params: HelloParams
        do {
            params = try JSONDecoder().decode(HelloParams.self, from: paramsData)
        } catch {
            throw BridgeError(code: .validation, message: "invalid hello params")
        }
        let result = try VersionNegotiation.negotiate(params)
        return try JSONEncoder().encode(result)
    }

    private func handleSubmitScan(_ paramsData: Data) async throws -> Data {
        let request: ScanRequest
        do {
            request = try XPCCodec.decodeScanRequest(paramsData)
        } catch {
            throw BridgeError(code: .validation, message: "invalid scan request")
        }
        do {
            let decision = try await agent.submitScan(request)
            return try XPCCodec.encodeDecision(decision)
        } catch {
            throw mapAgentError(error)
        }
    }

    private func handleGetStatus() async throws -> Data {
        do {
            let status = try await agent.status()
            return try XPCCodec.encodeStatus(status)
        } catch {
            throw mapAgentError(error)
        }
    }

    private func handleAck(_ paramsData: Data) async throws -> Data {
        let params: AckParams
        do {
            params = try JSONDecoder().decode(AckParams.self, from: paramsData)
        } catch {
            throw BridgeError(code: .validation, message: "invalid acknowledgeWarning params")
        }
        guard !params.eventID.isEmpty else {
            throw BridgeError(code: .validation, message: "eventID is required")
        }
        do {
            let accepted = try await agent.acknowledgeWarning(eventID: params.eventID, accepted: params.accepted)
            return try JSONEncoder().encode(accepted)
        } catch {
            throw mapAgentError(error)
        }
    }

    private func handleRecent(_ paramsData: Data) async throws -> Data {
        let params: RecentParams
        do {
            params = try JSONDecoder().decode(RecentParams.self, from: paramsData)
        } catch {
            throw BridgeError(code: .validation, message: "invalid recentDecisions params")
        }
        guard params.limit >= 0 else {
            throw BridgeError(code: .validation, message: "limit must be non-negative")
        }
        let limit = min(params.limit, BridgeProtocol.maxRecentLimit)
        do {
            let summaries = try await agent.recentDecisions(limit: limit)
            return try XPCCodec.encodeSummaries(summaries)
        } catch {
            throw mapAgentError(error)
        }
    }
}
