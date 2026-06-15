// Inbound request parsing and outbound reply building for the bridge envelope:
//   request: { v, id, method, params }
//   reply:   { v, id, ok:true, result } | { v, id, ok:false, error:{ code, message } }
//
// Inbound parsing uses JSONSerialization so a malformed-but-length-valid frame
// can still yield its `id` (when present) for a correlated error reply. Outbound
// envelopes are assembled with JSONSerialization too, embedding the already
// model-encoded result so key names/values exactly match the daemon's output.

import Foundation

/// A validated inbound request.
public struct ParsedRequest: Sendable, Equatable {
    public let id: String
    public let version: Int?
    public let method: String
    /// The `params` object re-serialized to JSON bytes for typed decoding.
    public let paramsData: Data
}

/// Result of parsing one frame body.
public enum RequestParse: Sendable, Equatable {
    case ok(ParsedRequest)
    /// Malformed frame. `id` is present when it could be recovered (enabling a
    /// correlated error reply); `nil` means the frame must be dropped.
    case malformed(id: String?)
}

public enum Envelope {
    /// Parses one frame body into a request (or a malformed marker).
    public static func parseRequest(_ body: Data) -> RequestParse {
        guard
            let object = try? JSONSerialization.jsonObject(with: body),
            let dict = object as? [String: Any]
        else {
            return .malformed(id: nil)
        }
        guard let id = dict["id"] as? String, !id.isEmpty else {
            return .malformed(id: nil) // cannot correlate a reply
        }
        guard let method = dict["method"] as? String, !method.isEmpty else {
            return .malformed(id: id)
        }
        let version = dict["v"] as? Int

        let paramsData: Data
        if let params = dict["params"] {
            // `params` came from JSONSerialization, so it re-serializes cleanly.
            paramsData = (try? JSONSerialization.data(withJSONObject: params, options: [.fragmentsAllowed]))
                ?? Data("{}".utf8)
        } else {
            paramsData = Data("{}".utf8)
        }
        return .ok(ParsedRequest(id: id, version: version, method: method, paramsData: paramsData))
    }

    /// Builds a success reply envelope (un-framed JSON bytes). `resultBody` is the
    /// model already encoded to JSON (e.g. by `XPCCodec`); it is embedded as
    /// `result` without re-keying.
    public static func successEnvelope(id: String, resultBody: Data) throws -> Data {
        let result = try JSONSerialization.jsonObject(with: resultBody, options: [.fragmentsAllowed])
        let envelope: [String: Any] = [
            "v": BridgeProtocol.version,
            "id": id,
            "ok": true,
            "result": result,
        ]
        return try JSONSerialization.data(withJSONObject: envelope)
    }

    /// Builds an error reply envelope (un-framed JSON bytes).
    public static func errorEnvelope(id: String, code: BridgeErrorCode, message: String) -> Data {
        let envelope: [String: Any] = [
            "v": BridgeProtocol.version,
            "id": id,
            "ok": false,
            "error": ["code": code.rawValue, "message": message],
        ]
        // This dictionary is always JSON-serializable; fall back to a minimal,
        // hand-built envelope only if serialization somehow fails. Restrict the
        // id to a conservative character set so it cannot break out of the JSON
        // string in this (effectively unreachable) path.
        if let data = try? JSONSerialization.data(withJSONObject: envelope) {
            return data
        }
        let safeId = String(id.unicodeScalars.filter { scalar in
            scalar.value >= 0x20 && scalar != "\"" && scalar != "\\"
        })
        return Data(#"{"v":1,"id":"\#(safeId)","ok":false,"error":{"code":"\#(code.rawValue)","message":"internal error"}}"#.utf8)
    }
}
