/**
 * VGuardrail CLI Adapter for Shell-GPT
 *
 * This adapter wraps Shell-GPT (`sgpt`) to provide policy enforcement
 * for AI-assisted shell usage.
 *
 * Usage:
 *   vg-sgpt [sgpt arguments...]
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
 * Shell-GPT flags that consume the next argument as their value.
 * Their values must not be mistaken for the positional prompt.
 * (`--chat` and `--repl` take a session id and are handled explicitly.)
 */
const VALUE_FLAGS = new Set([
  '--model',
  '--temperature',
  '--top-p',
  '--top-probability',
  '--role',
  '--create-role',
  '--show-role',
  '--show-chat',
]);

/**
 * Extract context from Shell-GPT CLI arguments.
 *
 * Shell-GPT supports several patterns:
 * - `sgpt "prompt"` - the first positional argument is the prompt
 * - `sgpt --chat <session> "prompt"` - chat session with a one-shot prompt
 * - `sgpt --repl <session>` - interactive REPL (not scanned)
 * - `cat error.log | sgpt "explain"` - piped stdin (scanned, re-supplied)
 */
export async function extractContext(args: string[]): Promise<ExtractionResult> {
  let positionalPrompt = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // REPL sessions are interactive: there is no one-shot prompt to scan.
    if (arg === '--repl' || arg.startsWith('--repl=')) {
      process.stderr.write(
        '[VGuardrail] Interactive Shell-GPT REPL session: prompts typed inside the session are not intercepted.\n',
      );
      return { found: false };
    }
    // `--chat <session>` - the session id is not the prompt.
    else if (arg === '--chat' && i + 1 < args.length) {
      i++;
    }
    // Skip the value of known value-taking flags
    else if (VALUE_FLAGS.has(arg)) {
      i++;
    }
    // Skip other flags (boolean flags and `--flag=value` forms)
    else if (arg.startsWith('-')) {
      continue;
    }
    // The first positional argument is the prompt.
    else if (!positionalPrompt) {
      positionalPrompt = arg;
    }
  }

  let prompt = positionalPrompt;

  // Piped input is part of the model context: capture it for scanning and
  // re-supply it to the real tool on allow (covers `cat error.log | sgpt "explain"`).
  let stdinData: string | undefined;
  if (isStdinPiped()) {
    stdinData = await readStdin();
    if (!prompt) {
      prompt = stdinData;
    }
  }

  if (!prompt && !stdinData) {
    process.stderr.write(
      '[VGuardrail] No prompt detected; passing through to Shell-GPT without scanning.\n',
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
 * Find the real Shell-GPT executable path.
 *
 * Resolution order: VG_SGPT_PATH override, then a PATH scan that skips
 * VGuardrail launchers (so `alias sgpt='vg-sgpt'` cannot recurse),
 * then well-known install locations.
 */
function findSgptExecutable(): string {
  return resolveRealExecutable({
    names: ['sgpt'],
    envVar: 'VG_SGPT_PATH',
  });
}

/**
 * Create the Shell-GPT tool definition.
 */
export const sgptToolDefinition = createToolDefinition({
  name: 'sgpt',
  displayName: 'Shell-GPT',
  executablePath: findSgptExecutable(),
  extractContext: extractContext,
  provider: 'sgpt',
});

/**
 * Main entry point for the vg-sgpt command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: sgptToolDefinition,
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
