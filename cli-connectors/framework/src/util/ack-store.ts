// Acknowledgement store for medium-risk WARN decisions in contexts that
// cannot show an interactive Proceed/Cancel dialog (the Claude Code hook, the
// PTY guard).
//
// Semantics ("resubmit to acknowledge"): the first submission of a
// medium-risk prompt is blocked and its key is recorded; resubmitting the
// SAME prompt within the window counts as an explicit acknowledgement and is
// allowed through. Keys are SHA-256 hashes — the store never contains prompt
// text (privacy invariant).

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** How long a pending acknowledgement stays valid. */
export const ACK_WINDOW_MS = 60_000;

const DEFAULT_STORE = path.join(os.homedir(), '.vguardrail', 'hook-acks.json');

export interface AckStoreOptions {
  /** Store file path (defaults to ~/.vguardrail/hook-acks.json). */
  storePath?: string;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/** Stable key for a (scope, prompt) pair; the scope separates sessions/tools. */
export function ackKey(scope: string, text: string): string {
  return crypto.createHash('sha256').update(`${scope}\n${text}`, 'utf8').digest('hex');
}

interface AckFile {
  [key: string]: number;
}

function load(storePath: string): AckFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: AckFile = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number') out[k] = v;
      }
      return out;
    }
  } catch {
    // Missing or corrupt store — start fresh (worst case: one extra block).
  }
  return {};
}

function save(storePath: string, data: AckFile): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data), { mode: 0o600 });
}

/**
 * One round of the resubmit-to-acknowledge protocol.
 *
 * Returns `true` when a fresh pending acknowledgement existed (the resubmit:
 * proceed, the pending entry is consumed). Returns `false` otherwise (first
 * submission: block, and a pending entry is recorded). Expired entries are
 * pruned on every call.
 */
export function consumeOrRecordAck(scope: string, text: string, options: AckStoreOptions = {}): boolean {
  const storePath = options.storePath ?? DEFAULT_STORE;
  const now = (options.now ?? Date.now)();
  const key = ackKey(scope, text);

  const store = load(storePath);
  for (const [k, ts] of Object.entries(store)) {
    if (now - ts > ACK_WINDOW_MS) delete store[k];
  }

  const pending = store[key] !== undefined;
  if (pending) {
    delete store[key];
  } else {
    store[key] = now;
  }
  save(storePath, store);
  return pending;
}
