/**
 * VGuardrail hook for Claude Code (`vg-claude-hook`).
 *
 * Unlike `vg-claude` (which wraps the CLI and scans the prompt passed on the
 * command line), this binary is wired into Claude Code's native hook system so
 * it scans prompts typed *inside* an interactive session — and the commands
 * Claude itself runs.
 *
 * It is invoked by Claude Code with a JSON event on stdin and communicates its
 * decision through stdout JSON (exit 0). Reference:
 *   UserPromptSubmit → { "prompt": "<text>", "session_id": "...", ... }
 *     block:  { "decision": "block", "reason": "..." }
 *     warn:   { "hookSpecificOutput": { "hookEventName": "UserPromptSubmit",
 *                                       "additionalContext": "..." } }
 *   PreToolUse → { "tool_name": "Bash", "tool_input": { "command": "..." }, ... }
 *     deny:   { "hookSpecificOutput": { "hookEventName": "PreToolUse",
 *                                       "permissionDecision": "deny",
 *                                       "permissionDecisionReason": "..." } }
 *
 * Fail-closed invariant: ANY exit code other than 0/2 makes Claude Code ALLOW
 * the prompt, so this hook must catch every error and emit a block itself. It
 * never exits non-zero.
 */

import {
  PolicyClient,
  buildScanRequest,
  createExtractionContext,
  loadConfig,
  resolveUserContext,
  warnTier,
  consumeOrRecordAck,
  prepareXpcEnvironment,
  type ToolDefinition,
  type UserContext,
  type Decision,
} from '@vguardrail/cli-framework';

/** What the hook prints to stdout (if anything) and the exit code to use. */
export interface HookOutput {
  stdout: string;
  exitCode: number;
}

/** The subset of the Claude Code hook payload we read. */
interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: { command?: string };
}

export interface HookDeps {
  client: Pick<PolicyClient, 'scan' | 'acknowledgeBypass'>;
  user: UserContext;
  /** Ack-store path override (tests). */
  ackStorePath?: string;
}

/**
 * Lightweight tool definition used only to populate the scan context
 * (`app`/`provider`). The hook never executes anything, so the executable and
 * extractor are stubs.
 */
const claudeHookTool: ToolDefinition = {
  name: 'claude-code',
  displayName: 'Claude Code',
  executablePath: '',
  extractContext: async () => ({ found: false }),
  provider: 'anthropic',
};

const ALLOW: HookOutput = { stdout: '', exitCode: 0 };

function blockPrompt(reason: string): HookOutput {
  return { stdout: JSON.stringify({ decision: 'block', reason }), exitCode: 0 };
}

function warnContext(reason: string): HookOutput {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[VGuardrail] warning: ${reason}`,
      },
    }),
    exitCode: 0,
  };
}

function denyTool(reason: string): HookOutput {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
    exitCode: 0,
  };
}

function scanText(text: string, deps: HookDeps): Promise<Decision> {
  return deps.client.scan(
    buildScanRequest({
      context: createExtractionContext({ prompt: text }),
      tool: claudeHookTool,
      user: deps.user,
    }),
  );
}

/** UserPromptSubmit: scan the typed prompt; block/warn/ack per risk tier. */
async function handleUserPrompt(input: HookInput, deps: HookDeps): Promise<HookOutput> {
  const prompt = input.prompt ?? '';
  if (prompt.trim().length === 0) return ALLOW;

  const decision = await scanText(prompt, deps);

  if (decision.action === 'allow') return ALLOW;
  if (decision.action === 'block') return blockPrompt(decision.reason);

  // WARN — branch on risk tier (identical semantics to the other connectors).
  switch (warnTier(decision.riskLevel)) {
    case 'block':
      return blockPrompt(`${decision.reason} | high risk — blocked, no override`);
    case 'notice':
      return warnContext(decision.reason);
    case 'prompt': {
      // No interactive dialog is possible inside a hook, so a medium-risk
      // prompt is blocked once; resubmitting the SAME prompt within 60s (keyed
      // by session) acknowledges and proceeds.
      const scope = `claude-hook:${input.session_id ?? 'no-session'}`;
      const acknowledged = consumeOrRecordAck(
        scope,
        prompt,
        deps.ackStorePath !== undefined ? { storePath: deps.ackStorePath } : {},
      );
      if (acknowledged) {
        deps.client.acknowledgeBypass('warn:claude-code').catch(() => {});
        return warnContext(`acknowledged — ${decision.reason}`);
      }
      return blockPrompt(
        `medium risk: ${decision.reason} — resubmit the same prompt within 60 seconds to acknowledge and proceed.`,
      );
    }
  }
}

/** PreToolUse: gate the commands Claude itself runs (Bash only). */
async function handlePreTool(input: HookInput, deps: HookDeps): Promise<HookOutput> {
  if (input.tool_name !== 'Bash') return ALLOW;
  const command = input.tool_input?.command ?? '';
  if (command.trim().length === 0) return ALLOW;

  const decision = await scanText(command, deps);
  if (decision.action === 'block' || (decision.action === 'warn' && warnTier(decision.riskLevel) === 'block')) {
    return denyTool(decision.reason);
  }
  // Medium/low warns on a model-generated command don't get the resubmit
  // dance (the user didn't type it); critical detections already force-block
  // engine-side. Allow.
  return ALLOW;
}

/**
 * Pure hook core: maps a raw stdin payload to the stdout/exit-code contract.
 * Always fails closed — any parse/transport/unexpected error blocks.
 */
export async function runHook(rawInput: string, deps: HookDeps): Promise<HookOutput> {
  let input: HookInput;
  try {
    input = JSON.parse(rawInput) as HookInput;
  } catch {
    return blockPrompt('security check unavailable (malformed hook input) — prompt blocked (fail-closed)');
  }

  try {
    switch (input.hook_event_name) {
      case 'UserPromptSubmit':
        return await handleUserPrompt(input, deps);
      case 'PreToolUse':
        return await handlePreTool(input, deps);
      default:
        // Unknown event: nothing to enforce, allow.
        return ALLOW;
    }
  } catch {
    // A scan that throws past safeScan, or any other failure: fail closed for
    // prompts; for tool calls a deny is the safe choice too.
    if (input.hook_event_name === 'PreToolUse') {
      return denyTool('security check unavailable — command blocked (fail-closed)');
    }
    return blockPrompt('security check unavailable — prompt blocked (fail-closed)');
  }
}

/** Reads all of stdin. */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

/** Binary entry point. */
export async function main(): Promise<void> {
  // GUI/hook launches lack a shell PATH and may use the user LaunchAgent.
  prepareXpcEnvironment();

  const config = loadConfig();
  const deps: HookDeps = {
    client: new PolicyClient({ timeoutMs: config.timeoutMs }),
    user: resolveUserContext(config.user),
  };

  let output: HookOutput;
  try {
    output = await runHook(await readStdin(), deps);
  } catch {
    // Absolute backstop — never let an unexpected throw exit non-zero (which
    // Claude Code would treat as "allow").
    output = blockPrompt('security check unavailable — prompt blocked (fail-closed)');
  }

  if (output.stdout.length > 0) process.stdout.write(output.stdout);
  process.exit(output.exitCode);
}
