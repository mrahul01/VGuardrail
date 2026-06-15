// MAIN-world page hook. Runs in the page's own JS context (manifest
// `world: "MAIN"`) so it can patch `window.fetch` BEFORE the site's code uses
// it — the only way to see drag-and-drop file uploads (ChatGPT/Claude/Gemini
// send attachments via `fetch(url, { body: FormData|File|Blob })`).
//
// It cannot use extension APIs from here, so it talks to the ISOLATED-world
// content script over `window.postMessage`: it ships the file out for scanning
// and awaits an allow/block verdict before letting the upload proceed.
//
// Best-effort by design: only `init.body` is inspected (not Request-wrapped or
// streamed bodies), and if the relay doesn't answer in time the upload is
// allowed (fail-open) so a broken pipeline never bricks the site — an explicit
// block verdict, however, is always honored.

import { extractUploadFiles, encodeUploadFile } from './upload-policy.js';

interface VerdictMsg {
  source?: unknown;
  kind?: unknown;
  id?: unknown;
  allow?: unknown;
}

(() => {
  const FLAG = '__vguardrailFetchHooked__';
  const w = window as unknown as Record<string, unknown>;
  if (w[FLAG]) return;
  w[FLAG] = true;

  const VERDICT_TIMEOUT_MS = 8000;
  let seq = 0;
  const pending = new Map<number, (allow: boolean) => void>();

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as VerdictMsg;
    if (data?.source !== 'vg-content' || data?.kind !== 'scan-file-verdict') return;
    const id = data.id as number;
    const resolve = pending.get(id);
    if (resolve) {
      pending.delete(id);
      resolve(data.allow === true);
    }
  });

  function requestVerdict(file: { name: string; mime?: string; content_base64: string }): Promise<boolean> {
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      window.postMessage(
        { source: 'vg-page', kind: 'scan-file-request', id, file },
        '*',
      );
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve(true); // fail-open: never hang or brick the page
        }
      }, VERDICT_TIMEOUT_MS);
    });
  }

  function blockedResponse(): Response {
    return new Response(JSON.stringify({ error: 'Upload blocked by VGuardrail policy' }), {
      status: 403,
      statusText: 'Blocked by VGuardrail',
      headers: { 'content-type': 'application/json' },
    });
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      const files = extractUploadFiles(init?.body);
      for (const file of files) {
        const encoded = await encodeUploadFile(file);
        if (!encoded) continue; // too large to scan — let it through (best-effort)
        const allow = await requestVerdict(encoded);
        if (!allow) return blockedResponse();
      }
    } catch (error) {
      // Our hook must never break the page; on any error, proceed normally.
      console.error('[VGuardrail] upload hook error', error);
    }
    return originalFetch(input, init);
  };
})();
