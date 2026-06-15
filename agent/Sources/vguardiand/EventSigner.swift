// Ed25519 signing of audit events, using CryptoKit (no external dependency).
//
// The private key is persisted under the identity directory with 0600 perms. In
// production this should live in the macOS Keychain; the file form is the MVP.

import CryptoKit
import Foundation

enum EventSigner {
    /// Loads (or creates) the signing key and returns a Sendable signing closure
    /// that produces `"ed25519:<base64>"` over the payload.
    static func makeSigner(directory: URL) throws -> @Sendable (Data) -> String {
        let keyData = try loadOrCreateKey(directory: directory)
        return { payload in
            guard let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: keyData),
                  let signature = try? key.signature(for: payload) else {
                return "" // signing should never fail; an empty sig is rejected by the backend
            }
            return "ed25519:" + signature.base64EncodedString()
        }
    }

    private static func loadOrCreateKey(directory: URL) throws -> Data {
        let file = directory.appendingPathComponent("event_signing.key")
        if let data = try? Data(contentsOf: file),
           (try? Curve25519.Signing.PrivateKey(rawRepresentation: data)) != nil {
            return data
        }
        let key = Curve25519.Signing.PrivateKey()
        let raw = key.rawRepresentation
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]
        )
        try raw.write(to: file, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return raw
    }
}
