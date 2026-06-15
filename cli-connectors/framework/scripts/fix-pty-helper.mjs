#!/usr/bin/env node
// node-pty ships a `spawn-helper` binary in its prebuilds, but npm's tarball
// extraction can drop the executable bit on it. Without +x, pty.fork() fails
// with "posix_spawnp failed". This postinstall restores the bit. No-op on
// platforms/layouts where the helper isn't present (e.g. Windows, or a
// source build that already chmodded it).

import { chmodSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const helper = join(
  root,
  'node_modules',
  'node-pty',
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'spawn-helper',
);

try {
  if (existsSync(helper)) {
    const mode = statSync(helper).mode;
    chmodSync(helper, mode | 0o111); // add execute for user/group/other
    console.log(`[vguardrail] ensured node-pty spawn-helper is executable: ${helper}`);
  }
} catch (error) {
  // Never fail the install over this — the guard is opt-in, and the runtime
  // surfaces a clear fail-closed error if the helper is still not runnable.
  console.warn(`[vguardrail] could not chmod node-pty spawn-helper: ${error.message}`);
}
