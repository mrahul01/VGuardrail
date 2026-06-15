// Integration test for the MAIN-world fetch hook: a FormData upload triggers a
// scan-file-request to the (mocked) content script; a block verdict makes the
// patched fetch return 403 without calling the real fetch, while an allow
// verdict passes through.

import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadHookWith(verdictAllow: boolean): Promise<typeof fetch> {
  // Fresh module each time so the IIFE re-runs and re-patches fetch.
  vi.resetModules();
  delete (window as unknown as Record<string, unknown>).__vguardrailFetchHooked__;

  const realFetch = vi.fn(async () => new Response('ok', { status: 200 }));
  window.fetch = realFetch as unknown as typeof fetch;

  // Stand in for the content-script relay: answer every scan-file-request.
  const responder = (event: MessageEvent): void => {
    const data = event.data as { kind?: string; id?: number };
    if (data?.kind === 'scan-file-request') {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'vg-content', kind: 'scan-file-verdict', id: data.id, allow: verdictAllow },
          source: window,
        }),
      );
    }
  };
  window.addEventListener('message', responder);
  (window as unknown as { __responder?: unknown }).__responder = responder;

  await import('../src/content/page-hook');
  return window.fetch;
}

afterEach(() => {
  const r = (window as unknown as { __responder?: EventListener }).__responder;
  if (r) window.removeEventListener('message', r);
});

describe('page-hook fetch interceptor', () => {
  it('blocks an upload (403) when the verdict is block, without calling real fetch', async () => {
    const realBefore = window.fetch;
    const patched = await loadHookWith(false);
    expect(patched).not.toBe(realBefore); // fetch was replaced

    const fd = new FormData();
    fd.append('file', new File(['AKIA-secret'], 'leak.txt', { type: 'text/plain' }));
    const res = await patched('https://chatgpt.com/backend-api/files', { method: 'POST', body: fd });
    expect(res.status).toBe(403);
  });

  it('passes the upload through when the verdict is allow', async () => {
    const patched = await loadHookWith(true);
    const fd = new FormData();
    fd.append('file', new File(['hello world'], 'note.txt', { type: 'text/plain' }));
    const res = await patched('https://chatgpt.com/backend-api/files', { method: 'POST', body: fd });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('does not intercept requests with no file body', async () => {
    const patched = await loadHookWith(false); // would block if it scanned
    const res = await patched('https://chatgpt.com/backend-api/conversation', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'hi' }),
    });
    expect(res.status).toBe(200); // passed straight through to real fetch
  });
});
