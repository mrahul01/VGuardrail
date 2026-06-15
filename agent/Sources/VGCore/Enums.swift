// Domain enumerations for the VGuardrail agent.
//
// Raw values are the canonical wire strings shared with the policy engine and the
// backend (snake_case), so JSON envelopes are stable across the Rust engine, this
// agent, and the dashboard.

import Foundation

/// Enforcement action returned by the engine.
public enum Action: String, Codable, Sendable, CaseIterable {
    case allow
    case warn
    case block
}

/// Aggregate risk level of an evaluated prompt.
public enum RiskLevel: String, Codable, Sendable, CaseIterable {
    case low
    case medium
    case high
    case critical
}

/// Severity of a rule or finding.
public enum Severity: String, Codable, Sendable, CaseIterable {
    case low
    case medium
    case high
    case critical
}

/// Data classification of prompt content.
public enum Classification: String, Codable, Sendable, CaseIterable {
    case `public`
    case `internal`
    case confidential
    case restricted
}

/// Detector category — the 24 policy categories plus the legacy
/// `classification` derivation category.
public enum Category: String, Codable, Sendable, CaseIterable {
    case secret
    case pii
    case sourceCode = "source_code"
    case classification
    case companyConfidential = "company_confidential"
    case financial
    case intellectualProperty = "intellectual_property"
    case usagePolicy = "usage_policy"
    case promptInjection = "prompt_injection"
    case sensitiveDocument = "sensitive_document"
    case customerData = "customer_data"
    case compliance
    case keyword
    case filePolicy = "file_policy"
    case imagePolicy = "image_policy"
    case aiClassification = "ai_classification"
    case destructiveCommand = "destructive_command"
    case legal
    case medical
    case hr
    case security
    case researchDevelopment = "research_development"
    case communication
    case procurement
    case government
}

/// Origin surface of a prompt.
public enum Source: String, Codable, Sendable, CaseIterable {
    case browser
    case ide
    case cli
    case api
}

/// RBAC role of the acting user.
public enum Role: String, Codable, Sendable, CaseIterable {
    case superAdmin = "super_admin"
    case securityAdmin = "security_admin"
    case auditor
    case manager
    case user
}

/// Audit event types (EVENT_MODEL.md). Raw values are the canonical PascalCase
/// names persisted in envelopes and uploaded to the backend.
public enum EventType: String, Codable, Sendable, CaseIterable {
    case promptSubmitted = "PromptSubmitted"
    case policyEvaluated = "PolicyEvaluated"
    case promptAllowed = "PromptAllowed"
    case promptWarned = "PromptWarned"
    case warningAccepted = "WarningAccepted"
    case warningRejected = "WarningRejected"
    case promptBlocked = "PromptBlocked"
    case policyViolation = "PolicyViolation"
    case uploadSuccess = "UploadSuccess"
    case uploadFailure = "UploadFailure"
    case agentStarted = "AgentStarted"
    case policyUpdated = "PolicyUpdated"

    /// The primary event type that corresponds to a decision's action.
    public static func primary(for action: Action) -> EventType {
        switch action {
        case .allow: return .promptAllowed
        case .warn: return .promptWarned
        case .block: return .promptBlocked
        }
    }
}
