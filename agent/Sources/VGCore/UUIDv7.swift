// Time-ordered UUIDv7 generation (RFC 9562). Used for event ids so the local
// queue and the cloud are globally time-sortable without a server round trip.

import Foundation

public enum UUIDv7 {
    /// Generates a UUIDv7 string from a millisecond timestamp and 74 random bits.
    ///
    /// Layout: 48-bit big-endian unix_ms, 4-bit version (0111), 12-bit rand_a,
    /// 2-bit variant (10), 62-bit rand_b.
    public static func generate(
        millis: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        randomA: UInt16 = UInt16.random(in: 0...0x0FFF),
        randomB: UInt64 = UInt64.random(in: 0...0x3FFF_FFFF_FFFF_FFFF)
    ) -> String {
        let ms = UInt64(bitPattern: millis) & 0xFFFF_FFFF_FFFF
        var bytes = [UInt8](repeating: 0, count: 16)

        // 48-bit timestamp.
        bytes[0] = UInt8((ms >> 40) & 0xFF)
        bytes[1] = UInt8((ms >> 32) & 0xFF)
        bytes[2] = UInt8((ms >> 24) & 0xFF)
        bytes[3] = UInt8((ms >> 16) & 0xFF)
        bytes[4] = UInt8((ms >> 8) & 0xFF)
        bytes[5] = UInt8(ms & 0xFF)

        // Version (0111) + 12-bit rand_a.
        let a = randomA & 0x0FFF
        bytes[6] = 0x70 | UInt8((a >> 8) & 0x0F)
        bytes[7] = UInt8(a & 0xFF)

        // Variant (10) + 62-bit rand_b.
        let b = randomB & 0x3FFF_FFFF_FFFF_FFFF
        bytes[8] = 0x80 | UInt8((b >> 56) & 0x3F)
        bytes[9] = UInt8((b >> 48) & 0xFF)
        bytes[10] = UInt8((b >> 40) & 0xFF)
        bytes[11] = UInt8((b >> 32) & 0xFF)
        bytes[12] = UInt8((b >> 24) & 0xFF)
        bytes[13] = UInt8((b >> 16) & 0xFF)
        bytes[14] = UInt8((b >> 8) & 0xFF)
        bytes[15] = UInt8(b & 0xFF)

        return format(bytes)
    }

    private static func format(_ b: [UInt8]) -> String {
        func hex(_ range: Range<Int>) -> String {
            b[range].map { String(format: "%02x", $0) }.joined()
        }
        return "\(hex(0..<4))-\(hex(4..<6))-\(hex(6..<8))-\(hex(8..<10))-\(hex(10..<16))"
    }
}
