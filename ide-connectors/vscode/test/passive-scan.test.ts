import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeScanResponse, syntheticDecision, type ScanResponse } from '@vguardrail/connector-sdk';

import {
  DEFAULT_DEBOUNCE_MS,
  MAX_DOCUMENT_BYTES,
  PASSIVE_ENGINE_DOWN_MESSAGE,
  PassiveScanController,
  type PassiveDocument,
} from '../src/passive-scan';

function response(action: 'allow' | 'warn' | 'block', fromFallback = false): ScanResponse {
  const decision = syntheticDecision({
    requestId: 'req-1',
    action,
    reason: action === 'allow' ? 'no findings' : 'email address detected in prompt',
  });
  return makeScanResponse(decision, { requestId: 'req-1', elapsedMs: 1, fromFallback });
}

const doc: PassiveDocument = {
  uri: 'file:///repo/notes.md',
  scheme: 'file',
  byteLength: 4096,
  filePath: '/repo/notes.md',
  fileExtension: 'md',
  languageId: 'markdown',
  workspaceName: 'acme-repo',
};

const bigPaste = 'x'.repeat(300);

describe('PassiveScanController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(result: () => Promise<ScanResponse>, enabled = true) {
    const scans: string[] = [];
    const notices: string[] = [];
    const controller = new PassiveScanController({
      scan: (text) => {
        scans.push(text);
        return result();
      },
      notify: (message) => notices.push(message),
      isEnabled: () => enabled,
    });
    return { controller, scans, notices };
  }

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(DEFAULT_DEBOUNCE_MS + 1);
  }

  it('ignores small (non-paste) insertions', async () => {
    const { controller, scans } = setup(() => Promise.resolve(response('block')));
    controller.handleChange(doc, ['short edit']);
    await settle();
    expect(scans).toHaveLength(0);
  });

  it('ignores non-file schemes and oversized documents', async () => {
    const { controller, scans } = setup(() => Promise.resolve(response('block')));
    controller.handleChange({ ...doc, scheme: 'output' }, [bigPaste]);
    controller.handleChange({ ...doc, byteLength: MAX_DOCUMENT_BYTES + 1 }, [bigPaste]);
    await settle();
    expect(scans).toHaveLength(0);
  });

  it('does nothing when the setting is off', async () => {
    const { controller, scans } = setup(() => Promise.resolve(response('block')), false);
    controller.handleChange(doc, [bigPaste]);
    await settle();
    expect(scans).toHaveLength(0);
  });

  it('scans a paste-sized insertion after the debounce window', async () => {
    const { controller, scans, notices } = setup(() => Promise.resolve(response('warn')));
    controller.handleChange(doc, [bigPaste]);
    expect(scans).toHaveLength(0); // debounced, not immediate
    await settle();
    expect(scans).toEqual([bigPaste]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('Pasted content');
    expect(notices[0]).toContain('email address detected in prompt');
  });

  it('coalesces a burst of pastes into one scan', async () => {
    const { controller, scans } = setup(() => Promise.resolve(response('allow')));
    controller.handleChange(doc, [bigPaste]);
    await vi.advanceTimersByTimeAsync(100);
    controller.handleChange(doc, [bigPaste]);
    await settle();
    expect(scans).toHaveLength(1);
    expect(scans[0]).toBe(`${bigPaste}\n${bigPaste}`);
  });

  it('stays silent on allow', async () => {
    const { controller, notices } = setup(() => Promise.resolve(response('allow')));
    controller.handleChange(doc, [bigPaste]);
    await settle();
    expect(notices).toHaveLength(0);
  });

  it('reports engine-down once, then mutes until recovery', async () => {
    let down = true;
    const { controller, notices } = setup(() =>
      Promise.resolve(down ? response('block', true) : response('allow')),
    );

    controller.handleChange(doc, [bigPaste]);
    await settle();
    controller.handleChange(doc, [bigPaste]);
    await settle();
    expect(notices).toEqual([PASSIVE_ENGINE_DOWN_MESSAGE]);

    down = false; // recovery resets the mute
    controller.handleChange(doc, [bigPaste]);
    await settle();
    down = true;
    controller.handleChange(doc, [bigPaste]);
    await settle();
    expect(notices).toEqual([PASSIVE_ENGINE_DOWN_MESSAGE, PASSIVE_ENGINE_DOWN_MESSAGE]);
  });

  it('never escalates a scan exception (advisory only)', async () => {
    const { controller, notices } = setup(() => Promise.reject(new Error('boom')));
    controller.handleChange(doc, [bigPaste]);
    await settle();
    expect(notices).toEqual([PASSIVE_ENGINE_DOWN_MESSAGE]);
  });

  it('stops scanning after dispose', async () => {
    const { controller, scans } = setup(() => Promise.resolve(response('allow')));
    controller.handleChange(doc, [bigPaste]);
    controller.dispose();
    await settle();
    expect(scans).toHaveLength(0);
  });
});
