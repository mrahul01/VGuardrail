#!/usr/bin/env bash
# Installs the VGuardrail native-messaging host manifest for Firefox.
#
# Usage:
#   scripts/install-native-host.sh
#
# Firefox identifies callers by the WebExtension id, not an origin: the manifest
# uses "allowed_extensions": ["connector@vguardrail.com"] (the gecko id pinned in
# the extension's manifest.json), so unlike the Chromium installers there is no
# <EXTENSION_ID> argument. The host binary itself is shared with
# chrome/native-host — build it there first.
set -euo pipefail

HOST_NAME="com.vguardrail.connector"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_ROOT="$(cd "$SCRIPT_DIR/../../chrome/native-host" && pwd)"
ENTRY="$HOST_ROOT/dist/main.js"

if [[ ! -f "$ENTRY" ]]; then
  echo "error: $ENTRY not found — run 'npm run build' in chrome/native-host first" >&2
  exit 1
fi

# Same launcher chrome/native-host's installer writes: Firefox execs a plain
# executable regardless of the JS shebang / file mode; it execs node against
# the built entry.
LAUNCHER="$HOST_ROOT/dist/run-host.sh"
NODE_BIN="$(command -v node)"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
exec "$NODE_BIN" "$ENTRY"
EOF
chmod +x "$LAUNCHER"

# Firefox's per-user NativeMessagingHosts directory on macOS.
NM_DIR="${VG_NM_DIR:-$HOME/Library/Application Support/Mozilla/NativeMessagingHosts}"
mkdir -p "$NM_DIR"
TARGET="$NM_DIR/$HOST_NAME.json"

sed -e "s|__HOST_PATH__|$LAUNCHER|g" \
    "$SCRIPT_DIR/../native-host-manifest/$HOST_NAME.json" > "$TARGET"

echo "installed native-messaging host manifest:"
echo "  $TARGET"
echo "  host: $LAUNCHER"
echo "  allowed extension: connector@vguardrail.com"
