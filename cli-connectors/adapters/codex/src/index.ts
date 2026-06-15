/**
 * VGuardrail CLI Adapter for the OpenAI Codex CLI
 *
 * This adapter wraps the OpenAI Codex CLI (`codex`) to provide
 * policy enforcement for AI-assisted coding.
 *
 * Usage:
 *   vg-codex [codex arguments...]
 */

import {
  CliConnector,
  createToolDefinition,
  createExtractionContext,
  resolveRealExecutable,
  isStdinPiped,
  readStdin,
  type ExtractionResult,
} from '@vguardrail/cli-framework';

/**
 * Codex CLI flags that consume the next argument as their value.
 * Their values must not be mistaken for positional prompt text.
 */
const VALUE_FLAGS = new Set([
  '-m',
  '--model',
  '-p',
  '--profile',
  '-s',
  '--sandbox',
  '-a',
  '--ask-for-approval',
  '-c',
  '--config',
  '-C',
  '--cd',
  '-i',
  '--image',
  '--color',
  '--output-schema',
  '--output-last-message',
]);

/**
 * Codex subcommands that carry no prompt of their own.
 * These are passed through without scanning.
 */
const NON_PROMPT_SUBCOMMANDS = new Set([
  'login',
  'logout',
  'mcp',
  'proto',
  'completion',
  'debug',
  'apply',
  'resume',
  'sandbox',
]);

/**
 * Extract context from Codex CLI arguments.
 *
 * The Codex CLI supports several patterns:
 * - `codex "prompt text"` - positional arguments (joined)
 * - `codex exec "prompt text"` - non-interactive exec subcommand
 * - Piped input via stdin (`cat task.md | codex exec -`)
 */
async function extractContext(args: string[]): Promise<ExtractionResult> {
  const positional: string[] = [];
  let firstPositionalSeen = false;
  let execMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip the value of known value-taking flags
    if (VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }

    // Skip other flags; '-' is the conventional read-from-stdin marker.
    if (arg.startsWith('-') && arg !== '-') {
      continue;
    }

    if (!firstPositionalSeen) {
      firstPositionalSeen = true;

      // `codex exec <prompt>` - the prompt follows the subcommand.
      if (arg === 'exec') {
        execMode = true;
        continue;
      }

      // Maintenance subcommands carry no prompt; pass through unscanned.
      if (NON_PROMPT_SUBCOMMANDS.has(arg)) {
        return { found: false };
      }
    }

    if (arg !== '-') {
      positional.push(arg);
    }
  }

  let prompt = positional.join(' ');

  // Piped input is part of the model context: capture it for scanning and
  // re-supply it to the real tool on allow (covers `codex exec -`).
  let stdinData: string | undefined;
  if (isStdinPiped()) {
    stdinData = await readStdin();
    if (!prompt) {
      prompt = stdinData;
    }
  }

  if (!prompt && !stdinData) {
    if (execMode) {
      process.stderr.write(
        '[VGuardrail] No prompt detected for codex exec; passing through without scanning.\n',
      );
    }
    return { found: false };
  }

  return {
    found: true,
    context: createExtractionContext({
      prompt,
      ...(stdinData !== undefined ? { stdinData } : {}),
    }),
  };
}

/**
 * Find the real Codex CLI executable path.
 *
 * Resolution order: VG_CODEX_PATH override, then a PATH scan that skips
 * VGuardrail launchers (so `alias codex='vg-codex'` cannot recurse),
 * then well-known install locations.
 */
function findCodexExecutable(): string {
  return resolveRealExecutable({
    names: ['codex'],
    envVar: 'VG_CODEX_PATH',
  });
}

/**
 * Create the Codex CLI tool definition.
 */
export const codexToolDefinition = createToolDefinition({
  name: 'codex-cli',
  displayName: 'Codex CLI',
  executablePath: findCodexExecutable(),
  extractContext: extractContext,
  provider: 'openai',
  defaultModel: 'gpt-5-codex',
  // Opt-in best-effort PTY guard for `codex` interactive sessions
  // (VG_INTERACTIVE_GUARD=1 / --interactive-guard). Ctrl+U clears the input.
  interactive: { clearInputSequence: '\x15' },
});

/**
 * Main entry point for the vg-codex command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: codexToolDefinition,
    verbose: args.includes('--verbose') || process.env.VG_VERBOSE === '1',
  });

  await connector.run(args);
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`[VGuardrail] Fatal error: ${error.message}\n`);
    process.exit(1);
  });
}
