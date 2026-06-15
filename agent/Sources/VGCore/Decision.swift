// The decision returned by the engine for a scan.

import Foundation

/// A single detection. Carries only a redacted preview — never a raw secret
/// (the engine redacts; the agent must preserve that invariant).
public struct Finding: Codable, Sendable, Equatable {
    public var detectorID: String
    public var category: Category
    public var kind: String
    public var spanStart: Int
    public var spanEnd: Int
    public var confidence: Double
    public var severity: Severity
    public var redactedPreview: String
    public var meta: [String: String]

    public init(
        detectorID: String,
        category: Category,
        kind: String,
        spanStart: Int,
        spanEnd: Int,
        confidence: Double,
        severity: Severity,
        redactedPreview: String,
        meta: [String: String] = [:]
    ) {
        self.detectorID = detectorID
        self.category = category
        self.kind = kind
        self.spanStart = spanStart
        self.spanEnd = spanEnd
        self.confidence = confidence
        self.severity = severity
        self.redactedPreview = redactedPreview
        self.meta = meta
    }

    private enum CodingKeys: String, CodingKey {
        case detectorID = "detector_id"
        case category
        case kind
        case spanStart = "span_start"
        case spanEnd = "span_end"
        case confidence
        case severity
        case redactedPreview = "redacted_preview"
        case meta
    }
}

/// An exception that suppressed a would-have-fired rule.
public struct Suppression: Codable, Sendable, Equatable {
    public var ruleID: String
    public var exceptionID: String

    public init(ruleID: String, exceptionID: String) {
        self.ruleID = ruleID
        self.exceptionID = exceptionID
    }

    private enum CodingKeys: String, CodingKey {
        case ruleID = "rule_id"
        case exceptionID = "exception_id"
    }
}

/// The engine's decision for a scan.
public struct Decision: Codable, Sendable, Equatable {
    public var requestID: String
    public var action: Action
    public var riskLevel: RiskLevel
    public var classification: Classification
    /// Primary policy category driving the decision (highest-severity finding).
    public var category: Category?
    public var matchedRuleID: String?
    public var severity: Severity?
    public var findings: [Finding]
    public var suppressions: [Suppression]
    public var reason: String
    public var policyVersion: UInt32
    public var elapsedMicros: UInt32
    public var incomplete: Bool

    public init(
        requestID: String,
        action: Action,
        riskLevel: RiskLevel,
        classification: Classification,
        category: Category? = nil,
        matchedRuleID: String? = nil,
        severity: Severity? = nil,
        findings: [Finding] = [],
        suppressions: [Suppression] = [],
        reason: String = "",
        policyVersion: UInt32 = 0,
        elapsedMicros: UInt32 = 0,
        incomplete: Bool = false
    ) {
        self.requestID = requestID
        self.action = action
        self.riskLevel = riskLevel
        self.classification = classification
        self.category = category
        self.matchedRuleID = matchedRuleID
        self.severity = severity
        self.findings = findings
        self.suppressions = suppressions
        self.reason = reason
        self.policyVersion = policyVersion
        self.elapsedMicros = elapsedMicros
        self.incomplete = incomplete
    }

    private enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case action
        case riskLevel = "risk_level"
        case classification
        case category
        case matchedRuleID = "matched_rule_id"
        case severity
        case findings
        case suppressions
        case reason
        case policyVersion = "policy_version"
        case elapsedMicros = "elapsed_micros"
        case incomplete
    }
}
