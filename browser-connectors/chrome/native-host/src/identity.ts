// Resolves the acting user for ScanRequests. Device identity is the agent's
// concern; here we supply only the user/org. Reads ~/.vguardrail/connector.json
// when present, else falls back to the OS user. Never throws — a bad/absent
// config degrades to the fallback rather than failing the host.

import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { Role } from '@vguardrail/connector-sdk';

export interface ConnectorIdentity {
  userId: string;
  role: Role;
  groups: string[];
}

const VALID_ROLES: ReadonlySet<string> = new Set([
  'super_admin',
  'security_admin',
  'auditor',
  'manager',
  'user',
]);

function fallbackIdentity(): ConnectorIdentity {
  let name = 'unknown-user';
  try {
    name = userInfo().username || name;
  } catch {
    // userInfo can throw on some sandboxes; keep the default.
  }
  return { userId: name, role: 'user', groups: [] };
}

/** Loads the connector identity, defaulting safely. */
export function loadIdentity(configPath = join(homedir(), '.vguardrail', 'connector.json')): ConnectorIdentity {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    return fallbackIdentity();
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fallback = fallbackIdentity();
    const userId = typeof parsed.userId === 'string' && parsed.userId.length > 0 ? parsed.userId : fallback.userId;
    const role = typeof parsed.role === 'string' && VALID_ROLES.has(parsed.role) ? (parsed.role as Role) : 'user';
    const groups = Array.isArray(parsed.groups) ? parsed.groups.filter((g): g is string => typeof g === 'string') : [];
    return { userId, role, groups };
  } catch {
    return fallbackIdentity();
  }
}
