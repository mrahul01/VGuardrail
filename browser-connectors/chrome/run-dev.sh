#!/usr/bin/env bash
#
# run-dev.sh — one-command LOOPBACK (WARN) demo of the VGuardrail Chrome connector.
#
# Brings up:  Chrome extension → native host → connector-sdk → xpc-bridge → vguardiand
# in loopback mode (the daemon's policy-engine client returns WARN for every prompt),
# so you can exercise the in-page modal + acknowledge end-to-end WITHOUT the Rust
# engine or any policy signing. (ALLOW/BLOCK need the engine + a signed policy.)
#
# Usage:
#   ./run-dev.sh <EXTENSION_ID>     # build + install + start (loopback WARN demo)
#   ./run-dev.sh stop               # stop the daemon + remove the host manifest
#
# Get <EXTENSION_ID> from chrome://extensions after "Load unpacked" → extension/dist.
#
# WHY sudo: the connector connects to the agent's XPC service with the `.privileged`
# option, which only resolves a SYSTEM-domain service. That means a root LaunchDaemon
# must register `com.vguardrail.agent.xpc`. There is no no-root path without changing
# the (frozen) agent contract.
set -euo pipefail

# ── paths & constants ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

SDK_DIR="$REPO/connector-sdk"
BRIDGE_DIR="$REPO/connector-sdk/bridge"
HOST_DIR="$SCRIPT_DIR/native-host"
EXT_DIR="$SCRIPT_DIR/extension"
AGENT_DIR="$REPO/agent"

MACH="com.vguardrail.agent.xpc"
NM_NAME="com.vguardrail.connector"
NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
DAEMON_LABEL="com.vguardrail.agent.dev"
PLIST="/Library/LaunchDaemons/$DAEMON_LABEL.plist"
DEV_DIR="/tmp/vguardrail"

log() { printf '\033[1;34m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── stop subcommand ───────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  log "stopping daemon and removing host manifest"
  sudo launchctl bootout "system/$DAEMON_LABEL" 2>/dev/null || true
  sudo rm -f "$PLIST"
  rm -f "$NM_DIR/$NM_NAME.json"
  echo "stopped. (dev data left in $DEV_DIR; rm -rf it to fully clean)"
  exit 0
fi

EXT_ID="${1:-}"
[[ -n "$EXT_ID" ]] || die "usage: $0 <EXTENSION_ID>   (or: $0 stop)"

# ── preflight ─────────────────────────────────────────────────────────────────
for tool in node npm swift; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool not found on PATH: $tool"
done
NODE_BIN="$(command -v node)"

# ── 1) build everything ───────────────────────────────────────────────────────
log "building connector-sdk"
( cd "$SDK_DIR" && npm install --silent && npm run build --silent )

log "building native host"
( cd "$HOST_DIR" && npm install --silent && npm run build --silent )

log "building extension → $EXT_DIR/dist"
( cd "$EXT_DIR" && npm install --silent && npm run build --silent )

log "building xpc-bridge (release)"
( cd "$BRIDGE_DIR" && swift build -c release --product vguardrail-xpc-bridge )
BRIDGE_BIN="$BRIDGE_DIR/.build/release/vguardrail-xpc-bridge"
[[ -x "$BRIDGE_BIN" ]] || die "bridge binary missing: $BRIDGE_BIN"

log "building vguardiand (loopback)"
( cd "$AGENT_DIR" && swift build -c release --product vguardiand )
VGUARDIAND_BIN="$AGENT_DIR/.build/release/vguardiand"
[[ -x "$VGUARDIAND_BIN" ]] || die "daemon binary missing: $VGUARDIAND_BIN"

HOST_ENTRY="$HOST_DIR/dist/main.js"
[[ -f "$HOST_ENTRY" ]] || die "host entry missing: $HOST_ENTRY"

mkdir -p "$DEV_DIR/identity"

# ── 2) native-messaging host launcher + manifest ──────────────────────────────
# The launcher bakes in VG_XPC_BRIDGE_PATH so the Chrome-spawned host (which does
# NOT inherit your shell PATH/env) can find the bridge.
LAUNCHER="$HOST_DIR/dist/run-host.sh"
log "writing host launcher → $LAUNCHER"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
export VG_XPC_BRIDGE_PATH="$BRIDGE_BIN"
exec "$NODE_BIN" "$HOST_ENTRY"
EOF
chmod +x "$LAUNCHER"

mkdir -p "$NM_DIR"
log "installing native-messaging manifest (allowed: chrome-extension://$EXT_ID/)"
cat > "$NM_DIR/$NM_NAME.json" <<EOF
{
  "name": "$NM_NAME",
  "description": "VGuardrail Chrome connector native messaging host (dev)",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

# ── 3) install + bootstrap the LaunchDaemon (loopback, unsigned-XPC accepted) ──
TMP_PLIST="$DEV_DIR/$DAEMON_LABEL.plist"
log "writing LaunchDaemon plist"
cat > "$TMP_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$DAEMON_LABEL</string>
  <key>ProgramArguments</key><array><string>$VGUARDIAND_BIN</string></array>
  <key>MachServices</key><dict><key>$MACH</key><true/></dict>
  <key>EnvironmentVariables</key><dict>
    <key>VG_ALLOW_LOOPBACK</key><string>1</string>
    <key>VG_XPC_ALLOW_UNSIGNED</key><string>1</string>
    <key>VG_MACH_SERVICE</key><string>$MACH</string>
    <key>VG_STORE_PATH</key><string>$DEV_DIR/agent.db</string>
    <key>VG_IDENTITY_DIR</key><string>$DEV_DIR/identity</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEV_DIR/vguardiand.out.log</string>
  <key>StandardErrorPath</key><string>$DEV_DIR/vguardiand.err.log</string>
</dict>
</plist>
EOF

log "bootstrapping daemon (sudo) — registers the $MACH service"
sudo cp "$TMP_PLIST" "$PLIST"
sudo chown root:wheel "$PLIST"
sudo chmod 644 "$PLIST"
sudo launchctl bootout "system/$DAEMON_LABEL" 2>/dev/null || true
sudo launchctl bootstrap system "$PLIST"
sudo launchctl enable "system/$DAEMON_LABEL" || true

# ── done ──────────────────────────────────────────────────────────────────────
cat <<EOF

==> loopback WARN demo is up.

Next:
  1. Reload an open tab on chatgpt.com / claude.ai / gemini.google.com / perplexity.ai
     (or open a fresh one) so the content script reconnects.
  2. Type a prompt and submit → you should see the WARN modal. "Send anyway" proceeds
     (and audits WarningAccepted); "Cancel" keeps it blocked.

Logs:
  daemon : tail -f $DEV_DIR/vguardiand.err.log
  host   : Chrome → chrome://extensions → service worker "Inspect views" console

Notes:
  • Every prompt warns: loopback returns WARN. ALLOW/BLOCK need the Rust engine
    (VG_GRPC=1 daemon + pe-engined + a signed policy) — see browser-connectors/chrome/README.md §3a.
  • Tear down with:  $0 stop
EOF
