// HTTP-based backend client for the Chrome extension.
//
// When the XPC native messaging bridge is unavailable (as in local dev),
// the extension calls the REST backend directly via fetch().
//
// The backend (running on localhost:8080 with VG_DEV_CLAIMS=1) accepts
// x-vg-* headers instead of verifying JWTs, and exposes POST /scan for
// prompt evaluation + audit event logging.
//
// Device registration flow:
//   1. Call POST /devices/register with device info
//   2. Keep the returned token
//   3. Use the token for subsequent scan requests
//
// In local dev mode, the backend accepts any enrollment token (or none).

import type { Decision } from '../shared/contract.js';
import type { NativeScanContext, ScanFile } from '../shared/protocol.js';

// ── Config (overridable from extension storage) ────────────────────────

const DEFAULT_BACKEND_URL = 'http://localhost:8080';
const DEFAULT_ORG_ID = 'local-org';
const DEFAULT_ROLE = 'device';
const DEVICE_ID_KEY = 'vg_device_id';
const DEVICE_TOKEN_KEY = 'vg_device_token';
const BACKEND_URL_KEY = 'vg_backend_url';
const ORG_ID_KEY = 'vg_org_id';

// ── Types ──────────────────────────────────────────────────────────────

export interface BackendConfig {
  backendUrl: string;
  orgId: string;
}

export interface DeviceRegistrationRequest {
  device_id: string;
  hostname: string;
  platform: string;
  agent_version: string;
  /** Hardware model from UA client hints, when the browser exposes it. */
  model?: string;
  /** OS name + version from UA client hints, e.g. "macOS 15.5.0". */
  os_version?: string;
}

export interface DeviceRegistrationResponse {
  status: string;
  org_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}

export interface ScanHttpRequest {
  text: string;
  context: NativeScanContext;
  files?: ScanFile[];
}

export interface ScanHttpResponse {
  request_id: string;
  decision: Decision;
}

export interface HttpErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// ── Storage helpers ────────────────────────────────────────────────────

async function getStorageValue<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] as T | undefined);
    });
  });
}

async function setStorageValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ── Configuration ──────────────────────────────────────────────────────

async function getConfig(): Promise<BackendConfig> {
  const [backendUrl, orgId] = await Promise.all([
    getStorageValue<string>(BACKEND_URL_KEY),
    getStorageValue<string>(ORG_ID_KEY),
  ]);
  return {
    backendUrl: backendUrl ?? DEFAULT_BACKEND_URL,
    orgId: orgId ?? DEFAULT_ORG_ID,
  };
}

// ── Device Registration ────────────────────────────────────────────────

/**
 * Generate a stable device ID for this browser instance.
 */
function generateDeviceId(): string {
  // Use a hash of installed extension id + random suffix
  const extId = chrome.runtime.id;
  const suffix = Math.random().toString(36).substring(2, 8);
  return `ext-${extId.substring(0, 8)}-${suffix}`;
}

/** UA-client-hints subset used for device quick facts (Chromium-only API). */
interface UaHighEntropyValues {
  platform?: string;
  platformVersion?: string;
  model?: string;
}

/**
 * Best-effort OS/model facts from UA client hints. Browsers expose no real
 * hostname or username; these hints are the richest details available here.
 */
async function collectDeviceFacts(): Promise<{ model?: string; os_version?: string }> {
  const uaData = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues(hints: string[]): Promise<UaHighEntropyValues>;
      };
    }
  ).userAgentData;
  if (!uaData?.getHighEntropyValues) return {};
  try {
    const hi = await uaData.getHighEntropyValues(['platformVersion', 'model']);
    const facts: { model?: string; os_version?: string } = {};
    if (hi.platform && hi.platformVersion) {
      facts.os_version = `${hi.platform} ${hi.platformVersion}`;
    }
    if (hi.model) {
      facts.model = hi.model;
    }
    return facts;
  } catch {
    return {};
  }
}

/**
 * Register the extension as a device with the backend.
 * Returns the access token, or throws on failure.
 */
