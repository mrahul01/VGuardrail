// Native-messaging transport: drives the NativeBridge over runtime.connectNative
// to the registered host (com.vguardrail.connector → connector-sdk → xpc-bridge
// → vguardiand → policy-engine). An error response (connect failure, timeout,
// disconnect, host error) throws so the caller can fall back or fail closed.

import type { Decision } from '../../shared/contract.js';
import { NATIVE_HOST_NAME, type NativeScanContext, type ScanFile } from '../../shared/protocol.js';
import { webextRuntime } from '../../shared/webext.js';
import { NativeBridge, type PortFactory } from '../native-bridge.js';
import type { ScanTransport } from '../transport.js';

// `runtime.connectNative` exists on Chromium and Firefox (Safari has no native
// hosts at all — its build uses the SafariAppTransport instead).
const connectNative: PortFactory = () => webextRuntime().connectNative(NATIVE_HOST_NAME);

export class NativeHostTransport implements ScanTransport {
  private readonly bridge: NativeBridge;

  constructor(connect: PortFactory = connectNative) {
    this.bridge = new NativeBridge(connect);
  }

  async scan(text: string, context: NativeScanContext, files?: ScanFile[]): Promise<Decision> {
    // The native messaging protocol doesn't carry file bytes yet; throw so the
    // caller falls through to the HTTP backend (which does the extraction).
    if (files && files.length > 0) {
      throw new Error('native host does not support file scanning');
    }
    const res = await this.bridge.request({
      id: crypto.randomUUID(),
      type: 'scan',
      payload: { text, context },
    });
    if (!res.ok) throw new Error(`native host scan failed: ${res.error.code}: ${res.error.message}`);
    if (res.type !== 'scan') throw new Error(`native host returned unexpected type: ${res.type}`);
    return res.decision;
  }

  async ack(eventId: string, accepted: boolean): Promise<boolean> {
    const res = await this.bridge.request({
      id: crypto.randomUUID(),
      type: 'ack',
      payload: { eventId, accepted },
    });
    return res.ok && res.type === 'ack' ? res.accepted : false;
  }
}
