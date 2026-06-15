-- VGuardrail Policy Engine — local SQLite schema (doc 05).
-- Applied inside a transaction by the migration runner.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL
);

-- Outbound audit event queue ------------------------------------------------
CREATE TABLE IF NOT EXISTS events_queue (
    event_id      TEXT    PRIMARY KEY,
    type          TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    payload       BLOB    NOT NULL,
    payload_sig   TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','inflight','uploaded','failed','dead')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,
    last_error    TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_status_retry ON events_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_events_created ON events_queue(created_at);

-- Active + historical signed policy bundles ---------------------------------
CREATE TABLE IF NOT EXISTS policy_cache (
    version      INTEGER PRIMARY KEY,
    bundle_json  BLOB    NOT NULL,
    signature    TEXT    NOT NULL,
    key_id       TEXT    NOT NULL,
    issued_at    TEXT    NOT NULL,
    installed_at TEXT    NOT NULL,
    is_active    INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_active ON policy_cache(is_active) WHERE is_active = 1;

-- Device registration / identity state (singleton) --------------------------
CREATE TABLE IF NOT EXISTS device_state (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    device_id        TEXT NOT NULL,
    hostname         TEXT NOT NULL,
    agent_version    TEXT NOT NULL,
    registered       INTEGER NOT NULL DEFAULT 0 CHECK (registered IN (0,1)),
    last_policy_sync TEXT,
    last_seen        TEXT
);

-- Upload worker bookkeeping -------------------------------------------------
CREATE TABLE IF NOT EXISTS upload_status (
    batch_id    TEXT PRIMARY KEY,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    event_count INTEGER NOT NULL,
    accepted    INTEGER,
    rejected    INTEGER,
    outcome     TEXT NOT NULL CHECK (outcome IN ('success','failure','partial'))
);
