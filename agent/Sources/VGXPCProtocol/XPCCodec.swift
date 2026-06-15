// JSON encode/decode for payloads crossing the XPC `Data` boundary.

import Foundation
import VGCore

/// Encodes/decodes the typed payloads exchanged over `AgentControl`.
public enum XPCCodec {
    /// Encodes any Codable payload to JSON `Data`.
    public static func encode(_ value: some Encodable) throws -> Data {
        try JSONEncoder().encode(value)
    }

    /// Decodes a typed payload from JSON `Data`.
    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        try JSONDecoder().decode(type, from: data)
    }

    // Typed conveniences for the four message kinds.

    public static func encodeScanRequest(_ request: ScanRequest) throws -> Data {
        try encode(request)
    }

    public static func decodeScanRequest(_ data: Data) throws -> ScanRequest {
        try decode(ScanRequest.self, from: data)
    }

    public static func encodeDecision(_ decision: Decision) throws -> Data {
        try encode(decision)
    }

    public static func decodeDecision(_ data: Data) throws -> Decision {
        try decode(Decision.self, from: data)
    }

    public static func encodeStatus(_ status: AgentStatus) throws -> Data {
        try encode(status)
    }

    public static func decodeStatus(_ data: Data) throws -> AgentStatus {
        try decode(AgentStatus.self, from: data)
    }

    public static func encodeSummaries(_ summaries: [DecisionSummary]) throws -> Data {
        try encode(summaries)
    }

    public static func decodeSummaries(_ data: Data) throws -> [DecisionSummary] {
        try decode([DecisionSummary].self, from: data)
    }
}
