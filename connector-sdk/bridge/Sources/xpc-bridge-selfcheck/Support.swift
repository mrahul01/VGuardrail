// Helpers for the selfcheck: building request envelopes, parsing reply
// envelopes, and length-prefixed pipe IO for the end-to-end runner check.

import Foundation

/// Parsed view of a reply envelope.
struct ReplyView {
    let v: Int?
    let id: String?
    let ok: Bool?
    let result: Any?
    let errorCode: String?
    let errorMessage: String?
}

/// Builds a request-envelope JSON body (un-framed).
func requestEnvelope(id: String, method: String, params: Any?, v: Int = 1) -> Data {
    var dict: [String: Any] = ["v": v, "id": id, "method": method]
    if let params { dict["params"] = params }
    return try! JSONSerialization.data(withJSONObject: dict)
}

/// Parses a reply-envelope JSON body.
func parseReply(_ data: Data) -> ReplyView {
    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return ReplyView(v: nil, id: nil, ok: nil, result: nil, errorCode: nil, errorMessage: nil)
    }
    var code: String?
    var message: String?
    if let err = obj["error"] as? [String: Any] {
        code = err["code"] as? String
        message = err["message"] as? String
    }
    return ReplyView(
        v: obj["v"] as? Int,
        id: obj["id"] as? String,
        ok: obj["ok"] as? Bool,
        result: obj["result"],
        errorCode: code,
        errorMessage: message
    )
}

// ── Pipe IO (blocking; used only by the end-to-end runner check) ───────────────

func writeAll(_ fd: Int32, _ data: Data) {
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        guard let base = raw.baseAddress else { return }
        var offset = 0
        while offset < raw.count {
            let n = write(fd, base + offset, raw.count - offset)
            if n <= 0 {
                if n < 0 && errno == EINTR { continue }
                return
            }
            offset += n
        }
    }
}

func readExact(_ fd: Int32, _ count: Int) -> Data? {
    guard count >= 0 else { return nil }
    if count == 0 { return Data() }
    var out = Data()
    var remaining = count
    var tmp = [UInt8](repeating: 0, count: count)
    while remaining > 0 {
        let n = tmp.withUnsafeMutableBytes { ptr -> Int in
            read(fd, ptr.baseAddress, remaining)
        }
        if n == 0 { return nil } // EOF
        if n < 0 {
            if errno == EINTR { continue }
            return nil
        }
        out.append(contentsOf: tmp[0..<n])
        remaining -= n
    }
    return out
}

/// Reads one length-prefixed frame body, or nil on EOF/error.
func readFrame(_ fd: Int32) -> Data? {
    guard let header = readExact(fd, 4), header.count == 4 else { return nil }
    let length = (Int(header[0]) << 24) | (Int(header[1]) << 16) | (Int(header[2]) << 8) | Int(header[3])
    return readExact(fd, length)
}
