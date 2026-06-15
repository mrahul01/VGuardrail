// Device quick facts collected at daemon startup: the user-visible computer
// name, hardware model, OS version, and the console (logged-in) user. These
// feed device registration so the dashboard shows a real machine name instead
// of a raw mDNS hostname, plus the at-a-glance details an admin needs.
//
// Everything here is best-effort and privacy-bounded: no location, no serial
// numbers, no MAC addresses.

import Foundation
import SystemConfiguration

struct DeviceFacts: Sendable {
    /// User-visible computer name ("Apple's MacBook Pro"), when readable.
    let computerName: String?
    /// mDNS/BSD hostname ("Apples-MacBook-Pro.local").
    let hostname: String
    /// Hardware model identifier, e.g. "MacBookPro18,3".
    let model: String?
    /// OS version, e.g. "macOS 15.5 (Build 24F74)".
    let osVersion: String
    /// User logged in at the console (the daemon itself runs as root).
    let consoleUser: String?

    /// The name shown to admins: prefer the friendly computer name.
    var displayName: String {
        computerName ?? hostname
    }

    static func collect() -> DeviceFacts {
        DeviceFacts(
            computerName: SCDynamicStoreCopyComputerName(nil, nil) as String?,
            hostname: ProcessInfo.processInfo.hostName,
            model: sysctlString("hw.model"),
            osVersion: "macOS " + ProcessInfo.processInfo.operatingSystemVersionString
                .replacingOccurrences(of: "Version ", with: ""),
            consoleUser: currentConsoleUser()
        )
    }

    private static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        return String(cString: buffer)
    }

    /// The console user via SCDynamicStore; `loginwindow`/root states map to nil.
    private static func currentConsoleUser() -> String? {
        var uid: uid_t = 0
        var gid: gid_t = 0
        guard let name = SCDynamicStoreCopyConsoleUser(nil, &uid, &gid) as String? else {
            return nil
        }
        if name.isEmpty || name == "loginwindow" || name == "root" {
            return nil
        }
        return name
    }
}
