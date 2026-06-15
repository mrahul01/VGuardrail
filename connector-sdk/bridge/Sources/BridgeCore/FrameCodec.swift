// Length-prefixed frame codec: 4-byte big-endian unsigned length, then that many
// bytes of UTF-8 JSON. Mirrors connector-sdk/src/protocol/envelope.ts exactly.

import Foundation

/// A fatal, unrecoverable stream error (e.g. an oversized advertised length).
/// Once the length prefix is corrupt the byte stream can no longer be framed, so
/// the caller must stop reading rather than guess boundaries.
public struct FrameStreamError: Error, Sendable, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
}

/// Encodes a JSON body as a length-prefixed frame. Throws if the body exceeds
/// the protocol cap (so we never emit a frame the peer would reject).
public func encodeFrame(_ body: Data) throws -> Data {
    guard body.count <= BridgeProtocol.maxFrameBytes else {
        throw FrameStreamError("frame of \(body.count) bytes exceeds cap")
    }
    let length = UInt32(body.count)
    var out = Data(capacity: 4 + body.count)
    out.append(UInt8((length >> 24) & 0xff))
    out.append(UInt8((length >> 16) & 0xff))
    out.append(UInt8((length >> 8) & 0xff))
    out.append(UInt8(length & 0xff))
    out.append(body)
    return out
}

/// Incremental frame reader. Not thread-safe by design: it is confined to the
/// single stdin reader thread. Memory is bounded — it holds at most one partial
/// frame (< cap) plus the most recent chunk.
public final class FrameDecoder {
    private var buffer = Data()

    public init() {}

    /// Bytes currently buffered awaiting a complete frame (for tests/diagnostics).
    public var pending: Int { buffer.count }

    /// Appends a chunk and returns every complete frame body decoded so far.
    /// Throws `FrameStreamError` if a frame advertises a length over the cap.
    public func push(_ chunk: Data) throws -> [Data] {
        buffer.append(chunk)
        var frames: [Data] = []

        while buffer.count >= 4 {
            // Read the 4-byte big-endian length without relying on alignment.
            let b0 = UInt32(buffer[buffer.startIndex])
            let b1 = UInt32(buffer[buffer.startIndex + 1])
            let b2 = UInt32(buffer[buffer.startIndex + 2])
            let b3 = UInt32(buffer[buffer.startIndex + 3])
            let length = Int((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)

            if length > BridgeProtocol.maxFrameBytes {
                throw FrameStreamError("incoming frame length \(length) exceeds cap")
            }
            if buffer.count < 4 + length { break } // wait for the rest

            let bodyStart = buffer.startIndex + 4
            let bodyEnd = bodyStart + length
            frames.append(Data(buffer[bodyStart..<bodyEnd]))
            buffer.removeSubrange(buffer.startIndex..<bodyEnd)
        }
        return frames
    }
}
