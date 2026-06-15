// The audit event envelope the agent persists and uploads (EVENT_MODEL.md /
// doc 04). Built from the request context the agent sent plus the engine's
// decision. Contains only metadata and redacted findings — never the raw prompt
// or a raw secret (privacy invariant).

import Foundation

/// A redacted, uploadable audit event.
public struct AuditEvent: Codable, Sendable, Equatable {
    public var eventID: String
    public var schema: String
    public var type: EventType
    public var timestampMs: Int64
    public var userID: String
    public var deviceID: String
    public var source: Source?
    public var provider: String?
    public var model: String?
    public var app: String?
    public var decision: Action
    public var riskLevel: RiskLevel
    public var classification: Classification
    /// Primary detection category of the decision (append-only, optional so
    /// stored pre-upgrade events still decode).
    public var category: Category?
    /// Engine reason string shown in the dashboard's audit/violations pages.
    public var reason: String?
    public var policyVersion: UInt32
    public var matchedRuleID: String?
    public var suppressions: [Suppression]
    public var incomplete: Bool
    public var findings: [Finding]

    public init(
        eventID: String,
        type: EventType,
        timestampMs: Int64,
        userID: String,
        deviceID: String,
        source: Source?,
        provider: String?,
        model: String?,
        app: String?,
        decision: Action,
        riskLevel: RiskLevel,
        classification: Classification,
        category: Category? = nil,
        reason: String? = nil,
        policyVersion: UInt32,
        matchedRuleID: String?,
        suppressions: [Suppression],
        incomplete: Bool,
        findings: [Finding]
    ) {
        self.eventID = eventID
        self.schema = "vguardrail.event/v1"
        self.type = type
        self.timestampMs = timestampMs
        self.userID = userID
        self.deviceID = deviceID
        self.source = source
        self.provider = provider
        self.model = model
        self.app = app
        self.decision = decision
        self.riskLevel = riskLevel
        self.classification = classification
        self.category = category
        self.reason = reason
        self.policyVersion = policyVersion
        self.matchedRuleID = matchedRuleID
        self.suppressions = suppressions
        self.incomplete = incomplete
        self.findings = findings
    }

    private enum CodingKeys: String, CodingKey {
        case eventID = "event_id"
        case schema
        case type
        case timestampMs = "timestamp_ms"
        case userID = "user_id"
        case deviceID = "device_id"
        case source
        case provider
        case model
        case app
        case decision
        case riskLevel = "risk_level"
        case classification
        case category
        case reason
        case policyVersion = "policy_version"
        case matchedRuleID = "matched_rule_id"
        case suppressions
        case incomplete
        case findings
    }
}

public extension AuditEvent {
    /// Builds an event of `type` from the request context and the engine decision.
    static func make(
        type: EventType,
        eventID: String,
        timestampMs: Int64,
        context: ScanContext,
        deviceID: String,
        decision: Decision
    ) -> AuditEvent {
        AuditEvent(
            eventID: eventID,
            type: type,
            timestampMs: timestampMs,
            userID: context.user.userID,
            deviceID: deviceID,
            source: context.source,
            provider: context.provider,
            model: context.model,
            app: context.app,
            decision: decision.action,
            riskLevel: decision.riskLevel,
            classification: decision.classification,
            category: decision.category,
            reason: decision.reason,
            policyVersion: decision.policyVersion,
            matchedRuleID: decision.matchedRuleID,
            suppressions: decision.suppressions,
            incomplete: decision.incomplete,
            findings: decision.findings
        )
    }

    /// Deterministic JSON encoding (sorted keys) used for storage and signing.
    func canonicalJSON() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}