export async function registerDevice(): Promise<string> {
  const config = await getConfig();
  const url = `${config.backendUrl}/devices/register`;

  const deviceId = generateDeviceId();
  await setStorageValue(DEVICE_ID_KEY, deviceId);

  const body: DeviceRegistrationRequest = {
    device_id: deviceId,
    hostname: `chrome-ext-${chrome.runtime.id.substring(0, 8)}`,
    platform: `chrome/${navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'unknown'}`,
    agent_version: chrome.runtime.getManifest().version ?? '0.1.0',
    ...(await collectDeviceFacts()),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-vg-org-id': config.orgId,
      'x-device-id': deviceId,
      'x-vg-role': DEFAULT_ROLE,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errBody = await response.json() as HttpErrorResponse;
      errorMsg = errBody.error?.message ?? errorMsg;
    } catch {
      // ignore parse errors
    }
    throw new Error(`Device registration failed: ${errorMsg}`);
  }

  const data = await response.json() as DeviceRegistrationResponse;
  await setStorageValue(DEVICE_TOKEN_KEY, data.access_token);
  return data.access_token;
}

// ── Scan (prompt evaluation) ───────────────────────────────────────────

/**
 * Evaluate a prompt via the backend HTTP API.
 *
 * Automatically registers the device if no token is stored.
 * Returns the Decision, or throws on failure.
 */
export async function scanViaHttp(
  text: string,
  context: NativeScanContext,
  files?: ScanFile[],
): Promise<Decision> {
  const config = await getConfig();
  const url = `${config.backendUrl}/scan`;

  let token = await getStorageValue<string>(DEVICE_TOKEN_KEY);
  let deviceId = await getStorageValue<string>(DEVICE_ID_KEY);

  if (!token) {
    token = await registerDevice();
  }
  if (!deviceId) {
    deviceId = await getStorageValue<string>(DEVICE_ID_KEY) ?? 'ext-unknown';
  }

  const body: ScanHttpRequest = { text, context };
  if (files && files.length > 0) body.files = files;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-vg-org-id': config.orgId,
      'x-device-id': deviceId,
      'x-vg-role': DEFAULT_ROLE,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // Token expired or invalid — re-register
      token = await registerDevice();
      deviceId = await getStorageValue<string>(DEVICE_ID_KEY) ?? 'ext-unknown';
      // Retry with new token
      return scanViaHttp(text, context);
    }

    let errorMsg = `HTTP ${response.status}`;
    try {
      const errBody = await response.json() as HttpErrorResponse;
      errorMsg = errBody.error?.message ?? errorMsg;
    } catch {
      // ignore
    }
    throw new Error(`Scan failed: ${errorMsg}`);
  }

  const data = await response.json() as ScanHttpResponse;
  // The backend serializes the decision in snake_case; surface the numeric
  // Send-Anyway inputs in the camelCase the gate/contract expect. (Other
  // fields are read as-is by the gate, unchanged.)
  const raw = data.decision as unknown as { risk_score?: number; confidence?: number };
  const decision = data.decision;
  if (typeof raw.risk_score === 'number') decision.riskScore = raw.risk_score;
  if (typeof raw.confidence === 'number') decision.confidence = raw.confidence;
  return decision;
}

// ── Ack (warn acknowledgement) ─────────────────────────────────────────

/**
 * Acknowledge a warning decision (send anyway).
 */
export async function ackViaHttp(
  eventId: string,
  accepted: boolean,
): Promise<boolean> {
  const config = await getConfig();
  const url = `${config.backendUrl}/events/batch`;

  let token = await getStorageValue<string>(DEVICE_TOKEN_KEY);
  let deviceId = await getStorageValue<string>(DEVICE_ID_KEY);

  if (!token) {
    token = await registerDevice();
  }
  if (!deviceId) {
    deviceId = await getStorageValue<string>(DEVICE_ID_KEY) ?? 'ext-unknown';
  }

  const body = {
    upload_id: `ack-${Date.now()}`,
    events: [
      {
        event_id: eventId,
        device_id: deviceId,
        timestamp_ms: Date.now(),
        event_type: 'warning_acknowledged',
        severity: 'info',
        details: {
          accepted,
          acknowledged_at: new Date().toISOString(),
        },
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-vg-org-id': config.orgId,
      'x-device-id': deviceId,
      'x-vg-role': DEFAULT_ROLE,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Non-fatal: warn acknowledgement failure shouldn't break the UX
    console.error('Ack via HTTP failed:', response.status);
    return false;
  }

  return true;
}