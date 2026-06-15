/**
 * VGuardrail CLI Adapter for Ollama
 *
 * This adapter wraps Ollama (`ollama`) to provide policy enforcement
 * for locally hosted models.
 *
 * Usage:
 *   vg-ollama [ollama arguments...]
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
 * `ollama run` flags that consume the next argument as their value.
 * Their values must not be mistaken for the model or prompt words.
 */
const VALUE_FLAGS = new Set(['--format', '--keepalive', '--think']);

/**
 * Extract context from Ollama CLI arguments.
 *
 * Ollama supports several patterns:
 * - `ollama run <model> "prompt words..."` - one-shot prompt (scanned)
 * - `cat notes.txt | ollama run <model>` - piped prompt (scanned, re-supplied)
 * - `ollama run <model>` - interactive REPL (not scanned)
 * - `ollama pull/list/serve/...` - maintenance commands (passed through)
 */
export async function extractContext(args: string[]): Promise<ExtractionResult> {
  // Locate the subcommand: the first argument that is not a flag.
  let subcommand = '';
  let subcommandIndex = -1;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    subcommand = arg;
    subcommandIndex = i;
    break;
  }

  if (!subcommand) {
    process.stderr.write(
      '[VGuardrail] No Ollama subcommand detected; passing through without scanning.\n',
    );
    return { found: false };
  }

  // Only `ollama run` carries a one-shot prompt on the command line.
  if (subcommand !== 'run') {
    if (subcommand === 'chat') {
      process.stderr.write(
        '[VGuardrail] Ollama chat is an interactive session: prompts are exchanged inside the session and cannot be intercepted per-message; passing through without scanning.\n',
      );
    } else {
      process.stderr.write(
        `[VGuardrail] Ollama maintenance command "${subcommand}": no prompt to scan; passing through.\n`,
      );
    }
    return { found: false };
  }

  // `ollama run <model> [prompt words...]` - the first positional after
  // `run` is the model; every positional after that is the prompt.
  let model = '';
  const promptWords: string[] = [];
  for (let i = subcommandIndex + 1; i < args.length; i++) {
    const arg = args[i];
    // Skip the value of known value-taking flags
    if (VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    // Skip boolean flags and `--flag=value` forms
    if (arg.startsWith('-')) {
      continue;
    }
    if (!model) {
      model = arg;
      continue;
    }
    promptWords.push(arg);
  }

  let prompt = promptWords.join(' ');

  // Piped input is part of the model context: capture it for scanning and
  // re-supply it to the real tool on allow (covers `cat notes.txt | ollama run llama3`).
  let stdinData: string | undefined;
  if (isStdinPiped()) {
    stdinData = await readStdin();
    if (!prompt) {
      prompt = stdinData;
    }
  }

  if (!prompt && !stdinData) {
    process.stderr.write(
      '[VGuardrail] Interactive Ollama run session: prompts typed inside the session are not intercepted.\n',
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
 * Find the real Ollama executable path.
 *
 * Resolution order: VG_OLLAMA_PATH override, then a PATH scan that skips
 * VGuardrail launchers (so `alias ollama='vg-ollama'` cannot recurse),
 * then well-known install locations.
 */
function findOllamaExecutable(): string {
  return resolveRealExecutable({
    names: ['ollama'],
    envVar: 'VG_OLLAMA_PATH',
  });
}

/**
 * Create the Ollama tool definition.
 */
export const ollamaToolDefinition = createToolDefinition({
  name: 'ollama',
  displayName: 'Ollama',
  executablePath: findOllamaExecutable(),
  extractContext: extractContext,
  provider: 'ollama',
});

/**
 * Main entry point for the vg-ollama command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: ollamaToolDefinition,
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
