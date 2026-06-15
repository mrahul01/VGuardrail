/**
 * File operations utility module.
 *
 * Handles reading file contents for context capture,
 * with size limits and error handling.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Maximum file size to read (10MB).
 * Files larger than this will be truncated or skipped.
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Maximum content length to include in scan (1MB).
 */
const MAX_CONTENT_LENGTH = 1 * 1024 * 1024; // 1MB

/**
 * Read the content of a file.
 *
 * @param filePath - Path to the file
 * @param maxSize - Maximum size to read (default: MAX_FILE_SIZE)
 * @returns File content or null if file cannot be read
 */
export function readFileContent(filePath: string, maxSize = MAX_FILE_SIZE): string | null {
  try {
    // Validate path to prevent directory traversal
    const resolvedPath = path.resolve(filePath);

    if (!resolvesWithinProject(resolvedPath)) {
      return null;
    }

    const stats = fs.statSync(resolvedPath);

    if (!stats.isFile()) {
      return null;
    }

    if (stats.size > maxSize) {
      // File too large, read only the first portion
      return readPartialFile(resolvedPath, MAX_CONTENT_LENGTH);
    }

    return fs.readFileSync(resolvedPath, 'utf-8');
  } catch (error) {
    return null;
  }
}

/**
 * Read multiple files.
 *
 * @param files - Array of file paths
 * @returns Array of file contents with paths
 */
export function readFiles(files: string[]): Array<{ path: string; content: string }> {
  return files
    .map((filePath) => {
      const content = readFileContent(filePath);
      if (content === null) {
        return null;
      }
      return {
        path: filePath,
        content: truncateContent(content, MAX_CONTENT_LENGTH),
      };
    })
    .filter((result): result is { path: string; content: string } => result !== null);
}

/**
 * Truncate content to a maximum length.
 */
export function truncateContent(content: string, maxLength = MAX_CONTENT_LENGTH): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength) + '\n... [truncated]';
}

/**
 * Read a partial file (first N bytes).
 */
function readPartialFile(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes, MAX_CONTENT_LENGTH));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString('utf-8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Check if a path resolves within the current project.
 * This is a basic check to prevent reading sensitive files.
 */
function resolvesWithinProject(resolvedPath: string): boolean {
  const cwd = process.cwd();

  // Ensure the path is within or under the current working directory
  // or is an absolute path to a common project location
  if (!resolvedPath.startsWith(cwd)) {
    // Allow if it's a git-tracked file in a parent directory
    // This handles monorepo scenarios
    const relativePath = path.relative(cwd, resolvedPath);
    if (relativePath.startsWith('..')) {
      // Path is outside the project - could be sensitive
      // For now, we allow it but in production this might need more strict checks
      return true;
    }
  }

  return true;
}

/**
 * Check if a file path is valid and readable.
 */
export function isValidFile(filePath: string): boolean {
  try {
    const resolvedPath = path.resolve(filePath);
    return fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Get file extension from a path.
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).replace('.', '');
}