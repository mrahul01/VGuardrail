import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gate, type GateDeps } from '../src/content/gate.js';
import type { SiteAdapter } from '../src/adapters/types.js';
import { warnTier, type Decision, type Action } from '../src/shared/contract.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// Gates install document-level capture listeners; uninstall them between tests
// so a stale gate doesn't intercept (and stopImmediatePropagation-starve) later ones.
const installed: Gate[] = [];

function decision(action: Action, over: Partial<Decision> = {}): Decision {
  return {
    requestId: `req-${action}`,
    action,
    riskLevel: action === 'block' ? 'critical' : action === 'warn' ? 'medium' : 'low',
    findings:
      action === 'allow'
        ? []
        : [{ detectorId: 'd', category: 'secret', kind: 'aws', severity: 'high', redactedPreview: 'AKIA…' }],
    reason: `${action} reason`,
    ...over,
  };
}

interface Harness {
  gate: Gate;
  input: HTMLElement;
  button: HTMLButtonElement;
  submit: ReturnType<typeof vi.fn>;
  scan: ReturnType<typeof vi.fn>;
  ack: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  warnNotice: ReturnType<typeof vi.fn>;
  blockNotice: ReturnType<typeof vi.fn>;
}

function setup(opts: { scan: () => Promise<Decision>; warn?: () => Promise<boolean> }): Harness {
  document.body.innerHTML = `<div id="in" contenteditable="true">secret prompt</div><button id="send">Send</button>`;
  const input = document.getElementById('in')!;
  const button = document.getElementById('send') as HTMLButtonElement;

  const submit = vi.fn(() => {
    // Real sites submit by activating the send button — exercise re-entrancy.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const scan = vi.fn(opts.scan);
  const ack = vi.fn(async () => undefined);
  const warn = vi.fn(opts.warn ?? (async () => false));
  const warnNotice = vi.fn();
  const blockNotice = vi.fn();

  const adapter: SiteAdapter = {
    id: 'test',
    provider: 'test',
    hostPatterns: ['test.local'],
    getInput: () => input,
    getText: () => input.textContent ?? '',
    isSubmitKey: (e) => e.key === 'Enter' && !e.shiftKey,
    findSendButton: () => button,
    submit,
  };

  const deps: GateDeps = {
    adapter,
    scan: scan as unknown as GateDeps['scan'],
    ack: ack as unknown as GateDeps['ack'],
    warn: warn as unknown as GateDeps['warn'],
    warnNotice,
    blockNotice,
    loc: { host: 'test.local', href: 'https://test.local/' },
  };
  const gate = new Gate(deps);
  gate.install();
  installed.push(gate);
  return { gate, input, button, submit, scan, ack, warn, warnNotice, blockNotice };
}

function pressEnter(input: HTMLElement): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
  input.dispatchEvent(ev);
  return ev;
}

afterEach(() => {
  while (installed.length) installed.pop()!.uninstall();
  document.body.innerHTML = '';
});

describe('Gate', () => {
  it('BLOCK: prevents the submission and shows a block notice', async () => {
    const h = setup({ scan: async () => decision('block') });
    const ev = pressEnter(h.input);
    expect(ev.defaultPrevented).toBe(true); // synchronous prevention
    await flush();
    expect(h.scan).toHaveBeenCalledTimes(1);
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.blockNotice).toHaveBeenCalledTimes(1);
    expect(h.blockNotice.mock.calls[0]![0].categories).toEqual(['secret']);
  });

  it('ALLOW: re-dispatches the submission exactly once (no loop)', async () => {
    const h = setup({ scan: async () => decision('allow') });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.scan).toHaveBeenCalledTimes(1); // re-dispatched click is NOT re-intercepted
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.blockNotice).not.toHaveBeenCalled();
  });

  it('WARN accept: acks true and re-dispatches', async () => {
    const h = setup({ scan: async () => decision('warn'), warn: async () => true });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.ack).toHaveBeenCalledWith('req-warn', true);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('WARN cancel: acks false and does not submit', async () => {
    const h = setup({ scan: async () => decision('warn'), warn: async () => false });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.ack).toHaveBeenCalledWith('req-warn', false);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it.each(['high', 'critical'] as const)(
    'WARN %s risk: locally escalated to block — no modal, acks false, no submit',
    async (riskLevel) => {
      const h = setup({ scan: async () => decision('warn', { riskLevel }) });
      pressEnter(h.input);
      await flush();
      await flush();
      expect(h.warn).not.toHaveBeenCalled(); // no proceed affordance at all
      expect(h.blockNotice).toHaveBeenCalledTimes(1);
      expect(h.blockNotice.mock.calls[0]![0].title).toBe('Blocked by policy — high risk');
      expect(h.ack).toHaveBeenCalledWith('req-warn', false);
      expect(h.submit).not.toHaveBeenCalled();
    },
  );

  it('WARN low risk: transient notice only, acks true, submits automatically', async () => {
    const h = setup({ scan: async () => decision('warn', { riskLevel: 'low' }) });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.warnNotice).toHaveBeenCalledTimes(1);
    expect(h.warnNotice.mock.calls[0]![0].categories).toEqual(['secret']);
    expect(h.ack).toHaveBeenCalledWith('req-warn', true);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  // ── Send-Anyway risk-score bands (>55 block · 20–55 medium · ≤20 low) ──────

  it('WARN risk score > 55: hides "Send anyway" and blocks completely', async () => {
    const h = setup({ scan: async () => decision('warn', { riskScore: 56 }) });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.warn).not.toHaveBeenCalled(); // no Send-anyway button
    expect(h.blockNotice).toHaveBeenCalledTimes(1);
    expect(h.ack).toHaveBeenCalledWith('req-warn', false);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('WARN risk score 20–55: shows "Send anyway" with a MEDIUM warning', async () => {
    const h = setup({ scan: async () => decision('warn', { riskScore: 40 }), warn: async () => true });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]![0].riskLevel).toBe('medium');
    expect(h.ack).toHaveBeenCalledWith('req-warn', true);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('WARN risk score ≤ 20: shows "Send anyway" with a LOW warning (not blocked)', async () => {
    // Real low-risk detections carry high confidence; it must NOT cause a block.
    const h = setup({ scan: async () => decision('warn', { riskScore: 16, confidence: 90 }), warn: async () => true });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.blockNotice).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]![0].riskLevel).toBe('low');
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('WARN within a band but cancelled: does not submit', async () => {
    const h = setup({ scan: async () => decision('warn', { riskScore: 30 }), warn: async () => false });
    pressEnter(h.input);
    await flush();
    await flush();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.ack).toHaveBeenCalledWith('req-warn', false);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('fail-closed: a scan rejection blocks (no submit)', async () => {
    const h = setup({ scan: async () => { throw new Error('sw down'); } });
    const ev = pressEnter(h.input);
    expect(ev.defaultPrevented).toBe(true);
    await flush();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.blockNotice).toHaveBeenCalledTimes(1);
  });

  it('click on the send button is intercepted too', async () => {
    const h = setup({ scan: async () => decision('block') });
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    h.button.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await flush();
    expect(h.scan).toHaveBeenCalledTimes(1);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it('does not intercept empty input', async () => {
    const h = setup({ scan: async () => decision('allow') });
    h.input.textContent = '   ';
    const ev = pressEnter(h.input);
    expect(ev.defaultPrevented).toBe(false);
    await flush();
    expect(h.scan).not.toHaveBeenCalled();
  });

  it('ignores Shift+Enter (newline, not submit)', async () => {
    const h = setup({ scan: async () => decision('allow') });
    const ev = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true, bubbles: true });
    h.input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    await flush();
    expect(h.scan).not.toHaveBeenCalled();
  });
});

describe('warnTier', () => {
  it('escalates high/critical to a local block', () => {
    expect(warnTier('high')).toBe('block');
    expect(warnTier('critical')).toBe('block');
  });

  it('keeps medium interactive, and treats missing/unknown levels as medium', () => {
    expect(warnTier('medium')).toBe('prompt');
    expect(warnTier(undefined)).toBe('prompt');
    expect(warnTier('weird')).toBe('prompt');
  });

  it('demotes low to a non-blocking notice', () => {
    expect(warnTier('low')).toBe('notice');
  });
});
