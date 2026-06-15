import Foundation
import Testing
@testable import VGCore
@testable import VGXPCProtocol

@Suite struct XPCCodecTests {
    @Test func scanRequestRoundTripsThroughData() throws {
        let req = ScanRequest(
            text: "secret prompt",
            context: ScanContext(source: .cli, provider: "openai",
                                 user: UserContext(userID: "u1", role: .user, groups: ["g"]))
        )
        let data = try XPCCodec.encodeScanRequest(req)
        #expect(try XPCCodec.decodeScanRequest(data) == req)
    }

    @Test func decisionRoundTripsThroughData() throws {
        let decision = Decision(
            requestID: "r1", action: .warn, riskLevel: .high, classification: .confidential,
            matchedRuleID: "rule_x", severity: .high, reason: "warned", policyVersion: 3
        )
        let data = try XPCCodec.encodeDecision(decision)
        #expect(try XPCCodec.decodeDecision(data) == decision)
    }

    @Test func statusRoundTripsThroughData() throws {
        let status = AgentStatus(
            engineServing: true, activePolicyVersion: 5, queuedEvents: 12,
            lastUploadOutcome: "success", engineConnected: true, agentVersion: "0.1.0"
        )
        let data = try XPCCodec.encodeStatus(status)
        #expect(try XPCCodec.decodeStatus(data) == status)
    }

    @Test func summariesRoundTripThroughData() throws {
        let summaries = [
            DecisionSummary(requestID: "r1", timestampMs: 1, action: .block, riskLevel: .critical,
                            matchedRuleID: "rule_x", provider: "openai", app: "Cursor"),
            DecisionSummary(requestID: "r2", timestampMs: 2, action: .allow, riskLevel: .low,
                            matchedRuleID: nil, provider: nil, app: nil),
        ]
        let data = try XPCCodec.encodeSummaries(summaries)
        #expect(try XPCCodec.decodeSummaries(data) == summaries)
    }

    @Test func decodingGarbageThrows() {
        #expect(throws: (any Error).self) {
            _ = try XPCCodec.decodeDecision(Data("not json".utf8))
        }
    }

    @Test func interfaceBuildsForAgentControl() {
        // NSXPCInterface(with:) validates the @objc protocol is XPC-representable.
        let iface = AgentXPC.interface()
        #expect(NSStringFromProtocol(iface.protocol).contains("AgentControl"))
        #expect(AgentXPC.machServiceName == "com.vguardrail.agent.xpc")
    }
}
