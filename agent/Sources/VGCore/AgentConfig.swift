// Static configuration for the agent and its workers.

import Foundation

/// Filesystem and network configuration for the daemon.
public struct AgentConfig: Sendable, Equatable {
    /// Unix socket the engine (`pe-engined`) listens on.
    public var engineSocketPath: String
    /// Path to the agent's SQLite store.
    public var databasePath: String
    /// Directory holding the shared identity (`~/.vguardrail`).
    public var identityDirectory: URL
    /// Mach service name vended over XPC.
    public var xpcMachServiceName: String
    /// Base URL of the audit backend (`POST {base}/events/batch`).
    public var uploadBaseURL: URL?
    /// Path to a signed policy bundle the FilePolicySource pushes to the engine.
    public var policyBundlePath: String
    /// Detector/evaluation deadline hint forwarded to the engine (informational).
    public var requestTimeoutMillis: Int
    /// Upload batch size.
    public var uploadBatchSize: Int
    /// Max upload attempts before an event is marked dead.
    public var maxUploadAttempts: Int
    /// Base backoff for failed uploads, in milliseconds.
    public var uploadBackoffBaseMillis: Int64

    public init(
        engineSocketPath: String = "/var/run/vguardrail/policy.sock",
        databasePath: String = "/var/db/vguardrail/agent.db",
        identityDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".vguardrail"),
        xpcMachServiceName: String = "com.vguardrail.agent.xpc",
        uploadBaseURL: URL? = nil,
        policyBundlePath: String = "/var/db/vguardrail/policy.bundle.json",
        requestTimeoutMillis: Int = 2000,
        uploadBatchSize: Int = 100,
        maxUploadAttempts: Int = 8,
        uploadBackoffBaseMillis: Int64 = 1000
    ) {
        self.engineSocketPath = engineSocketPath
        self.databasePath = databasePath
        self.identityDirectory = identityDirectory
        self.xpcMachServiceName = xpcMachServiceName
        self.uploadBaseURL = uploadBaseURL
        self.policyBundlePath = policyBundlePath
        self.requestTimeoutMillis = requestTimeoutMillis
        self.uploadBatchSize = uploadBatchSize
        self.maxUploadAttempts = maxUploadAttempts
        self.uploadBackoffBaseMillis = uploadBackoffBaseMillis
    }
}
