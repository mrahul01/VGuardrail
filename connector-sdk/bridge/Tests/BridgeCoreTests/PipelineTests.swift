// Unit/integration tests for the envelope + dispatch + negotiation + error
// mapping, driven through BridgePipeline with a FakePolicyAgent (no daemon).

import Testing
import Foundation
import VGXPCProtocol
@testable import BridgeCore

private func request(id: String, method: String, params: Any?, v: Int = 1) -> Data {
    var dict: [String: Any] = ["v": v, "id": id, "method": method]
    if let params { dict["params"] = params }
    return try! JSONSerialization.data(withJSONObject: dict)
}

private func reply(_ data: Data) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
}

private func errorCode(_ data: Data) -> String? {
    (reply(data)["error"] as? [String: Any])?["code"] as? String
}

@Suite("BridgePipeline")
struct PipelineTests {
    private func okPipeline(timeoutMs: Int = 2000) -> BridgePipeline {
        BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .ok)), timeoutMs: timeoutMs)
    }

    @Test("drops uncorrelatable malformed frames")
    func dropsMalformed() async {
        #expect(await okPipeline().reply(toRequestBody: Data("not json".utf8)) == nil)
        #expect(await okPipeline().reply(toRequestBody: Data("true".utf8)) == nil)
    }

    @Test("missing method yields a correlated VALIDATION error")
    func missingMethod() async {
        let body = try! JSONSerialization.data(withJSONObject: ["v": 1, "id": "m1"])
        let data = await okPipeline().reply(toRequestBody: body)
        #expect(data != nil)
        #expect(reply(data!)["id"] as? String == "m1")
        #expect(errorCode(data!) == "VALIDATION")
    }

    @Test("submitScan returns a Decision with snake_case keys")
    func submitScan() async {
        let params: [String: Any] = [
            "text": "x",
            "context": ["user": ["user_id": "u", "role": "user", "groups": []]],
        ]
        let data = await okPipeline().reply(toRequestBody: request(id: "s1", method: "submitScan", params: params))!
        let result = reply(data)["result"] as? [String: Any]
        #expect(reply(data)["ok"] as? Bool == true)
        #expect(result?["action"] as? String == "block")
        #expect(result?["matched_rule_id"] as? String == "rule.secret.aws")
    }

    @Test("getStatus / acknowledgeWarning / recentDecisions round-trip")
    func otherMethods() async {
        let p = okPipeline()
        let status = await p.reply(toRequestBody: request(id: "st", method: "getStatus", params: [:]))!
        #expect((reply(status)["result"] as? [String: Any])?["agentVersion"] as? String == "1.2.0")

        let ack = await p.reply(toRequestBody: request(id: "a", method: "acknowledgeWarning",
                                                        params: ["eventID": "e", "accepted": true]))!
        #expect(reply(ack)["result"] as? Bool == true)

        let recent = await p.reply(toRequestBody: request(id: "r", method: "recentDecisions", params: ["limit": 5]))!
        #expect((reply(recent)["result"] as? [Any])?.count == 2)
    }

    @Test("unknown method and bad params yield VALIDATION")
    func validation() async {
        let p = okPipeline()
        let unknown = await p.reply(toRequestBody: request(id: "u", method: "frob", params: [:]))!
        #expect(errorCode(unknown) == "VALIDATION")
        let bad = await p.reply(toRequestBody: request(id: "b", method: "submitScan", params: ["nope": 1]))!
        #expect(errorCode(bad) == "VALIDATION")
    }

    @Test("hello negotiates v1 and rejects no-overlap")
    func negotiation() async {
        let p = okPipeline()
        let ok = await p.reply(toRequestBody: request(id: "h", method: "hello",
                                                      params: ["sdk": "0.1.0", "proto": [1], "schema": "vguardrail.event/v1"]))!
        let result = reply(ok)["result"] as? [String: Any]
        #expect(result?["proto"] as? Int == 1)
        #expect(result?["schema"] as? String == "vguardrail.event/v1")

        let bad = await p.reply(toRequestBody: request(id: "h2", method: "hello", params: ["proto": [99]]))!
        #expect(errorCode(bad) == "VERSION_MISMATCH")

        let wrongV = await p.reply(toRequestBody: request(id: "v", method: "getStatus", params: [:], v: 2))!
        #expect(errorCode(wrongV) == "VERSION_MISMATCH")
    }

    @Test("maps unavailable / remote / timeout to the right codes")
    func errorMapping() async {
        let down = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .unavailable)), timeoutMs: 2000)
        #expect(errorCode(await down.reply(toRequestBody: request(id: "d", method: "getStatus", params: [:]))!) == "NOT_CONNECTED")

        let remote = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .remote("nope"))), timeoutMs: 2000)
        #expect(errorCode(await remote.reply(toRequestBody: request(id: "rm", method: "getStatus", params: [:]))!) == "REMOTE")

        let slow = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .slow(milliseconds: 1000))), timeoutMs: 80)
        #expect(errorCode(await slow.reply(toRequestBody: request(id: "t", method: "getStatus", params: [:]))!) == "TIMEOUT")
    }

    @Test("schema constant matches the agent models")
    func schema() {
        #expect(bridgeSchemaMatchesAgentModels())
    }

    @Test("engine-unavailable sentinel maps to UNAVAILABLE, plain remote to REMOTE")
    func unavailableMapping() {
        let tagged = XPCClientError.remote(XPCErrorWire.encodeUnavailable("grpc: connection refused"))
        let mapped = mapAgentError(tagged)
        #expect(mapped.code == .unavailable)
        #expect(mapped.message == "policy engine unavailable")
        // No prompt content and no raw daemon dump leaks through the clean message.
        #expect(!mapped.message.contains("grpc"))

        let plain = mapAgentError(XPCClientError.remote("some other failure"))
        #expect(plain.code == .remote)
        #expect(plain.message == "some other failure")
    }
}
