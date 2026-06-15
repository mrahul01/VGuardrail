/**
 * VGuardrail CLI Adapter for the llama.cpp CLI
 *
 * This adapter wraps the llama.cpp command-line tool to provide policy
 * enforcement for locally hosted models. The binary has been renamed
 * across llama.cpp versions (`llama-cli`, formerly `main`, sometimes
 * installed as `llama`), so resolution tries each name in order.
 *
 * Usage:
 *   vg-llama [llama.cpp arguments...]
 */

import {
  CliConnector,
  createToolDefinition,
  createExtractionContext,
  readFileContent,
  resolveRealExecutable,
  type ExtractionResult,
} from '@vguardrail/cli-framework';

/**
 * Extract context from llama.cpp CLI arguments.
 *
 * llama.cpp supports several patterns:
 * - `llama-cli -p "prompt"` / `--prompt "prompt"` (and `=` forms)
 * - `llama-cli -f prompt.txt` / `--file prompt.txt` - prompt read from a
 *   file (the file is read and scanned; unreadable files fail closed)
 * - No prompt flag - interactive/conversation mode (not scanned)
 */
export async function extractContext(args: string[]): Promise<ExtractionResult> {
  let prompt = '';
  let promptFile = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle -p / --prompt flag
    if ((arg === '-p' || arg === '--prompt') && i + 1 < args.length) {
      prompt = args[++i];
    }
    // Handle --prompt="value" / -p="value" formats
    else if (arg.startsWith('--prompt=')) {
      prompt = arg.slice('--prompt='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('-p=')) {
      prompt = arg.slice('-p='.length).replace(/^["']|["']$/g, '');
    }
    // Handle -f / --file flag (prompt read from a file)
    else if ((arg === '-f' || arg === '--file') && i + 1 < args.length) {
      promptFile = args[++i];
    }
    // Handle --file="value" / -f="value" formats
    else if (arg.startsWith('--file=')) {
      promptFile = arg.slice('--file='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('-f=')) {
      promptFile = arg.slice('-f='.length).replace(/^["']|["']$/g, '');
    }
  }

  // No prompt flag: llama.cpp runs interactively (or prints usage).
  if (!prompt && !promptFile) {
    process.stderr.write(
      '[VGuardrail] No -p/--prompt or -f/--file detected; interactive llama.cpp sessions are not intercepted. Passing through without scanning.\n',
    );
    return { found: false };
  }

  // Read the prompt file so its contents are scanned.
  const files: Array<{ path: string; content: string }> = [];
  if (promptFile) {
    const content = readFileContent(promptFile);
    if (content === null) {
      // Fail closed: an unreadable prompt file cannot be scanned.
      return {
        found: false,
        error: `Cannot read prompt file: ${promptFile}`,
      };
    }
    files.push({ path: promptFile, content });
  }

  // The prompt is the inline -p value; a prompt file is scanned as file
  // content (and used as the prompt when no inline prompt is given).
  const scanPrompt = prompt || (files.length > 0 ? files[0].content : '');

  return {
    found: true,
    context: createExtractionContext({
      prompt: scanPrompt,
      files,
    }),
  };
}

/**
 * Find the real llama.cpp executable path.
 *
 * Resolution order: VG_LLAMA_BIN override, then a PATH scan for
 * `llama-cli`, `main`, and `llama` (in that order) that skips VGuardrail
 * launchers (so `alias llama-cli='vg-llama'` cannot recurse), then
 * well-known install locations.
 */
function findLlamaExecutable(): string {
  return resolveRealExecutable({
    names: ['llama-cli', 'main', 'llama'],
    envVar: 'VG_LLAMA_BIN',
  });
}

/**
 * Create the llama.cpp tool definition.
 */
export const llamaToolDefinition = createToolDefinition({
  name: 'llama-cpp',
  displayName: 'llama.cpp',
  executablePath: findLlamaExecutable(),
  extractContext: extractContext,
  provider: 'llama-cpp',
});

/**
 * Main entry point for the vg-llama command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: llamaToolDefinition,
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
