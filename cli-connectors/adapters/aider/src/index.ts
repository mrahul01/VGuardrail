/**
 * VGuardrail CLI Adapter for Aider
 *
 * This adapter wraps Aider (`aider`) to provide policy enforcement
 * for AI-assisted coding.
 *
 * Usage:
 *   vg-aider [aider arguments...]
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
 * Extract context from Aider CLI arguments.
 *
 * Aider supports several patterns:
 * - `aider --message "prompt" file.py` / `aider -m "prompt"` - one-shot message
 * - `aider --message-file prompt.txt` - message read from a file (scanned)
 * - `aider [files...]` - interactive chat session (not scanned)
 */
async function extractContext(args: string[]): Promise<ExtractionResult> {
  let message = '';
  let messageFile = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle --message / --msg / -m flag
    if ((arg === '--message' || arg === '--msg' || arg === '-m') && i + 1 < args.length) {
      message = args[++i];
    }
    // Handle --message="value" / --msg="value" format
    else if (arg.startsWith('--message=')) {
      message = arg.slice('--message='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('--msg=')) {
      message = arg.slice('--msg='.length).replace(/^["']|["']$/g, '');
    }
    // Handle --message-file flag
    else if (arg === '--message-file' && i + 1 < args.length) {
      messageFile = args[++i];
    }
    // Handle --message-file="value" format
    else if (arg.startsWith('--message-file=')) {
      messageFile = arg.slice('--message-file='.length).replace(/^["']|["']$/g, '');
    }
  }

  // Plain `aider` (no message) launches an interactive chat session.
  if (!message && !messageFile) {
    process.stderr.write(
      '[VGuardrail] Interactive Aider session: prompts typed inside the session are not intercepted.\n',
    );
    return { found: false };
  }

  // Read the message file so its contents are scanned.
  const files: Array<{ path: string; content: string }> = [];
  if (messageFile) {
    const content = readFileContent(messageFile);
    if (content === null) {
      // Fail closed: an unreadable message file cannot be scanned.
      return {
        found: false,
        error: `Cannot read --message-file: ${messageFile}`,
      };
    }
    files.push({ path: messageFile, content });
  }

  // The prompt is the inline message; a message file is scanned as file
  // content (and used as the prompt when no inline message is given).
  const prompt = message || (files.length > 0 ? files[0].content : '');

  return {
    found: true,
    context: createExtractionContext({
      prompt,
      files,
    }),
  };
}

/**
 * Find the real Aider executable path.
 *
 * Resolution order: VG_AIDER_PATH override, then a PATH scan that skips
 * VGuardrail launchers (so `alias aider='vg-aider'` cannot recurse),
 * then well-known install locations.
 */
function findAiderExecutable(): string {
  return resolveRealExecutable({
    names: ['aider'],
    envVar: 'VG_AIDER_PATH',
  });
}

/**
 * Create the Aider tool definition.
 */
export const aiderToolDefinition = createToolDefinition({
  name: 'aider',
  displayName: 'Aider',
  executablePath: findAiderExecutable(),
  extractContext: extractContext,
  provider: 'aider',
});

/**
 * Main entry point for the vg-aider command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: aiderToolDefinition,
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
