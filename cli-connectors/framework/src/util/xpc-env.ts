// XPC environment preparation shared by the wrappers, the Claude Code hook,
// and the PTY guard.
//
// Two launch realities break the connector-sdk's defaults:
//   1. Processes launched without a login shell (GUI apps, hook commands) may
//      lack /usr/local/bin on PATH, so the bare `vguardrail-xpc-bridge`
//      helper name never resolves.
//   2. Local dev runs vguardiand as a per-user LaunchAgent whose mach service
//      lives in the user launchd domain; the bridge must be told to look
//      there (VG_XPC_USER_AGENT=1) instead of the production system domain.
//
// Mirrors ide-connectors/vscode/src/xpc-env.ts. Explicit user-provided values
// always win — only unset variables are filled in.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Where the bridge installer puts the signed helper. */
export const DEFAULT_BRIDGE_PATH = '/usr/local/bin/vguardrail-xpc-bridge';

/** Marker that the local-dev user LaunchAgent owns the agent mach service. */
const LOCAL_AGENT_PLIST = 'Library/LaunchAgents/com.vguardrail.agent.local.plist';

/**
 * Populates the environment the SDK's XpcBridgeTransport reads at connect
 * time.
 */
export function prepareXpcEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  exists: (p: string) => boolean = fs.existsSync,
): void {
  if (env.VG_XPC_BRIDGE_PATH === undefined && exists(DEFAULT_BRIDGE_PATH)) {
    env.VG_XPC_BRIDGE_PATH = DEFAULT_BRIDGE_PATH;
  }
  if (env.VG_XPC_USER_AGENT === undefined && exists(path.join(home, LOCAL_AGENT_PLIST))) {
    env.VG_XPC_USER_AGENT = '1';
  }
}
