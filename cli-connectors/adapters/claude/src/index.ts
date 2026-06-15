/**
 * VGuardrail CLI Adapter for Claude Code
 *
 * This adapter wraps the Claude Code CLI tool to provide
 * policy enforcement for AI-assisted coding.
 *
 * Usage:
 *   vg-claude [claude-code arguments...]
 */

import {
  CliConnector,
  createToolDefinition,
  createExtractionContext,
  readFiles,
  resolveRealExecutable,
  type ExtractionResult,
} from '@vguardrail/cli-framework';

/**
 * Extract context from Claude Code CLI arguments.
 *
 * Claude Code supports several patterns:
 * - `claude "prompt text"` - positional argument
 * - `claude --prompt "prompt text"` - explicit prompt flag
 * - `claude --read file.txt` - file inclusion
 * - Piped input via stdin
 */
async function extractContext(args: string[]): Promise<ExtractionResult> {
  let prompt = '';
  const filesToRead: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle --prompt flag
    if (arg === '--prompt' && i + 1 < args.length) {
      prompt = args[++i];
    }
    // Handle --prompt="value" format
    else if (arg.startsWith('--prompt=')) {
      prompt = arg.slice('--prompt='.length).replace(/^["']|["']$/g, '');
    }
    // Handle --read flag
    else if (arg === '--read' && i + 1 < args.length) {
      filesToRead.push(args[++i]);
    }
    // Handle positional argument (first non-flag argument is the prompt)
    else if (!arg.startsWith('-') && prompt === '') {
      prompt = arg;
    }
  }

  // Check for piped input (stdin)
  const hasStdin = !process.stdin.isTTY;

  // If no prompt found and no stdin, this might be an interactive session
  if (!prompt && !hasStdin && filesToRead.length === 0) {
    return { found: false }; // No context to scan
  }

  // Read referenced files
  const fileContents = readFiles(filesToRead);

  return {
    found: true,
    context: createExtractionContext({
      prompt,
      files: fileContents,
    }),
  };
}

/**
 * Find the real Claude Code executable path.
 *
 * Resolution order: VG_CLAUDE_PATH override, then a PATH scan that skips
 * VGuardrail launchers (so `alias claude='vg-claude'` cannot recurse),
 * then well-known install locations.
 */
function findClaudeExecutable(): string {
  return resolveRealExecutable({
    names: ['claude', 'claude-code'],
    envVar: 'VG_CLAUDE_PATH',
  });
}

/**
 * Create the Claude Code tool definition.
 */
export const claudeToolDefinition = createToolDefinition({
  name: 'claude-code',
  displayName: 'Claude Code',
  executablePath: findClaudeExecutable(),
  extractContext: extractContext,
  provider: 'anthropic',
  defaultModel: 'claude-opus-4',
});

/**
 * Main entry point for the vg-claude command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: claudeToolDefinition,
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
