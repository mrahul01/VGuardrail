// Runtime checks for VGSQLite.

import Foundation
import VGSQLite

func checkVGSQLite(_ c: Checker) {
    c.section("VGSQLite — typed values")
    c.expectNoThrow("insert and read typed values") {
        let db = try SQLiteDatabase.inMemory()
        try db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, score REAL, data BLOB);")
        try db.run("INSERT INTO t VALUES (?, ?, ?, ?);",
                   [.integer(1), .text("alice"), .real(3.5), .blob([0xDE, 0xAD])])
        let rows = try db.query("SELECT id, name, score, data FROM t;")
        guard rows.count == 1,
              rows[0]["id"].intValue == 1,
              rows[0]["name"].textValue == "alice",
              rows[0]["score"].doubleValue == 3.5,
              rows[0]["data"].blobValue == [0xDE, 0xAD] else { throw Err("value mismatch") }
    }

    c.section("VGSQLite — parameterised binding resists injection")
    c.expectNoThrow("bound value is data, not SQL") {
        let db = try SQLiteDatabase.inMemory()
        try db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);")
        let evil = "x'); DROP TABLE t; --"
        try db.run("INSERT INTO t VALUES (?, ?);", [.integer(1), .text(evil)])
        let row = try db.queryOne("SELECT name FROM t WHERE id = 1;")
        guard row?["name"].textValue == evil else { throw Err("binding mangled") }
        guard try db.query("SELECT count(*) AS c FROM t;")[0]["c"].intValue == 1 else {
            throw Err("table dropped — injection succeeded")
        }
    }

    c.section("VGSQLite — transactions")
    c.expectNoThrow("commit persists both rows") {
        let db = try SQLiteDatabase.inMemory()
        try db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY);")
        try db.transaction {
            try db.run("INSERT INTO t VALUES (1);")
            try db.run("INSERT INTO t VALUES (2);")
        }
        guard try db.query("SELECT count(*) AS c FROM t;")[0]["c"].intValue == 2 else {
            throw Err("commit lost rows")
        }
    }
    c.expectNoThrow("rollback discards on error") {
        let db = try SQLiteDatabase.inMemory()
        try db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY);")
        try? db.transaction {
            try db.run("INSERT INTO t VALUES (1);")
            try db.run("INSERT INTO t VALUES (1);") // duplicate PK → throws
        }
        guard try db.query("SELECT count(*) AS c FROM t;")[0]["c"].intValue == 0 else {
            throw Err("rollback failed")
        }
    }

    c.section("VGSQLite — error handling")
    c.expectThrows("bad SQL throws SQLiteError") {
        let db = try SQLiteDatabase.inMemory()
        try db.run("INSERT INTO nope VALUES (1);")
    }
    c.expectThrows("closed db throws") {
        let db = try SQLiteDatabase.inMemory()
        db.close()
        try db.execute("SELECT 1;")
    }
}
