// Best-effort interactive guard: runs a tool under a pseudo-terminal so each
// line the user submits is scanned before the child (e.g. an AI REPL) acts on
// it. Opt-in (VG_INTERACTIVE_GUARD=1 / --interactive-guard); the Claude Code
// hook is the deterministic path and is preferred where available.
//
// Design: keystrokes are forwarded to the child IMMEDIATELY so typing stays
// responsive; only the Enter key is intercepted. On Enter we scan the
// reconstructed line (see LineReconstructor) and, if blocked, swallow the
// newline and clear the child's input box instead of letting it submit.
//
// Limits (documented honestly in the README): cursor-editing / full-screen
// TUIs can desync the shadow buffer; such lines are flagged `dirty` and still
// scanned best-effort. This is mitigation, not a guarantee — unlike the hook.

import type { IPty } from 'node-pty';
import type { ScanRequest } from '@vguardrail/connector-sdk';

import type { ToolDefinition, UserContext, RepoContext } from '../core/types.js';
import { PolicyClient } from '../sdk/client.js';
import { buildScanRequest, createExtractionContext } from '../sdk/scan-request.js';
import { warnTier } from '../policy/enforcement.js';
import { consumeOrRecordAck } from '../util/ack-store.js';
import { logger } from '../util/logger.js';

const DEFAULT_CLEAR_SEQUENCE = '\x15'; // Ctrl+U

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export interface PtySessionOptions {
  tool: ToolDefinition;
  args: string[];
  user: UserContext;
  repo?: RepoContext;
  /** Injectable policy client (tests). Defaults to a fail-closed PolicyClient. */
  client?: PolicyClient;
  /** Injectable pty factory (tests). Defaults to node-pty's spawn. */
  spawnPty?: (file: string, args: string[], opts: PtySpawnOptions) => IPty;
  /** Ack-store path override (tests). */
  ackStorePath?: string;
}

interface PtySpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Writes a framed banner on its own lines so it is visible amid TUI output. */
function banner(color: string, message: string): string {
  return `\r\n${color}${BOLD}[VGuardrail]${RESET}${color} ${message}${RESET}\r\n`;
}

/**
 * Runs `tool` under a PTY with per-line scanning. Resolves with the child's
 * exit code. Falls back to a thrown error only if the PTY cannot be created;
 * the caller (connector) handles that by failing closed.
 */
