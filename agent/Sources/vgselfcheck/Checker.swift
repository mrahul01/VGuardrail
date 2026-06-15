// A tiny assertion harness for runtime verification under the Command Line Tools
// (where `swift test` cannot execute test bundles). `vgselfcheck` exercises the
// critical paths of each module and exits non-zero on any failure, so it can gate
// CI on machines without full Xcode and serve as a developer smoke test.

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

    func expectNoThrow(_ message: String, _ body: () throws -> Void) {
        do {
            try body()
            passes += 1
            print("  ok   \(message)")
        } catch {
            failures += 1
            print("  FAIL \(message): \(error)")
        }
    }

    func finish() -> Never {
        print("\n\(failures == 0 ? "ALL PASS" : "FAILURES") — \(passes) passed, \(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }
}
