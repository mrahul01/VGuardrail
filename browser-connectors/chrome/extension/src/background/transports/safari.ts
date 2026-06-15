// Safari transport: browser.runtime.sendNativeMessage routes to the containing
// app's SafariWebExtensionHandler (Safari has no separate native-host process);
// the handler forwards the scan over XPC to vguardiand and replies with the
// Decision JSON. Same request/response envelope as the native host
// (shared/protocol.ts), mirrored in safari/swift/SafariWebExtensionHandler.swift.

import type { Decision } from '../../shared/contract.js';
import {
  NATIVE_HOST_NAME,
  type NativeRequest,
  type NativeResponse,
  type NativeScanContext,
} from '../../shared/protocol.js';
import { webextRuntime } from '../../shared/webext.js';
import type { ScanTransport } from '../transport.js';

export type NativeSend = (message: NativeRequest) => Promise<unknown>;

// Safari ignores the application id (it always routes to the containing app);
// it is passed only to satisfy the WebExtension API shape.
const sendToApp: NativeSend = (message) => webextRuntime().sendNativeMessage(NATIVE_HOST_NAME, message);

export class SafariAppTransport implements ScanTransport {
  constructor(private readonly send: NativeSend = sendToApp) {}

  async scan(text: string, context: NativeScanContext): Promise<Decision> {
    const res = toResponse(
      await this.send({ id: crypto.randomUUID(), type: 'scan', payload: { text, context } }),
    );
    if (!res.ok) throw new Error(`app extension scan failed: ${res.error.code}: ${res.error.message}`);
    if (res.type !== 'scan') throw new Error(`app extension returned unexpected type: ${res.type}`);
    return res.decision;
  }

  async ack(eventId: string, accepted: boolean): Promise<boolean> {
    try {
      const res = toResponse(
        await this.send({ id: crypto.randomUUID(), type: 'ack', payload: { eventId, accepted } }),
      );
      return res.ok && res.type === 'ack' ? res.accepted : false;
    } catch {
      return false;
    }
  }
}

function toResponse(message: unknown): NativeResponse {
  if (typeof message !== 'object' || message === null || typeof (message as NativeResponse).id !== 'string') {
    throw new Error('malformed app extension response');
  }
  return message as NativeResponse;
}
