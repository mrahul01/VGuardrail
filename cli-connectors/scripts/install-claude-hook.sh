#!/usr/bin/env bash
#
# install-claude-hook.sh — wire the vg-claude-hook binary into Claude Code's
# UserPromptSubmit and PreToolUse hooks so prompts typed inside interactive
# sessions (and the Bash commands Claude runs) are scanned by VGuardrail.
#
# Usage:
#   ./install-claude-hook.sh                 # add/refresh the hook entries
#   ./install-claude-hook.sh --uninstall     # remove only our entries
#   HOOK_BIN=/custom/vg-claude-hook ./install-claude-hook.sh
#
# It performs an idempotent JSON merge into ~/.claude/settings.json: our two
# entries are keyed by the hook command path, so re-running replaces them in
# place and never touches other hooks. The original file is backed up once.
#
# Org-wide enforcement: to prevent users from removing the hook, place the same
# entries in /Library/Application Support/ClaudeCode/managed-settings.json and
# set "allowManagedHooksOnly": true (managed settings cannot be overridden by
# ~/.claude/settings.json). This script intentionally edits only the user file.

set -euo pipefail

HOOK_BIN="${HOOK_BIN:-/usr/local/bin/vg-claude-hook}"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
TIMEOUT_SECONDS="${HOOK_TIMEOUT:-10}"

UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null 2>&1 || { echo "python3 is required" >&2; exit 1; }

if [ "${UNINSTALL}" -eq 0 ] && [ ! -x "${HOOK_BIN}" ]; then
  echo "warning: ${HOOK_BIN} is not present/executable yet." >&2
  echo "         Run ./scripts/install-wrappers.sh first, then re-run this script." >&2
fi

mkdir -p "$(dirname "${SETTINGS}")"
[ -f "${SETTINGS}" ] || echo '{}' > "${SETTINGS}"
cp "${SETTINGS}" "${SETTINGS}.vguardrail.bak" 2>/dev/null || true

HOOK_BIN="${HOOK_BIN}" SETTINGS="${SETTINGS}" TIMEOUT_SECONDS="${TIMEOUT_SECONDS}" \
UNINSTALL="${UNINSTALL}" python3 <<'PY'
import json, os, sys

hook_bin = os.environ["HOOK_BIN"]
settings_path = os.environ["SETTINGS"]
timeout = int(os.environ["TIMEOUT_SECONDS"])
uninstall = os.environ["UNINSTALL"] == "1"

try:
    with open(settings_path) as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("settings.json is not a JSON object")
except (json.JSONDecodeError, ValueError) as e:
    print(f"error: {settings_path} is not valid JSON ({e}); leaving it untouched", file=sys.stderr)
    sys.exit(1)
except FileNotFoundError:
    data = {}

hooks = data.setdefault("hooks", {})

def strip_ours(event):
    """Remove any groups whose command is our hook binary."""
    groups = hooks.get(event, [])
    kept = []
    for group in groups:
        inner = [h for h in group.get("hooks", []) if h.get("command") != hook_bin]
        if inner:
            group["hooks"] = inner
            kept.append(group)
        elif not group.get("hooks"):
            # group had only our hook -> drop it entirely
            pass
    if kept:
        hooks[event] = kept
    elif event in hooks:
        del hooks[event]

# Always strip first so the operation is idempotent (replace-in-place).
strip_ours("UserPromptSubmit")
strip_ours("PreToolUse")

if not uninstall:
    hooks.setdefault("UserPromptSubmit", []).append({
        "hooks": [{"type": "command", "command": hook_bin, "timeout": timeout}]
    })
    hooks.setdefault("PreToolUse", []).append({
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": hook_bin, "timeout": timeout}]
    })

# Clean up an emptied hooks object.
if not hooks:
    data.pop("hooks", None)

with open(settings_path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print(("removed" if uninstall else "installed") + f" VGuardrail hooks in {settings_path}")
PY

if [ "${UNINSTALL}" -eq 0 ]; then
  echo
  echo "Claude Code will now scan interactive prompts and Bash commands via ${HOOK_BIN}."
  echo "Restart any running 'claude' session to pick up the new hooks."
  echo "For org-wide enforcement, replicate these entries into"
  echo "  /Library/Application Support/ClaudeCode/managed-settings.json"
  echo "  with \"allowManagedHooksOnly\": true"
fi
