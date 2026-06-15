// Owns the native-messaging port: lazy connect, id-correlation, per-request
// timeout, and reconnect. Fail-closed by construction — a timeout, a disconnect,
// or a failure to connect resolves the request as an error response, which the
// service worker maps to a BLOCK decision. Testable: the port is injected.

import type { NativeRequest, NativeResponse } from '../shared/protocol.js';

/** The subset of chrome.runtime.Port this bridge uses. */
export interface NativePort {
  postMessage(message: unknown): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
  disconnect(): void;
}

export type PortFactory = () => NativePort;

interface Pending {
  resolve: (response: NativeResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NativeBridge {
  private port: NativePort | undefined;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly connect: PortFactory,
    private readonly timeoutMs = 3000,
  ) {}

  /** Sends a request and resolves its correlated response (or an error response). */
  request(req: NativeRequest): Promise<NativeResponse> {
    return new Promise<NativeResponse>((resolve) => {
      let port: NativePort;
      try {
        port = this.ensurePort();
      } catch {
        resolve(errorResponse(req.id, 'DISCONNECT', 'native host unavailable'));
        return;
      }

      const timer = setTimeout(() => {
        if (this.pending.delete(req.id)) {
          resolve(errorResponse(req.id, 'TIMEOUT', 'native host timeout'));
        }
      }, this.timeoutMs);

      this.pending.set(req.id, { resolve, timer });

      try {
        port.postMessage(req);
      } catch {
        if (this.pending.delete(req.id)) {
          clearTimeout(timer);
          resolve(errorResponse(req.id, 'DISCONNECT', 'native host write failed'));
        }
      }
    });
  }

  private ensurePort(): NativePort {
    if (this.port) return this.port;
    const port = this.connect();
    port.onMessage.addListener((message) => this.onMessage(message));
    port.onDisconnect.addListener(() => this.onDisconnect());
    this.port = port;
    return port;
  }

  private onMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return;
    const response = message as NativeResponse;
    if (typeof response.id !== 'string') return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    pending.resolve(response);
  }

  private onDisconnect(): void {
    this.port = undefined;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(errorResponse(id, 'DISCONNECT', 'native host disconnected'));
    }
    this.pending.clear();
  }
}

function errorResponse(id: string, code: string, message: string): NativeResponse {
  return { id, ok: false, error: { code, message } };
}
