// The verification suite required by the task: codec, malformed frames, oversized
// frames, version mismatch, XPC-unavailable, timeout — plus happy-path dispatch
// for all five methods and an end-to-end runner check over real pipes.

import Foundation
import BridgeCore
import VGCore
import VGXPCProtocol

// MARK: codec tests

func checkFrameCodec(_ c: Checker) {
    c.section("frame codec")

    let body = Data(#"{"hello":"world"}"#.utf8)
    let frame = try! encodeFrame(body)
    c.expect(frame.count == body.count + 4, "frame = 4-byte prefix + body")
    c.expect(Int(frame[0]) << 24 | Int(frame[1]) << 16 | Int(frame[2]) << 8 | Int(frame[3]) == body.count,
             "length prefix is big-endian body length")

    let dec1 = FrameDecoder()
    c.expect((try? dec1.push(frame))?.count == 1, "decodes a single whole frame")

    // split across chunks
    let dec2 = FrameDecoder()
    var split: [Data] = []
    split += (try? dec2.push(frame.subdata(in: 0..<3))) ?? []
    split += (try? dec2.push(frame.subdata(in: 3..<6))) ?? []
    split += (try? dec2.push(frame.subdata(in: 6..<frame.count))) ?? []
    c.expect(split.count == 1 && dec2.pending == 0, "reassembles a frame split across chunks")

    // two frames in one chunk
    let dec3 = FrameDecoder()
    let two = try! encodeFrame(Data(#"{"a":1}"#.utf8)) + (try! encodeFrame(Data(#"{"b":2}"#.utf8)))
    c.expect((try? dec3.push(two))?.count == 2, "decodes two frames delivered in one chunk")

    // partial trailing frame held until completed
    let dec4 = FrameDecoder()
    let f1 = try! encodeFrame(Data(#"{"a":1}"#.utf8))
    let f2 = try! encodeFrame(Data(#"{"b":2}"#.utf8))
    let firstBatch = (try? dec4.push(f1 + f2.subdata(in: 0..<2))) ?? []
    c.expect(firstBatch.count == 1 && dec4.pending == 2, "holds a partial trailing frame")
    let secondBatch = (try? dec4.push(f2.subdata(in: 2..<f2.count))) ?? []
    c.expect(secondBatch.count == 1, "completes the held frame on more bytes")

    c.expectThrows("refuses to encode an oversized frame") {
        _ = try encodeFrame(Data(count: BridgeProtocol.maxFrameBytes + 1))
    }
}

// MARK: oversized frame tests

func checkOversizedFrame(_ c: Checker) {
    c.section("oversized inbound frame")
    let dec = FrameDecoder()
    var header = Data(count: 4)
    let oversized = UInt32(BridgeProtocol.maxFrameBytes + 1)
    header[0] = UInt8((oversized >> 24) & 0xff)
    header[1] = UInt8((oversized >> 16) & 0xff)
    header[2] = UInt8((oversized >> 8) & 0xff)
    header[3] = UInt8(oversized & 0xff)
    c.expectThrows("rejects an inbound frame advertising a length over the cap") {
        _ = try dec.push(header)
    }
}

// MARK: malformed frame tests + happy-path dispatch

func checkEnvelopeAndDispatch(_ c: Checker) async {
    c.section("envelope parsing + dispatch (happy paths)")
    let pipeline = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .ok)), timeoutMs: 2000)

    // malformed JSON → no id → dropped (nil)
    let droppedReply = await pipeline.reply(toRequestBody: Data("not json".utf8))
    c.expect(droppedReply == nil, "malformed JSON (no id) is dropped")

    // non-object JSON → dropped
    let fragmentReply = await pipeline.reply(toRequestBody: Data("true".utf8))
    c.expect(fragmentReply == nil, "non-object JSON is dropped")

    // valid JSON, missing method, but with id → correlated VALIDATION error
    let missingMethod = try! JSONSerialization.data(withJSONObject: ["v": 1, "id": "m1"])
    if let data = await pipeline.reply(toRequestBody: missingMethod) {
        let r = parseReply(data)
        c.expect(r.id == "m1" && r.ok == false && r.errorCode == "VALIDATION",
                 "missing method → correlated VALIDATION error")
    } else {
        c.expect(false, "missing method should produce a correlated error, not a drop")
    }

    // unknown method → VALIDATION
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "u1", method: "frobnicate", params: [:])) {
        c.expect(parseReply(data).errorCode == "VALIDATION", "unknown method → VALIDATION error")
    } else {
        c.expect(false, "unknown method should produce an error")
    }

    // submitScan → Decision
    let scanParams: [String: Any] = [
        "text": "secret AKIA....",
        "context": ["source": "browser", "provider": "openai", "app": "chatgpt",
                    "user": ["user_id": "u-1", "role": "user", "groups": []]],
    ]
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "s1", method: "submitScan", params: scanParams)) {
        let r = parseReply(data)
        let result = r.result as? [String: Any]
        c.expect(r.ok == true && r.id == "s1", "submitScan → ok reply")
        c.expect(result?["action"] as? String == "block", "submitScan result is a Decision (block)")
        c.expect(result?["matched_rule_id"] as? String == "rule.secret.aws", "Decision keeps snake_case keys")
        // verify it round-trips through the real codec back into a VGCore Decision
        if let result, let body = try? JSONSerialization.data(withJSONObject: result) {
            c.expect((try? XPCCodec.decodeDecision(body)) != nil, "submitScan result decodes as VGCore Decision")
        } else {
            c.expect(false, "submitScan result missing")
        }
    } else {
        c.expect(false, "submitScan should reply")
    }

    // getStatus → AgentStatus
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "st1", method: "getStatus", params: [:])) {
        let r = parseReply(data)
        let result = r.result as? [String: Any]
        c.expect(r.ok == true, "getStatus → ok reply")
        c.expect(result?["agentVersion"] as? String == "1.2.0", "AgentStatus uses camelCase wire keys")
    } else {
        c.expect(false, "getStatus should reply")
    }

    // acknowledgeWarning → bool
    let ackParams: [String: Any] = ["eventID": "evt-1", "accepted": true]
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "a1", method: "acknowledgeWarning", params: ackParams)) {
        let r = parseReply(data)
        c.expect(r.ok == true && (r.result as? Bool) == true, "acknowledgeWarning → boolean result")
    } else {
        c.expect(false, "acknowledgeWarning should reply")
    }

    // recentDecisions → array
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "r1", method: "recentDecisions", params: ["limit": 5])) {
        let r = parseReply(data)
        c.expect(r.ok == true && (r.result as? [Any])?.count == 2, "recentDecisions → array of summaries")
    } else {
        c.expect(false, "recentDecisions should reply")
    }

    // bad params for a typed method → VALIDATION
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "b1", method: "submitScan", params: ["nope": 1])) {
        c.expect(parseReply(data).errorCode == "VALIDATION", "invalid scan params → VALIDATION error")
    } else {
        c.expect(false, "invalid params should produce an error")
    }
}

