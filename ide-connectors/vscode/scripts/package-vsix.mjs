#!/usr/bin/env node
// Produces a per-IDE .vsix from the shared extension.
//
// Usage: node scripts/package-vsix.mjs <vscode|cursor|windsurf|trae|antigravity>
//
// The targets share one codebase; only the marketplace-facing
// displayName/description differ. The script temporarily rewrites
// package.json, runs `vsce package --no-dependencies` (the bundle is
// self-contained via esbuild), and always restores the manifest. When vsce is
// not installed, the dist build is still produced and the script prints the
// exact packaging instructions instead of failing.

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = {
  vscode: 'VGuardrail for VS Code',
  cursor: 'VGuardrail for Cursor',
  windsurf: 'VGuardrail for Windsurf',
  trae: 'VGuardrail for Trae',
  antigravity: 'VGuardrail for Antigravity',
};

const target = process.argv[2];
if (target === undefined || TARGETS[target] === undefined) {
  console.error(`usage: node scripts/package-vsix.mjs <${Object.keys(TARGETS).join('|')}>`);
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'package.json');

function run(command) {
  execSync(command, { cwd: root, stdio: 'inherit' });
}

/** Returns an invocable vsce command, or undefined when unavailable. */
function resolveVsce() {
  for (const candidate of ['vsce', 'npx --no-install @vscode/vsce']) {
    const probe = spawnSync(candidate, ['--version'], { cwd: root, shell: true, stdio: 'ignore' });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}

// 1. Always produce the runnable bundle.
run('npm run build');

const original = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(original);
const outFile = `vguardrail-ide-${target}-${manifest.version}.vsix`;

const vsce = resolveVsce();
if (vsce === undefined) {
  console.log(`
dist/extension.js built for "${target}", but vsce is not installed so no .vsix was produced.
To package, install vsce and re-run:

  npm install -D @vscode/vsce
  npm run package:${target}

(or globally: npm install -g @vscode/vsce)`);
  process.exit(0);
}

// 2. Rewrite the marketplace-facing fields for this IDE, package, restore.
manifest.displayName = TARGETS[target];
manifest.description = `${TARGETS[target]} — scans prompts and pasted content against the local VGuardrail policy engine before they reach an AI provider.`;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
try {
  run(`${vsce} package --no-dependencies --allow-missing-repository -o ${outFile}`);
  console.log(`\npackaged: ${outFile}`);
} finally {
  writeFileSync(manifestPath, original);
}
