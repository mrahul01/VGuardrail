/**
 * VGuardrail CLI Adapter for the GitHub Copilot CLI
 *
 * This adapter wraps `gh` to provide policy enforcement for the
 * Copilot extension (`gh copilot suggest` / `gh copilot explain`).
 * Every other `gh` invocation passes through untouched - the FULL
 * original argv (including `copilot`) is always forwarded to the
 * real `gh` binary.
 *
 * Usage:
 *   vg-gh-copilot copilot suggest "install ffmpeg"
 *   vg-gh-copilot [any other gh arguments...]
 */

import {
  CliConnector,
  createToolDefinition,
  createExtractionContext,
  resolveRealExecutable,
  type ExtractionResult,
} from '@vguardrail/cli-framework';

/**
 * `gh copilot` flags that consume the next argument as their value.
 * Their values must not be mistaken for the positional prompt.
 */
const VALUE_FLAGS = new Set(['-t', '--target', '--hostname']);

/**
 * Extract context from GitHub Copilot CLI arguments.
 *
 * The Copilot extension supports:
 * - `gh copilot suggest "<prompt>"` - command suggestion (scanned)
 * - `gh copilot explain "<command>"` - command explanation (scanned)
 * - `gh copilot suggest` / `gh copilot` - interactive prompt (not scanned)
 * - Any other `gh` invocation - passed through unscanned
 */
export async function extractContext(args: string[]): Promise<ExtractionResult> {
  // Only `gh copilot ...` carries a prompt; every other gh invocation
  // (pr, issue, api, ...) is not an AI prompt surface.
  if (args.length === 0 || args[0] !== 'copilot') {
    process.stderr.write(
      '[VGuardrail] Not a GitHub Copilot invocation; passing through to gh without scanning.\n',
    );
    return { found: false };
  }

  // Locate the copilot subcommand and the positional prompt after it,
  // skipping flags (and the values of value-taking flags like -t/--target).
  let subcommand = '';
  let prompt = '';
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    if (!subcommand) {
      subcommand = arg;
      continue;
    }
    if (!prompt) {
      prompt = arg;
    }
  }

  if (subcommand !== 'suggest' && subcommand !== 'explain') {
    if (!subcommand) {
      process.stderr.write(
        '[VGuardrail] Interactive Copilot session: prompts typed inside the session are not intercepted.\n',
      );
    } else {
      process.stderr.write(
        `[VGuardrail] Copilot maintenance command "${subcommand}": no prompt to scan; passing through.\n`,
      );
    }
    return { found: false };
  }

  if (!prompt) {
    process.stderr.write(
      `[VGuardrail] gh copilot ${subcommand} without an inline prompt is interactive; prompts typed inside the session are not intercepted.\n`,
    );
    return { found: false };
  }

  return {
    found: true,
    context: createExtractionContext({ prompt }),
  };
}

/**
 * Find the real gh executable path.
 *
 * Resolution order: VG_GH_PATH override, then a PATH scan that skips
 * VGuardrail launchers (so `alias gh='vg-gh-copilot'` cannot recurse),
 * then well-known install locations.
 */
function findGhExecutable(): string {
  return resolveRealExecutable({
    names: ['gh'],
    envVar: 'VG_GH_PATH',
  });
}

/**
 * Create the GitHub Copilot CLI tool definition.
 */
export const ghCopilotToolDefinition = createToolDefinition({
  name: 'gh-copilot',
  displayName: 'GitHub Copilot CLI',
  executablePath: findGhExecutable(),
  extractContext: extractContext,
  provider: 'github',
});

/**
 * Main entry point for the vg-gh-copilot command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: ghCopilotToolDefinition,
    verbose: args.includes('--verbose') || process.env.VG_VERBOSE === '1',
  });

  // The connector forwards the full original argv (including `copilot`
  // and all flags) verbatim to the real `gh` binary on allow.
  await connector.run(args);
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
}
