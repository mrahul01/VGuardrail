// Runtime checks for VGXPCProtocol.

import Foundation
import VGCore
import VGXPCProtocol

func checkVGXPCProtocol(_ c: Checker) {
    c.section("VGXPCProtocol — Codable over the Data boundary")
    c.expectNoThrow("ScanRequest round-trips") {
        let req = ScanRequest(text: "p", context: ScanContext(source: .cli, provider: "openai",
                                                              user: UserContext(userID: "u")))
        let data = try XPCCodec.encodeScanRequest(req)
        guard try XPCCodec.decodeScanRequest(data) == req else { throw Err("scan request") }
    }
    c.expectNoThrow("Decision round-trips") {
        let d = Decision(requestID: "r", action: .warn, riskLevel: .high, classification: .confidential,
                         matchedRuleID: "x", severity: .high, policyVersion: 3)
        guard try XPCCodec.decodeDecision(XPCCodec.encodeDecision(d)) == d else { throw Err("decision") }
    }
    c.expectNoThrow("AgentStatus round-trips") {
        let s = AgentStatus(engineServing: true, activePolicyVersion: 5, queuedEvents: 12,
                            lastUploadOutcome: "success", engineConnected: true, agentVersion: "0.1.0")
        guard try XPCCodec.decodeStatus(XPCCodec.encodeStatus(s)) == s else { throw Err("status") }
    }
    c.expectThrows("garbage payload throws") {
        _ = try XPCCodec.decodeDecision(Data("not json".utf8))
    }

    c.section("VGXPCProtocol — NSXPCInterface")
    let iface = AgentXPC.interface()
    c.expect(NSStringFromProtocol(iface.protocol).contains("AgentControl"), "interface wraps AgentControl")
    c.expect(AgentXPC.machServiceName == "com.vguardrail.agent.xpc", "mach service name")
}
