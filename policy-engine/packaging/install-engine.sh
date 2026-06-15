#!/usr/bin/env bash
# Installs pe-engined as a supervised LaunchDaemon so launchd respawns it if it
# dies — the engine vguardiand consults for every decision. Without this the
# engine is a manual prerequisite that, once stopped, fails every prompt closed.
#
# Requires sudo. For a real deployment the binary must be Developer ID signed and
# the plist's VG_POLICY_PUBKEY / VG_EVENT_SIGNING_SEED set to your keys.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBEXEC="/usr/local/libexec/vguardrail"
ENGINE_PLIST="/Library/LaunchDaemons/com.vguardrail.policy-engine.plist"

if [[ $EUID -ne 0 ]]; then
    echo "error: run with sudo" >&2
    exit 1
fi

echo "building release binary (pe-engined)…"
( cd "$ROOT" && cargo build --release --bin pe-engined )

echo "installing binary → $LIBEXEC"
install -d "$LIBEXEC"
install -m 0755 "$ROOT/target/release/pe-engined" "$LIBEXEC/pe-engined"

echo "creating runtime directories"
install -d -m 0750 /var/db/vguardrail /var/run/vguardrail /var/log/vguardrail

echo "installing LaunchDaemon → $ENGINE_PLIST"
install -m 0644 "$ROOT/packaging/com.vguardrail.policy-engine.plist" "$ENGINE_PLIST"

echo "bootstrapping the engine (respawns on crash via KeepAlive)"
launchctl bootstrap system "$ENGINE_PLIST" \
    || launchctl kickstart -k system/com.vguardrail.policy-engine

cat <<'EOF'

Installed. Next steps:
  - Set VG_POLICY_PUBKEY and VG_EVENT_SIGNING_SEED in the engine plist.
  - Then install the agent (agent/Scripts/install.sh); its first health check
    will find the engine already serving on /var/run/vguardrail/policy.sock.

Verify it is supervised:
  sudo launchctl print system/com.vguardrail.policy-engine | grep -E 'state|pid'

Uninstall:
  sudo launchctl bootout system/com.vguardrail.policy-engine
  sudo rm -f /usr/local/libexec/vguardrail/pe-engined \
             /Library/LaunchDaemons/com.vguardrail.policy-engine.plist
EOF
