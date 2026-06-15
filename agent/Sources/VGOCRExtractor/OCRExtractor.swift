// Apple Vision OCR — extracts the text in an image so it can be scanned by the
// policy engine like any other prompt. Screenshots of API keys, credentials in
// Slack/chat captures, code screenshots, etc. become detectable.
//
// Uses `VNRecognizeTextRequest` (.accurate, language-corrected). Text
// recognition is windowserver-free, so it works from a CLI / vgctl session;
// the daemon (LaunchDaemon) path is best-effort (see vguardiand).

import Foundation
import Vision
import ImageIO

/// Errors surfaced by the OCR extractor.
public enum OCRError: Error, CustomStringConvertible {
    /// The file/data could not be decoded into an image.
    case cannotLoadImage(String)
    /// Vision failed to run the recognition request.
    case recognitionFailed(String)

    public var description: String {
        switch self {
        case .cannotLoadImage(let p): return "cannot load image: \(p)"
        case .recognitionFailed(let m): return "OCR failed: \(m)"
        }
    }
}

/// Stateless namespace for image text extraction.
public enum OCRExtractor {
    /// Recognizes and returns the text in the image at `imageURL` (one line per
    /// recognized text observation). Returns an empty string when the image
    /// contains no recognizable text.
    public static func extractText(from imageURL: URL) async throws -> String {
        guard
            let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
            let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            throw OCRError.cannotLoadImage(imageURL.path)
        }
        return try recognize(cgImage)
    }

    /// Recognizes text from raw image bytes (e.g. a screenshot blob).
    public static func extractText(from data: Data) async throws -> String {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else {
            throw OCRError.cannotLoadImage("<data: \(data.count) bytes>")
        }
        return try recognize(cgImage)
    }

    /// Runs a synchronous Vision text-recognition pass. `VNImageRequestHandler`
    /// invokes the request's completion handler inline during `perform`, so the
    /// result is available by the time `perform` returns — no continuation
    /// hand-off across threads (keeps the non-Sendable CGImage local).
    private static func recognize(_ cgImage: CGImage) throws -> String {
        var recognized: [String] = []
        var failure: String?

        let request = VNRecognizeTextRequest { req, error in
            if let error {
                failure = error.localizedDescription
                return
            }
            let observations = (req.results as? [VNRecognizedTextObservation]) ?? []
            recognized = observations.compactMap { $0.topCandidates(1).first?.string }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            throw OCRError.recognitionFailed(error.localizedDescription)
        }
        if let failure {
            throw OCRError.recognitionFailed(failure)
        }
        return recognized.joined(separator: "\n")
    }
}
