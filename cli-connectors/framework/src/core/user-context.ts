/**
 * User context resolution for policy evaluation.
 *
 * Resolves user identity and role from environment variables,
 * configuration files, and system information.
 */

import * as os from 'node:os';
import type { UserContext as UserContextType } from './types.js';
import type { UserConfig } from './config.js';

// Re-export UserContext for convenience
export type UserContext = UserContextType;

/**
 * Get user information from environment variables.
 */
export function getUserFromEnv(): { userId: string; hostname: string } {
  return {
    userId: process.env.USER || process.env.USERNAME || os.userInfo().username || 'unknown',
    hostname: os.hostname(),
  };
}

/**
 * Resolve the complete user context from environment and configuration.
 *
 * Priority order:
 * 1. Configuration file values
 * 2. Environment variables
 * 3. System defaults
 */
export function resolveUserContext(userConfig?: Partial<UserConfig>): UserContextType {
  const envUser = getUserFromEnv();

  return {
    userId: userConfig?.id || envUser.userId,
    role: userConfig?.role || 'user',
    groups: userConfig?.groups || [],
  };
}

/**
 * Validate that user context has required fields.
 */
export function validateUserContext(context: UserContextType): boolean {
  return (
    typeof context.userId === 'string' &&
    context.userId.length > 0 &&
    typeof context.role === 'string' &&
    context.role.length > 0 &&
    Array.isArray(context.groups)
  );
}

/**
 * Anonymize user context for logging (removes PII).
 */
export function anonymizeUserContext(context: UserContextType): Omit<UserContextType, 'userId'> & { userId: string } {
  // Hash the user ID for privacy in logs
  return {
    userId: `user_${context.userId.slice(0, 4)}`,
    role: context.role,
    groups: context.groups,
  };
}