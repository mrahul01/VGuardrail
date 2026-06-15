// Background entry (MV3 service worker on Chromium; event page on Firefox and
// Safari): bridges content-script messages to the policy engine through the
// transport chain selected for this build (`__VG_TRANSPORT__`, injected by each
// browser's esbuild config):
//
//   chromium   — native messaging host (com.vguardrail.connector) first, then
//                the HTTP dev backend (localhost:8080) as the local-dev fallback
//   safari     — sendNativeMessage to the containing app's
//                SafariWebExtensionHandler (XPC to vguardiand); requires the
//                Xcode-converted wrapper app
//   safari-dev — HTTP dev backend only. For Safari's "Add Temporary Extension"
//                (unpacked) loading, where no containing app exists, so
//                sendNativeMessage has nowhere to route — XPC is impossible in
//                this mode regardless of privileges.
//
// Always resolves a Decision for SCAN (fail-closed BLOCK on any error), so the
// content gate never has to reason about transport failures.

import type { AckReply, ContentMessage, ScanReply } from '../shared/messages.js';
import { webextRuntime } from '../shared/webext.js';
import { ackThroughTransports, scanThroughTransports, type ScanTransport } from './transport.js';
import { HttpBackendTransport } from './transports/http.js';
import { NativeHostTransport } from './transports/native.js';
import { SafariAppTransport } from './transports/safari.js';

declare const __VG_TRANSPORT__: 'chromium' | 'safari' | 'safari-dev' | undefined;

const flavor = typeof __VG_TRANSPORT__ === 'string' ? __VG_TRANSPORT__ : 'chromium';
const transports: readonly ScanTransport[] =
  flavor === 'safari'
    ? [new SafariAppTransport()]
    : flavor === 'safari-dev'
      ? [new HttpBackendTransport()]
      : [new NativeHostTransport(), new HttpBackendTransport()];

console.log(`[VGuardrail] background ready (transport: ${flavor})`);

// ── Handlers ───────────────────────────────────────────────────────────

async function handleScan(msg: Extract<ContentMessage, { kind: 'SCAN' }>): Promise<ScanReply> {
  return { decision: await scanThroughTransports(transports, msg.text, msg.context) };
}

async function handleScanFile(
  msg: Extract<ContentMessage, { kind: 'SCAN_FILE' }>,
): Promise<ScanReply> {
  // Empty prompt text; the file's extracted content is what gets scanned.
  return { decision: await scanThroughTransports(transports, '', msg.context, [msg.file]) };
}

async function handleAck(msg: Extract<ContentMessage, { kind: 'ACK' }>): Promise<AckReply> {
  return { ok: await ackThroughTransports(transports, msg.eventId, msg.accepted) };
}

// ── Message listener ───────────────────────────────────────────────────

webextRuntime().onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message.kind === 'SCAN') {
    handleScan(message).then(sendResponse);
    return true; // keep the channel open for the async response
  }
  if (message.kind === 'SCAN_FILE') {
    handleScanFile(message).then(sendResponse);
    return true;
  }
  if (message.kind === 'ACK') {
    handleAck(message).then(sendResponse);
    return true;
  }
  return false;
});
