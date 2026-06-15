// Schema + forward-only migrations for the agent store (doc 05, agent-owned).

import VGSQLite

enum Schema {
    /// Ordered migrations; index + 1 is the version.
    static let migrations: [String] = [migration1]

    static var supportedVersion: Int64 { Int64(migrations.count) }

    /// Applies any unapplied migrations. Fail-closed if the on-disk schema is
    /// newer than this binary supports.
    static func migrate(_ db: SQLiteDatabase) throws {
        try db.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);"
        )
        let current = try db.queryOne("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations;")?["v"].intValue ?? 0
        guard current <= supportedVersion else {
            throw SchemaError.tooNew(found: current, supported: supportedVersion)
        }
        for (i, ddl) in migrations.enumerated() {
            let version = Int64(i + 1)
            if version > current {
                try db.transaction {
                    try db.execute(ddl)
                    try db.run(
                        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'));",
                        [.integer(version)]
                    )
                }
            }
        }
    }

    private static let migration1 = """
    CREATE TABLE audit_events (
        event_id      TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        payload       BLOB NOT NULL,
        payload_sig   TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','inflight','uploaded','failed','dead')),
        attempts      INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,
        last_error    TEXT
    );
    CREATE INDEX idx_events_status_retry ON audit_events(status, next_retry_at);
    CREATE INDEX idx_events_created ON audit_events(created_at);

    CREATE TABLE device_state (
        id               INTEGER PRIMARY KEY CHECK (id = 1),
        device_id        TEXT NOT NULL,
        hostname         TEXT NOT NULL,
        agent_version    TEXT NOT NULL,
        registered       INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0,1)),
        last_policy_sync TEXT,
        last_seen        TEXT
    );

    CREATE TABLE upload_status (
        batch_id    TEXT PRIMARY KEY,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        event_count INTEGER NOT NULL,
        accepted    INTEGER,
        rejected    INTEGER,
        outcome     TEXT NOT NULL CHECK (outcome IN ('success','failure','partial'))
    );

    CREATE TABLE decision_log (
        request_id      TEXT PRIMARY KEY,
        ts              INTEGER NOT NULL,
        action          TEXT NOT NULL,
        risk_level      TEXT NOT NULL,
        matched_rule_id TEXT,
        provider        TEXT,
        app             TEXT
    );
    CREATE INDEX idx_decision_ts ON decision_log(ts);
    """
}

/// Errors applying the schema.
public enum SchemaError: Error, Equatable {
    case tooNew(found: Int64, supported: Int64)
}
