// A thin, synchronous wrapper over the system SQLite.
//
// This type is intentionally **not** `Sendable`: it owns a raw connection
// pointer and is meant to be confined to a single isolation domain (the
// `EventQueue` actor owns one). Keeping it non-Sendable lets the compiler enforce
// that confinement instead of us hand-waving a lock.

import CSQLite
import Foundation

/// SQLITE_TRANSIENT tells SQLite to copy bound text/blob immediately, so the
/// Swift buffers need not outlive the bind call.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public final class SQLiteDatabase {
    private var handle: OpaquePointer?

    /// Opens (creating if needed) a database at `path`. Use `":memory:"` for an
    /// ephemeral database.
    public init(path: String) throws {
        var db: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        let rc = sqlite3_open_v2(path, &db, flags, nil)
        guard rc == SQLITE_OK, let db else {
            let err = SQLiteError.from(db, fallbackCode: rc)
            if db != nil { sqlite3_close(db) }
            throw err
        }
        self.handle = db
        sqlite3_busy_timeout(db, 5_000)
        try execute("PRAGMA journal_mode = WAL;")
        try execute("PRAGMA foreign_keys = ON;")
    }

    /// Opens an in-memory database.
    public static func inMemory() throws -> SQLiteDatabase {
        try SQLiteDatabase(path: ":memory:")
    }

    deinit {
        if let handle { sqlite3_close(handle) }
    }

    /// Closes the connection early. Safe to call once; further use throws.
    public func close() {
        if let handle {
            sqlite3_close(handle)
            self.handle = nil
        }
    }

    /// Executes one or more semicolon-separated statements with no bindings.
    public func execute(_ sql: String) throws {
        guard let handle else { throw SQLiteError(code: SQLITE_MISUSE, message: "database is closed") }
        var errMsg: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &errMsg)
        if rc != SQLITE_OK {
            let message = errMsg.map { String(cString: $0) } ?? "exec failed"
            if let errMsg { sqlite3_free(errMsg) }
            throw SQLiteError(code: rc, message: message)
        }
    }

    /// Runs a single statement with bindings, returning the number of rows
    /// changed.
    @discardableResult
    public func run(_ sql: String, _ params: [SQLValue] = []) throws -> Int {
        guard let handle else { throw SQLiteError(code: SQLITE_MISUSE, message: "database is closed") }
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        try bind(stmt, params)
        let rc = sqlite3_step(stmt)
        guard rc == SQLITE_DONE || rc == SQLITE_ROW else {
            throw SQLiteError.from(handle, fallbackCode: rc)
        }
        return Int(sqlite3_changes(handle))
    }

    /// Runs a query and returns all rows.
    public func query(_ sql: String, _ params: [SQLValue] = []) throws -> [Row] {
        guard let handle else { throw SQLiteError(code: SQLITE_MISUSE, message: "database is closed") }
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        try bind(stmt, params)

        let columnCount = Int(sqlite3_column_count(stmt))
        var names = [String]()
        names.reserveCapacity(columnCount)
        for i in 0..<columnCount {
            names.append(sqlite3_column_name(stmt, Int32(i)).map { String(cString: $0) } ?? "col\(i)")
        }

        var rows = [Row]()
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw SQLiteError.from(handle, fallbackCode: rc) }
            var values = [SQLValue]()
            values.reserveCapacity(columnCount)
            for i in 0..<columnCount {
                values.append(columnValue(stmt, Int32(i)))
            }
            rows.append(Row(columns: names, values: values))
        }
        return rows
    }

    /// Convenience: the first row of a query, if any.
    public func queryOne(_ sql: String, _ params: [SQLValue] = []) throws -> Row? {
        try query(sql, params).first
    }

    /// Runs `body` inside a transaction, committing on success and rolling back
    /// on any thrown error.
    public func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE;")
        do {
            let result = try body()
            try execute("COMMIT;")
            return result
        } catch {
            // Best-effort rollback; surface the original error.
            try? execute("ROLLBACK;")
            throw error
        }
    }

    /// The rowid of the most recent successful INSERT.
    public func lastInsertRowID() -> Int64 {
        guard let handle else { return 0 }
        return sqlite3_last_insert_rowid(handle)
    }

    // MARK: - Internals

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        let rc = sqlite3_prepare_v2(handle, sql, -1, &stmt, nil)
        guard rc == SQLITE_OK, let stmt else {
            throw SQLiteError.from(handle, fallbackCode: rc)
        }
        return stmt
    }

    private func bind(_ stmt: OpaquePointer, _ params: [SQLValue]) throws {
        for (offset, value) in params.enumerated() {
            let index = Int32(offset + 1) // SQLite parameters are 1-based.
            let rc: Int32
            switch value {
            case .null:
                rc = sqlite3_bind_null(stmt, index)
            case let .integer(v):
                rc = sqlite3_bind_int64(stmt, index, v)
            case let .real(v):
                rc = sqlite3_bind_double(stmt, index, v)
            case let .text(v):
                rc = sqlite3_bind_text(stmt, index, v, -1, SQLITE_TRANSIENT)
            case let .blob(bytes):
                if bytes.isEmpty {
                    rc = sqlite3_bind_zeroblob(stmt, index, 0)
                } else {
                    rc = bytes.withUnsafeBytes { raw in
                        sqlite3_bind_blob(stmt, index, raw.baseAddress, Int32(raw.count), SQLITE_TRANSIENT)
                    }
                }
            }
            guard rc == SQLITE_OK else { throw SQLiteError.from(handle, fallbackCode: rc) }
        }
    }

    private func columnValue(_ stmt: OpaquePointer, _ index: Int32) -> SQLValue {
        switch sqlite3_column_type(stmt, index) {
        case SQLITE_INTEGER:
            return .integer(sqlite3_column_int64(stmt, index))
        case SQLITE_FLOAT:
            return .real(sqlite3_column_double(stmt, index))
        case SQLITE_TEXT:
            return .text(sqlite3_column_text(stmt, index).map { String(cString: $0) } ?? "")
        case SQLITE_BLOB:
            if let ptr = sqlite3_column_blob(stmt, index) {
                let count = Int(sqlite3_column_bytes(stmt, index))
                let buffer = UnsafeRawBufferPointer(start: ptr, count: count)
                return .blob([UInt8](buffer))
            }
            return .blob([])
        default:
            return .null
        }
    }
}
