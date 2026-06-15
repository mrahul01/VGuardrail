// The agent-owned event queue: an actor that serializes all access to the local
// SQLite store. Implements the queue state machine
// (pending → inflight → uploaded, with failed-backoff → dead), the device and
// upload tables, and a rolling decision log for the menu bar UI.

import Foundation
import VGCore
import VGSQLite

public actor EventQueue {
    private let db: SQLiteDatabase

    /// Maximum rows retained in the rolling decision log.
    public static let decisionLogCap = 500

    /// Opens (creating/migrating) the store at `path`.
    public init(path: String) throws {
        self.db = try SQLiteDatabase(path: path)
        try Schema.migrate(db)
    }

    /// Opens an in-memory store (tests).
    public static func inMemory() throws -> EventQueue {
        try EventQueue(path: ":memory:")
    }

    // MARK: - Queue

    /// Enqueues a signed audit event in `pending` state. The signature is
    /// computed by the caller (which holds the signing key).
    public func enqueue(_ event: AuditEvent, signature: String) throws {
        let payload = [UInt8](try event.canonicalJSON())
        try db.run(
            """
            INSERT INTO audit_events (event_id, type, created_at, payload, payload_sig, status)
            VALUES (?, ?, ?, ?, ?, 'pending');
            """,
            [
                .text(event.eventID),
                .text(event.type.rawValue),
                .text(String(event.timestampMs)),
                .blob(payload),
                .text(signature),
            ]
        )
    }

    /// Claims up to `limit` ready events (`pending`/`failed` past their backoff),
    /// transitioning them to `inflight`.
    public func claimBatch(limit: Int, nowMillis: Int64) throws -> [QueuedEvent] {
        try db.transaction {
            let rows = try db.query(
                """
                SELECT event_id, type, created_at, payload, payload_sig
                FROM audit_events
                WHERE status IN ('pending','failed')
                  AND (next_retry_at IS NULL OR next_retry_at <= ?)
                ORDER BY created_at
                LIMIT ?;
                """,
                [.integer(nowMillis), .integer(Int64(limit))]
            )
            let events = rows.map { row in
                QueuedEvent(
                    eventID: row["event_id"].textValue ?? "",
                    type: row["type"].textValue ?? "",
                    createdAt: row["created_at"].textValue ?? "",
                    payload: row["payload"].blobValue ?? [],
                    payloadSignature: row["payload_sig"].textValue ?? ""
                )
            }
            for e in events {
                try db.run("UPDATE audit_events SET status='inflight' WHERE event_id=?;", [.text(e.eventID)])
            }
            return events
        }
    }

    /// Marks events as successfully uploaded.
    public func markUploaded(_ eventIDs: [String]) throws {
        try db.transaction {
            for id in eventIDs {
                try db.run(
                    "UPDATE audit_events SET status='uploaded', last_error=NULL WHERE event_id=?;",
                    [.text(id)]
                )
            }
        }
    }

    /// Marks an event failed: schedules a backoff retry, or moves it to `dead`
    /// once `maxAttempts` is reached. Returns the new status.
    @discardableResult
    public func markFailed(
        eventID: String, error: String, nowMillis: Int64,
        baseBackoffMillis: Int64, maxAttempts: Int
    ) throws -> EventStatus {
        guard let attempts = try db.queryOne(
            "SELECT attempts FROM audit_events WHERE event_id=?;", [.text(eventID)]
        )?["attempts"].intValue else {
            throw EventQueueError.unknownEvent(eventID)
        }
        let newAttempts = attempts + 1
        if newAttempts >= Int64(maxAttempts) {
            try db.run(
                "UPDATE audit_events SET status='dead', attempts=?, last_error=?, next_retry_at=NULL WHERE event_id=?;",
                [.integer(newAttempts), .text(error), .text(eventID)]
            )
            return .dead
        }
        let shift = min(attempts, 16)
        let next = nowMillis + baseBackoffMillis * (Int64(1) << shift)
        try db.run(
            "UPDATE audit_events SET status='failed', attempts=?, last_error=?, next_retry_at=? WHERE event_id=?;",
            [.integer(newAttempts), .text(error), .integer(next), .text(eventID)]
        )
        return .failed
    }

    /// Count of events still owing upload (`pending`+`inflight`+`failed`).
    public func queueDepth() throws -> UInt64 {
        let n = try db.queryOne(
            "SELECT COUNT(*) AS c FROM audit_events WHERE status IN ('pending','inflight','failed');"
        )?["c"].intValue ?? 0
        return UInt64(max(0, n))
    }

    /// Count of events in a given status.
    public func count(status: EventStatus) throws -> UInt64 {
        let n = try db.queryOne(
            "SELECT COUNT(*) AS c FROM audit_events WHERE status=?;", [.text(status.rawValue)]
        )?["c"].intValue ?? 0
        return UInt64(max(0, n))
    }

    /// Deletes `uploaded` rows, returning the number vacuumed.
    @discardableResult
    public func purgeUploaded() throws -> Int {
        try db.run("DELETE FROM audit_events WHERE status='uploaded';")
    }

    // MARK: - Device state

    public func saveDevice(_ d: DeviceRecord) throws {
        try db.run(
            """
            INSERT OR REPLACE INTO device_state
            (id, device_id, hostname, agent_version, registered, last_policy_sync, last_seen)
            VALUES (1, ?, ?, ?, ?, ?, ?);
            """,
            [
                .text(d.deviceID), .text(d.hostname), .text(d.agentVersion),
                .integer(d.registered ? 1 : 0),
                d.lastPolicySync.map { SQLValue.text($0) } ?? .null,
                d.lastSeen.map { SQLValue.text($0) } ?? .null,
            ]
        )
    }

    public func loadDevice() throws -> DeviceRecord? {
        guard let row = try db.queryOne(
            "SELECT device_id, hostname, agent_version, registered, last_policy_sync, last_seen FROM device_state WHERE id=1;"
        ) else { return nil }
        return DeviceRecord(
            deviceID: row["device_id"].textValue ?? "",
            hostname: row["hostname"].textValue ?? "",
            agentVersion: row["agent_version"].textValue ?? "",
            registered: (row["registered"].intValue ?? 0) != 0,
            lastPolicySync: row["last_policy_sync"].textValue,
            lastSeen: row["last_seen"].textValue
        )
    }

    // MARK: - Upload bookkeeping

    public func recordUpload(_ u: UploadRecord) throws {
        try db.run(
            """
            INSERT OR REPLACE INTO upload_status
            (batch_id, started_at, finished_at, event_count, accepted, rejected, outcome)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            [
                .text(u.batchID), .text(u.startedAt),
                u.finishedAt.map { SQLValue.text($0) } ?? .null,
                .integer(Int64(u.eventCount)),
                u.accepted.map { SQLValue.integer(Int64($0)) } ?? .null,
                u.rejected.map { SQLValue.integer(Int64($0)) } ?? .null,
                .text(u.outcome.rawValue),
            ]
        )
    }

    /// The most recent upload record, if any.
    public func lastUpload() throws -> UploadRecord? {
        guard let row = try db.queryOne(
            "SELECT batch_id, started_at, finished_at, event_count, accepted, rejected, outcome FROM upload_status ORDER BY started_at DESC LIMIT 1;"
        ) else { return nil }
        return UploadRecord(
            batchID: row["batch_id"].textValue ?? "",
            startedAt: row["started_at"].textValue ?? "",
            finishedAt: row["finished_at"].textValue,
            eventCount: Int(row["event_count"].intValue ?? 0),
            accepted: row["accepted"].intValue.map(Int.init),
            rejected: row["rejected"].intValue.map(Int.init),
            outcome: UploadOutcome(rawValue: row["outcome"].textValue ?? "failure") ?? .failure
        )
    }

    // MARK: - Decision log (rolling, for the menu bar)

    public func logDecision(_ s: DecisionSummary) throws {
        try db.transaction {
            try db.run(
                """
                INSERT OR REPLACE INTO decision_log
                (request_id, ts, action, risk_level, matched_rule_id, provider, app)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                [
                    .text(s.requestID), .integer(s.timestampMs),
                    .text(s.action.rawValue), .text(s.riskLevel.rawValue),
                    s.matchedRuleID.map { SQLValue.text($0) } ?? .null,
                    s.provider.map { SQLValue.text($0) } ?? .null,
                    s.app.map { SQLValue.text($0) } ?? .null,
                ]
            )
            // Trim to the cap (keep the newest rows).
            try db.run(
                """
                DELETE FROM decision_log WHERE request_id NOT IN (
                    SELECT request_id FROM decision_log ORDER BY ts DESC LIMIT ?
                );
                """,
                [.integer(Int64(Self.decisionLogCap))]
            )
        }
    }

    public func recentDecisions(limit: Int) throws -> [DecisionSummary] {
        let rows = try db.query(
            "SELECT request_id, ts, action, risk_level, matched_rule_id, provider, app FROM decision_log ORDER BY ts DESC LIMIT ?;",
            [.integer(Int64(limit))]
        )
        return rows.map { row in
            DecisionSummary(
                requestID: row["request_id"].textValue ?? "",
                timestampMs: row["ts"].intValue ?? 0,
                action: Action(rawValue: row["action"].textValue ?? "allow") ?? .allow,
                riskLevel: RiskLevel(rawValue: row["risk_level"].textValue ?? "low") ?? .low,
                matchedRuleID: row["matched_rule_id"].textValue,
                provider: row["provider"].textValue,
                app: row["app"].textValue
            )
        }
    }
}
