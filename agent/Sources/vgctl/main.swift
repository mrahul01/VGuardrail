// vgctl — a developer CLI that drives the agent daemon over XPC. It is the MVP
// prompt-submission path (future browser/IDE/CLI connectors use the same XPC
// entry point) and a handy way to inspect agent status from a script.
//
// Usage:
//   vgctl status
//   vgctl scan "<prompt text>" [--provider <name>] [--app <name>]
//   vgctl recent [<limit>]
//   vgctl ack <eventID> <accept|reject>

import Foundation
import VGCore
import VGXPCProtocol
import VGOCRExtractor

func printJSON(_ value: some Encodable) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(value), let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

func usage() -> Never {
    FileHandle.standardError.write(Data("""
    usage:
      vgctl status
      vgctl scan "<prompt>" [--provider <name>] [--app <name>]
      vgctl scan-image <path> [--provider <name>] [--app <name>]
      vgctl recent [<limit>]
      vgctl ack <eventID> <accept|reject>

    Set VG_MACH_SERVICE to override the service name (default com.vguardrail.agent.xpc).

    """.utf8))
    exit(2)
}

func optionValue(_ name: String, in args: [String]) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { usage() }

let serviceName = ProcessInfo.processInfo.environment["VG_MACH_SERVICE"] ?? agentXPCMachServiceName
let client = AgentXPCClient(machServiceName: serviceName)

do {
    switch command {
    case "status":
        printJSON(try await client.status())

    case "scan":
        guard args.count >= 2 else { usage() }
        let request = ScanRequest(
            text: args[1],
            context: ScanContext(
                source: .cli,
                provider: optionValue("--provider", in: args) ?? "openai",
                app: optionValue("--app", in: args) ?? "vgctl",
                user: UserContext(userID: NSUserName())
            )
        )
        let decision = try await client.submitScan(request)
        printJSON(decision)
        // Exit non-zero on a block so scripts can gate on it.
        if decision.action == .block { exit(1) }

    case "scan-image":
        // OCR an image with Apple Vision, then scan the recognized text through
        // the same engine path — a screenshot of an API key is caught here.
        guard args.count >= 2 else { usage() }
        let imageURL = URL(fileURLWithPath: args[1])
        let recognized: String
        do {
            recognized = try await OCRExtractor.extractText(from: imageURL)
        } catch {
            FileHandle.standardError.write(Data("vgctl: \(error)\n".utf8))
            exit(1)
        }
        if recognized.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            FileHandle.standardError.write(Data("vgctl: no text recognized in \(args[1])\n".utf8))
            exit(0)
        }
        let request = ScanRequest(
            text: recognized,
            context: ScanContext(
                source: .cli,
                provider: optionValue("--provider", in: args) ?? "vision",
                app: optionValue("--app", in: args) ?? "ocr",
                user: UserContext(userID: NSUserName())
            )
        )
        let decision = try await client.submitScan(request)
        printJSON(decision)
        if decision.action == .block { exit(1) }

    case "recent":
        let limit = args.count >= 2 ? (Int(args[1]) ?? 20) : 20
        printJSON(try await client.recentDecisions(limit: limit))

    case "ack":
        guard args.count >= 3, let accepted = ["accept": true, "reject": false][args[2]] else { usage() }
        let ok = try await client.acknowledgeWarning(eventID: args[1], accepted: accepted)
        print(ok ? "ok" : "failed")

    default:
        usage()
    }
} catch {
    FileHandle.standardError.write(Data("vgctl: \(error)\n".utf8))
    exit(1)
}
