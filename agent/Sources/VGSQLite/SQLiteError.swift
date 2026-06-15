// Errors surfaced from SQLite.

import CSQLite
import Foundation

/// A SQLite error with its result code and message.
public struct SQLiteError: Error, Equatable, CustomStringConvertible {
    public let code: Int32
    public let message: String

    public init(code: Int32, message: String) {
        self.code = code
        self.message = message
    }

    /// Builds an error from the connection's last error.
    static func from(_ db: OpaquePointer?, fallbackCode: Int32) -> SQLiteError {
        let code = db.map { sqlite3_errcode($0) } ?? fallbackCode
        let message = db.flatMap { sqlite3_errmsg($0) }.map { String(cString: $0) }
            ?? "unknown sqlite error"
        return SQLiteError(code: code, message: message)
    }

    public var description: String { "SQLiteError(\(code)): \(message)" }
}
