#!/usr/bin/env bash
# Installs vguardiand (LaunchDaemon) and the menu bar LaunchAgent.
#
# Requires sudo. For a real deployment the binaries must be Developer ID signed
# and the daemon's VG_XPC_REQUIREMENT set to your team's code requirement, or XPC
# peers will be rejected (fail-closed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBEXEC="/usr/local/libexec/vguardrail"
DAEMON_PLIST="/Library/LaunchDaemons/com.vguardrail.agent.plist"

if [[ $EUID -ne 0 ]]; then
    echo "error: run with sudo" >&2
    exit 1
fi

echo "building release binaries (set VG_GRPC=1 for the real engine client)…"
( cd "$ROOT" && swift build -c release --product vguardiand )

echo "installing binary → $LIBEXEC"
install -d "$LIBEXEC"
install -m 0755 "$ROOT/.build/release/vguardiand" "$LIBEXEC/vguardiand"

echo "creating runtime directories"
install -d -m 0750 /var/db/vguardrail /var/run/vguardrail /var/log/vguardrail

echo "installing LaunchDaemon → $DAEMON_PLIST"
install -m 0644 "$ROOT/Resources/com.vguardrail.agent.plist" "$DAEMON_PLIST"

echo "bootstrapping the daemon"
launchctl bootstrap system "$DAEMON_PLIST" || launchctl kickstart -k system/com.vguardrail.agent

cat <<'EOF'

Installed. Next steps:
  - Set VG_XPC_REQUIREMENT in the daemon plist to your Team ID requirement.
  - Place a signed policy bundle at /var/db/vguardrail/policy.bundle.json.
  - Install the policy engine as a supervised LaunchDaemon (KeepAlive) so it is
    respawned instead of failing every prompt closed when it dies:
      sudo policy-engine/packaging/install-engine.sh
    It must be serving on /var/run/vguardrail/policy.sock before the daemon's
    first health check.
  - For the menu bar app, sign it, copy to /Applications/VGuardrail.app, and
    install Resources/com.vguardrail.menubar.plist to /Library/LaunchAgents.

Uninstall:
  sudo launchctl bootout system /Library/LaunchDaemons/com.vguardrail.agent.plist
  sudo rm -rf /usr/local/libexec/vguardrail /Library/LaunchDaemons/com.vguardrail.agent.plist
EOF
