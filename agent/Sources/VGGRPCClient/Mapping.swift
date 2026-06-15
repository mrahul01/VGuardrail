// Mapping between the generated protobuf types and the VGCore domain model.
//
// NOTE: This target only compiles in a full build (`VG_GRPC=1`), where the
// GRPCProtobufGenerator plugin has produced the `Vguardrail_PolicyEngine_V1_*`
// types from policy_engine.proto. It is not built in the Command-Line-Tools-only
// authoring environment.

import Foundation
import VGCore

// Short aliases for the generated namespace.
typealias PBEvaluateRequest = Vguardrail_PolicyEngine_V1_EvaluateRequest
typealias PBEvaluateResponse = Vguardrail_PolicyEngine_V1_EvaluateResponse
typealias PBScanContext = Vguardrail_PolicyEngine_V1_ScanContext
typealias PBFinding = Vguardrail_PolicyEngine_V1_Finding

enum ProtoMap {
    // MARK: VGCore → proto

    static func request(_ request: ScanRequest, requestID: String) -> PBEvaluateRequest {
        var pb = PBEvaluateRequest()
        pb.requestID = requestID
        pb.text = request.text
        pb.context = context(request.context)
        return pb
    }

    static func context(_ ctx: ScanContext) -> PBScanContext {
        var pb = PBScanContext()
        pb.source = source(ctx.source)
        pb.provider = ctx.provider ?? ""
        pb.model = ctx.model ?? ""
        pb.app = ctx.app ?? ""
        if let repo = ctx.repo {
            var r = Vguardrail_PolicyEngine_V1_RepoContext()
            r.name = repo.name
            r.classification = classification(repo.classification)
            pb.repo = r
        }
        if let file = ctx.file {
            var f = Vguardrail_PolicyEngine_V1_FileContext()
            f.path = file.path
            f.extension = file.fileExtension ?? ""
            pb.file = f
        }
        var u = Vguardrail_PolicyEngine_V1_UserContext()
        u.userID = ctx.user.userID
        u.role = role(ctx.user.role)
        u.groups = ctx.user.groups
        pb.user = u
        return pb
    }

    static func source(_ s: Source?) -> Vguardrail_PolicyEngine_V1_Source {
        switch s {
        case .browser: return .browser
        case .ide: return .ide
        case .cli: return .cli
        case .api: return .api
        case nil: return .unspecified
        }
    }

    static func role(_ r: Role) -> Vguardrail_PolicyEngine_V1_Role {
        switch r {
        case .superAdmin: return .superAdmin
        case .securityAdmin: return .securityAdmin
        case .auditor: return .auditor
        case .manager: return .manager
        case .user: return .user
        }
    }

    static func classification(_ c: Classification?) -> Vguardrail_PolicyEngine_V1_Classification {
        switch c {
        case .public: return .public
        case .internal: return .internal
        case .confidential: return .confidential
        case .restricted: return .restricted
        case nil: return .unspecified
        }
    }

    // MARK: proto → VGCore

    static func decision(_ pb: PBEvaluateResponse) -> Decision {
        Decision(
            requestID: pb.requestID,
            action: action(pb.action),
            riskLevel: riskLevel(pb.riskLevel),
            classification: classificationFrom(pb.classification),
            category: categoryOptional(pb.category),
            matchedRuleID: pb.matchedRuleID.isEmpty ? nil : pb.matchedRuleID,
            severity: severityOptional(pb.severity),
            findings: pb.findings.map(finding),
            suppressions: pb.suppressions.map {
                Suppression(ruleID: $0.ruleID, exceptionID: $0.exceptionID)
            },
            reason: pb.reason,
            policyVersion: pb.policyVersion,
            elapsedMicros: pb.elapsedMicros,
            incomplete: pb.incomplete
        )
    }

    static func finding(_ pb: PBFinding) -> Finding {
        Finding(
            detectorID: pb.detectorID,
            category: category(pb.category),
            kind: pb.kind,
            spanStart: Int(pb.spanStart),
            spanEnd: Int(pb.spanEnd),
            confidence: Double(pb.confidence),
            severity: severity(pb.severity),
            redactedPreview: pb.redactedPreview,
            meta: pb.meta
        )
    }

    /// Fail-safe: an unspecified action is treated as WARN, never ALLOW.
    static func action(_ a: Vguardrail_PolicyEngine_V1_Action) -> Action {
        switch a {
        case .allow: return .allow
        case .warn: return .warn
        case .block: return .block
        default: return .warn
        }
    }

    static func riskLevel(_ r: Vguardrail_PolicyEngine_V1_RiskLevel) -> RiskLevel {
        switch r {
        case .low: return .low
        case .medium: return .medium
        case .high: return .high
        case .critical: return .critical
        default: return .low
        }
    }

    static func classificationFrom(_ c: Vguardrail_PolicyEngine_V1_Classification) -> Classification {
        switch c {
        case .public: return .public
        case .internal: return .internal
        case .confidential: return .confidential
        case .restricted: return .restricted
        default: return .public
        }
    }

    // Fully qualified: `Category` alone is ambiguous against ObjC runtime's
    // `Category` once Foundation/ObjC headers are visible in this target.
    static func category(_ c: Vguardrail_PolicyEngine_V1_Category) -> VGCore.Category {
        switch c {
        case .secret: return .secret
        case .pii: return .pii
        case .sourceCode: return .sourceCode
        case .classification: return .classification
        case .companyConfidential: return .companyConfidential
        case .financial: return .financial
        case .intellectualProperty: return .intellectualProperty
        case .usagePolicy: return .usagePolicy
        case .promptInjection: return .promptInjection
        case .sensitiveDocument: return .sensitiveDocument
        case .customerData: return .customerData
        case .compliance: return .compliance
        case .keyword: return .keyword
        case .filePolicy: return .filePolicy
        case .imagePolicy: return .imagePolicy
        case .aiClassification: return .aiClassification
        case .destructiveCommand: return .destructiveCommand
        case .legal: return .legal
        case .medical: return .medical
        case .hr: return .hr
        case .security: return .security
        case .researchDevelopment: return .researchDevelopment
        case .communication: return .communication
        case .procurement: return .procurement
        case .government: return .government
        default: return .secret
        }
    }

    static func categoryOptional(_ c: Vguardrail_PolicyEngine_V1_Category) -> VGCore.Category? {
        c == .unspecified ? nil : category(c)
    }

    static func severity(_ s: Vguardrail_PolicyEngine_V1_Severity) -> Severity {
        switch s {
        case .sevLow: return .low
        case .sevMedium: return .medium
        case .sevHigh: return .high
        case .sevCritical: return .critical
        default: return .low
        }
    }

    static func severityOptional(_ s: Vguardrail_PolicyEngine_V1_Severity) -> Severity? {
        s == .unspecified ? nil : severity(s)
    }
}
