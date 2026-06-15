// Orchestrates the IO loop: a dedicated reader thread deframes stdin and hands
// each request to a bounded pool of handler Tasks; replies are serialized by a
// FrameWriter actor. Back-pressure is intrinsic — the reader blocks on a
// counting semaphore when `maxInFlight` requests are outstanding, which stops
// draining stdin and lets the OS pipe back-pressure the SDK. Shutdown is
// graceful on EOF (and on an unrecoverable stream error or a broken stdout).

import Foundation

/// A small thread-safe boolean used to signal shutdown across the reader thread
/// and the handler Tasks.
private final class AtomicFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var value = false
    func set() { lock.lock(); value = true; lock.unlock() }
    var isSet: Bool { lock.lock(); defer { lock.unlock() }; return value }
}

public struct BridgeRunner: Sendable {
    public init() {}

    /// Runs until stdin reaches EOF (or an unrecoverable error), draining
    /// in-flight handlers before returning.
    ///
    /// - Parameters:
    ///   - pipeline: the parse→dispatch→encode stack.
    ///   - inputFD: descriptor to read framed requests from (default stdin).
    ///   - outputFD: descriptor to write framed replies to (default stdout).
    ///   - maxInFlight: max concurrent handlers (bounds memory + provides back-pressure).
    public func run(
        pipeline: BridgePipeline,
        inputFD: Int32 = STDIN_FILENO,
        outputFD: Int32 = STDOUT_FILENO,
        maxInFlight: Int = 16
    ) async {
        let slotCount = max(1, maxInFlight)
        let slots = DispatchSemaphore(value: slotCount)
        let writer = FrameWriter(fileDescriptor: outputFD)
        let flag = AtomicFlag()

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let thread = Thread {
                // The decoder and read buffer are confined to this thread.
                let decoder = FrameDecoder()
                let bufferSize = 64 * 1024
                let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
                defer { buffer.deallocate() }

                readLoop: while !flag.isSet {
                    let n = read(inputFD, buffer, bufferSize)
                    if n == 0 { break } // EOF — graceful shutdown
                    if n < 0 {
                        if errno == EINTR { continue }
                        BridgeLog.warn("stdin read error (errno \(errno)); shutting down")
                        break
                    }

                    let chunk = Data(bytes: buffer, count: n)
                    let frames: [Data]
                    do {
                        frames = try decoder.push(chunk)
                    } catch {
                        // A corrupt/oversized length prefix desynchronizes the
                        // stream irrecoverably; stop rather than guess boundaries.
                        BridgeLog.warn("fatal frame stream error; shutting down")
                        break
                    }

                    for body in frames {
                        if flag.isSet { break readLoop }
                        // Back-pressure: blocks here (and thus stops reading stdin)
                        // once `maxInFlight` requests are outstanding.
                        slots.wait()
                        let requestBody = body
                        Task {
                            defer { slots.signal() }
                            guard let envelope = await pipeline.reply(toRequestBody: requestBody) else {
                                return // uncorrelatable frame — dropped
                            }
                            let frame: Data
                            do {
                                frame = try encodeFrame(envelope)
                            } catch {
                                BridgeLog.warn("reply exceeded frame cap; dropped")
                                return
                            }
                            do {
                                try await writer.write(frame)
                            } catch {
                                // stdout is gone; initiate shutdown.
                                flag.set()
                            }
                        }
                    }
                }

                // Drain: reclaim every permit, which can only happen once all
                // in-flight handlers have signalled completion (bounded by the
                // per-request timeout). Then restore the count: libdispatch traps
                // in `_dispatch_semaphore_dispose` if a semaphore is deallocated
                // with a value below the one it was created with.
                for _ in 0..<slotCount { slots.wait() }
                for _ in 0..<slotCount { slots.signal() }
                continuation.resume()
            }
            thread.name = "vguardrail-xpc-bridge.reader"
            thread.stackSize = 1 << 20
            thread.start()
        }
    }
}
