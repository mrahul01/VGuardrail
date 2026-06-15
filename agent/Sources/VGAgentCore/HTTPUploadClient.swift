// Uploads audit events to the backend `POST {base}/events/batch`.
//
// Offline-first: any non-2xx or transport error throws, so the caller leaves the
// batch queued for a later retry.

import Foundation
import VGEventQueue

public struct HTTPUploadClient: UploadClient {
    private let endpoint: URL
    private let session: URLSession
    private let authorization: String?
    private let deviceID: String?

    /// - Parameters:
    ///   - baseURL: backend base; events post to `baseURL/events/batch`.
    ///   - authorization: optional `Authorization` header value (e.g. a bearer token).
    ///   - deviceID: sent as `x-device-id` so the backend can attribute events
    ///     to this device (dev mode; production derives it from the JWT).
    public init(
        baseURL: URL, authorization: String? = nil, deviceID: String? = nil,
        session: URLSession = .shared
    ) {
        self.endpoint = baseURL.appendingPathComponent("events/batch")
        self.authorization = authorization
        self.deviceID = deviceID
        self.session = session
    }

    public func upload(_ events: [QueuedEvent]) async throws -> UploadResult {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let authorization {
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
        if let deviceID {
            request.setValue(deviceID, forHTTPHeaderField: "x-device-id")
        }
        request.httpBody = Self.encodeBatch(events)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw UploadError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw UploadError.server(status: http.statusCode)
        }
        return Self.parseResult(data, sent: events.count)
    }

    /// Wraps the (already-JSON) event payloads in `{"events":[ … ]}` without
    /// re-encoding them.
    static func encodeBatch(_ events: [QueuedEvent]) -> Data {
        var body = Data("{\"events\":[".utf8)
        for (i, event) in events.enumerated() {
            if i > 0 { body.append(0x2C) } // ','
            body.append(contentsOf: event.payload)
        }
        body.append(contentsOf: Data("]}".utf8))
        return body
    }

    static func parseResult(_ data: Data, sent: Int) -> UploadResult {
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let accepted = (obj["accepted"] as? Int) ?? sent
            let rejected = (obj["rejected"] as? Int) ?? 0
            return UploadResult(accepted: accepted, rejected: rejected)
        }
        // Backend returned 2xx without a parseable body — treat all as accepted.
        return UploadResult(accepted: sent, rejected: 0)
    }
}

public enum UploadError: Error, Equatable {
    case invalidResponse
    case server(status: Int)
}