export async function runPtySession(options: PtySessionOptions): Promise<number> {
  const { tool, args, user } = options;
  const clearSeq = tool.interactive?.clearInputSequence ?? DEFAULT_CLEAR_SEQUENCE;
  const client = options.client ?? new PolicyClient();

  // Lazy import so the native module is only required when the guard runs.
  const { spawn } = await import('node-pty');
  const spawnPty = options.spawnPty ?? ((f, a, o) => spawn(f, a, o));

  const { LineReconstructor } = await import('./line-reconstructor.js');
  const reconstructor = new LineReconstructor();

  const child = spawnPty(tool.executablePath, args, {
    name: process.env.TERM ?? 'xterm-256color',
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
    cwd: process.cwd(),
    env: process.env,
  });

  const stdin = process.stdin;
  const writeOut = (s: string): void => {
    process.stdout.write(s);
  };

  // Child → our stdout, verbatim.
  child.onData((data) => writeOut(data));

  // Raw mode so we see every keystroke; restore on exit.
  const wasRaw = stdin.isRaw === true;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();

  // Forward terminal resizes.
  const onResize = (): void => {
    try {
      child.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
    } catch {
      /* child may have exited */
    }
  };
  process.stdout.on('resize', onResize);

  const buildRequest = (text: string): ScanRequest =>
    buildScanRequest({
      context: createExtractionContext({ prompt: text }),
      tool,
      user,
      ...(options.repo !== undefined ? { repo: options.repo } : {}),
    });

  // Serialized FIFO processing: stdin chunks are appended to a queue and
  // drained by a single async loop. This preserves byte order even across the
  // await on a scan (a fast typist cannot race past the gate, and bytes that
  // arrive mid-scan are processed strictly after the line being gated).
  const queue: Buffer[] = [];
  let draining = false;

  const onStdin = (chunk: Buffer): void => {
    queue.push(chunk);
    if (!draining) void drain();
  };

  async function drain(): Promise<void> {
    draining = true;
    try {
      while (queue.length > 0) {
        // Take everything pending as one slice so a line split across chunk
        // boundaries reconstructs correctly; bytes that arrive during the
        // await below stay in `queue` for the next iteration (FIFO preserved).
        const pending = queue.splice(0);
        const slice = pending.length === 1 ? pending[0]! : Buffer.concat(pending);
        await processSlice(slice);
      }
    } finally {
      draining = false;
    }
  }

  async function processSlice(chunk: Buffer): Promise<void> {
    // Split at each Enter so the bytes BEFORE the newline reach the child
    // immediately, the newline is gated, and bytes after a permitted line
    // continue normally.
    let rest = chunk;
    for (;;) {
      const nlIndex = firstNewline(rest);
      if (nlIndex === -1) {
        if (rest.length > 0) {
          reconstructor.push(rest);
          child.write(rest.toString('binary'));
        }
        return;
      }

      const before = rest.subarray(0, nlIndex);
      if (before.length > 0) {
        reconstructor.push(before);
        child.write(before.toString('binary'));
      }
      const newlineByte = rest.subarray(nlIndex, nlIndex + 1);
      const submitted = reconstructor.push(newlineByte); // yields the line
      rest = rest.subarray(nlIndex + 1);

      const line = submitted[0];
      if (line === undefined || line.text.trim().length === 0 || line.text.startsWith('/')) {
        // Empty line or slash-command: nothing to scan — let it submit.
        child.write('\r');
        continue;
      }

      const proceed = await gateLine(line.text);
      child.write(proceed ? '\r' : clearSeq);
    }
  }

  async function gateLine(text: string): Promise<boolean> {
    let decision;
    try {
      decision = await client.scan(buildRequest(text));
    } catch (error) {
      logger.debug('PTY scan failed; blocking (fail-closed)', { error });
      writeOut(banner(RED, 'security check unavailable — line blocked (fail-closed)'));
      return false;
    }

    if (decision.action === 'allow') return true;

    if (decision.action === 'block') {
      writeOut(banner(RED, `BLOCKED: ${decision.reason}`));
      return false;
    }

    // WARN: branch on risk tier (same semantics as every other connector).
    switch (warnTier(decision.riskLevel)) {
      case 'block':
        writeOut(banner(RED, `BLOCKED (high risk, no override): ${decision.reason}`));
        return false;
      case 'notice':
        writeOut(banner(YELLOW, `warning: ${decision.reason}`));
        return true;
      case 'prompt': {
        const acknowledged = consumeOrRecordAck(
          `pty:${tool.name}`,
          text,
          options.ackStorePath !== undefined ? { storePath: options.ackStorePath } : {},
        );
        if (acknowledged) {
          writeOut(banner(YELLOW, `acknowledged: ${decision.reason}`));
          void client.acknowledgeBypass(`warn:${tool.name}`).catch(() => {});
          return true;
        }
        writeOut(
          banner(
            YELLOW,
            `medium risk: ${decision.reason} — resubmit the same line within 60s to proceed`,
          ),
        );
        return false;
      }
    }
  }

  stdin.on('data', onStdin);

  return new Promise<number>((resolve) => {
    child.onExit(({ exitCode, signal }) => {
      stdin.removeListener('data', onStdin);
      if (stdin.isTTY && !wasRaw) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.removeListener('resize', onResize);
      void client.close().catch(() => {});
      resolve(typeof signal === 'number' && signal > 0 ? 128 + signal : exitCode);
    });
  });
}

/** Index of the first CR or LF in a buffer, or -1. */
function firstNewline(buf: Buffer): number {
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0d || buf[i] === 0x0a) return i;
  }
  return -1;
}
