import { isLocalAuthDisabled, MOCK_USER_SESSION } from "@/lib/auth/local-mode";

export class BackendClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  constructor(status: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = "BackendClientError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const API_BASE_URL = process.env.API_BASE_URL ?? "";
const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS ?? 8000);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function backendFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  console.error("BFF_FETCH", { url, baseUrl: API_BASE_URL, path, hasToken: !!init.token, method: init.method ?? "GET" });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
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
      console.error("BFF_FETCH_SEND", { url, attempt });
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      console.error("BFF_FETCH_RESPONSE", { url, status: response.status, statusText: response.statusText });
      const bodyText = await response.text();
      console.error("BFF_FETCH_BODY", { url, bodyText: bodyText.substring(0, 500) });
      const body = bodyText ? JSON.parse(bodyText) : null;
      if (!response.ok) {
        const code = body?.error?.code ?? "backend_error";
        const message = body?.error?.message ?? response.statusText;
        throw new BackendClientError(response.status, code, message, response.status >= 500);
      }
      return body as T;
    } catch (error) {
      console.error("BFF_FETCH_ERROR", { url, attempt, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) });
      lastError = error;
      const retryable =
        error instanceof BackendClientError ? error.retryable : true;
      if (!retryable || attempt === 2) break;
      await sleep(100 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  console.error("BFF_FETCH_FAILED", { url, finalError: lastError instanceof Error ? lastError.message : String(lastError) });
  throw lastError instanceof Error
    ? lastError
    : new BackendClientError(500, "backend_error", "Backend request failed");
}

