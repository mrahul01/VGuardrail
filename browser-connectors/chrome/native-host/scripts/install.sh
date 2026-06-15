#!/usr/bin/env bash
# Installs the VGuardrail Chrome native-messaging host manifest so Chrome will
# launch this host for the extension.
#
# Usage:
#   scripts/install.sh <EXTENSION_ID>
#
# <EXTENSION_ID> is the unpacked/published extension id (chrome://extensions →
# the id under the VGuardrail connector). The manifest's allowed_origins is
# pinned to exactly that id, so no other extension can talk to the host.
set -euo pipefail

if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "usage: $0 <EXTENSION_ID>" >&2
  exit 2
fi
EXTENSION_ID="$1"

HOST_NAME="com.vguardrail.connector"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY="$HOST_ROOT/dist/main.js"

if [[ ! -f "$ENTRY" ]]; then
  echo "error: $ENTRY not found — run 'npm run build' first" >&2
  exit 1
fi

# A small launcher so Chrome can exec a plain executable regardless of the JS
# shebang / file mode. It execs node against the built entry.
LAUNCHER="$HOST_ROOT/dist/run-host.sh"
NODE_BIN="$(command -v node)"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$ENTRY"
EOF
chmod +x "$LAUNCHER"

# Chrome's per-user NativeMessagingHosts directory on macOS. Override the base
# with VG_NM_DIR to target Chromium/Edge/Brave.
NM_DIR="${VG_NM_DIR:-$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts}"
mkdir -p "$NM_DIR"
TARGET="$NM_DIR/$HOST_NAME.json"

sed -e "s|__HOST_PATH__|$LAUNCHER|g" \
    -e "s|__EXTENSION_ID__|$EXTENSION_ID|g" \
    "$HOST_ROOT/manifest/$HOST_NAME.json" > "$TARGET"

echo "installed native-messaging host manifest:"
echo "  $TARGET"
echo "  host: $LAUNCHER"
echo "  allowed extension: chrome-extension://$EXTENSION_ID/"
