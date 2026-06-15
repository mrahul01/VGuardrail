// Curated catalog of AI-related software for the device inventory: AI IDEs,
// AI CLIs, desktop AI apps, and browsers (AI-web hosts — individual tabs are
// not enumerable from a daemon; the browser extension covers in-page detail).
//
// Matching is deliberately conservative: exact case-insensitive bundle/binary
// names plus a short unambiguous-substring allowlist, so `codesign` never
// matches "code" and the like. macOS has no per-app "stopped" state distinct
// from installed, so items are either "running" or "installed".

import Foundation

public enum AICatalog {
    public struct Entry: Sendable {
        let category: String
        let bundleNames: [String]
        let binaryNames: [String]
    }

    public static let entries: [Entry] = [
        Entry(
            category: "ai_ide",
            bundleNames: [
                "Cursor", "Windsurf", "Zed", "Visual Studio Code", "VSCodium",
                "Antigravity", "Antigravity IDE", "Trae", "Xcode",
                "IntelliJ IDEA", "IntelliJ IDEA CE", "PyCharm", "PyCharm CE",
                "WebStorm", "GoLand", "CLion", "RubyMine", "Rider", "DataGrip",
                "Android Studio", "Fleet",
            ],
            binaryNames: []
        ),
        Entry(
            category: "ai_cli",
            bundleNames: [],
            binaryNames: [
                "claude", "gemini", "codex", "aider", "ollama", "llama-server",
                "llama-cli", "mlx_lm.server", "mlx_lm.generate", "sgpt",
                "gh-copilot", "goose", "copilot", "opencode", "amp",
                "cursor-agent",
            ]
        ),
        Entry(
            category: "ai_desktop",
            bundleNames: [
                "ChatGPT", "Claude", "LM Studio", "Ollama", "Perplexity",
                "GitHub Copilot", "Msty", "Jan", "Raycast", "NotebookLM", "Dia",
            ],
            binaryNames: []
        ),
        Entry(
            category: "browser",
            bundleNames: [
                "Google Chrome", "Safari", "Microsoft Edge", "Brave Browser",
                "Firefox", "Arc", "Comet",
            ],
            binaryNames: []
        ),
    ]

    /// Unambiguous substrings matched against the full command line — catches
    /// Electron helper renames ("Cursor Helper (Renderer)") and `npx` launches.
    /// Keep entries specific enough that system tools can never contain them.
    private static let commandSubstrings: [(needle: String, category: String)] = [
        ("chatgpt", "ai_desktop"),
        ("copilot", "ai_cli"),
        ("ollama", "ai_cli"),
        ("aider", "ai_cli"),
        ("windsurf", "ai_ide"),
    ]

    /// Classifies one process. `name` is the display name (bundle name for
    /// apps), `path` the executable path, `command` the full command line.
    public static func classify(name: String, path: String?, command: String?) -> String? {
        let lowerName = name.lowercased()
        for entry in entries {
            for bundle in entry.bundleNames {
                let lowerBundle = bundle.lowercased()
                // Exact, or "Bundle Helper…" Electron helper convention.
                if lowerName == lowerBundle || lowerName.hasPrefix(lowerBundle + " ") {
                    return entry.category
                }
            }
            let basename = ((path ?? "") as NSString).lastPathComponent.lowercased()
            for binary in entry.binaryNames where basename == binary || lowerName == binary {
                return entry.category
            }
        }
        // vg-* wrappers are our own AI-CLI launchers.
        if lowerName.hasPrefix("vg-") { return "ai_cli" }
        if let command = command?.lowercased() {
            for (needle, category) in commandSubstrings where command.contains(needle) {
                return category
            }
        }
        return nil
    }

    /// Installed-but-not-running AI software: catalog apps found under the
    /// Applications folders plus catalog CLI binaries in a fixed directory
    /// list. Never derived from $PATH — the root daemon's PATH is minimal and
    /// unrelated to the console user's shell.
    public static func installedItems(consoleUser: String?) -> [(category: String, name: String, path: String)] {
        let fm = FileManager.default
        var out: [(String, String, String)] = []

        let home = consoleUser.map { "/Users/\($0)" }
        var appDirs = ["/Applications"]
        if let home { appDirs.append("\(home)/Applications") }
        for dir in appDirs {
            guard let items = try? fm.contentsOfDirectory(atPath: dir) else { continue }
            for item in items where item.hasSuffix(".app") {
                let name = String(item.dropLast(4))
                if let category = classifyBundleName(name) {
                    out.append((category, name, "\(dir)/\(item)"))
                }
            }
        }

        var binDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        if let home {
            binDirs.append("\(home)/.local/bin")
            binDirs.append("\(home)/bin")
        }
        let cliBinaries = entries.first(where: { $0.category == "ai_cli" })?.binaryNames ?? []
        for dir in binDirs {
            for binary in cliBinaries {
                let path = "\(dir)/\(binary)"
                if fm.isExecutableFile(atPath: path) {
                    out.append(("ai_cli", binary, path))
                }
            }
        }
        return out
    }

    private static func classifyBundleName(_ name: String) -> String? {
        let lower = name.lowercased()
        for entry in entries {
            for bundle in entry.bundleNames where bundle.lowercased() == lower {
                return entry.category
            }
        }
        return nil
    }
}
