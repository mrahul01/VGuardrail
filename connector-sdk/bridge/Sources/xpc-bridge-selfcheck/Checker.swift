// Tiny async assertion harness — the bridge's analogue of the agent's
// `vgselfcheck` Checker. Runs runtime verification under the Command Line Tools
// (which cannot execute swift-testing bundles) and exits non-zero on any failure.

import Foundation

final class Checker {
    private(set) var failures = 0
    private(set) var passes = 0

    func section(_ title: String) {
        print("\n== \(title) ==")
    }

    func expect(_ condition: Bool, _ message: String) {
        if condition {
            passes += 1
            print("  ok   \(message)")
        } else {
            failures += 1
            print("  FAIL \(message)")
        }
    }

    func expectThrows(_ message: String, _ body: () throws -> Void) {
        do {
            try body()
            failures += 1
            print("  FAIL \(message) (expected throw)")
        } catch {
            passes += 1
            print("  ok   \(message)")
        }
    }

    func finish() -> Never {
        print("\n\(failures == 0 ? "ALL PASS" : "FAILURES") — \(passes) passed, \(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }
}
