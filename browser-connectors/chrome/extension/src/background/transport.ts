// The transport seam between the background message handlers and whatever
// carries a scan to the policy engine. Which transports a build gets is decided
// at build time (`__VG_TRANSPORT__`, injected by each browser's esbuild config),
// so one source tree serves Chromium (native host + HTTP dev fallback) and
// Safari (sendNativeMessage to the containing app). Fail-closed by construction:
// when every transport fails, the caller gets a synthetic BLOCK, never an allow.

import { failClosedBlock, type Decision } from '../shared/contract.js';
import type { NativeScanContext, ScanFile } from '../shared/protocol.js';

export interface ScanTransport {
  /**
   * Resolves the engine's Decision; throws if this transport can't deliver one.
   * `files` (optional) carries base64 attachments to scan with the text.
   */
  scan(text: string, context: NativeScanContext, files?: ScanFile[]): Promise<Decision>;
  /** Best-effort audit of a WARN response; resolves false instead of throwing. */
  ack(eventId: string, accepted: boolean): Promise<boolean>;
}

/** Tries each transport in order; if all fail, returns a fail-closed BLOCK. */
export async function scanThroughTransports(
  transports: readonly ScanTransport[],
  text: string,
  context: NativeScanContext,
  files?: ScanFile[],
): Promise<Decision> {
  for (const transport of transports) {
    try {
      return await transport.scan(text, context, files);
    } catch (error) {
      console.error('[VGuardrail] scan transport failed:', error);
    }
  }
  return failClosedBlock('agent unavailable; prompt blocked');
}

/** Best-effort WARN acknowledgement; true once any transport records it. */
export async function ackThroughTransports(
  transports: readonly ScanTransport[],
  eventId: string,
  accepted: boolean,
): Promise<boolean> {
  for (const transport of transports) {
    if (await transport.ack(eventId, accepted)) return true;
  }
  return false;
}
