// Content-script entry. Picks the adapter for this host and installs the gate,
// wiring its scan/ack to the background script and its UI to the shadow-DOM
// modal. Messaging goes through the webext shim so the same bundle runs on
// Chromium (`chrome.*`) and Firefox/Safari (`browser.*`, promise-first).

import { matchAdapter } from '../adapters/registry.js';
import { Gate } from './gate.js';
import { showBlockNotice, showWarnModal, showWarnNotice } from './modal.js';
import type { AckReply, ContentMessage, ScanReply } from '../shared/messages.js';
import type { ScanFile } from '../shared/protocol.js';
import { shouldBlockUpload } from './upload-policy.js';
import { webextRuntime } from '../shared/webext.js';

// Idempotency guard: the script can be injected more than once per page —
// Safari re-injects on SPA history navigations, and reloading an unpacked /
// temporary extension can leave a prior instance live. A second Gate installs
// its own capture listeners with an independent `bypass` token, so one gate's
// approved-replay click is re-intercepted and re-scanned by the other gate
// (duplicate scans + a back-and-forth replay loop). Install at most one Gate.
const INSTALLED_FLAG = '__vguardrailGateInstalled__';
const flags = window as unknown as Record<string, boolean | undefined>;

const adapter = matchAdapter(location.host);

if (adapter && !flags[INSTALLED_FLAG]) {
  flags[INSTALLED_FLAG] = true;
  const runtime = webextRuntime();
  const gate = new Gate({
    adapter,
    scan: async (text, context) => {
      const reply = (await runtime.sendMessage({ kind: 'SCAN', text, context } satisfies ContentMessage)) as ScanReply;
      return reply.decision;
    },
    ack: async (eventId, accepted) => {
      (await runtime.sendMessage({ kind: 'ACK', eventId, accepted } satisfies ContentMessage)) as AckReply;
    },
    warn: showWarnModal,
    warnNotice: showWarnNotice,
    blockNotice: showBlockNotice,
  });
  gate.install();

  // ── File-upload relay (MAIN-world page-hook ↔ service worker) ─────────────
  // The MAIN-world hook (page-hook.ts) patches fetch and posts each upload here
  // for scanning; we relay it to the background transport and post the verdict
  // back so the hook can allow or block the upload before it leaves the browser.
  interface ScanFileRequest {
    source?: unknown;
    kind?: unknown;
    id?: unknown;
    file?: { name?: string; mime?: string; content_base64?: string };
  }
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as ScanFileRequest;
    if (data?.source !== 'vg-page' || data?.kind !== 'scan-file-request') return;
    const id = data.id;
    const reply = (allow: boolean): void => {
      window.postMessage({ source: 'vg-content', kind: 'scan-file-verdict', id, allow }, '*');
    };
    const raw = data.file;
    if (!raw?.content_base64 || !raw.name) {
      reply(true);
      return;
    }
    const file: ScanFile = {
      name: raw.name,
      ...(raw.mime ? { mime: raw.mime } : {}),
      content_base64: raw.content_base64,
    };
    const context = {
      provider: adapter.provider,
      url: location.href,
      title: document.title,
    };
    void (async () => {
      try {
        const res = (await runtime.sendMessage({
          kind: 'SCAN_FILE',
          file,
          context,
        } satisfies ContentMessage)) as ScanReply;
        const block = shouldBlockUpload(res.decision);
        if (block) {
          showBlockNotice({
            title: 'Upload blocked by policy',
            reason: res.decision.reason,
            categories: [...new Set(res.decision.findings.map((f) => f.category))],
          });
        }
        reply(!block);
      } catch {
        // Relay/transport failure: fail-open so a broken pipeline can't brick
        // uploads (the typed-prompt gate remains fail-closed).
        reply(true);
      }
    })();
  });
}
