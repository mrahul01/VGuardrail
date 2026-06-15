import { describe, expect, it, vi } from 'vitest';
import type { Decision } from '../src/shared/contract.js';
import type { NativeResponse } from '../src/shared/protocol.js';
import { ackThroughTransports, scanThroughTransports, type ScanTransport } from '../src/background/transport.js';
import { NativeHostTransport } from '../src/background/transports/native.js';
import { SafariAppTransport } from '../src/background/transports/safari.js';

const decision = (action: Decision['action']): Decision => ({
  requestId: 'r',
  action,
  riskLevel: 'low',
  findings: [],
  reason: '',
});

// A fake chrome.runtime.Port that answers every request with a canned response.
class AnsweringPort {
  private cb: ((m: unknown) => void) | undefined;

  constructor(private readonly answer: (id: string) => NativeResponse) {}

  onMessage = { addListener: (cb: (m: unknown) => void) => { this.cb = cb; } };
  onDisconnect = { addListener: () => undefined };

  postMessage(message: unknown): void {
    const req = message as { id: string };
    queueMicrotask(() => this.cb?.(this.answer(req.id)));
  }
  disconnect(): void {}
}

const makePort = (answer: (id: string) => NativeResponse) => new AnsweringPort(answer);

describe('scanThroughTransports', () => {
  it('returns the first transport’s decision', async () => {
    const a: ScanTransport = { scan: vi.fn(async () => decision('allow')), ack: async () => true };
    const b: ScanTransport = { scan: vi.fn(async () => decision('warn')), ack: async () => true };
    const res = await scanThroughTransports([a, b], 'x', {});
    expect(res.action).toBe('allow');
    expect(b.scan).not.toHaveBeenCalled();
  });

  it('falls back to the next transport when one throws', async () => {
    const failing: ScanTransport = {
      scan: async () => {
        throw new Error('down');
      },
      ack: async () => false,
    };
    const ok: ScanTransport = { scan: async () => decision('warn'), ack: async () => true };
    const res = await scanThroughTransports([failing, ok], 'x', {});
    expect(res.action).toBe('warn');
  });

  it('fails closed (BLOCK) when every transport throws', async () => {
    const failing: ScanTransport = {
      scan: async () => {
        throw new Error('down');
      },
      ack: async () => false,
    };
    const res = await scanThroughTransports([failing, failing], 'x', {});
    expect(res.action).toBe('block');
    expect(res.riskLevel).toBe('high');
  });
});

describe('ackThroughTransports', () => {
  it('stops at the first transport that records the ack', async () => {
    const a: ScanTransport = { scan: async () => decision('allow'), ack: vi.fn(async () => true) };
    const b: ScanTransport = { scan: async () => decision('allow'), ack: vi.fn(async () => true) };
    expect(await ackThroughTransports([a, b], 'e', true)).toBe(true);
    expect(b.ack).not.toHaveBeenCalled();
  });

  it('returns false when no transport records it', async () => {
    const a: ScanTransport = { scan: async () => decision('allow'), ack: async () => false };
    expect(await ackThroughTransports([a], 'e', false)).toBe(false);
  });
});

describe('NativeHostTransport', () => {
  it('resolves the host’s decision for a scan', async () => {
    const port = makePort((id) => ({ id, ok: true, type: 'scan', decision: decision('allow') }));
    const transport = new NativeHostTransport(() => port);
    const res = await transport.scan('text', { provider: 'openai' });
    expect(res.action).toBe('allow');
  });

  it('throws on an error response so the caller can fall back', async () => {
    const port = makePort((id) => ({ id, ok: false, error: { code: 'DISCONNECT', message: 'gone' } }));
    const transport = new NativeHostTransport(() => port);
    await expect(transport.scan('text', {})).rejects.toThrow(/DISCONNECT/);
  });

  it('resolves the acked flag and maps errors to false', async () => {
    const ok = new NativeHostTransport(() => makePort((id) => ({ id, ok: true, type: 'ack', accepted: true })));
    expect(await ok.ack('e', true)).toBe(true);
    const failing = new NativeHostTransport(() =>
      makePort((id) => ({ id, ok: false, error: { code: 'ACK_FAILED', message: 'no' } })),
    );
    expect(await failing.ack('e', true)).toBe(false);
  });
});

describe('SafariAppTransport', () => {
  it('resolves the app extension’s decision for a scan', async () => {
    const transport = new SafariAppTransport(async (req) => ({
      id: req.id,
      ok: true,
      type: 'scan',
      decision: decision('block'),
    }));
    const res = await transport.scan('text', {});
    expect(res.action).toBe('block');
  });

  it('throws on an error response and on malformed replies', async () => {
    const errored = new SafariAppTransport(async (req) => ({
      id: req.id,
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'malformed request' },
    }));
    await expect(errored.scan('text', {})).rejects.toThrow(/BAD_REQUEST/);

    const malformed = new SafariAppTransport(async () => 'nonsense');
    await expect(malformed.scan('text', {})).rejects.toThrow(/malformed/);
  });

  it('maps ack failures to false instead of throwing', async () => {
    const failing = new SafariAppTransport(async () => {
      throw new Error('no app');
    });
    expect(await failing.ack('e', true)).toBe(false);
  });
});
