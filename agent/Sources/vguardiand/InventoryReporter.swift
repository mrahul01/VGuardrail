// Device inventory: running processes/apps and installed browser extensions,
// reported to the backend so the dashboard's device-detail page can show what
// is active on the machine.
//
// Processes are read in-process via libproc (proc_listallpids + proc_pidinfo
// PROC_PIDTBSDINFO for start time/uid, proc_pidpath for the executable, and
// sysctl KERN_PROCARGS2 for the full command line) — no `ps` parsing. Command
// lines of other users' processes are only readable as root (the daemon's
// production context); otherwise the field is omitted. Sizes are capped so a
// runaway process table cannot bloat the upload.

import Darwin
import Foundation
import VGAgentCore

struct InventoryReporter {
    /// Wire shape: must match the backend's `DeviceProcess` (snake_case).
    struct ProcessEntry: Encodable {
        let pid: UInt32
        let name: String
        let user: String?
        let started_at_ms: Int64?
        let is_app: Bool
        let command: String?
        /// AI classification (ai_ide / ai_cli / ai_desktop / browser); nil
        /// for non-AI processes.
        let ai_category: String?
        /// "running" | "installed" (installed = catalog software found on
        /// disk but not currently running; reported with pid 0).
        let status: String
    }

    /// Wire shape: must match the backend's `BrowserExtension` (snake_case).
    struct ExtensionEntry: Encodable {
        let browser: String
        let extension_id: String?
        let name: String
        let version: String?
    }

    struct Snapshot: Encodable {
        let device_id: String
        let collected_at_ms: Int64
        let processes: [ProcessEntry]
        let extensions: [ExtensionEntry]
    }

    static let maxProcesses = 300
    static let maxExtensions = 100
    static let maxInstalled = 100
    static let maxCommandLength = 400

    // MARK: - Collection

    static func collect(deviceID: String, consoleUser: String?) -> Snapshot {
        let running = Array(collectProcesses().prefix(maxProcesses))
        return Snapshot(
            device_id: deviceID,
            collected_at_ms: Int64(Date().timeIntervalSince1970 * 1000),
            processes: running + installedEntries(consoleUser: consoleUser, running: running),
            extensions: Array(collectExtensions(consoleUser: consoleUser).prefix(maxExtensions))
        )
    }

    /// Running processes via libproc. AI-tagged items sort first (so the cap
    /// never trims them), then GUI apps, then background noise.
    static func collectProcesses() -> [ProcessEntry] {
        var entries = allPids().compactMap(processEntry(pid:))
        entries.sort {
            let aiA = $0.ai_category != nil
            let aiB = $1.ai_category != nil
            if aiA != aiB { return aiA }
            if $0.is_app != $1.is_app { return $0.is_app }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        return entries
    }

    /// Installed-but-not-running AI software, deduplicated against running
    /// AI processes by (category, name).
    static func installedEntries(consoleUser: String?, running: [ProcessEntry]) -> [ProcessEntry] {
        let active = Set(
            running.compactMap { entry in
                entry.ai_category.map { "\($0)|\(entry.name.lowercased())" }
            }
        )
        return AICatalog.installedItems(consoleUser: consoleUser)
            .filter { !active.contains("\($0.category)|\($0.name.lowercased())") }
            .prefix(maxInstalled)
            .map { item in
                ProcessEntry(
                    pid: 0,
                    name: item.name,
                    user: nil,
                    started_at_ms: nil,
                    is_app: item.path.hasSuffix(".app"),
                    command: item.path,
                    ai_category: item.category,
                    status: "installed"
                )
            }
    }

    private static func allPids() -> [pid_t] {
        // First call sizes the buffer; headroom covers processes spawned between
        // the two calls.
        let estimate = proc_listallpids(nil, 0)
        guard estimate > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(estimate) + 64)
        let bytes = Int32(pids.count * MemoryLayout<pid_t>.size)
        let filled = proc_listallpids(&pids, bytes)
        guard filled > 0 else { return [] }
        return Array(pids.prefix(Int(filled))).filter { $0 > 0 }
    }

