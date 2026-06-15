import { afterEach, describe, expect, it } from 'vitest';
import { showWarnModal, showBlockNotice, showWarnNotice } from '../src/content/modal.js';

afterEach(() => {
  document.querySelectorAll('[data-vguardrail="ui"]').forEach((n) => n.remove());
});

function shadowOf(): ShadowRoot {
  const host = document.querySelector('[data-vguardrail="ui"]') as HTMLElement;
  return host.shadowRoot!;
}

describe('WARN modal', () => {
  it('renders only metadata (reason, risk, categories) — no prompt/preview', () => {
    void showWarnModal({ reason: 'Contains an AWS key', riskLevel: 'critical', categories: ['secret', 'pii'] });
    const root = shadowOf();
    expect(root.querySelector('[data-vg="reason"]')!.textContent).toBe('Contains an AWS key');
    expect(root.querySelector('[data-vg="risk"]')!.textContent).toContain('critical');
    expect(root.querySelector('[data-vg="cats"]')!.textContent).toContain('secret, pii');
    // No raw preview / prompt text anywhere in the modal.
    expect(root.textContent).not.toContain('AKIA');
  });

  it('Send anyway resolves true and removes the modal', async () => {
    const p = showWarnModal({ reason: 'r', riskLevel: 'high', categories: [] });
    (shadowOf().querySelector('[data-vg="proceed"]') as HTMLButtonElement).click();
    await expect(p).resolves.toBe(true);
    expect(document.querySelector('[data-vguardrail="ui"]')).toBeNull();
  });

  it('Cancel resolves false', async () => {
    const p = showWarnModal({ reason: 'r', riskLevel: 'high', categories: [] });
    (shadowOf().querySelector('[data-vg="cancel"]') as HTMLButtonElement).click();
    await expect(p).resolves.toBe(false);
  });
});

describe('BLOCK notice', () => {
  it('renders a block toast with the reason', () => {
    showBlockNotice({ reason: 'Blocked by rule.secret.aws', categories: ['secret'] });
    expect(shadowOf().querySelector('[data-vg="block"]')!.textContent).toContain('Blocked by rule.secret.aws');
  });

  it('honors a title override (high-risk warn escalation)', () => {
    showBlockNotice({ title: 'Blocked by policy — high risk', reason: 'r', categories: [] });
    expect(shadowOf().querySelector('[data-vg="block"]')!.textContent).toContain('Blocked by policy — high risk');
  });
});

describe('WARN notice', () => {
  it('renders a transient warn toast with no interactive controls', () => {
    showWarnNotice({ reason: 'Low-risk policy match', categories: ['pii'] });
    const toast = shadowOf().querySelector('[data-vg="warn-notice"]')!;
    expect(toast.textContent).toContain('Low-risk policy match');
    expect(toast.querySelector('button')).toBeNull();
  });
});
