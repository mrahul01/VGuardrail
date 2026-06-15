// Message contracts between the content script and the service worker
// (chrome.runtime messaging). The SW always resolves a Decision for SCAN —
// errors are mapped to a fail-closed BLOCK there, so the gate never has to.

import type { Decision } from './contract.js';
import type { ScanFile } from './protocol.js';

export interface ScanCaptureContext {
  provider: string;
  model?: string;
  url: string;
  title: string;
}

export type ContentMessage =
  | { kind: 'SCAN'; text: string; context: ScanCaptureContext }
  | { kind: 'SCAN_FILE'; file: ScanFile; context: ScanCaptureContext }
  | { kind: 'ACK'; eventId: string; accepted: boolean };

export interface ScanReply {
  decision: Decision;
}

export interface AckReply {
  ok: boolean;
}
