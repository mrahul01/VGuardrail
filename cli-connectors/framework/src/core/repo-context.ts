/**
 * Repository context detection for policy evaluation.
 *
 * Detects repository information from the current working directory,
 * including git repository name and classification.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import type { RepoContext as RepoContextType } from './types.js';
import type { RepoConfig } from './config.js';

// Re-export RepoContext for convenience
export type RepoContext = RepoContextType;

/**
 * Check if the current directory is inside a git repository.
 */
export function isGitRepo(cwd?: string): boolean {
  try {
    const gitDir = path.join(cwd || process.cwd(), '.git');
    return fs.existsSync(gitDir);
  } catch {
    return false;
  }
}

/**
 * Get the repository name from git remote URL.
 *
 * @param cwd - Optional working directory
 * @returns Repository name in format 'owner/repo' or null if not found
 */
export function getRepoName(cwd?: string): string | null {
  try {
    const remoteUrl = child_process
      .execSync('git remote get-url origin', {
        cwd: cwd || process.cwd(),
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .trim();

    // Parse the remote URL to extract owner/repo
    let match: RegExpMatchArray | null;

    // HTTPS format
    match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }

    // SSH format (git@host:owner/repo.git)
    match = remoteUrl.match(/^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect repository context from the current working directory.
 *
 * @param repoConfig - Optional configuration for repo-specific settings
 * @param cwd - Optional working directory
 * @returns Repository context or undefined if not in a repo
 */
export function detectRepoContext(repoConfig?: RepoConfig, cwd?: string): RepoContextType | undefined {
  if (!isGitRepo(cwd)) {
    return undefined;
  }

  const repoName = getRepoName(cwd);
  if (!repoName) {
    // In a git repo but can't determine name
    const result: RepoContextType = { name: 'unknown' };
    if (repoConfig?.classification !== undefined) {
      result.classification = repoConfig.classification;
    }
    return result;
  }

  const result: RepoContextType = { name: repoName };
  if (repoConfig?.classification !== undefined) {
    result.classification = repoConfig.classification;
  }
  return result;
}

/**
 * Get repository classification from environment or config.
 */
export function getRepoClassification(_repoName: string, repoConfig?: RepoConfig): string | undefined {
  // Check environment variable first
  const envClassification = process.env.VG_REPO_CLASSIFICATION;
  if (envClassification) {
    return envClassification;
  }

  // Check config
  return repoConfig?.classification;
}

/**
 * Validate repository context.
 */
export function validateRepoContext(context: RepoContextType): boolean {
  return typeof context.name === 'string' && context.name.length > 0;
}