// ScanSelectionCommand — "Scan Selection with VGuardrail" in Xcode's
// Editor → VGuardrail menu.
//
// Joins the lines covered by the current selection(s) — or the whole buffer
// when nothing is selected — and evaluates them via XPCScanClient (direct XPC
// to vguardiand, 5 s timeout, fail-closed).
//
// UI semantics (important): Xcode Source Editor Extensions CANNOT present any
// UI of their own — no panels, no notifications. The only feedback channel is
// the command's completion handler:
//   - ALLOW  → completionHandler(nil): the command succeeds silently.
//   - WARN / BLOCK / engine unreachable → completionHandler(NSError) whose
//     localizedDescription carries the decision + reason; Xcode surfaces it
//     as an alert sheet ("The operation couldn't be completed…").
// There is no "Proceed anyway" affordance for WARN here — the extension can't
// ask. A WARN therefore reads as a failed command with the warning text;
// users who accept the risk can still copy the text manually. Documented in
// the README.
//
// Whole-buffer scans are capped at 256 KiB (matching the other IDE
// connectors); beyond the cap the command completes with an explanatory
// error instead of scanning. An explicit selection is never capped.
//
// The file is guarded with #if canImport(XcodeKit): the XcodeKit framework
// ships inside Xcode.app, not in the Command Line Tools SDK, so syntax
// verification with `xcrun swiftc -parse` works everywhere while full
// type-checking requires Xcode.

#if canImport(XcodeKit)

import Foundation
import XcodeKit

final class ScanSelectionCommand: NSObject, XCSourceEditorCommand {

    static let errorDomain = "com.vguardrail.xcode-connector"
    /// Same cap as the VS Code / JetBrains connectors (whole-buffer scans only).
    static let maxBufferBytes = 256 * 1024

    func perform(
        with invocation: XCSourceEditorCommandInvocation,
        completionHandler: @escaping (Error?) -> Void
    ) {
        let buffer = invocation.buffer
        let text: String
        if let selected = Self.selectedText(in: buffer) {
            text = selected
        } else {
            let whole = buffer.completeBuffer
            guard whole.utf8.count <= Self.maxBufferBytes else {
                completionHandler(Self.error(
                    code: 3,
                    message: "VGuardrail: scan skipped — no selection and this file exceeds "
                        + "the 256 KiB whole-buffer cap. Select the region to scan."
                ))
                return
            }
            text = whole
        }

        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            completionHandler(Self.error(code: 4, message: "VGuardrail: nothing to scan."))
            return
        }

        // XPCScanClient always calls back exactly once within its 5 s
        // deadline, so the command cannot hang Xcode.
        XPCScanClient().scan(text: text, fileName: nil) { verdict in
            switch verdict.action {
            case .allow:
                completionHandler(nil)
            case .warn:
                completionHandler(Self.decisionError(prefix: "VGuardrail WARN", verdict: verdict, code: 1))
            case .block:
                completionHandler(Self.decisionError(prefix: "VGuardrail BLOCK", verdict: verdict, code: 2))
            }
        }
    }

    // ── selection extraction ───────────────────────────────────────────────

    /// Joins the full lines covered by every non-empty selection range.
    /// Returns nil when there is no real selection (carets only), in which
    /// case the caller falls back to the whole buffer.
    static func selectedText(in buffer: XCSourceTextBuffer) -> String? {
        let lines = buffer.lines.compactMap { $0 as? String }
        var pieces: [String] = []

        for case let range as XCSourceTextRange in buffer.selections {
            // A zero-length range is just the caret, not a selection.
            if range.start.line == range.end.line && range.start.column == range.end.column {
                continue
            }
            var lastLine = range.end.line
            // `end.column == 0` means the selection stops at the start of
            // `end.line`; that line carries no selected characters.
            if range.end.column == 0 && range.end.line > range.start.line {
                lastLine -= 1
            }
            guard range.start.line < lines.count else { continue }
            let upper = min(lastLine, lines.count - 1)
            for index in range.start.line...upper {
                pieces.append(lines[index])
            }
        }

        let joined = pieces.joined()
        return joined.isEmpty ? nil : joined
    }

    // ── errors (Xcode renders localizedDescription as an alert) ───────────

    private static func decisionError(prefix: String, verdict: ScanVerdict, code: Int) -> NSError {
        var message = prefix
        if verdict.fromFallback {
            message += " — \(verdict.reason.isEmpty ? XPCScanClient.engineUnavailableReason : verdict.reason)"
        } else {
            message += " — \(verdict.reason.isEmpty ? "rejected by policy" : verdict.reason)"
            if !verdict.categories.isEmpty {
                message += " [\(verdict.categories.joined(separator: ", "))]"
            }
        }
        return error(code: code, message: message)
    }

    private static func error(code: Int, message: String) -> NSError {
        NSError(
            domain: errorDomain,
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}

#endif
