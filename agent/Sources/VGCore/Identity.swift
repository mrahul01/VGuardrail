// Device identity, persisted to the shared ~/.vguardrail directory so all
// VGuardrail clients on the host agree on a device id.

import Foundation

/// Stable identity of this device/agent install.
public struct DeviceIdentity: Codable, Sendable, Equatable {
    public var deviceID: String
    public var hostname: String
    public var agentVersion: String

    public init(deviceID: String, hostname: String, agentVersion: String) {
        self.deviceID = deviceID
        self.hostname = hostname
        self.agentVersion = agentVersion
    }

    private enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case hostname
        case agentVersion = "agent_version"
    }
}

/// Errors loading or persisting identity.
public enum IdentityError: Error, Equatable {
    case write(String)
}

/// Loads, or creates and persists, the device identity in `directory`.
public enum IdentityStore {
    /// Returns the identity at `directory/identity.json`, creating it (with a new
    /// UUIDv7 device id) if absent. `agentVersion` always reflects this build.
    public static func loadOrCreate(
        directory: URL,
        hostname: String,
        agentVersion: String,
        newDeviceID: () -> String = { UUIDv7.generate() }
    ) throws -> DeviceIdentity {
        let fm = FileManager.default
        let file = directory.appendingPathComponent("identity.json")

        if let data = try? Data(contentsOf: file),
           var existing = try? JSONDecoder().decode(DeviceIdentity.self, from: data) {
            // Keep the persisted device id; refresh version/hostname for this run.
            if existing.agentVersion != agentVersion || existing.hostname != hostname {
                existing.agentVersion = agentVersion
                existing.hostname = hostname
                try persist(existing, to: file, directory: directory, fm: fm)
            }
            return existing
        }

        let created = DeviceIdentity(
            deviceID: newDeviceID(),
            hostname: hostname,
            agentVersion: agentVersion
        )
        try persist(created, to: file, directory: directory, fm: fm)
        return created
    }

    private static func persist(
        _ identity: DeviceIdentity,
        to file: URL,
        directory: URL,
        fm: FileManager
    ) throws {
        do {
            try fm.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            // Tighten even if the directory pre-existed with looser perms.
            try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
            let data = try encoder.encode(identity)
            try data.write(to: file, options: [.atomic])
            // Restrict to the owner (identity is host-scoped, not a secret, but
            // should not be world-writable).
            try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        } catch {
            throw IdentityError.write(error.localizedDescription)
        }
    }
}
