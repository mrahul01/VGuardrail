// Serializes framed writes to a file descriptor (stdout in production). Being an
// actor guarantees whole frames never interleave even when many request handlers
// complete concurrently. Uses POSIX `write` directly (no FileHandle) so partial
// writes and EINTR are handled explicitly and there is no Sendable friction.

import Foundation

public actor FrameWriter {
    private let fd: Int32

    public init(fileDescriptor: Int32) {
        self.fd = fileDescriptor
    }

    /// Writes the entire buffer, looping over partial writes. Throws
    /// `BridgeError(.transport)` if the descriptor is closed/broken (EPIPE) or
    /// errors — the caller treats that as the peer going away.
    public func write(_ data: Data) throws {
        guard !data.isEmpty else { return }
        try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            let total = raw.count
            while offset < total {
                let written = Foundation.write(fd, base + offset, total - offset)
                if written < 0 {
                    if errno == EINTR { continue }
                    throw BridgeError(code: .transport, message: "stdout write failed")
                }
                if written == 0 {
                    throw BridgeError(code: .transport, message: "stdout closed")
                }
                offset += written
            }
        }
    }
}
