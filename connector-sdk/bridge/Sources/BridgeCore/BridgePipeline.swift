// The full protocol stack for one request, minus IO: parse → validate version →
// dispatch (with timeout) → build the reply envelope. Returns the un-framed
// reply envelope bytes, or `nil` when the request cannot be correlated and must
// be dropped. Pure and deterministic, so the entire protocol behaviour is
// testable without stdio or a daemon.

import Foundation

public struct BridgePipeline: Sendable {
    private let dispatcher: Dispatcher
    private let timeoutMs: Int

    public init(dispatcher: Dispatcher, timeoutMs: Int) {
        self.dispatcher = dispatcher
        self.timeoutMs = timeoutMs
    }

    /// Produces the reply envelope (un-framed JSON) for one inbound frame body,
    /// or `nil` if the frame is malformed with no recoverable `id` (drop it).
    public func reply(toRequestBody body: Data) async -> Data? {
        switch Envelope.parseRequest(body) {
        case .malformed(let id):
            guard let id else { return nil }
            return Envelope.errorEnvelope(id: id, code: .validation, message: "malformed request")

        case .ok(let request):
            if let version = request.version, version != BridgeProtocol.version {
                return Envelope.errorEnvelope(
                    id: request.id,
                    code: .versionMismatch,
                    message: "unsupported protocol version \(version)"
                )
            }
            do {
                let dispatcher = self.dispatcher
                let method = request.method
                let params = request.paramsData
                let resultBody = try await withTimeout(milliseconds: timeoutMs) {
                    try await dispatcher.handle(method: method, paramsData: params)
                }
                do {
                    return try Envelope.successEnvelope(id: request.id, resultBody: resultBody)
                } catch {
                    // The result couldn't be embedded (e.g. not valid JSON). This
                    // is an internal fault, not the client's; report it safely.
                    return Envelope.errorEnvelope(id: request.id, code: .transport, message: "failed to encode reply")
                }
            } catch let error as BridgeError {
                return Envelope.errorEnvelope(id: request.id, code: error.code, message: error.message)
            } catch {
                return Envelope.errorEnvelope(id: request.id, code: .transport, message: "internal error")
            }
        }
    }
}
