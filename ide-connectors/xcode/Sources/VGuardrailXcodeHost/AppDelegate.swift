// AppDelegate — minimal host app for the VGuardrail Xcode extension.
//
// Xcode Source Editor Extensions must ship inside a macOS app; the app itself
// has no scanning role. This host shows a single window explaining how to
// enable the extension. All real work happens in VGuardrailXcodeExtension.

import AppKit

@main
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 200),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "VGuardrail Xcode Connector"
        window.center()

        let label = NSTextField(wrappingLabelWithString: """
        The VGuardrail extension is installed with this app.

        Enable it under System Settings → General → Login Items & Extensions \
        → Xcode Source Editor (on older macOS: System Settings → Privacy & \
        Security → Extensions), then restart Xcode.

        In Xcode, select text and run Editor → VGuardrail → \
        Scan Selection with VGuardrail. Allowed scans succeed silently; \
        warned or blocked content surfaces as an Xcode error alert with the \
        policy reason. If the VGuardrail agent is not running, every scan \
        fails closed to BLOCK.
        """)
        label.frame = NSRect(x: 20, y: 20, width: 440, height: 160)
        window.contentView?.addSubview(label)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
