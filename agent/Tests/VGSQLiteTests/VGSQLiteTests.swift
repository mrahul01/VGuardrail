import Foundation
import Testing
@testable import VGSQLite

@Suite struct SQLiteDatabaseTests {
    private func makeDB() throws -> SQLiteDatabase {
        let db = try SQLiteDatabase.inMemory()
        try db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL, data BLOB);")
        return db
    }

    @Test func insertAndQueryTypedValues() throws {
        let db = try makeDB()
        let changes = try db.run(
            "INSERT INTO t (id, name, score, data) VALUES (?, ?, ?, ?);",
            [.integer(1), .text("alice"), .real(3.5), .blob([0xDE, 0xAD])]
        )
        #expect(changes == 1)

        let rows = try db.query("SELECT id, name, score, data FROM t;")
        #expect(rows.count == 1)
        #expect(rows[0]["id"].intValue == 1)
        #expect(rows[0]["name"].textValue == "alice")
        #expect(rows[0]["score"].doubleValue == 3.5)
        #expect(rows[0]["data"].blobValue == [0xDE, 0xAD])
    }

    @Test func nullRoundTrips() throws {
        let db = try makeDB()
        try db.run("INSERT INTO t (id, name) VALUES (?, ?);", [.integer(1), .null])
        let row = try #require(try db.queryOne("SELECT name FROM t WHERE id = 1;"))
        #expect(row["name"].isNull)
    }

    @Test func textBindingResistsInjection() throws {
        let db = try makeDB()
        // A malicious value bound as a parameter is stored literally, not executed.
        let evil = "alice'); DROP TABLE t; --"
        try db.run("INSERT INTO t (id, name) VALUES (?, ?);", [.integer(1), .text(evil)])
        let row = try #require(try db.queryOne("SELECT name FROM t WHERE id = 1;"))
        #expect(row["name"].textValue == evil)
        // Table still exists.
        #expect(try db.query("SELECT count(*) AS c FROM t;")[0]["c"].intValue == 1)
    }

    @Test func transactionCommits() throws {
        let db = try makeDB()
        try db.transaction {
            try db.run("INSERT INTO t (id, name) VALUES (1, 'a');")
            try db.run("INSERT INTO t (id, name) VALUES (2, 'b');")
        }
        #expect(try db.query("SELECT count(*) AS c FROM t;")[0]["c"].intValue == 2)
    }

    @Test func transactionRollsBackOnError() throws {
        let db = try makeDB()
        try? db.transaction {
            try db.run("INSERT INTO t (id, name) VALUES (1, 'a');")
            // Duplicate primary key → throws → rollback.
            try db.run("INSERT INTO t (id, name) VALUES (1, 'dup');")
        }
        #expect(try db.query("SELECT count(*) AS c FROM t;")[0]["c"].intValue == 0)
    }

    @Test func errorsSurfaceCodeAndMessage() throws {
        let db = try makeDB()
        #expect(throws: SQLiteError.self) {
            try db.run("INSERT INTO nonexistent VALUES (1);")
        }
    }

    @Test func usingClosedDatabaseThrows() throws {
        let db = try SQLiteDatabase.inMemory()
        db.close()
        #expect(throws: SQLiteError.self) {
            try db.execute("SELECT 1;")
        }
    }
}
