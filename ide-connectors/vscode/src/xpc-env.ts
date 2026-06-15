// XPC environment preparation for GUI-launched IDEs.
//
// Two realities of macOS GUI apps that break the SDK's defaults:
//   1. GUI processes don't inherit a shell PATH — /usr/local/bin is absent, so
//      the bare `vguardrail-xpc-bridge` helper name never resolves.
//   2. Local dev runs vguardiand as a per-user LaunchAgent, whose mach service
//      lives in the user launchd domain; the bridge must be told to look there
//      (VG_XPC_USER_AGENT=1) instead of the production system domain.
//
// Deliberately free of any `vscode` import (unit-testable).

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Where install-wrappers/bridge installs put the signed helper. */
export const DEFAULT_BRIDGE_PATH = '/usr/local/bin/vguardrail-xpc-bridge';

/** Marker that the local-dev user LaunchAgent owns the agent mach service. */
const LOCAL_AGENT_PLIST = 'Library/LaunchAgents/com.vguardrail.agent.local.plist';

/**
 * Populates the environment the SDK's XpcBridgeTransport reads at connect
 * time. Explicit user-provided values always win — only unset variables are
 * filled in.
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