// MARK: version mismatch tests

func checkVersionNegotiation(_ c: Checker) async {
    c.section("version negotiation")
    let pipeline = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .ok)), timeoutMs: 2000)

    // compatible hello
    let helloOK: [String: Any] = ["sdk": "0.1.0", "proto": [1], "schema": "vguardrail.event/v1"]
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "h1", method: "hello", params: helloOK)) {
        let r = parseReply(data)
        let result = r.result as? [String: Any]
        c.expect(r.ok == true, "hello → ok reply")
        c.expect(result?["proto"] as? Int == 1, "negotiated protocol is 1")
        c.expect(result?["schema"] as? String == "vguardrail.event/v1", "reply schema matches")
        c.expect((result?["agent"] as? String)?.isEmpty == false, "reply carries an agent identifier")
    } else {
        c.expect(false, "hello should reply")
    }

    // no overlap → VERSION_MISMATCH
    let helloBad: [String: Any] = ["sdk": "9.9.9", "proto": [99], "schema": "vguardrail.event/v1"]
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "h2", method: "hello", params: helloBad)) {
        c.expect(parseReply(data).errorCode == "VERSION_MISMATCH", "no protocol overlap → VERSION_MISMATCH")
    } else {
        c.expect(false, "hello mismatch should reply with an error")
    }

    // wrong envelope protocol version on a normal request → VERSION_MISMATCH
    if let data = await pipeline.reply(toRequestBody: requestEnvelope(id: "v2", method: "getStatus", params: [:], v: 2)) {
        c.expect(parseReply(data).errorCode == "VERSION_MISMATCH", "request with v=2 → VERSION_MISMATCH")
    } else {
        c.expect(false, "v=2 request should reply with an error")
    }
}

// MARK: XPC-unavailable + remote-error + timeout tests

