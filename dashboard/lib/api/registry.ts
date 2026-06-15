// Server-side repository registry: the BFF (`with-rbac.ts`) uses this to talk
// to the Rust backend over the internal network. There is NO mock data path
// and NO silent fallback — if the backend is unreachable the request fails
// loudly with a 5xx, which is the correct production behaviour.
//
// The browser never uses this module; pages use the client→BFF registry in
// `lib/api/bff-repositories.ts`.

import {
  createBackendAuditRepository,
  createBackendDashboardRepository,
  createBackendDeviceRepository,
  createBackendExceptionRepository,
  createBackendPolicyRepository,
  createBackendSettingsRepository,
  createBackendUserRepository,
  createBackendViolationRepository,
} from "@/lib/api/backend";
import type { RepositoryRegistry } from "@/lib/api/types";

export function createRepositoryRegistry(options?: {
  /** Cognito ID token forwarded to the backend as `Authorization: Bearer`. */
  readonly token?: string;
}): RepositoryRegistry {
  const token = options?.token;
  return {
    dashboard: createBackendDashboardRepository(token),
    devices: createBackendDeviceRepository(token),
    policies: createBackendPolicyRepository(token),
    violations: createBackendViolationRepository(token),
    exceptions: createBackendExceptionRepository(token),
    audit: createBackendAuditRepository(token),
    users: createBackendUserRepository(token),
    org: createBackendSettingsRepository(token),
  };
}
