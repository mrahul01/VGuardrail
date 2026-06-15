import { describe, expect, it, vi } from 'vitest';
import { NativeBridge, type NativePort } from '../src/background/native-bridge.js';
import type { NativeRequest, NativeResponse } from '../src/shared/protocol.js';

// A controllable fake of chrome.runtime.Port.
class FakePort implements NativePort {
  sent: NativeRequest[] = [];
  private msgCb: ((m: unknown) => void) | undefined;
  private discCb: (() => void) | undefined;
  disconnected = false;

  onMessage = { addListener: (cb: (m: unknown) => void) => { this.msgCb = cb; } };
  onDisconnect = { addListener: (cb: () => void) => { this.discCb = cb; } };

  postMessage(message: unknown): void {
    if (this.disconnected) throw new Error('disconnected');
    this.sent.push(message as NativeRequest);
  }
  disconnect(): void {
    this.disconnected = true;
  }

  // test helpers
  reply(res: NativeResponse): void {
    this.msgCb?.(res);
  }
  fireDisconnect(): void {
    this.discCb?.();
  }
}

const scanReq = (id: string): NativeRequest => ({ id, type: 'scan', payload: { text: 'x', context: {} } });

describe('NativeBridge', () => {
  it('correlates a reply to its request by id', async () => {
    const port = new FakePort();
    const bridge = new NativeBridge(() => port);
    const p = bridge.request(scanReq('a'));
    expect(port.sent[0]!.id).toBe('a');
    port.reply({ id: 'a', ok: true, type: 'scan', decision: { requestId: 'r', action: 'allow', riskLevel: 'low', findings: [], reason: '' } });
    const res = await p;
    expect(res).toMatchObject({ id: 'a', ok: true, type: 'scan' });
  });

  it('connects the port lazily and reuses it', async () => {
    const factory = vi.fn(() => new FakePort());
    const bridge = new NativeBridge(factory);
    void bridge.request(scanReq('a'));
    void bridge.request(scanReq('b'));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('resolves a TIMEOUT error response when no reply arrives', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new NativeBridge(() => new FakePort(), 1000);
      const p = bridge.request(scanReq('t'));
      await vi.advanceTimersByTimeAsync(1000);
      const res = await p;
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error.code).toBe('TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves pending requests as DISCONNECT when the port drops', async () => {
    const port = new FakePort();
    const bridge = new NativeBridge(() => port);
    const p = bridge.request(scanReq('d'));
    port.fireDisconnect();
    const res = await p;
    expect(res.ok === false && res.error.code).toBe('DISCONNECT');
  });

  it('reconnects with a fresh port after a disconnect', async () => {
    const ports: FakePort[] = [];
    const factory = vi.fn(() => {
      const p = new FakePort();
      ports.push(p);
      return p;
    });
    const bridge = new NativeBridge(factory);
    const p1 = bridge.request(scanReq('a'));
    ports[0]!.fireDisconnect();
    await p1;
    void bridge.request(scanReq('b'));
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('fails closed (DISCONNECT) if connecting throws', async () => {
    const bridge = new NativeBridge(() => {
      throw new Error('no native host');
    });
    const res = await bridge.request(scanReq('x'));
    expect(res.ok === false && res.error.code).toBe('DISCONNECT');
  });
});
