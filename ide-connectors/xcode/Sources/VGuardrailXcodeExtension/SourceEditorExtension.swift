// SourceEditorExtension — entry point of the Xcode Source Editor Extension.
//
// Defines the single command this connector contributes ("Scan Selection with
// VGuardrail" under Editor → VGuardrail). Returning the definitions in code
// (rather than only in Info.plist) keeps the identifiers and the class names
// in one reviewed place.
//
// Guarded with #if canImport(XcodeKit) — see ScanSelectionCommand.swift.

#if canImport(XcodeKit)

import Foundation
import XcodeKit

final class SourceEditorExtension: NSObject, XCSourceEditorExtension {

    var commandDefinitions: [[XCSourceEditorCommandDefinitionKey: Any]] {
        [
            [
                .identifierKey: "com.vguardrail.xcode-connector.scan-selection",
                .classNameKey: NSStringFromClass(ScanSelectionCommand.self),
                .nameKey: "Scan Selection with VGuardrail",
            ],
        ]
    }
}

#endif
