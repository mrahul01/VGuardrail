/**
 * Policy client wrapper for the connector-sdk.
 *
 * Provides a simplified interface for policy evaluation
 * with proper error handling and fail-closed behavior.
 */

import { ConnectorClient } from '@vguardrail/connector-sdk';
import type { ScanRequest, Decision, ScanResponse, Transport } from '@vguardrail/connector-sdk';

/**
 * Options for creating a PolicyClient.
 */
export interface PolicyClientOptions {
  /** Timeout for policy evaluation in milliseconds */
  timeoutMs?: number;
  /** Transport override (e.g. MockTransport in tests). Defaults to the XPC bridge. */
  transport?: Transport;
}

/**
 * Policy client that wraps the connector-sdk's ConnectorClient.
 *
 * This class provides:
 * - Automatic connection management
 * - Fail-closed behavior via safeScan
 * - Proper error handling and mapping
 */
export class PolicyClient {
  private readonly client: ConnectorClient;
  private readonly timeoutMs: number;

  constructor(options: PolicyClientOptions = {}) {
    this.timeoutMs = options.timeoutMs || 30000;

    this.client = new ConnectorClient({
      timeoutMs: this.timeoutMs,
      ...(options.transport !== undefined ? { transport: options.transport } : {}),
    });
  }

  /**
   * Evaluate a scan request against the policy engine.
   *
   * Uses safeScan for fail-closed behavior - if the agent is unavailable,
   * the decision will default to 'block'.
   *
   * @param request - The scan request to evaluate
   * @returns The policy decision
   * @throws If there's a validation error or version mismatch
   */
  async scan(request: ScanRequest): Promise<Decision> {
    try {
      const response: ScanResponse = await this.client.safeScan(request, {
        fallbackAction: 'block',
      });
      return response.decision;
    } catch (error) {
      // Re-throw validation and version mismatch errors
      // These are programmer errors that should not be silently handled
      if (error instanceof Error) {
        const errorName = error.constructor.name;
        if (errorName === 'ValidationError' || errorName === 'VersionMismatchError') {
          throw error;
        }
      }
      // For availability errors, safeScan should have returned a fallback decision
      // If we get here, something unexpected happened
      throw new Error(`Policy evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Evaluate a scan request with explicit error handling.
   *
   * Unlike scan(), this method throws on any error including
   * transport failures. Use this when you need to distinguish
   * between policy decisions and system failures.
   *
   * @param request - The scan request to evaluate
   * @returns The policy decision
   * @throws On any error
   */
  async scanStrict(request: ScanRequest): Promise<Decision> {
    const response: ScanResponse = await this.client.scan(request);
    return response.decision;
  }

  /**
   * Record an emergency bypass as a best-effort audit acknowledgement.
   *
   * Reuses the daemon's acknowledgeWarning channel with a synthetic
   * `bypass:` event id so the bypass leaves a trace in the audit trail.
   * Fire-and-forget: failures are swallowed (the daemon may be the very
   * thing the operator is bypassing).
   *
   * @param toolName - The wrapped tool that was run with scanning disabled
   */
  async acknowledgeBypass(toolName: string): Promise<void> {
    try {
      const eventId = `bypass:${toolName}:${Date.now()}`;
      await this.client.acknowledgeWarning(eventId, true);
    } catch {
      // Best effort only - never block or fail the bypass on audit errors.
    }
  }

  /**
   * Check if the policy engine is available.
   *
   * @returns true if the engine is connected and serving
   */
  async isAvailable(): Promise<boolean> {
    try {
      const status = await this.client.status();
      return status.engineServing;
    } catch {
      return false;
    }
  }

  /**
   * Close the connection to the policy engine.
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}