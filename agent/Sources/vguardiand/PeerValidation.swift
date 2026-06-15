// Validates that an XPC peer is a trusted, correctly-signed first-party client
// before the daemon accepts its connection.
//
// Fail-closed: without a configured code requirement (and without the explicit
// dev bypass), connections are rejected.

import Foundation
import Security

enum PeerValidation {
    /// Whether `connection` should be allowed to connect.
    ///
    /// - `allowUnsigned`: dev bypass (VG_XPC_ALLOW_UNSIGNED=1).
    /// - `requirementString`: a code-signing requirement (e.g. a Designated
    ///   Requirement or `anchor apple generic and certificate leaf[subject.OU] = "<TEAMID>"`).
    ///   Supplied at install time via VG_XPC_REQUIREMENT.
    static func isTrusted(
        connection: NSXPCConnection,
        allowUnsigned: Bool,
        requirementString: String?
    ) -> Bool {
        if allowUnsigned { return true }
        guard let requirementString else { return false } // fail-closed

        let pid = connection.processIdentifier
        let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary

        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
              let code else {
            return false
        }

        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(requirementString as CFString, [], &requirement) == errSecSuccess,
              let requirement else {
            return false
        }

        return SecCodeCheckValidity(code, [], requirement) == errSecSuccess
    }
}
