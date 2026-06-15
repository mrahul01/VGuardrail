/**
 * VGuardrail CLI Adapter for MLX LM
 *
 * This adapter wraps Apple's MLX LM generation CLI (`mlx_lm.generate`)
 * to provide policy enforcement for locally hosted models.
 *
 * Usage:
 *   vg-mlx [mlx_lm.generate arguments...]
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
 * Extract context from MLX LM CLI arguments.
 *
 * mlx_lm.generate supports several patterns:
 * - `mlx_lm.generate --prompt "text"` / `--prompt="text"` - inline prompt
 * - `cat notes.txt | mlx_lm.generate --prompt -` - prompt read from stdin
 *   (captured, scanned, and re-supplied)
 * - No --prompt - nothing to scan; passed through with a notice
 */
export async function extractContext(args: string[]): Promise<ExtractionResult> {
  let prompt = '';
  let hasPromptFlag = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle --prompt flag
    if (arg === '--prompt' && i + 1 < args.length) {
      hasPromptFlag = true;
      prompt = args[++i];
    }
    // Handle --prompt="value" format
    else if (arg.startsWith('--prompt=')) {
      hasPromptFlag = true;
      prompt = arg.slice('--prompt='.length).replace(/^["']|["']$/g, '');
    }
  }

  if (!hasPromptFlag) {
    process.stderr.write(
      '[VGuardrail] No --prompt detected; passing through to MLX LM without scanning.\n',
    );
    return { found: false };
  }

  // `--prompt -` reads the prompt from stdin: capture it for scanning and
  // re-supply it to the real tool on allow.
  let stdinData: string | undefined;
  if (prompt === '-') {
    if (!isStdinPiped()) {
      process.stderr.write(
        '[VGuardrail] --prompt - with no piped stdin: the prompt is typed into the terminal and is not intercepted. Passing through without scanning.\n',
      );
      return { found: false };
    }
    stdinData = await readStdin();
    prompt = stdinData;
  }

  if (!prompt) {
    process.stderr.write(
      '[VGuardrail] Empty prompt; passing through to MLX LM without scanning.\n',
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
 * Find the real MLX LM executable path.
 *
 * Resolution order: VG_MLX_BIN override, then a PATH scan that skips
 * VGuardrail launchers (so `alias mlx_lm.generate='vg-mlx'` cannot
 * recurse), then well-known install locations.
 */
function findMlxExecutable(): string {
  return resolveRealExecutable({
    names: ['mlx_lm.generate'],
    envVar: 'VG_MLX_BIN',
  });
}

/**
 * Create the MLX LM tool definition.
 */
export const mlxToolDefinition = createToolDefinition({
  name: 'mlx-lm',
  displayName: 'MLX LM',
  executablePath: findMlxExecutable(),
  extractContext: extractContext,
  provider: 'mlx',
});

/**
 * Main entry point for the vg-mlx command.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const connector = new CliConnector({
    tool: mlxToolDefinition,
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
