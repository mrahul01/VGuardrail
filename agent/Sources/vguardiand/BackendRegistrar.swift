// Registers this device with the Audit Cloud so it appears in the dashboard's
// device list with its quick facts (hostname, model, OS, user). The server
// derives the IP itself — a client-claimed address would be spoofable.

import Foundation

struct BackendRegistrar {
    /// Wire shape: must match the backend's `DeviceRegistrationRequest`.
    private struct RegistrationRequest: Encodable {
        let device_id: String
        let hostname: String
        let platform: String
        let agent_version: String
        let model: String?
        let os_version: String?
        let username: String?
        let hostname_full: String?
    }

    /// POSTs `{base}/devices/register`. Best-effort: registration repeats on
    /// every daemon start, so a transient failure self-heals.
    @discardableResult
    static func register(
        baseURL: URL, deviceID: String, agentVersion: String, facts: DeviceFacts,
        enrollmentToken: String?
    ) async -> Bool {
        let body = RegistrationRequest(
            device_id: deviceID,
            hostname: facts.displayName,
            platform: platformString(),
            agent_version: agentVersion,
            model: facts.model,
            os_version: facts.osVersion,
            username: facts.consoleUser,
            hostname_full: facts.hostname
        )
        guard let payload = try? JSONEncoder().encode(body) else { return false }

        var request = URLRequest(url: baseURL.appendingPathComponent("devices/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let enrollmentToken {
            request.setValue(enrollmentToken, forHTTPHeaderField: "x-enrollment-token")
        }
        request.httpBody = payload
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            guard (200..<300).contains(status) else {
                log("device registration failed: HTTP \(status)")
                return false
            }
            return true
        } catch {
            log("device registration failed: \(error)")
            return false
        }
    }

    private static func platformString() -> String {
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        return "macos/\(machine) (vguardiand)"
    }

    private static func log(_ message: String) {
        FileHandle.standardError.write(Data("vguardiand: \(message)\n".utf8))
    }
}
