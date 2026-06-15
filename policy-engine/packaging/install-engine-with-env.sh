#!/usr/bin/env bash
# install-engine-with-env.sh — small, additive companion to install-engine.sh.
#
# What it does differently from install-engine.sh:
#   - Reads VG_POLICY_PUBKEY and VG_EVENT_SIGNING_SEED from the repo .env.
#   - Substitutes the placeholder values in the LaunchDaemon plist before
#     bootstrapping, so pe-engined does not exit with MissingEnv on startup.
#
# It does NOT change:
#   - the plist's Label, ProgramArguments, RunAtLoad, KeepAlive, ThrottleInterval,
#     socket path, or store path.
#   - install-engine.sh itself (this script calls it for the install/bootstrap
#     and then overlays the EnvironmentVariables).
#   - any policy-evaluation code, schemas, or APIs.
#
# Requires sudo for install + launchctl bootstrap.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
PLIST_SRC="$REPO_ROOT/policy-engine/packaging/com.vguardrail.policy-engine.plist"
PLIST_DST="/Library/LaunchDaemons/com.vguardrail.policy-engine.plist"

if [[ $EUID -ne 0 ]]; then
    echo "error: run with sudo" >&2
    exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
    echo "error: $ENV_FILE not found" >&2
    exit 1
fi
if [[ ! -f "$PLIST_SRC" ]]; then
    echo "error: $PLIST_SRC not found" >&2
    exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
# Re-read the values with IFS='=' so trailing '=' is preserved (awk -F= drops it).
# base64 padding always ends in '=' for any 32-byte key, so this is required.
read_env() { awk -v k="$1" 'index($0,k"=")==1 { sub(k"=",""); print; exit }' "$ENV_FILE"; }
VG_POLICY_PUBKEY="$(read_env VG_POLICY_PUBKEY)"
VG_EVENT_SIGNING_SEED="$(read_env VG_EVENT_SIGNING_SEED)"
export VG_POLICY_PUBKEY VG_EVENT_SIGNING_SEED
: "${VG_POLICY_PUBKEY:?VG_POLICY_PUBKEY missing in $ENV_FILE}"
: "${VG_EVENT_SIGNING_SEED:?VG_EVENT_SIGNING_SEED missing in $ENV_FILE}"

# Decode a base64 value (padded or unpadded) and check it decodes to exactly $3 bytes.
# Returns 0 if OK, 1 otherwise.
validate_std_b64_32() {
    local label="$1" value="$2" expected="$3"
    local decoded_len
    decoded_len=$(echo -n "$value" | base64 -d 2>/dev/null | wc -c | tr -d ' ')
    if [[ "$decoded_len" != "$expected" ]]; then
        echo "warn: $label decodes to ${decoded_len} bytes (expected ${expected})"
        return 1
    fi
    # Also verify no non-standard chars (base64url '_' or '-') are present.
    local stripped="${value//=/}"
    if [[ "$stripped" =~ [_\-] ]]; then
        echo "warn: $label contains base64url characters ('_' or '-')"
        return 1
    fi
    return 0
}

if ! validate_std_b64_32 "VG_EVENT_SIGNING_SEED" "$VG_EVENT_SIGNING_SEED" 32; then
    VG_EVENT_SIGNING_SEED="$(openssl rand 32 | base64 | tr -d '\n')"
    # Ensure padding for maximum compatibility (the engine accepts both, but tools like awk prefer it).
    if [[ ${#VG_EVENT_SIGNING_SEED} -eq 43 ]]; then
        VG_EVENT_SIGNING_SEED="${VG_EVENT_SIGNING_SEED}="
    fi
    echo "wrote fresh VG_EVENT_SIGNING_SEED to $ENV_FILE"
    /usr/bin/sed -i.bak -E "s|^VG_EVENT_SIGNING_SEED=.*|VG_EVENT_SIGNING_SEED=$VG_EVENT_SIGNING_SEED|" "$ENV_FILE"
fi
validate_std_b64_32 "VG_EVENT_SIGNING_SEED" "$VG_EVENT_SIGNING_SEED" 32 \
    || { echo "error: regenerated VG_EVENT_SIGNING_SEED is still invalid"; exit 1; }

# 1) Build the engine (idempotent).
echo "building release binary (pe-engined)…"
( cd "$REPO_ROOT/policy-engine" && cargo build --release --bin pe-engined )

# 2) Install the binary, directories, and (unconfigured) plist via the existing
#    script. This preserves the supervised launchd lifecycle.
echo "installing via install-engine.sh…"
( cd "$REPO_ROOT" && bash policy-engine/packaging/install-engine.sh >/dev/null )

# 3) Overlay the real keys onto the installed plist. Uses PlistBuddy so we edit
#    only the two keys and never touch ProgramArguments / KeepAlive / etc.
echo "patching $PLIST_DST with VG_POLICY_PUBKEY and VG_EVENT_SIGNING_SEED…"
/usr/libexec/PlistBuddy -c "Delete :EnvironmentVariables:VG_POLICY_PUBKEY"     "$PLIST_DST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Delete :EnvironmentVariables:VG_EVENT_SIGNING_SEED" "$PLIST_DST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:VG_POLICY_PUBKEY string $VG_POLICY_PUBKEY"     "$PLIST_DST"
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:VG_EVENT_SIGNING_SEED string $VG_EVENT_SIGNING_SEED" "$PLIST_DST"

# 4) Sanity-check: no placeholder remains.
/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:VG_POLICY_PUBKEY"     "$PLIST_DST"
/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:VG_EVENT_SIGNING_SEED" "$PLIST_DST"

# 5) Force a clean restart under launchd's KeepAlive.
echo "kicking the engine under launchd…"
launchctl kickstart -k system/com.vguardrail.policy-engine || true

cat <<'EOF'
Done. Verify with:
  sudo launchctl print system/com.vguardrail.policy-engine | grep -E 'state|pid'
  ls -la /var/run/vguardrail/policy.sock
  tail -n 20 /var/log/vguardrail/pe-engined.log
EOF
