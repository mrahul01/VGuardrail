#!/usr/bin/env bash
# Installs the VGuardrail native-messaging host manifest for Microsoft Edge.
#
# Usage:
#   scripts/install-native-host.sh <EXTENSION_ID>
#
# <EXTENSION_ID> is the unpacked/published extension id (edge://extensions →
# the id under the VGuardrail Edge connector). Edge is Chromium, so this reuses
# chrome/native-host's installer (same host binary, same chrome-extension://
# origin scheme); only the per-browser NativeMessagingHosts directory differs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/../../chrome/native-host/scripts/install.sh"

VG_NM_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts" \
  exec "$INSTALLER" "$@"
