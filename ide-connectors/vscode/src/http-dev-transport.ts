// HttpDevTransport — local-development Transport that evaluates prompts via
// the dev backend's POST /scan (the same real 24-category detector pipeline
// the browser extensions use on localhost) instead of the signed XPC bridge.
//
// Why it exists: the production path (XpcBridgeTransport → vguardiand →
// pe-engined over gRPC) requires the signed Swift helper plus the engine
// LaunchDaemon. For local development the backend container is already
// running, so `"vguardrail.transport": "http-dev"` gives real allow/warn/block
// decisions today. Errors are thrown as the SDK's TransportError so
// `safeScan()` converts them into a fail-closed BLOCK, never an allow.
//
// Deliberately free of any `vscode` import (unit-testable with a stub server).

import {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  TransportError,
  type Transport,
} from '@vguardrail/connector-sdk';

export interface HttpDevTransportOptions {
  /** Dev backend base URL (no trailing slash), e.g. `http://localhost:8080`. */
  baseUrl?: string;
  /** Org id sent as `x-vg-org-id` (the backend's VG_DEV_CLAIMS mode reads it). */
  orgId?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Injectable fetch, for tests. */
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_ORG = 'local-org';
const DEFAULT_TIMEOUT_MS = 8000;

/** The slice of the wire-encoded ScanRequest this transport reads. */
interface WireScanParams {
  text: string;
  context?: {
    app?: string;
    provider?: string;
    model?: string;
    file?: { path?: string };
    user?: { user_id?: string };
  };
}

export class HttpDevTransport implements Transport {
  private readonly baseUrl: string;
  private readonly orgId: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpDevTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.orgId = options.orgId ?? DEFAULT_ORG;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async connect(): Promise<void> {
    // Lazy: availability is checked per request so a backend started after the
    // IDE still works without a reconnect.
  }

  async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    switch (method) {
      case 'hello':
        // Echo the SDK's own protocol/schema so negotiation always succeeds —
        // there is no independent peer to negotiate with in HTTP dev mode.
        return { proto: PROTOCOL_VERSION, schema: SCHEMA_VERSION, agent: 'http-dev' };
      case 'submitScan':
        return this.submitScan(params as WireScanParams, signal);
      case 'getStatus':
        return this.getStatus(signal);
      case 'acknowledgeWarning':
        // The dev backend has no WARN-ack endpoint; report the ack as recorded
        // so the UI flow proceeds (the scan itself was already audited).
        return true;
      case 'recentDecisions':
        return [];
      default:
        throw new TransportError(`http-dev transport does not support method "${method}"`);
    }
  }

  async close(): Promise<void> {
    // Stateless.
  }

  private async submitScan(params: WireScanParams, signal: AbortSignal): Promise<unknown> {
    const app = params.context?.app ?? 'ide';
    const userId = params.context?.user?.user_id ?? 'unknown';
    const body = {
      text: params.text,
      context: {
        provider: params.context?.provider ?? app,
        model: params.context?.model,
        app,
        url: params.context?.file?.path,
      },
    };
    const reply = (await this.post('/scan', body, signal, {
      'x-device-id': `ide-${app}-${userId}`,
    })) as { decision?: BackendDecision };
    if (reply.decision === undefined) {
      throw new TransportError('dev backend /scan reply carried no decision');
    }
    return toWireDecision(reply.decision);
  }

  private async getStatus(signal: AbortSignal): Promise<unknown> {
    const health = (await this.get('/health', signal)) as { version?: string };
    return {
      engineServing: true,
      activePolicyVersion: 0,
      queuedEvents: 0,
      engineConnected: true,
      agentVersion: `http-dev backend ${health.version ?? '?'}`,
    };
  }

  private get(path: string, signal: AbortSignal): Promise<unknown> {
    return this.send(path, { method: 'GET' }, signal);
  }

  private post(
    path: string,
    body: unknown,
    signal: AbortSignal,
    headers: Record<string, string> = {},
  ): Promise<unknown> {
    return this.send(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      },
      signal,
    );
  }

  private async send(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set('x-vg-org-id', this.orgId);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch (cause) {
      throw new TransportError(`dev backend unreachable at ${this.baseUrl}${path}`, { cause });
    }
    if (!response.ok) {
      throw new TransportError(`dev backend ${path} returned HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch (cause) {
      throw new TransportError(`dev backend ${path} returned invalid JSON`, { cause });
    }
  }
}

// ── Backend → SDK wire mapping ────────────────────────────────────────────────

/** The dev backend's /scan decision shape (backend/server/src/routes/scan.rs). */
interface BackendDecision {
  request_id: string;
  action: string;
  risk_level: string;
  matched_rule_id?: string | null;
  severity?: string | null;
  reason: string;
  findings: ReadonlyArray<{
    detector_id: string;
    category: string;
    kind: string;
    severity: string;
    redacted_preview: string;
  }>;
}

/** Risk level → the classification slot the SDK's wire Decision requires. */
function classificationFor(riskLevel: string): string {
  switch (riskLevel) {
    case 'critical':
      return 'restricted';
    case 'high':
      return 'confidential';
    case 'medium':
      return 'confidential';
    default:
      return 'internal';
  }
}

/**
 * Maps the backend decision into the SDK's strict snake_case wire Decision.
 * The dev backend reports no spans/confidence (redaction-safe summaries only),
 * so structural fields are filled with neutral values.
 */
function toWireDecision(d: BackendDecision): unknown {
  return {
    request_id: d.request_id,
    action: d.action,
    risk_level: d.risk_level,
    classification: classificationFor(d.risk_level),
    matched_rule_id: d.matched_rule_id ?? null,
    severity: d.severity ?? null,
    findings: d.findings.map((f) => ({
      detector_id: f.detector_id,
      category: f.category,
      kind: f.kind,
      span_start: 0,
      span_end: 0,
      confidence: 0.9,
      severity: f.severity,
      redacted_preview: f.redacted_preview,
      meta: {},
    })),
    suppressions: [],
    reason: d.reason,
    policy_version: 0,
    elapsed_micros: 0,
    incomplete: false,
  };
}
