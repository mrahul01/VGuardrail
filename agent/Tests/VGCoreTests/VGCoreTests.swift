// Tests use swift-testing (`import Testing`), Apple's current test framework,
// which is the one available in the Command Line Tools used to build this package
// (XCTest ships only with full Xcode). The assertions map 1:1 to XCTest and can be
// mechanically converted on an Xcode host if required.

import Foundation
import Testing
@testable import VGCore

@Suite struct EnumTests {
    @Test func wireValues() {
        #expect(Action.block.rawValue == "block")
        #expect(Category.sourceCode.rawValue == "source_code")
        #expect(Role.securityAdmin.rawValue == "security_admin")
        #expect(Classification.public.rawValue == "public")
        #expect(EventType.policyEvaluated.rawValue == "PolicyEvaluated")
    }

    @Test func eventTypePrimaryForAction() {
        #expect(EventType.primary(for: .allow) == .promptAllowed)
        #expect(EventType.primary(for: .warn) == .promptWarned)
        #expect(EventType.primary(for: .block) == .promptBlocked)
    }
}

@Suite struct CodableTests {
    @Test func scanRequestRoundTrip() throws {
        let req = ScanRequest(
            text: "hello",
            context: ScanContext(
                source: .ide,
                provider: "openai",
                model: "gpt-4o",
                app: "Cursor",
                repo: RepoContext(name: "monorepo", classification: .restricted),
                file: FileContext(path: "src/main.rs", fileExtension: "rs"),
                user: UserContext(userID: "u1", role: .user, groups: ["eng"])
            )
        )
        let data = try JSONEncoder().encode(req)
        let back = try JSONDecoder().decode(ScanRequest.self, from: data)
        #expect(back == req)
    }

    @Test func fileContextEncodesExtensionKey() throws {
        let f = FileContext(path: "a/b.swift", fileExtension: "swift")
        let json = String(data: try JSONEncoder().encode(f), encoding: .utf8)!
        #expect(json.contains("\"extension\""))
        #expect(!json.contains("fileExtension"))
    }

    @Test func decisionRoundTrip() throws {
        let decision = Decision(
            requestID: "req-1",
            action: .block,
            riskLevel: .critical,
            classification: .restricted,
            matchedRuleID: "rule_aws_block",
            severity: .critical,
            findings: [
                Finding(
                    detectorID: "secret.aws_access_key",
                    category: .secret,
                    kind: "aws_access_key",
                    spanStart: 0, spanEnd: 20,
                    confidence: 0.99,
                    severity: .critical,
                    redactedPreview: "AKIA…MPLE",
                    meta: ["k": "v"]
                )
            ],
            suppressions: [Suppression(ruleID: "r", exceptionID: "e")],
            reason: "matched",
            policyVersion: 42,
            elapsedMicros: 850,
            incomplete: false
        )
        let data = try JSONEncoder().encode(decision)
        let back = try JSONDecoder().decode(Decision.self, from: data)
        #expect(back == decision)
    }
}

@Suite struct AuditEventTests {
    private func sampleDecision() -> Decision {
        Decision(
            requestID: "req-2",
            action: .block,
            riskLevel: .critical,
            classification: .restricted,
            matchedRuleID: "rule_aws_block",
            severity: .critical,
            findings: [
                Finding(
                    detectorID: "secret.aws_access_key",
                    category: .secret,
                    kind: "aws_access_key",
                    spanStart: 0, spanEnd: 20,
                    confidence: 0.99,
                    severity: .critical,
                    redactedPreview: "AKIA…MPLE"
                )
            ],
            policyVersion: 42
        )
    }

    @Test func buildAndRedactionInvariant() throws {
        let context = ScanContext(
            source: .cli, provider: "anthropic", model: "claude", app: "claude-code",
            user: UserContext(userID: "alice", role: .user)
        )
        let event = AuditEvent.make(
            type: .promptBlocked, eventID: "evt-1", timestampMs: 1_700_000_000_000,
            context: context, deviceID: "dev-1", decision: sampleDecision()
        )
        #expect(event.userID == "alice")
        #expect(event.deviceID == "dev-1")
        #expect(event.schema == "vguardrail.event/v1")

        let json = String(data: try event.canonicalJSON(), encoding: .utf8)!
        // The raw secret must never appear — only the redacted preview.
        #expect(!json.contains("AKIAIOSFODNN7EXAMPLE"))
        #expect(json.contains("AKIA…MPLE"))
        // No prompt text field is present in the envelope.
        #expect(!json.contains("\"text\""))
    }

    @Test func canonicalJSONIsDeterministic() throws {
        let event = AuditEvent.make(
            type: .policyEvaluated, eventID: "evt-1", timestampMs: 1,
            context: ScanContext(user: UserContext(userID: "u")),
            deviceID: "d",
            decision: Decision(requestID: "r", action: .allow, riskLevel: .low, classification: .public)
        )
        #expect(try event.canonicalJSON() == (try event.canonicalJSON()))
    }
}

@Suite struct UUIDv7Tests {
    @Test func formatAndVersion() {
        let s = UUIDv7.generate(millis: 0x0123_4567_89AB, randomA: 0x0ABC, randomB: 0)
        let parts = s.split(separator: "-")
        #expect(parts.map(\.count) == [8, 4, 4, 4, 12])
        #expect(Array(parts[2])[0] == "7")            // version nibble
        #expect("89ab".contains(Array(parts[3])[0]))  // variant high bits
    }

    @Test func timestampOrdering() {
        let early = UUIDv7.generate(millis: 1_000, randomA: 0, randomB: 0)
        let late = UUIDv7.generate(millis: 2_000, randomA: 0, randomB: 0)
        #expect(early < late)
    }
}

@Suite struct IdentityTests {
    @Test func loadOrCreatePersistsAndReuses() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("vg-id-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }

        var calls = 0
        let first = try IdentityStore.loadOrCreate(
            directory: dir, hostname: "host-a", agentVersion: "0.1.0",
            newDeviceID: { calls += 1; return "device-fixed" }
        )
        #expect(first.deviceID == "device-fixed")
        #expect(calls == 1)

        let second = try IdentityStore.loadOrCreate(
            directory: dir, hostname: "host-a", agentVersion: "0.1.0",
            newDeviceID: { calls += 1; return "device-other" }
        )
        #expect(second.deviceID == "device-fixed")
        #expect(calls == 1)
    }

    @Test func refreshesVersionButKeepsDeviceID() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("vg-id-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }

        let v1 = try IdentityStore.loadOrCreate(
            directory: dir, hostname: "host", agentVersion: "0.1.0", newDeviceID: { "dev" }
        )
        let v2 = try IdentityStore.loadOrCreate(
            directory: dir, hostname: "host", agentVersion: "0.2.0",
            newDeviceID: { "should-not-be-used" }
        )
        #expect(v1.deviceID == v2.deviceID)
        #expect(v2.agentVersion == "0.2.0")
    }
}
