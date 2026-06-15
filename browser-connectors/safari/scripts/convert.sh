#!/usr/bin/env bash
# One-command build of the VGuardrail Safari connector.
#
# Generates the Xcode project from the built web-extension resources
# (extension/dist) with Apple's converter, then finishes the wiring that used
# to be manual:
#   1. swaps the generated SafariWebExtensionHandler.swift for ours (which
#      forwards scans over XPC to vguardiand) — same filename, so the
#      project.pbxproj never needs editing;
#   2. adds the mach-lookup entitlement for com.vguardrail.agent.xpc;
#   3. builds the app with xcodebuild (ad-hoc signed, local run only);
#   4. opens the app once so the extension registers with Safari.
#
# Usage:
#   scripts/convert.sh              # full flow
#   scripts/convert.sh --no-build   # stop after generation + wiring
#
# Prerequisites:
#   - full Xcode (the converter is not in the Command Line Tools):
#       App Store → Xcode, then:  sudo xcode-select -s /Applications/Xcode.app
#   - extension/dist built:  cd extension && npm install && npm run build
set -euo pipefail

APP_NAME="VGuardrail Safari Connector"
BUNDLE_ID="com.vguardrail.safari-connector"
XPC_SERVICE="com.vguardrail.agent.xpc"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAFARI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES="$SAFARI_ROOT/extension/dist"
PROJECT_DIR="$SAFARI_ROOT/xcode"

NO_BUILD=0
[[ "${1:-}" == "--no-build" ]] && NO_BUILD=1

if [[ ! -f "$RESOURCES/manifest.json" ]]; then
  echo "error: $RESOURCES/manifest.json not found — run 'npm run build' in safari/extension first" >&2
  exit 1
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "error: safari-web-extension-converter not found (Command Line Tools only?)." >&2
  found="$(ls -d /Applications/Xcode*.app 2>/dev/null | head -1 || true)"
  if [[ -n "$found" ]]; then
    echo "Xcode appears to be at: $found" >&2
    echo "Run:  sudo xcode-select -s \"$found\"  and re-run this script." >&2
  else
    echo "Install full Xcode from the App Store (free), then run:" >&2
    echo "  sudo xcode-select -s /Applications/Xcode.app" >&2
  fi
  exit 1
fi

# ── 1. Generate the project ──────────────────────────────────────────────────
xcrun safari-web-extension-converter "$RESOURCES" \
  --project-location "$PROJECT_DIR" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --no-open \
  --no-prompt \
  --force

GEN_ROOT="$PROJECT_DIR/$APP_NAME"

# ── 2. Swap in our XPC-bridging handler (same filename → no pbxproj edits) ───
GEN_HANDLER="$(find "$GEN_ROOT" -name "SafariWebExtensionHandler.swift" -not -path "*/build/*" | head -1)"
if [[ -z "$GEN_HANDLER" ]]; then
  echo "error: generated SafariWebExtensionHandler.swift not found under $GEN_ROOT" >&2
  exit 1
fi
cp "$SAFARI_ROOT/swift/SafariWebExtensionHandler.swift" "$GEN_HANDLER"
echo "==> Installed VGuardrail XPC handler at: $GEN_HANDLER"

# ── 3. Entitlement: let the sandboxed extension look up the agent's service ──
KEY_ESCAPED='com\.apple\.security\.temporary-exception\.mach-lookup\.global-name'
patched=0
while IFS= read -r ent; do
  # Only extension-target entitlements (the app target doesn't talk XPC).
  case "$ent" in *Extension*) ;; *) continue ;; esac
  if ! plutil -extract "$KEY_ESCAPED" raw "$ent" >/dev/null 2>&1; then
    plutil -insert "$KEY_ESCAPED" -array "$ent"
    plutil -insert "$KEY_ESCAPED.0" -string "$XPC_SERVICE" "$ent"
  fi
  echo "==> Entitlement $XPC_SERVICE added to: $ent"
  patched=1
done < <(find "$GEN_ROOT" -name "*.entitlements" -not -path "*/build/*")
if [[ "$patched" -eq 0 ]]; then
  echo "warning: no extension .entitlements file found — add the mach-lookup entitlement in Xcode manually" >&2
fi

if [[ "$NO_BUILD" -eq 1 ]]; then
  echo "==> --no-build: open $GEN_ROOT/$APP_NAME.xcodeproj in Xcode to build."
  exit 0
fi

# ── 4. Build (ad-hoc signed — fine for local dev w/ Allow Unsigned Extensions)
echo "==> Building with xcodebuild …"
if ! xcodebuild \
    -project "$GEN_ROOT/$APP_NAME.xcodeproj" \
    -scheme "$APP_NAME" \
    -configuration Debug \
    -derivedDataPath "$PROJECT_DIR/build" \
    CODE_SIGN_IDENTITY="-" \
    AD_HOC_CODE_SIGNING_ALLOWED=YES \
    build >"$PROJECT_DIR/xcodebuild.log" 2>&1; then
  echo "error: xcodebuild failed — see $PROJECT_DIR/xcodebuild.log" >&2
  echo "Fallback: open $GEN_ROOT/$APP_NAME.xcodeproj in Xcode and Run once." >&2
  exit 1
fi

APP="$PROJECT_DIR/build/Build/Products/Debug/$APP_NAME.app"
echo "==> Built: $APP"

# ── 5. Launch once so Safari registers the extension ─────────────────────────
open "$APP"

cat <<EOF

Done. Final steps in Safari (one-time):
  1. Safari → Settings → Advanced → "Show features for web developers"
  2. Develop → Allow Unsigned Extensions   (re-enable after each Safari restart)
  3. Safari → Settings → Extensions → enable "$APP_NAME"
  4. Visit chatgpt.com / claude.ai and grant site access via the toolbar icon

NOTE: Safari talks XPC directly to vguardiand — with the agent daemons stopped,
every prompt is BLOCKED fail-closed ("policy engine unavailable"). Start
pe-engined + vguardiand for allow/warn decisions.
EOF
