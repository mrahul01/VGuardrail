// Runtime checks for the AI software catalog used by the device inventory.

import Foundation
import VGAgentCore

func checkAICatalog(_ c: Checker) {
    c.section("AICatalog — AI software classification")

    c.expect(
        AICatalog.classify(name: "Cursor", path: "/Applications/Cursor.app/Contents/MacOS/Cursor", command: nil) == "ai_ide",
        "Cursor classifies as ai_ide"
    )
    c.expect(
        AICatalog.classify(name: "Cursor Helper (Renderer)", path: nil, command: nil) == "ai_ide",
        "Electron helper processes inherit the bundle's category"
    )
    c.expect(
        AICatalog.classify(name: "claude", path: "/opt/homebrew/bin/claude", command: "claude --model opus") == "ai_cli",
        "claude CLI classifies as ai_cli"
    )
    c.expect(
        AICatalog.classify(name: "ChatGPT", path: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", command: nil) == "ai_desktop",
        "ChatGPT desktop classifies as ai_desktop"
    )
    c.expect(
        AICatalog.classify(name: "Google Chrome", path: nil, command: nil) == "browser",
        "browsers classify as AI-web hosts"
    )
    c.expect(
        AICatalog.classify(name: "vg-gemini", path: nil, command: nil) == "ai_cli",
        "vg-* wrappers classify as ai_cli"
    )
    c.expect(
        AICatalog.classify(name: "codesign", path: "/usr/bin/codesign", command: "codesign -dv app") == nil,
        "codesign does NOT match (no broad substrings)"
    )
    c.expect(
        AICatalog.classify(name: "launchd", path: "/sbin/launchd", command: nil) == nil,
        "system processes stay untagged"
    )
}
