// A typed SQLite value and a query row.

import Foundation

/// A value bound to, or read from, a SQLite column.
public enum SQLValue: Equatable, Sendable {
    case null
    case integer(Int64)
    case real(Double)
    case text(String)
    case blob([UInt8])

    public var intValue: Int64? {
        if case let .integer(v) = self { return v }
        return nil
    }

    public var doubleValue: Double? {
        if case let .real(v) = self { return v }
        return nil
    }

    public var textValue: String? {
        if case let .text(v) = self { return v }
        return nil
    }

    public var blobValue: [UInt8]? {
        if case let .blob(v) = self { return v }
        return nil
    }

    public var boolValue: Bool? {
        intValue.map { $0 != 0 }
    }

    public var isNull: Bool {
        if case .null = self { return true }
        return false
    }
}

/// A single result row, addressable by column name or index.
public struct Row: Sendable {
    private let columns: [String]
    private let values: [SQLValue]
    private let indexByName: [String: Int]

    init(columns: [String], values: [SQLValue]) {
        self.columns = columns
        self.values = values
        var map = [String: Int](minimumCapacity: columns.count)
        for (i, name) in columns.enumerated() { map[name] = i }
        self.indexByName = map
    }

    public subscript(_ index: Int) -> SQLValue {
        values[index]
    }

    public subscript(_ name: String) -> SQLValue {
        guard let i = indexByName[name] else { return .null }
        return values[i]
    }

    public var columnNames: [String] { columns }
}
