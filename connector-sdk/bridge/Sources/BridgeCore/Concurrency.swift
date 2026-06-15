// Timeout protection for a single in-flight request. Races the operation against
// a deadline; on expiry the operation Task is cancelled and a `BridgeError`
// (code TIMEOUT) is thrown. This protects the bridge from a hung daemon — the
// slot is released and an error reply is sent regardless of whether XPC ever
// answers.

import Foundation

/// Runs `operation` with a millisecond deadline. Returns its value, or throws
/// `BridgeError(.timeout)` if the deadline elapses first.
public func withTimeout<T: Sendable>(
    milliseconds: Int,
    _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    if milliseconds <= 0 {
        return try await operation()
    }
    return try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            try await operation()
        }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(milliseconds) * 1_000_000)
            throw BridgeError(code: .timeout, message: "request timed out")
        }
        do {
            guard let result = try await group.next() else {
                throw BridgeError(code: .timeout, message: "request produced no result")
            }
            group.cancelAll()
            return result
        } catch {
            group.cancelAll()
            throw error
        }
    }
}
