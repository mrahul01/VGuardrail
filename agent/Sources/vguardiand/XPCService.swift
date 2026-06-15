// The XPC listener delegate and the bridge that forwards AgentControl calls to
// the AgentCore actor.

import Foundation
import VGAgentCore
import VGCore
import VGOCRExtractor
import VGXPCProtocol

/// Wraps a non-Sendable value so it can be captured by a `Task`. XPC reply blocks
/// are invoked exactly once; this box documents that the crossing is sound.
struct SendableBox<T>: @unchecked Sendable {
    let value: T
}

/// The object exported over XPC; forwards to the actor-isolated core.
final class AgentControlBridge: NSObject, AgentControl {
    private let core: AgentCore

    init(core: AgentCore) {
        self.core = core
    }

    func submitScan(_ requestData: Data, withReply reply: @escaping (Data?, String?) -> Void) {
        let box = SendableBox(value: reply)
        let core = core
        Task {
            do {
                let request = try XPCCodec.decodeScanRequest(requestData)
                let decision = try await core.submitScan(request)
                box.value(try XPCCodec.encodeDecision(decision), nil)
            } catch let AgentError.engineUnavailable(detail) {
                // Tag engine-down so the connector fails closed *and* can report
                // "policy engine unavailable" rather than an opaque error.
                box.value(nil, XPCErrorWire.encodeUnavailable(detail))
            } catch {
                box.value(nil, String(describing: error))
            }
        }
    }

    func submitImageScan(_ imagePath: String, withReply reply: @escaping (Data?, String?) -> Void) {
        let box = SendableBox(value: reply)
        let core = core
        Task {
            do {
                // Vision text recognition is windowserver-free, so it generally
                // runs even from a LaunchDaemon; the vgctl (user-session) path is
                // the guaranteed one if a sandbox ever denies it here.
                let text = try await OCRExtractor.extractText(from: URL(fileURLWithPath: imagePath))
                let request = ScanRequest(
                    text: text,
                    context: ScanContext(
                        source: .cli, provider: "vision", app: "ocr",
                        user: UserContext(userID: NSUserName())
                    )
                )
                let decision = try await core.submitScan(request)
                box.value(try XPCCodec.encodeDecision(decision), nil)
            } catch let AgentError.engineUnavailable(detail) {
                box.value(nil, XPCErrorWire.encodeUnavailable(detail))
            } catch {
                box.value(nil, String(describing: error))
            }
        }
    }

    func getStatus(withReply reply: @escaping (Data) -> Void) {
        let box = SendableBox(value: reply)
        let core = core
        Task {
            let status = await core.status()
            let data = (try? XPCCodec.encodeStatus(status)) ?? Data("{}".utf8)
            box.value(data)
        }
    }

    func acknowledgeWarning(_ eventID: String, accepted: Bool, withReply reply: @escaping (Bool) -> Void) {
        let box = SendableBox(value: reply)
        let core = core
        Task {
            let ok = await core.acknowledgeWarning(eventID: eventID, accepted: accepted)
            box.value(ok)
        }
    }

    func recentDecisions(limit: Int, withReply reply: @escaping (Data) -> Void) {
        let box = SendableBox(value: reply)
        let core = core
        Task {
            let summaries = await core.recentDecisions(limit: limit)
            let data = (try? XPCCodec.encodeSummaries(summaries)) ?? Data("[]".utf8)
            box.value(data)
        }
    }
}

/// Accepts (validated) connections and exports an `AgentControlBridge`.
final class XPCListenerDelegate: NSObject, NSXPCListenerDelegate, Sendable {
    private let core: AgentCore
    private let allowUnsigned: Bool
    private let requirementString: String?

    init(core: AgentCore, allowUnsigned: Bool, requirementString: String?) {
        self.core = core
        self.allowUnsigned = allowUnsigned
        self.requirementString = requirementString
    }

    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection newConnection: NSXPCConnection) -> Bool {
        guard PeerValidation.isTrusted(
            connection: newConnection, allowUnsigned: allowUnsigned, requirementString: requirementString
        ) else {
            return false
        }
        newConnection.exportedInterface = AgentXPC.interface()
        newConnection.exportedObject = AgentControlBridge(core: core)
        newConnection.resume()
        return true
    }
}
