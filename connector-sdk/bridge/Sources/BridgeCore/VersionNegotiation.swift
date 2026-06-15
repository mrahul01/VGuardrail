// `hello` handshake. The SDK advertises the protocol versions and schema it
// supports; the bridge selects a mutually supported protocol and echoes its
// schema + identifier. The SDK performs the final accept/reject (it fails closed
// on an unsupported protocol or unknown schema), so the bridge stays lenient but
// correct: it only rejects when the client offers protocols with no overlap.

import Foundation

/// Inbound `hello` params.
struct HelloParams: Decodable {
    let sdk: String?
    let proto: [Int]?
    let schema: String?
}

/// Outbound `hello` result.
struct HelloResult: Encodable {
    let proto: Int
    let schema: String
    let agent: String
}

enum VersionNegotiation {
    /// Selects the negotiated protocol or throws `versionMismatch` when the
    /// client offered a non-empty protocol set with no overlap.
    static func negotiate(_ params: HelloParams) throws -> HelloResult {
        let supported = BridgeProtocol.supportedProtocols
        let offered = params.proto ?? []

        if offered.isEmpty {
            // No explicit offer (older/loose client): answer with our newest and
            // let the SDK's own gate decide.
            return HelloResult(
                proto: supported.max() ?? BridgeProtocol.version,
                schema: BridgeProtocol.schema,
                agent: BridgeProtocol.agentIdentifier
            )
        }

        let common = offered.filter(supported.contains)
        guard let selected = common.max() else {
            throw BridgeError(
                code: .versionMismatch,
                message: "no common protocol version (bridge supports \(supported))"
            )
        }
        return HelloResult(proto: selected, schema: BridgeProtocol.schema, agent: BridgeProtocol.agentIdentifier)
    }
}
