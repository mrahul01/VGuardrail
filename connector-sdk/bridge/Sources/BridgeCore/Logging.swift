// Diagnostics to stderr. SECURITY: this is the ONLY logging path, and it emits
// nothing derived from request payloads — no prompt text, no findings, no
// secrets, no `params`/`result` bodies. Callers pass fixed strings, method
// names, error codes, and counts only.

import Foundation

public enum BridgeLog {
    /// Serializes writes so concurrent diagnostics don't interleave.
    private static let lock = NSLock()

    public static func note(_ message: String) {
        emit("info", message)
    }

    public static func warn(_ message: String) {
        emit("warn", message)
    }

    private static func emit(_ level: String, _ message: String) {
        let line = "vguardrail-xpc-bridge [\(level)] \(message)\n"
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardError.write(Data(line.utf8))
    }
}
