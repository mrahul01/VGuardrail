/**
 * Real-executable resolution for CLI wrappers.
 *
 * Wrappers are commonly installed as `vg-<tool>` launchers and then aliased
 * over the original command (e.g. `alias gemini='vg-gemini'`). When the
 * wrapper goes looking for the real binary it must never resolve back to
 * itself (or any other VGuardrail launcher), otherwise an alias or symlink
 * would cause infinite recursion.
 *
 * Resolution order:
 *   1. Explicit environment variable override (e.g. VG_GEMINI_PATH)
 *   2. PATH scan, skipping the wrapper's own directory and any candidate
 *      that resolves (through symlinks) to a VGuardrail launcher
 *   3. Well-known install locations not always on PATH
 *   4. Fall back to the bare name (resolved by the OS at spawn time)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Options for resolving the real executable behind a wrapper.
 */
export interface ResolveExecutableOptions {
  /** Candidate binary names in preference order (e.g. ['gemini']) */
  names: string[];
  /** Environment variable that overrides resolution (e.g. 'VG_GEMINI_PATH') */
  envVar?: string;
  /** Extra directories to search after PATH */
  extraDirs?: string[];
  /** Environment to consult (defaults to process.env) */
  env?: NodeJS.ProcessEnv;
}

/**
 * Well-known install locations searched after PATH.
 */
function defaultExtraDirs(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? '';
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    ...(home ? [`${home}/.local/bin`, `${home}/bin`] : []),
  ];
}

/**
 * Resolve the real executable for a wrapped tool.
 *
 * @param options - Resolution options
 * @returns Absolute path to the real binary, or the first candidate name
 *          as a fallback (left to the OS to resolve at spawn time)
 */
export function resolveRealExecutable(options: ResolveExecutableOptions): string {
  const env = options.env ?? process.env;

  // 1. Explicit override always wins.
  if (options.envVar) {
    const override = env[options.envVar];
    if (override) {
      return override;
    }
  }

  // 2 + 3. Scan PATH, then well-known locations.
  const pathDirs = (env.PATH ?? '').split(path.delimiter).filter((dir) => dir.length > 0);
  const extraDirs = options.extraDirs ?? defaultExtraDirs(env);
  const searchDirs = dedupe([...pathDirs, ...extraDirs]);
  const selfDir = wrapperDirectory();

  for (const name of options.names) {
    for (const dir of searchDirs) {
      const candidate = path.join(dir, name);
      if (!isExecutableFile(candidate)) {
        continue;
      }
      if (isVGuardrailWrapper(candidate, selfDir)) {
        continue;
      }
      return candidate;
    }
  }

  // 4. Fall back to the bare name; spawn will consult PATH.
  return options.names[0];
}

/**
 * The directory containing the currently running wrapper script,
 * with symlinks resolved. Used to avoid resolving back to ourselves.
 */
function wrapperDirectory(): string | null {
  const entry = process.argv[1];
  if (!entry) {
    return null;
  }
  try {
    return path.dirname(fs.realpathSync(entry));
  } catch {
    return path.dirname(path.resolve(entry));
  }
}

/**
 * Whether a candidate executable is (or points at) a VGuardrail wrapper.
 *
 * A candidate is rejected when, after resolving symlinks, it:
 * - lives in the same directory as the running wrapper script, or
 * - has a `vg-` prefixed basename (our launcher naming convention).
 */
function isVGuardrailWrapper(candidate: string, selfDir: string | null): boolean {
  let resolved: string;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    resolved = candidate;
  }

  if (path.basename(resolved).startsWith('vg-')) {
    return true;
  }

  if (selfDir !== null && path.dirname(resolved) === selfDir) {
    return true;
  }

  return false;
}

/**
 * Whether a path exists, is a regular file, and is executable.
 */
function isExecutableFile(candidate: string): boolean {
  try {
    const stats = fs.statSync(candidate);
    if (!stats.isFile()) {
      return false;
    }
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove duplicate entries while preserving order.
 */
function dedupe(entries: string[]): string[] {
  return [...new Set(entries)];
}
