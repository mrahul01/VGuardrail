// Message contracts between the service worker and the native messaging host.
// Mirrors browser-connectors/chrome/native-host/src/protocol.ts.

import type { Decision } from './contract.js';

/** The registered native-messaging host name (matches the host manifest). */
export const NATIVE_HOST_NAME = 'com.vguardrail.connector';

export interface NativeScanContext {
  provider?: string;
  model?: string;
  app?: string;
  url?: string;
  title?: string;
}

/** A base64-encoded file attachment to scan alongside (or instead of) text. */
export interface ScanFile {
  name: string;
  mime?: string;
  content_base64: string;
}

export type NativeRequest =
  | { id: string; type: 'scan'; payload: { text: string; context: NativeScanContext } }
  | { id: string; type: 'ack'; payload: { eventId: string; accepted: boolean } };

export type NativeResponse =
  | { id: string; ok: true; type: 'scan'; decision: Decision }
  | { id: string; ok: true; type: 'ack'; accepted: boolean }
  | { id: string; ok: false; error: { code: string; message: string } };
