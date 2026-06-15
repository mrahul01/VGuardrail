/**
 * VGuardrail CLI Adapter for the Gemini CLI
 *
 * This adapter wraps Google's Gemini CLI (`gemini`) to provide
 * policy enforcement for AI-assisted coding.
 *
 * Usage:
 *   vg-gemini [gemini arguments...]
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
 * Gemini CLI flags that consume the next argument as their value.
 * Their values must not be mistaken for positional prompt text.
 */
const VALUE_FLAGS = new Set([
  '-m',
  '--model',
  '-e',
  '--extensions',
  '--include-directories',
  '--proxy',
  '--sandbox-image',
  '--allowed-mcp-server-names',
  '--allowed-tools',
  '--approval-mode',
  '--telemetry-target',
  '--telemetry-otlp-endpoint',
  '--telemetry-outfile',
]);

/**
 * Extract context from Gemini CLI arguments.
 *
 * The Gemini CLI supports several patterns:
 * - `gemini "prompt text"` - positional arguments (joined)
 * - `gemini -p "prompt text"` / `gemini --prompt "prompt text"` - prompt flag
 * - `gemini -i` / `gemini --interactive` - interactive session (not scanned)
 * - Piped input via stdin (`cat notes.txt | gemini`)
 */
async function extractContext(args: string[]): Promise<ExtractionResult> {
  let flagPrompt = '';
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Interactive session: there is no one-shot prompt to scan.
    if (arg === '-i' || arg === '--interactive') {
      process.stderr.write(
        '[VGuardrail] Interactive Gemini session: no prompt to scan; prompts typed inside the session are not intercepted.\n',
      );
      return { found: false };
    }
    // Handle -p / --prompt flag
    else if ((arg === '-p' || arg === '--prompt') && i + 1 < args.length) {
      flagPrompt = args[++i];
    }
    // Handle --prompt="value" format
    else if (arg.startsWith('--prompt=')) {
      flagPrompt = arg.slice('--prompt='.length).replace(/^["']|["']$/g, '');
    }
    // Skip the value of known value-taking flags
    else if (VALUE_FLAGS.has(arg)) {
      i++;
    }
    // Collect positional arguments (joined into the prompt)
    else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  let prompt = flagPrompt || positional.join(' ');

  // Piped input is part of the model context: capture it for scanning and
  // re-supply it to the real tool on allow.
  let stdinData: string | undefined;
  if (isStdinPiped()) {
    stdinData = await readStdin();
    if (!prompt) {
      prompt = stdinData;
    }
  }

  if (!prompt && !stdinData) {
    process.stderr.write(
      '[VGuardrail] No prompt detected; passing through to Gemini without scanning.\n',
    );
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
 * Find the real Gemini CLI executable path.
 *
 * Resolution order: VG_GEMINI_PATH override, then a PATH scan that skips
 * VGuardrail launchers (so `alias gemini='vg-gemini'` cannot recurse),
 * then well-known install locations.
 */
function findGeminiExecutable(): string {
  return resolveRealExecutable({
    names: ['gemini'],
    envVar: 'VG_GEMINI_PATH',
  });
}

/**
 * Create the Gemini CLI tool definition.
 */
export const geminiToolDefinition = createToolDefinition({
  name: 'gemini-cli',
  displayName: 'Gemini CLI',
  executablePath: findGeminiExecutable(),
  extractContext: extractContext,
  provider: 'google',
  defaultModel: 'gemini-2.5-pro',
  // Opt-in best-effort PTY guard for `gemini` interactive sessions
  // (VG_INTERACTIVE_GUARD=1 / --interactive-guard). Ctrl+U clears the input.
  interactive: { clearInputSequence: '\x15' },
});

/**
 * Main entry point for the vg-gemini command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: geminiToolDefinition,
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
