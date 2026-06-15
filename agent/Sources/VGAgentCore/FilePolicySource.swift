// A PolicySource that reads a signed bundle from disk (MVP).
//
// A CloudPolicySource (GET /policies/latest via Cognito) is a future drop-in
// behind the same protocol; the engine performs all signature/anti-rollback
// verification regardless of source.

import Foundation

public struct FilePolicySource: PolicySource {
    private let path: String

    public init(path: String) {
        self.path = path
    }

    public func currentBundle() async throws -> Data? {
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        return try Data(contentsOf: URL(fileURLWithPath: path))
    }
}
