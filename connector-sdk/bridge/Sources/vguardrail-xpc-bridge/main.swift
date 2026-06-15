// vguardrail-xpc-bridge — the production helper connector-sdk spawns.
//
// It reads length-prefixed JSON request frames on stdin, relays each to the
// agent daemon over NSXPC (com.vguardrail.agent.xpc), and writes framed replies
// to stdout. The daemon's code-signing peer check authenticates THIS process, so
// the XPC trust boundary is preserved.

import Foundation
import BridgeCore
import VGXPCProtocol

// Do not die from SIGPIPE if the SDK closes stdout mid-write; surface EPIPE as a
// write error and shut down gracefully instead.
signal(SIGPIPE, SIG_IGN)
// Terminate promptly on supervisor signals (EOF on stdin is the primary path).
signal(SIGTERM) { _ in _exit(0) }
signal(SIGINT) { _ in _exit(0) }

// Refuse to start if our schema constant ever diverged from the agent's models.
guard bridgeSchemaMatchesAgentModels() else {
    BridgeLog.warn("schema constant drift detected; refusing to start")
    exit(2)
}

let timeoutMs = BridgeConfig.timeoutMillisFromEnvironment()

// Connect ONLY to the canonical Mach service, with AgentXPCClient's default
// lookup domain (system LaunchDaemon; VG_XPC_USER_AGENT=1 targets a per-user
// LaunchAgent instead — local dev). The service name is not configurable
// (SECURITY.md).
let agent = AgentXPCClient()
let dispatcher = Dispatcher(agent: agent)
let pipeline = BridgePipeline(dispatcher: dispatcher, timeoutMs: timeoutMs)

BridgeLog.note("starting (protocol v\(BridgeProtocol.version), timeout \(timeoutMs)ms)")
await BridgeRunner().run(pipeline: pipeline, maxInFlight: BridgeConfig.defaultMaxInFlight)
BridgeLog.note("stdin closed; exiting")
