#!/usr/bin/env bash
# Setup helper for the VGuardrail Xcode Source Editor Extension.
#
# Honest scope: unlike Safari web extensions, Apple provides NO converter for
# source-editor extensions — there is no `xcodebuild`-only path to fabricate
# the .xcodeproj from this checkout. This script therefore:
#   1. verifies the Swift sources parse (`xcrun swiftc -parse` — works with
#      the Command Line Tools; XcodeKit-dependent code is behind
#      `#if canImport(XcodeKit)`, so under CLT it is syntax-checked only,
#      full type-checking happens when Xcode builds the real target);
#   2. checks whether full Xcode is selected (required to create and build
#      the project — the extension template is not in the CLT);
#   3. prints the exact manual project-creation steps (also in README.md).
#
# Usage: scripts/setup.sh
set -euo pipefail

XPC_SERVICE="com.vguardrail.agent.xpc"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XCODE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXT_SOURCES=(
  "$XCODE_ROOT/Sources/VGuardrailXcodeExtension/SourceEditorExtension.swift"
  "$XCODE_ROOT/Sources/VGuardrailXcodeExtension/ScanSelectionCommand.swift"
  "$XCODE_ROOT/Sources/VGuardrailXcodeExtension/XPCScanClient.swift"
)
HOST_SOURCES=(
  "$XCODE_ROOT/Sources/VGuardrailXcodeHost/AppDelegate.swift"
)

# ── 1. Syntax-verify the sources ─────────────────────────────────────────────
if ! command -v xcrun >/dev/null 2>&1; then
  echo "error: xcrun not found — install the Command Line Tools: xcode-select --install" >&2
  exit 1
fi

echo "==> Verifying Swift sources with 'xcrun swiftc -parse' …"
xcrun swiftc -parse "${EXT_SOURCES[@]}"
xcrun swiftc -parse "${HOST_SOURCES[@]}"
echo "==> Sources parse cleanly."
echo "    NOTE: XcodeKit ships inside Xcode.app, not the CLT SDK. The"
echo "    XcodeKit-dependent code is behind '#if canImport(XcodeKit)', so"
echo "    under CLT this is a syntax check only; full type-checking of the"
echo "    XcodeKit code paths happens when Xcode builds the extension target."

# ── 2. Full Xcode? ───────────────────────────────────────────────────────────
DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
if [[ "$DEV_DIR" == *CommandLineTools* || -z "$DEV_DIR" ]]; then
  echo
  echo "Command Line Tools only — full Xcode is required to CREATE and BUILD"
  echo "the extension (the 'Xcode Source Editor Extension' template and"
  echo "XcodeKit are not in the CLT)."
  found="$(ls -d /Applications/Xcode*.app 2>/dev/null | head -1 || true)"
  if [[ -n "$found" ]]; then
    echo "Xcode appears to be at: $found"
    echo "Run:  sudo xcode-select -s \"$found\"  and re-run this script."
  else
    echo "Install full Xcode from the App Store (free), then run:"
    echo "  sudo xcode-select -s /Applications/Xcode.app"
  fi
else
  echo
  echo "==> Full Xcode selected at: $DEV_DIR"
fi

# ── 3. Manual steps (no converter exists for source-editor extensions) ──────
cat <<EOF

Project creation is manual (Apple ships no converter for source-editor
extensions). In Xcode:

  1. File → New → Project… → macOS → App
       Product Name: VGuardrailXcodeHost   (Interface: XIB or empty — the
       host is programmatic; Storyboard works too, then delete the storyboard
       wiring), Language: Swift.
  2. Delete the template's generated AppDelegate/ContentView sources and add:
       Sources/VGuardrailXcodeHost/AppDelegate.swift          → app target
  3. File → New → Target… → macOS → Xcode Source Editor Extension
       Product Name: VGuardrailXcodeExtension. Activate the scheme when asked.
  4. Delete the extension template's SourceEditorExtension.swift /
     SourceEditorCommand.swift and add ours to the EXTENSION target:
       Sources/VGuardrailXcodeExtension/SourceEditorExtension.swift
       Sources/VGuardrailXcodeExtension/ScanSelectionCommand.swift
       Sources/VGuardrailXcodeExtension/XPCScanClient.swift
  5. In the extension target's Info.plist, under NSExtension →
     NSExtensionAttributes, set XCSourceEditorExtensionPrincipalClass to
       \$(PRODUCT_MODULE_NAME).SourceEditorExtension
     (command definitions come from code).
  6. Entitlement (extension target → Signing & Capabilities → App Sandbox
     stays ON): open the extension's .entitlements file and add
       com.apple.security.temporary-exception.mach-lookup.global-name
         (Array) → item 0 (String): $XPC_SERVICE
     Without it the sandboxed extension cannot reach vguardiand and every
     scan fails closed to BLOCK.
  7. Run the VGuardrailXcodeHost scheme once, then enable the extension in
     System Settings → General → Login Items & Extensions → Xcode Source
     Editor, and restart Xcode.
  8. In Xcode: Editor → VGuardrail → Scan Selection with VGuardrail.

Behavior reminder: allowed scans succeed silently; WARN/BLOCK (and an
unreachable engine) surface as an Xcode error alert carrying the decision and
reason — source-editor extensions cannot present richer UI.
EOF
