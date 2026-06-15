/**
 * Emergency bypass handling.
 *
 * Operators occasionally need to run a tool when the policy engine is
 * misbehaving (e.g. an incident where the agent itself is the outage).
 * The `--bypass` flag (or `VG_BYPASS=1` environment variable) skips the
 * policy scan entirely. It is intentionally loud: a warning is printed to
 * stderr and a best-effort audit acknowledgement is sent to the daemon so
 * the bypass leaves a trace.
 *
 * The flag is ALWAYS stripped before the arguments are forwarded to the
 * real tool, so the wrapped CLI never sees it.
 */

/**
 * The CLI flag that triggers an emergency bypass.
 */
export const BYPASS_FLAG = '--bypass';

/**
 * The environment variable equivalent of `--bypass`.
 * Only the exact value '1' activates the bypass.
 */
export const BYPASS_ENV_VAR = 'VG_BYPASS';

/**
 * Result of resolving the bypass state from arguments and environment.
 */
export interface BypassResolution {
  /** Whether the emergency bypass is active */
  bypass: boolean;
  /** The arguments with every `--bypass` occurrence removed */
  args: string[];
  /** Where the bypass was requested from, if active */
  source?: 'flag' | 'env';
}

/**
 * Resolve the bypass state from CLI arguments and the environment.
 *
 * - `--bypass` anywhere in the argument list activates the bypass and is
 *   stripped (all occurrences) from the forwarded arguments.
 * - `VG_BYPASS=1` activates the bypass without any argument changes.
 * - The flag takes precedence over the environment variable for the
 *   reported `source`.
 *
 * @param args - Raw CLI arguments (process.argv.slice(2))
 * @param env - Environment to consult (defaults to process.env)
 * @returns The bypass state and the sanitized argument list
 */
export function resolveBypass(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): BypassResolution {
  const stripped = args.filter((arg) => arg !== BYPASS_FLAG);
  const flagPresent = stripped.length !== args.length;
  const envPresent = env[BYPASS_ENV_VAR] === '1';

  if (flagPresent) {
    return { bypass: true, args: stripped, source: 'flag' };
  }

  if (envPresent) {
    return { bypass: true, args: stripped, source: 'env' };
  }

  return { bypass: false, args: stripped };
}

/**
 * Print the loud emergency-bypass warning to stderr.
 *
 * Deliberately unmissable: the user is running an AI tool with policy
 * enforcement disabled.
 */
export function printBypassWarning(toolName: string, source: 'flag' | 'env'): void {
  const via = source === 'flag' ? '--bypass flag' : `${BYPASS_ENV_VAR}=1 environment variable`;
  const lines = [
    '════════════════════════════════════════════════════════════════════',
    ' [VGuardrail] EMERGENCY BYPASS ACTIVE',
    ` [VGuardrail] Policy scanning is DISABLED for this ${toolName} run`,
    ` [VGuardrail] Requested via ${via}`,
    ' [VGuardrail] This invocation is being recorded for audit purposes.',
    '════════════════════════════════════════════════════════════════════',
  ];
  process.stderr.write(`\x1b[1;33m${lines.join('\n')}\x1b[0m\n`);
}
