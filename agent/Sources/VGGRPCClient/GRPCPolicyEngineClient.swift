// The production PolicyEngineClient: talks to `pe-engined` over gRPC on a Unix
// domain socket, using grpc-swift v2.
//
// NOTE: Compiles only in a full build (`VG_GRPC=1`). It is not built in the
// Command-Line-Tools-only authoring environment (no grpc-swift / codegen). The
// `VGCore` mapping in Mapping.swift is environment-independent and reviewed; the
// grpc-swift plumbing below targets grpc-swift v2 and should be validated on an
// Xcode + network host.

import Foundation
import GRPCCore
import GRPCNIOTransportHTTP2
import VGAgentCore
import VGCore

public struct GRPCPolicyEngineClient: PolicyEngineClient {
    private let socketPath: String

    public init(socketPath: String) {
        self.socketPath = socketPath
    }

    private func makeTransport() throws -> HTTP2ClientTransport.Posix {
        // Explicit authority: the default UDS-derived ":authority" (the socket
        // path) is rejected by tonic/hyper at the HTTP/2 layer (RST_STREAM).
        try HTTP2ClientTransport.Posix(
            target: .unixDomainSocket(path: socketPath, authority: "localhost"),
            transportSecurity: .plaintext
        )
    }

    public func evaluate(_ request: ScanRequest) async throws -> Decision {
        let requestID = UUIDv7.generate()
        let pb = ProtoMap.request(request, requestID: requestID)
        return try await withGRPCClient(transport: try makeTransport()) { client in
            let stub = Vguardrail_PolicyEngine_V1_PolicyEngine.Client(wrapping: client)
            let response = try await stub.evaluate(pb)
            return ProtoMap.decision(response)
        }
    }

    public func loadPolicy(_ bundleJSON: Data) async throws -> LoadPolicyResult {
        var pb = Vguardrail_PolicyEngine_V1_LoadPolicyRequest()
        pb.bundleJson = bundleJSON
        return try await withGRPCClient(transport: try makeTransport()) { client in
            let stub = Vguardrail_PolicyEngine_V1_PolicyEngine.Client(wrapping: client)
            let response = try await stub.loadPolicy(pb)
            return LoadPolicyResult(
                accepted: response.accepted,
                activeVersion: response.activeVersion,
                rejectReason: response.rejectReason
            )
        }
    }

    public func health() async throws -> EngineHealth {
        let pb = Vguardrail_PolicyEngine_V1_HealthRequest()
        return try await withGRPCClient(transport: try makeTransport()) { client in
            let stub = Vguardrail_PolicyEngine_V1_PolicyEngine.Client(wrapping: client)
            let response = try await stub.health(pb)
            return EngineHealth(
                serving: response.status == .serving,
                activePolicyVersion: response.activePolicyVersion,
                queuedEvents: response.queuedEvents,
                engineVersion: response.engineVersion
            )
        }
    }
}
