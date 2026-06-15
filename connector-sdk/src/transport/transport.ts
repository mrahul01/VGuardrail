// The Transport interface decouples `ConnectorClient` from how bytes reach the
// daemon. Production uses `XpcBridgeTransport` (spawns the signed Swift helper);
// tests use `MockTransport`. The client layers retry/timeout/version on top, so
// a Transport only needs to do one round-trip and honor cancellation.

/**
 * A bidirectional request channel to the agent.
 *
 * Implementations MUST:
 * - reject `request` with a `NotConnectedError` when not connected;
 * - return the bridge reply's `result` on success, or throw a `RemoteError`
 *   when the daemon returns `ok: false`;
 * - stop waiting and drop the in-flight correlation when `signal` aborts (so a
 *   late reply never resolves a since-timed-out call).
 */
export interface Transport {
  /** Establishes the channel (spawns/handshakes as needed). Idempotent. */
  connect(): Promise<void>;

  /**
   * Performs one request/reply round-trip.
   * @param method one of the bridge `Method` names.
   * @param params method parameters (already wire-encoded).
   * @param signal aborts the call when the caller's deadline elapses.
   * @returns the reply `result` payload (still raw — the client decodes it).
   */
  request(method: string, params: unknown, signal: AbortSignal): Promise<unknown>;

  /** Tears down the channel. Idempotent. */
  close(): Promise<void>;
}
