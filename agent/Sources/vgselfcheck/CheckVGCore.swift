// Runtime checks for VGCore (mirrors the key swift-testing assertions).

import Foundation
import VGCore

func checkVGCore(_ c: Checker) {
    c.section("VGCore — enums & event types")
    c.expect(Action.block.rawValue == "block", "Action wire value")
    c.expect(Category.sourceCode.rawValue == "source_code", "Category wire value")
    c.expect(Role.securityAdmin.rawValue == "security_admin", "Role wire value")
    c.expect(EventType.primary(for: .block) == .promptBlocked, "primary event for block")
    c.expect(EventType.primary(for: .warn) == .promptWarned, "primary event for warn")

    c.section("VGCore — Codable round trips")
    c.expectNoThrow("ScanRequest round-trips") {
        let req = ScanRequest(
            text: "hi",
            context: ScanContext(
                source: .ide, provider: "openai",
                file: FileContext(path: "a.swift", fileExtension: "swift"),
                user: UserContext(userID: "u1", role: .user, groups: ["eng"])
            )
        )
        let data = try JSONEncoder().encode(req)
        let json = String(data: data, encoding: .utf8)!
        guard json.contains("\"extension\"") else { throw Err("extension key") }
        let back = try JSONDecoder().decode(ScanRequest.self, from: data)
        guard back == req else { throw Err("not equal") }
    }

    c.section("VGCore — AuditEvent redaction invariant")
    let decision = Decision(
        requestID: "r", action: .block, riskLevel: .critical, classification: .restricted,
        matchedRuleID: "rule_aws_block", severity: .critical,
        findings: [Finding(detectorID: "secret.aws_access_key", category: .secret,
                           kind: "aws_access_key", spanStart: 0, spanEnd: 20,
                           confidence: 0.99, severity: .critical, redactedPreview: "AKIA…MPLE")],
        policyVersion: 42
    )
    let event = AuditEvent.make(
        type: .promptBlocked, eventID: "e1", timestampMs: 1_700_000_000_000,
        context: ScanContext(source: .cli, provider: "anthropic",
                             user: UserContext(userID: "alice")),
        deviceID: "dev-1", decision: decision
    )
    c.expectNoThrow("AuditEvent canonical JSON excludes raw secret & prompt text") {
        let json = String(data: try event.canonicalJSON(), encoding: .utf8)!
        guard !json.contains("AKIAIOSFODNN7EXAMPLE") else { throw Err("raw secret leaked") }
        guard json.contains("AKIA…MPLE") else { throw Err("missing redacted preview") }
        guard !json.contains("\"text\"") else { throw Err("prompt text present") }
    }
    c.expect(event.userID == "alice" && event.deviceID == "dev-1", "envelope carries identity")

    c.section("VGCore — UUIDv7")
    let early = UUIDv7.generate(millis: 1_000, randomA: 0, randomB: 0)
    let late = UUIDv7.generate(millis: 2_000, randomA: 0, randomB: 0)
    c.expect(early < late, "UUIDv7 sorts by timestamp")
    let parts = UUIDv7.generate(millis: 0x0123_4567_89AB, randomA: 0x0ABC, randomB: 0).split(separator: "-")
    c.expect(parts.map(\.count) == [8, 4, 4, 4, 12], "UUIDv7 canonical shape")
    c.expect(Array(parts[2])[0] == "7", "UUIDv7 version nibble is 7")

    c.section("VGCore — Identity persistence")
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vg-sc-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    c.expectNoThrow("identity created then reused") {
        var calls = 0
        let a = try IdentityStore.loadOrCreate(directory: dir, hostname: "h", agentVersion: "0.1.0",
                                               newDeviceID: { calls += 1; return "dev-x" })
        let b = try IdentityStore.loadOrCreate(directory: dir, hostname: "h", agentVersion: "0.1.0",
                                               newDeviceID: { calls += 1; return "dev-y" })
        guard a.deviceID == "dev-x", b.deviceID == "dev-x", calls == 1 else { throw Err("identity reuse") }
    }
}

struct Err: Error { let m: String; init(_ m: String) { self.m = m } }