    /// Detailed info for one pid: PROC_PIDTBSDINFO carries start time and uid,
    /// proc_pidpath the executable, KERN_PROCARGS2 the full command line.
    static func processEntry(pid: pid_t) -> ProcessEntry? {
        var info = proc_bsdinfo()
        let size = Int32(MemoryLayout<proc_bsdinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else { return nil }
        guard info.pbi_status != UInt32(SZOMB) else { return nil }

        let path = executablePath(pid: pid)
        let command = commandLine(pid: pid)
        let startedMs =
            info.pbi_start_tvsec > 0
            ? Int64(info.pbi_start_tvsec) * 1000 + Int64(info.pbi_start_tvusec) / 1000
            : nil
        let name = displayName(path: path, fallback: shortName(pid: pid) ?? "pid \(pid)")
        return ProcessEntry(
            pid: UInt32(pid),
            name: name,
            user: userName(uid: info.pbi_uid),
            started_at_ms: startedMs,
            is_app: (path ?? command ?? "").contains(".app/"),
            command: command ?? path,
            ai_category: AICatalog.classify(name: name, path: path, command: command),
            status: "running"
        )
    }

    private static func executablePath(pid: pid_t) -> String? {
        // PROC_PIDPATHINFO_MAXSIZE (4 * MAXPATHLEN) is a macro Swift can't see.
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        return String(cString: buffer)
    }

    private static func shortName(pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: 2 * Int(MAXCOMLEN) + 1)
        guard proc_name(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        return String(cString: buffer)
    }

    /// Full command line via sysctl KERN_PROCARGS2. Layout: argc, exec path,
    /// NUL padding, then argc NUL-terminated argv strings. Readable for own
    /// processes (all processes when running as root); nil otherwise.
    static func commandLine(pid: pid_t) -> String? {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else {
            return nil
        }
        var buffer = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buffer, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else {
            return nil
        }
        let argc = buffer.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
        guard argc > 0 else { return nil }
        var idx = MemoryLayout<Int32>.size
        while idx < size, buffer[idx] != 0 { idx += 1 }  // skip exec path
        while idx < size, buffer[idx] == 0 { idx += 1 }  // skip padding
        var args: [String] = []
        var current: [UInt8] = []
        while idx < size, args.count < Int(argc) {
            if buffer[idx] == 0 {
                args.append(String(decoding: current, as: UTF8.self))
                current.removeAll(keepingCapacity: true)
            } else {
                current.append(buffer[idx])
            }
            idx += 1
        }
        let joined = args.joined(separator: " ")
        guard !joined.isEmpty else { return nil }
        return String(joined.prefix(maxCommandLength))
    }

    private static func userName(uid: uid_t) -> String? {
        guard let pw = getpwuid(uid) else { return nil }
        return String(cString: pw.pointee.pw_name)
    }

    /// For an app bundle path, the bundle name reads better than the binary
    /// ("Safari" instead of "Safari.app/Contents/MacOS/Safari").
    static func displayName(path: String?, fallback: String) -> String {
        guard let path, !path.isEmpty else { return fallback }
        if let range = path.range(of: ".app/") {
            let bundleName = (String(path[..<range.lowerBound]) as NSString).lastPathComponent
            if !bundleName.isEmpty { return bundleName }
        }
        let name = (path as NSString).lastPathComponent
        return name.isEmpty ? fallback : name
    }

    // MARK: - Browser extensions

    /// Scans the console user's browser profiles. The daemon runs as root, so
    /// the home directory comes from the console user, not the process.
    static func collectExtensions(consoleUser: String?) -> [ExtensionEntry] {
        let home: String
        if let user = consoleUser, !user.isEmpty {
            home = "/Users/\(user)"
        } else {
            home = NSHomeDirectory()
        }
        let support = "\(home)/Library/Application Support"
        var out: [ExtensionEntry] = []
        out += chromiumExtensions(profileRoot: "\(support)/Google/Chrome", browser: "chrome")
        out += chromiumExtensions(profileRoot: "\(support)/Microsoft Edge", browser: "edge")
        out += chromiumExtensions(
            profileRoot: "\(support)/BraveSoftware/Brave-Browser", browser: "brave")
        out += firefoxExtensions(profileRoot: "\(support)/Firefox/Profiles")
        return out
    }

    /// Chromium layout: <root>/<profile>/Extensions/<ext-id>/<version>/manifest.json
    static func chromiumExtensions(profileRoot: String, browser: String) -> [ExtensionEntry] {
        let fm = FileManager.default
        guard let profiles = try? fm.contentsOfDirectory(atPath: profileRoot) else { return [] }
        var seen = Set<String>()
        var out: [ExtensionEntry] = []
        for profile in profiles {
            let extensionsDir = "\(profileRoot)/\(profile)/Extensions"
            guard let extIDs = try? fm.contentsOfDirectory(atPath: extensionsDir) else { continue }
            for extID in extIDs where !seen.contains(extID) {
                let versionsDir = "\(extensionsDir)/\(extID)"
                guard let versions = try? fm.contentsOfDirectory(atPath: versionsDir),
                      let version = versions.sorted().last
                else { continue }
                let manifestDir = "\(versionsDir)/\(version)"
                guard
                    let manifest = readJSON(atPath: "\(manifestDir)/manifest.json")
                else { continue }
                seen.insert(extID)
                out.append(ExtensionEntry(
                    browser: browser,
                    extension_id: extID,
                    name: manifestName(manifest, manifestDir: manifestDir) ?? extID,
                    version: manifest["version"] as? String
                ))
            }
        }
        return out
    }

    /// Resolves `__MSG_*__` placeholder names via the extension's locale table.
    static func manifestName(_ manifest: [String: Any], manifestDir: String) -> String? {
        guard let raw = manifest["name"] as? String else { return nil }
        guard raw.hasPrefix("__MSG_"), raw.hasSuffix("__") else { return raw }
        let key = String(raw.dropFirst("__MSG_".count).dropLast(2))
        let locale = (manifest["default_locale"] as? String) ?? "en"
        guard
            let messages = readJSON(atPath: "\(manifestDir)/_locales/\(locale)/messages.json")
        else { return raw }
        // Message keys are case-insensitive per the Chrome i18n spec.
        for (msgKey, value) in messages where msgKey.lowercased() == key.lowercased() {
            if let entry = value as? [String: Any], let message = entry["message"] as? String {
                return message
            }
        }
        return raw
    }

    /// Firefox keeps an extension registry per profile in extensions.json.
    static func firefoxExtensions(profileRoot: String) -> [ExtensionEntry] {
        let fm = FileManager.default
        guard let profiles = try? fm.contentsOfDirectory(atPath: profileRoot) else { return [] }
        var seen = Set<String>()
        var out: [ExtensionEntry] = []
        for profile in profiles {
            guard
                let registry = readJSON(atPath: "\(profileRoot)/\(profile)/extensions.json"),
                let addons = registry["addons"] as? [[String: Any]]
            else { continue }
            for addon in addons {
                guard let id = addon["id"] as? String, !seen.contains(id) else { continue }
                // Skip built-in system addons; report user-visible extensions.
                if (addon["location"] as? String) == "app-system-defaults" { continue }
                seen.insert(id)
                let name = ((addon["defaultLocale"] as? [String: Any])?["name"] as? String)
                out.append(ExtensionEntry(
                    browser: "firefox",
                    extension_id: id,
                    name: name ?? id,
                    version: addon["version"] as? String
                ))
            }
        }
        return out
    }

    // MARK: - Upload

    /// POSTs the snapshot to `{base}/devices/inventory`. Best-effort: failures
    /// are logged and retried on the next cycle; inventory never blocks the
    /// enforcement path.
    static func report(baseURL: URL, deviceID: String, authorization: String?) async {
        let facts = DeviceFacts.collect()
        let snapshot = collect(deviceID: deviceID, consoleUser: facts.consoleUser)
        guard let body = try? JSONEncoder().encode(snapshot) else { return }

        var request = URLRequest(url: baseURL.appendingPathComponent("devices/inventory"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(deviceID, forHTTPHeaderField: "x-device-id")
        if let authorization {
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            if !(200..<300).contains(status) {
                log("inventory upload failed: HTTP \(status)")
            }
        } catch {
            log("inventory upload failed: \(error)")
        }
    }

    private static func log(_ message: String) {
        FileHandle.standardError.write(Data("vguardiand: \(message)\n".utf8))
    }

    /// Reads and parses a JSON object file, or nil on any failure.
    private static func readJSON(atPath path: String) -> [String: Any]? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}
