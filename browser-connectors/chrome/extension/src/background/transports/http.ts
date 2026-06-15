// HTTP dev transport: calls the local REST backend (default localhost:8080)
// directly via fetch. Used as the fallback when the native messaging host isn't
// installed (local dev without the agent stack); registration and token
// semantics live in backend/http-client.

import { ackViaHttp, registerDevice, scanViaHttp } from '../../backend/http-client.js';
import type { Decision } from '../../shared/contract.js';
import type { NativeScanContext, ScanFile } from '../../shared/protocol.js';
import type { ScanTransport } from '../transport.js';

export class HttpBackendTransport implements ScanTransport {
  async scan(text: string, context: NativeScanContext, files?: ScanFile[]): Promise<Decision> {
    try {
      return await scanViaHttp(text, context, files);
    } catch {
      // One re-register + retry: covers an expired or revoked device token.
      await registerDevice();
      return scanViaHttp(text, context, files);
    }
  }

  async ack(eventId: string, accepted: boolean): Promise<boolean> {
    try {
      // Ack is audit bookkeeping; the local-dev backend may not expose the
      // endpoint, and a failure must never affect enforcement.
      return await ackViaHttp(eventId, accepted);
    } catch {
      return false;
    }
  }
}