func checkErrorMapping(_ c: Checker) async {
    c.section("error mapping (unavailable / remote / timeout)")

    // XPC unavailable → NOT_CONNECTED
    let downPipeline = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .unavailable)), timeoutMs: 2000)
    if let data = await downPipeline.reply(toRequestBody: requestEnvelope(id: "d1", method: "getStatus", params: [:])) {
        let r = parseReply(data)
        c.expect(r.ok == false && r.errorCode == "NOT_CONNECTED", "agent unavailable → NOT_CONNECTED error")
    } else {
        c.expect(false, "unavailable agent should reply with an error")
    }

    // daemon remote error → REMOTE
    let remotePipeline = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .remote("engine refused"))), timeoutMs: 2000)
    if let data = await remotePipeline.reply(toRequestBody: requestEnvelope(id: "rm1", method: "getStatus", params: [:])) {
        c.expect(parseReply(data).errorCode == "REMOTE", "daemon error → REMOTE error")
    } else {
        c.expect(false, "remote error should reply")
    }

    // engine-down: the daemon tags engineUnavailable with a stable sentinel, which
    // must map to UNAVAILABLE (not the generic REMOTE) so the connector fails
    // closed *and* can report "policy engine unavailable".
    let engineDown = XPCErrorWire.encodeUnavailable("grpc: connection refused")
    let unavailablePipeline = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .remote(engineDown))), timeoutMs: 2000)
    if let data = await unavailablePipeline.reply(toRequestBody: requestEnvelope(id: "un1", method: "getStatus", params: [:])) {
        let r = parseReply(data)
        c.expect(r.errorCode == "UNAVAILABLE", "engine-unavailable sentinel → UNAVAILABLE error")
        c.expect(r.errorMessage == "policy engine unavailable", "UNAVAILABLE message is clean (no raw daemon dump)")
    } else {
        c.expect(false, "engine-unavailable should reply with an error")
    }

    // hung daemon → TIMEOUT (bridge-side protection, well under any SDK deadline)
    let slowPipeline = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .slow(milliseconds: 1000))), timeoutMs: 80)
    let start = Date()
    if let data = await slowPipeline.reply(toRequestBody: requestEnvelope(id: "t1", method: "getStatus", params: [:])) {
        let elapsed = Date().timeIntervalSince(start)
        c.expect(parseReply(data).errorCode == "TIMEOUT", "hung daemon → TIMEOUT error")
        c.expect(elapsed < 0.8, "timeout fires near the deadline, not after the agent")
    } else {
        c.expect(false, "timeout should reply with an error")
    }
}

// MARK: end-to-end over real pipes (full runner + graceful EOF shutdown)

func checkIntegrationOverPipes(_ c: Checker) async {
    c.section("end-to-end over pipes (runner + graceful shutdown)")

    var inFds: [Int32] = [0, 0]   // [readByBridge, writeByUs]
    var outFds: [Int32] = [0, 0]  // [readByUs, writeByBridge]
    guard pipe(&inFds) == 0, pipe(&outFds) == 0 else {
        c.expect(false, "could not create pipes")
        return
    }
    let bridgeStdin = inFds[0], ourWrite = inFds[1]
    let ourRead = outFds[0], bridgeStdout = outFds[1]

    let pipeline = BridgePipeline(dispatcher: Dispatcher(agent: FakePolicyAgent(behavior: .ok)), timeoutMs: 2000)
    let runner = BridgeRunner()
    let task = Task.detached {
        await runner.run(pipeline: pipeline, inputFD: bridgeStdin, outputFD: bridgeStdout, maxInFlight: 4)
    }

    // Send getStatus and read the reply frame back through the real IO loop.
    writeAll(ourWrite, try! encodeFrame(requestEnvelope(id: "e2e-1", method: "getStatus", params: [:])))
    if let frame = await readFrameAsync(ourRead) {
        let r = parseReply(frame)
        c.expect(r.id == "e2e-1" && r.ok == true, "end-to-end getStatus round-trips through the runner")
    } else {
        c.expect(false, "expected a reply frame from the runner")
    }

    // Two framed requests in one write — runner must answer both.
    let batch = try! encodeFrame(requestEnvelope(id: "e2e-2", method: "getStatus", params: [:]))
        + (try! encodeFrame(requestEnvelope(id: "e2e-3", method: "recentDecisions", params: ["limit": 1])))
    writeAll(ourWrite, batch)
    let reply2 = await readFrameAsync(ourRead).map(parseReply)
    let reply3 = await readFrameAsync(ourRead).map(parseReply)
    let ids = Set([reply2?.id, reply3?.id].compactMap { $0 })
    c.expect(ids == ["e2e-2", "e2e-3"], "runner answers both pipelined requests")

    // Close our write end → bridge sees EOF → run() returns (graceful shutdown).
    close(ourWrite)
    let shutdown = await withGracePeriod(seconds: 3) { await task.value }
    c.expect(shutdown, "runner shuts down gracefully on stdin EOF")
    if !shutdown { task.cancel() }

    close(ourRead)
    close(bridgeStdin)
    close(bridgeStdout)
}

// Reads a frame off `fd` without blocking the cooperative pool's progress.
func readFrameAsync(_ fd: Int32) async -> Data? {
    await withCheckedContinuation { (cont: CheckedContinuation<Data?, Never>) in
        DispatchQueue.global().async {
            cont.resume(returning: readFrame(fd))
        }
    }
}

// Awaits `body` but gives up after `seconds`, returning whether it completed.
func withGracePeriod(seconds: Double, _ body: @escaping @Sendable () async -> Void) async -> Bool {
    await withTaskGroup(of: Bool.self) { group in
        group.addTask { await body(); return true }
        group.addTask {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            return false
        }
        let first = await group.next() ?? false
        group.cancelAll()
        return first
    }
}

// MARK: schema constant

func checkSchemaConstant(_ c: Checker) {
    c.section("schema constant")
    c.expect(bridgeSchemaMatchesAgentModels(), "bridge schema constant matches the agent's AuditEvent schema")
}
