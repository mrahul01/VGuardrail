/**
 * Input validation utility module.
 *
 * Provides validation for file paths, CLI arguments,
 * and other user-provided inputs.
 */

import * as path from 'node:path';

/**
 * Validate a file path for safety.
 *
 * Checks for:
 * - Path traversal attempts
 * - Invalid characters
 * - Absolute paths outside allowed directories
 */
export function validatePath(filePath: string): { valid: boolean; error?: string } {
  if (!filePath || filePath.trim() === '') {
    return { valid: false, error: 'Empty path' };
  }

  // Check for null bytes
  if (filePath.includes('\0')) {
    return { valid: false, error: 'Path contains null bytes' };
  }

  // Resolve the path
  const resolved = path.resolve(filePath);

  // Check for path traversal attempts (going above cwd)
  const relative = path.relative(process.cwd(), resolved);
  if (relative.startsWith('..') && !isAllowedExternalPath(resolved)) {
    return { valid: false, error: 'Path is outside allowed directory' };
  }

  return { valid: true };
}

/**
 * Sanitize a file path by removing potentially dangerous components.
 */
export function sanitizePath(filePath: string): string {
  // Remove null bytes
  let sanitized = filePath.replace(/\0/g, '');

  // Resolve to absolute path
  sanitized = path.resolve(sanitized);

  return sanitized;
}

/**
 * Check if an external path is allowed.
 * This can be extended to allow specific external directories.
 */
function isAllowedExternalPath(resolvedPath: string): boolean {
  // For now, we don't allow any external paths
  // This could be extended with a whitelist
  const allowedPrefixes: string[] = [];

  return allowedPrefixes.some((prefix) => resolvedPath.startsWith(prefix));
}

/**
 * Validate CLI arguments for safety.
 *
 * Checks for:
 * - Extremely long arguments (potential buffer overflow attempts)
 * - Null bytes in arguments
 */
export function validateArguments(args: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const maxArgLength = 100000; // 100KB per argument

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.includes('\0')) {
      errors.push(`Argument ${i} contains null bytes`);
    }

    if (arg.length > maxArgLength) {
      errors.push(`Argument ${i} exceeds maximum length (${arg.length} > ${maxArgLength})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a prompt string.
 *
 * Checks for:
 * - Empty prompts
 * - Excessively long prompts
 */
export function validatePrompt(prompt: string, maxLength = 1000000): { valid: boolean; error?: string } {
  if (!prompt || prompt.trim() === '') {
    return { valid: false, error: 'Empty prompt' };
  }

  if (prompt.length > maxLength) {
    return { valid: false, error: `Prompt exceeds maximum length (${prompt.length} > ${maxLength})` };
  }

  return { valid: true };
}

/**
 * Validate a tool name.
 *
 * Checks for:
 * - Valid characters (alphanumeric, hyphens, underscores)
 * - Reasonable length
 */
export function validateToolName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Empty tool name' };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { valid: false, error: 'Tool name contains invalid characters' };
  }

  if (name.length > 64) {
    return { valid: false, error: 'Tool name too long (max 64 characters)' };
  }

  return { valid: true };
}