/**
 * Dashboard → Rust backend client.
 *
 * Phase 5 of the Docker migration. The dashboard used to talk to
 * API Gateway directly via `gateway-client.ts`. After Phase 4/5 the
 * Rust service at `http://backend:8080` exposes the same paths, so
 * this client is a near-drop-in replacement that points at the new
 * container hostname when `BACKEND_API_URL` is set inside the
 * Docker network.
 *
 * Selection rules (in priority order):
 *
 *   1. `BACKEND_API_URL` env var  → use this as the base URL.
 *                                  Default in `docker-compose.yml`
 *                                  is `http://backend:8080`.
 *   2. `API_BASE_URL` env var     → legacy / dev-mode override.
 *
 * The wire format is **byte-identical** to the previous API Gateway
 * responses (same `Page<{ items, page, per_page, total, next_token }>`
 * shape, same error envelope, same `Authorization: Bearer <jwt>`
 * header). Existing BFF routes and hooks keep working without
 * further changes.
 */

import { BackendClientError } from "@/lib/api/client";
import { isLocalAuthDisabled, MOCK_USER_SESSION } from "@/lib/auth/local-mode";

const BACKEND_BASE_URL =
  process.env.BACKEND_API_URL ?? process.env.API_BASE_URL ?? "";

const REQUEST_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 8000);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch from the Rust backend service. Mirrors `gatewayFetch` /
 * `backendFetch` semantics (3 attempts, exponential backoff, retry
 * on 5xx + network errors).
 */
export async function backendHttpFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const url = `${BACKEND_BASE_URL}${path}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = new Headers(init.headers);
      headers.set("Content-Type", "application/json");
      // In local-dev mode the backend runs with VG_DEV_CLAIMS which reads
      // x-vg-role / x-vg-org-id headers instead of verifying JWTs.
      // Skip the Authorization header entirely to avoid sending a fake JWT
      // that the backend would try to parse and reject (e.g. alg: none).
      if (!isLocalAuthDisabled() && init.token) {
        headers.set("Authorization", `Bearer ${init.token}`);
      }
      if (isLocalAuthDisabled()) {
        headers.set("x-vg-role", MOCK_USER_SESSION.role);
        headers.set("x-vg-org-id", MOCK_USER_SESSION.orgId);
      }
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (response.status === 204) {
        return undefined as T;
      }
      const bodyText = await response.text();
      const body = bodyText ? JSON.parse(bodyText) : null;
      if (!response.ok) {
        const code = body?.error?.code ?? "backend_error";
        const message = body?.error?.message ?? response.statusText;
        throw new BackendClientError(
          response.status,
          code,
          message,
          response.status >= 500,
        );
      }
      return body as T;
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof BackendClientError ? error.retryable : true;
      if (!retryable || attempt === 2) break;
      await sleep(100 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new BackendClientError(500, "backend_error", "Backend request failed");
}

/**
 * Returns `true` when the new Docker-native backend is reachable.
 * Used by `with-rbac.ts` to decide whether to use the live backend
 * registry or fall back to mocks.
 */
export function isBackendConfigured(): boolean {
  return BACKEND_BASE_URL.length > 0;
}

/** Exposed for tests / debugging. */
export const _internal = { BACKEND_BASE_URL, REQUEST_TIMEOUT_MS };
