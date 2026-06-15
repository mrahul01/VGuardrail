//! The SQLite-backed store: migrations, the event queue state machine, policy
//! cache, device state, and upload bookkeeping (doc 05).

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{Result, StoreError};
use crate::model::{CachedPolicy, DeviceState, EventStatus, QueuedEvent, UploadRecord};

/// Ordered migrations; index+1 is the version.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/0001_init.sql")];

/// Highest schema version this binary understands.
pub const SUPPORTED_VERSION: u32 = MIGRATIONS.len() as u32;

/// Handle to the local database.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Opens (creating if needed) the database at `path` and runs migrations.
    ///
    /// # Errors
    /// Propagates SQLite and migration errors.
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_conn(conn)
    }

    /// Opens an in-memory database (tests / ephemeral use).
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn open_in_memory() -> Result<Self> {
        Self::from_conn(Connection::open_in_memory()?)
    }

    /// Applies the at-rest encryption key (SQLCipher). No-op unless built with
    /// the `sqlcipher` feature; the key comes from the macOS Keychain (doc 05 §1).
    ///
    /// # Errors
    /// Propagates SQLite errors when the feature is enabled.
    #[cfg(feature = "sqlcipher")]
    pub fn open_encrypted(path: &str, key: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "key", key)?;
        Self::from_conn(conn)
    }

    fn from_conn(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
        )?;
        let current: u32 = self.conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |r| r.get(0),
        )?;

        if current > SUPPORTED_VERSION {
            return Err(StoreError::SchemaTooNew {
                found: current,
                supported: SUPPORTED_VERSION,
            });
        }

        for (idx, sql) in MIGRATIONS.iter().enumerate() {
            let version = idx as u32 + 1;
            if version > current {
                self.conn.execute_batch(sql)?;
                self.conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, datetime('now'))",
                    params![version],
                )?;
            }
        }
        Ok(())
    }

    // ── Event queue ─────────────────────────────────────────────────────────

    /// Enqueues an event in `pending` state.
    ///
    /// # Errors
    /// Propagates SQLite errors (including a duplicate `event_id`).
    pub fn enqueue(&self, e: &QueuedEvent) -> Result<()> {
        self.conn.execute(
            "INSERT INTO events_queue(event_id, type, created_at, payload, payload_sig, status)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending')",
            params![
                e.event_id,
                e.event_type,
                e.created_at,
                e.payload,
                e.payload_sig
            ],
        )?;
        Ok(())
    }

    /// Claims up to `limit` ready events (`pending`/`failed` with elapsed
    /// backoff), transitioning them to `inflight`, and returns them.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn claim_batch(&mut self, limit: usize, now_ms: i64) -> Result<Vec<QueuedEvent>> {
        let tx = self.conn.transaction()?;
        let claimed: Vec<QueuedEvent> = {
            let mut stmt = tx.prepare(
                "SELECT event_id, type, created_at, payload, payload_sig
                 FROM events_queue
                 WHERE status IN ('pending','failed')
                   AND (next_retry_at IS NULL OR next_retry_at <= ?1)
                 ORDER BY created_at
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![now_ms, limit as i64], |r| {
                Ok(QueuedEvent {
                    event_id: r.get(0)?,
                    event_type: r.get(1)?,
                    created_at: r.get(2)?,
                    payload: r.get(3)?,
                    payload_sig: r.get(4)?,
                })
            })?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for e in &claimed {
            tx.execute(
                "UPDATE events_queue SET status='inflight' WHERE event_id=?1",
                params![e.event_id],
            )?;
        }
        tx.commit()?;
        Ok(claimed)
    }

    /// Marks events as successfully uploaded.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn mark_uploaded(&self, event_ids: &[String]) -> Result<()> {
        for id in event_ids {
            self.conn.execute(
                "UPDATE events_queue SET status='uploaded', last_error=NULL WHERE event_id=?1",
                params![id],
            )?;
        }
        Ok(())
    }

    /// Marks an event as failed, scheduling a backoff retry or moving it to
    /// `dead` once `max_attempts` is reached. Returns the new status.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn mark_failed(
        &self,
        event_id: &str,
        error: &str,
        now_ms: i64,
        base_backoff_ms: i64,
        max_attempts: u32,
    ) -> Result<EventStatus> {
        let attempts: u32 = self
            .conn
            .query_row(
                "SELECT attempts FROM events_queue WHERE event_id=?1",
                params![event_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::Integrity(format!("unknown event '{event_id}'")))?;

        let new_attempts = attempts + 1;
        if new_attempts >= max_attempts {
            self.conn.execute(
                "UPDATE events_queue SET status='dead', attempts=?2, last_error=?3, next_retry_at=NULL WHERE event_id=?1",
                params![event_id, new_attempts, error],
            )?;
            return Ok(EventStatus::Dead);
        }
        // Exponential backoff, capped at 2^16 multiples to avoid overflow.
        let shift = attempts.min(16);
        let next = now_ms + base_backoff_ms.saturating_mul(1i64 << shift);
        self.conn.execute(
            "UPDATE events_queue SET status='failed', attempts=?2, last_error=?3, next_retry_at=?4 WHERE event_id=?1",
            params![event_id, new_attempts, error, next],
        )?;
        Ok(EventStatus::Failed)
    }

    /// Count of events still owing upload (`pending`+`inflight`+`failed`).
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn queue_depth(&self) -> Result<u64> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM events_queue WHERE status IN ('pending','inflight','failed')",
            [],
            |r| r.get(0),
        )?;
        Ok(n as u64)
    }

    /// Count of events in a given status.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn count_by_status(&self, status: EventStatus) -> Result<u64> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM events_queue WHERE status=?1",
            params![status.as_str()],
            |r| r.get(0),
        )?;
        Ok(n as u64)
    }

    /// Deletes `uploaded` rows, returning how many were vacuumed (doc 05 §4).
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn purge_uploaded(&self) -> Result<usize> {
        Ok(self
            .conn
            .execute("DELETE FROM events_queue WHERE status='uploaded'", [])?)
    }

    // ── Policy cache ────────────────────────────────────────────────────────

    /// Installs a policy bundle, optionally making it active (clearing any
    /// previous active row to satisfy the single-active invariant).
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn install_policy(
        &mut self,
        policy: &CachedPolicy,
        issued_at: &str,
        installed_at: &str,
        make_active: bool,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        if make_active {
            tx.execute("UPDATE policy_cache SET is_active=0 WHERE is_active=1", [])?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO policy_cache
             (version, bundle_json, signature, key_id, issued_at, installed_at, is_active)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                policy.version,
                policy.bundle_json,
                policy.signature,
                policy.key_id,
                issued_at,
                installed_at,
                i32::from(make_active),
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Returns the active policy bundle, if any.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn active_policy(&self) -> Result<Option<CachedPolicy>> {
        Ok(self
            .conn
            .query_row(
                "SELECT version, bundle_json, signature, key_id, is_active
                 FROM policy_cache WHERE is_active=1",
                [],
                |r| {
                    Ok(CachedPolicy {
                        version: r.get(0)?,
                        bundle_json: r.get(1)?,
                        signature: r.get(2)?,
                        key_id: r.get(3)?,
                        is_active: r.get::<_, i32>(4)? != 0,
                    })
                },
            )
            .optional()?)
    }

    /// All cached policy versions, ascending.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn policy_versions(&self) -> Result<Vec<u32>> {
        let mut stmt = self
            .conn
            .prepare("SELECT version FROM policy_cache ORDER BY version")?;
        let rows = stmt.query_map([], |r| r.get::<_, u32>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Keeps only the `keep` highest-version bundles (plus always the active
    /// one), deleting older cached policies. Returns rows deleted.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn prune_policies(&self, keep: usize) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM policy_cache
             WHERE is_active=0 AND version NOT IN (
                 SELECT version FROM policy_cache ORDER BY version DESC LIMIT ?1
             )",
            params![keep as i64],
        )?)
    }

    // ── Device state ────────────────────────────────────────────────────────

    /// Persists the singleton device state.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn save_device(&self, d: &DeviceState) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO device_state
             (id, device_id, hostname, agent_version, registered, last_policy_sync, last_seen)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                d.device_id,
                d.hostname,
                d.agent_version,
                i32::from(d.registered),
                d.last_policy_sync,
                d.last_seen,
            ],
        )?;
        Ok(())
    }

    /// Loads the device state, if set.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn load_device(&self) -> Result<Option<DeviceState>> {
        Ok(self
            .conn
            .query_row(
                "SELECT device_id, hostname, agent_version, registered, last_policy_sync, last_seen
                 FROM device_state WHERE id=1",
                [],
                |r| {
                    Ok(DeviceState {
                        device_id: r.get(0)?,
                        hostname: r.get(1)?,
                        agent_version: r.get(2)?,
                        registered: r.get::<_, i32>(3)? != 0,
                        last_policy_sync: r.get(4)?,
                        last_seen: r.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    // ── Upload bookkeeping ──────────────────────────────────────────────────

    /// Records an upload batch outcome.
    ///
    /// # Errors
    /// Propagates SQLite errors.
    pub fn record_upload(&self, u: &UploadRecord) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO upload_status
             (batch_id, started_at, finished_at, event_count, accepted, rejected, outcome)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                u.batch_id,
                u.started_at,
                u.finished_at,
                u.event_count,
                u.accepted,
                u.rejected,
                u.outcome.as_str(),
            ],
        )?;
        Ok(())
    }
}
