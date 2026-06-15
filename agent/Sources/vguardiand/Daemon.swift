// vguardiand — the VGuardrail LaunchDaemon.
//
// Boots the agent: loads identity, opens the event queue, builds AgentCore with
// a policy-engine client (gRPC in full builds; a fail-safe loopback otherwise),
// vends the XPC service, and runs the policy-sync / upload / health workers.

import Foundation
import VGAgentCore
import VGCore
import VGEventQueue
import VGXPCProtocol

#if VG_GRPC
import VGGRPCClient
#endif

private let agentVersion = "0.1.0"

/// An UploadClient used when no backend is configured: it always fails, but the
/// daemon never runs the upload worker in that case, so events simply accumulate
/// (offline) rather than being marked failed.
private struct DisabledUploadClient: UploadClient {
    struct Disabled: Error {}
    func upload(_ events: [QueuedEvent]) async throws -> UploadResult { throw Disabled() }
}

@main
struct Daemon {
    static func main() async {
        let env = ProcessInfo.processInfo.environment

        // Configuration.
        var config = AgentConfig()
        if let v = env["VG_SOCKET_PATH"] { config.engineSocketPath = v }
        if let v = env["VG_STORE_PATH"] { config.databasePath = v }
        if let v = env["VG_MACH_SERVICE"] { config.xpcMachServiceName = v }
        if let v = env["VG_POLICY_BUNDLE"] { config.policyBundlePath = v }
        if let v = env["VG_IDENTITY_DIR"] { config.identityDirectory = URL(fileURLWithPath: v) }
        if let v = env["VG_UPLOAD_URL"], let url = URL(string: v) { config.uploadBaseURL = url }

        // Quick facts (computer name, model, OS version, console user) feed
        // device registration; the friendly computer name is what admins see.
        let facts = DeviceFacts.collect()
        let hostname = facts.displayName

        // One-shot mode: register + upload one inventory snapshot, then exit.
        // Needs only the identity — no engine, queue, or XPC. Used by installers
        // and for verifying the backend wiring without daemonizing.
        if CommandLine.arguments.contains("--inventory-once") {
            guard let baseURL = config.uploadBaseURL else {
                fail("--inventory-once requires VG_UPLOAD_URL")
            }
            let identity: DeviceIdentity
            do {
                identity = try IdentityStore.loadOrCreate(
                    directory: config.identityDirectory, hostname: hostname,
                    agentVersion: agentVersion
                )
            } catch {
                fail("identity load failed: \(error)")
            }
            await BackendRegistrar.register(
                baseURL: baseURL, deviceID: identity.deviceID, agentVersion: agentVersion,
                facts: facts, enrollmentToken: env["VG_ENROLLMENT_TOKEN"]
            )
            await InventoryReporter.report(
                baseURL: baseURL, deviceID: identity.deviceID,
                authorization: env["VG_UPLOAD_TOKEN"]
            )
            FileHandle.standardError.write(
                Data("vguardiand: inventory snapshot sent for \(identity.deviceID)\n".utf8))
            exit(0)
        }

        // Identity, queue, signer.
        let identity: DeviceIdentity
        let queue: EventQueue
        let sign: @Sendable (Data) -> String
        do {
            identity = try IdentityStore.loadOrCreate(
                directory: config.identityDirectory, hostname: hostname, agentVersion: agentVersion
            )
            queue = try EventQueue(path: config.databasePath)
            sign = try EventSigner.makeSigner(directory: config.identityDirectory)
        } catch {
            fail("startup failed: \(error)")
        }

        // Policy-engine client.
        let client: any PolicyEngineClient
        #if VG_GRPC
        client = GRPCPolicyEngineClient(socketPath: config.engineSocketPath)
        #else
        guard env["VG_ALLOW_LOOPBACK"] == "1" else {
            fail("""
            built without the gRPC client (VG_GRPC=1) and VG_ALLOW_LOOPBACK is not set.
            Refusing to start: a loopback-only daemon would not consult the policy engine.
            """)
        }
        FileHandle.standardError.write(Data("vguardiand: WARNING running with loopback client (no engine)\n".utf8))
        client = LoopbackPolicyEngineClient()
        #endif

        // Upload client (only run the worker if a backend is configured).
        let upload: any UploadClient
        if let baseURL = config.uploadBaseURL {
            upload = HTTPUploadClient(
                baseURL: baseURL, authorization: env["VG_UPLOAD_TOKEN"],
                deviceID: identity.deviceID
            )
        } else {
            upload = DisabledUploadClient()
        }

        let core = AgentCore(
            client: client, queue: queue, upload: upload,
            policySource: FilePolicySource(path: config.policyBundlePath),
            config: config, identity: identity, sign: sign
        )

        await core.bootstrap(hostname: hostname)

        // XPC listener.
        let delegate = XPCListenerDelegate(
            core: core,
            allowUnsigned: env["VG_XPC_ALLOW_UNSIGNED"] == "1",
            requirementString: env["VG_XPC_REQUIREMENT"]
        )
        let listener = NSXPCListener(machServiceName: config.xpcMachServiceName)
        listener.delegate = delegate
        listener.resume()
        FileHandle.standardError.write(Data("vguardiand: listening on \(config.xpcMachServiceName)\n".utf8))

        // Workers.
        startWorkers(core: core, runUpload: config.uploadBaseURL != nil)

        // Registration + inventory when a backend is configured: register the
        // device (so it appears in the dashboard with its quick facts), then
        // report processes/extensions at startup and every 10 minutes.
        // Never blocks enforcement.
        if let baseURL = config.uploadBaseURL {
            let deviceID = identity.deviceID
            let token = env["VG_UPLOAD_TOKEN"]
            let enrollmentToken = env["VG_ENROLLMENT_TOKEN"]
            Task {
                await BackendRegistrar.register(
                    baseURL: baseURL, deviceID: deviceID, agentVersion: agentVersion,
                    facts: facts, enrollmentToken: enrollmentToken
                )
                while true {
                    await InventoryReporter.report(
                        baseURL: baseURL, deviceID: deviceID, authorization: token
                    )
                    try? await Task.sleep(for: .seconds(600))
                }
            }
        }

        // Keep the process alive; launchd manages the lifecycle.
        //
        // withExtendedLifetime is load-bearing: NSXPCListener holds its
        // delegate WEAKLY, and in release builds ARC frees `listener` and
        // `delegate` right after their last use above — after which every
        // peer is rejected with xpc_connection_cancel(). Pinning both for
        // the lifetime of this loop keeps the service accepting connections.
        withExtendedLifetime((listener, delegate)) {}
        while true {
            try? await Task.sleep(for: .seconds(3600))
            withExtendedLifetime((listener, delegate)) {}
        }
    }

    private static func startWorkers(core: AgentCore, runUpload: Bool) {
        Task {
            while true {
                await core.refreshHealth()
                try? await Task.sleep(for: .seconds(15))
            }
        }
        Task {
            while true {
                _ = await core.syncPolicyOnce()
                try? await Task.sleep(for: .seconds(60))
            }
        }
        if runUpload {
            Task {
                while true {
                    _ = await core.runUploadOnce()
                    try? await Task.sleep(for: .seconds(30))
                }
            }
        }
    }

    private static func fail(_ message: String) -> Never {
        FileHandle.standardError.write(Data("vguardiand: \(message)\n".utf8))
        exit(1)
    }
}
