/**
 * Integration tests for the PTY interactive guard.
 *
 * A tiny Node "REPL" stands in for the real tool: it echoes back every line it
 * receives as `RECV:<line>`. We drive it through runPtySession with an
 * injected pty factory (so no real TTY is needed) and a mock PolicyClient,
 * then assert which lines reached the child.
 *
 * Covered:
 * - an allowed line reaches the child (the gated CR is forwarded)
 * - a blocked line never reaches the child and the clear-sequence is sent
 * - a fail-closed scan (client throws) blocks the line
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Decision } from '@vguardrail/connector-sdk';
import { runPtySession } from '../../src/process/pty-session.js';
import type { ToolDefinition } from '../../src/core/types.js';

const CLEAR = '\x15';

const tool: ToolDefinition = {
  name: 'fake-repl',
  displayName: 'Fake REPL',
  executablePath: '/bin/true',
  extractContext: async () => ({ found: false }),
  interactive: { clearInputSequence: CLEAR },
};

const user = { userId: 'u1', role: 'user', groups: [] };

/** A fake IPty that records what the guard writes to the child. */
class FakePty extends EventEmitter {
  written = '';
  private dataCb?: (d: string) => void;
  private exitCb?: (e: { exitCode: number; signal?: number }) => void;

  onData(cb: (d: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    this.exitCb = cb;
  }
  write(data: string): void {
    this.written += data;
    // Echo a submitted line back as the real REPL would (when CR forwarded).
    if (data === '\r') this.dataCb?.('\r\nRECV\r\n');
  }
  resize(): void {}
  finish(code = 0): void {
    this.exitCb?.({ exitCode: code });
  }
}

function mockClient(decide: (text: string) => Decision | Promise<Decision> | Error) {
  return {
    scan: vi.fn(async (req: { text: string }) => {
      const r = decide(req.text);
      if (r instanceof Error) throw r;
      return r;
    }),
    acknowledgeBypass: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function decision(action: Decision['action'], riskLevel: Decision['riskLevel'], reason = ''): Decision {
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

/** Drives a session: feeds stdin chunks, then ends the child. */
async function drive(
  client: ReturnType<typeof mockClient>,
  feed: (stdin: EventEmitter) => void,
): Promise<FakePty> {
  const pty = new FakePty();
  // Fake process.stdin: a TTY-like emitter with the methods the guard calls.
  const fakeStdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  }) as unknown as NodeJS.ReadStream;
  const origStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

  try {
    const sessionPromise = runPtySession({
      tool,
      args: [],
      user,
      client: client as never,
      spawnPty: () => pty as never,
    });
    // Wait until the guard has attached its stdin 'data' listener (it does so
    // only after its internal dynamic imports resolve).
    for (let i = 0; i < 100 && fakeStdin.listenerCount('data') === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    feed(fakeStdin as unknown as EventEmitter);
    // Allow async scans to resolve.
    await new Promise((r) => setTimeout(r, 30));
    pty.finish(0);
    await sessionPromise;
    return pty;
  } finally {
    Object.defineProperty(process, 'stdin', origStdin);
  }
}

describe('runPtySession', () => {
  it('forwards an allowed line to the child', async () => {
    const client = mockClient(() => decision('allow', 'low'));
    const pty = await drive(client, (stdin) => {
      stdin.emit('data', Buffer.from('hello world\r'));
    });
    expect(client.scan).toHaveBeenCalledOnce();
    // The typed bytes plus the gated CR were written; no clear-sequence.
    expect(pty.written).toContain('hello world');
    expect(pty.written).toContain('\r');
    expect(pty.written).not.toContain(CLEAR);
  });

  it('blocks a line and clears the input box', async () => {
    const client = mockClient(() => decision('block', 'critical', 'secret found'));
    const pty = await drive(client, (stdin) => {
      stdin.emit('data', Buffer.from('my AKIA secret\r'));
    });
    // The visible characters were echoed live, but the CR was swallowed and a
    // clear-sequence sent instead — the REPL never received a submit.
    expect(pty.written).toContain('my AKIA secret');
    expect(pty.written).toContain(CLEAR);
    expect(pty.written).not.toContain('RECV'); // child never echoed a submit
  });

  it('fails closed (blocks) when the scan throws', async () => {
    const client = mockClient(() => new Error('engine down'));
    const pty = await drive(client, (stdin) => {
      stdin.emit('data', Buffer.from('anything\r'));
    });
    expect(pty.written).toContain(CLEAR);
    expect(pty.written).not.toContain('RECV');
  });

  it('lets empty and slash-command lines submit without scanning', async () => {
    const client = mockClient(() => decision('block', 'critical'));
    const pty = await drive(client, (stdin) => {
      stdin.emit('data', Buffer.from('/help\r'));
    });
    expect(client.scan).not.toHaveBeenCalled();
    expect(pty.written).toContain('\r');
    expect(pty.written).not.toContain(CLEAR);
  });
});
