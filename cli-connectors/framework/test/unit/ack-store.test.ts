/**
 * Unit tests for the resubmit-to-acknowledge store used by the Claude Code
 * hook and the PTY guard for medium-risk WARN decisions.
 *
 * Tests cover:
 * - first submission records and reports "not acknowledged" (block)
 * - resubmit within the window reports "acknowledged" (proceed) and consumes
 * - a resubmit after expiry blocks again
 * - distinct prompts / scopes never cross-acknowledge
 * - the store file holds only hashes, never prompt text
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { consumeOrRecordAck, ACK_WINDOW_MS } from '../../src/util/ack-store.js';

let storePath: string;

beforeEach(() => {
  storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vg-ack-')), 'acks.json');
});
afterEach(() => {
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

describe('consumeOrRecordAck', () => {
  it('blocks the first submission and proceeds on a resubmit within the window', () => {
    const now = 1_000_000;
    const first = consumeOrRecordAck('session-1', 'rewrite this PIP', { storePath, now: () => now });
    expect(first).toBe(false); // not yet acknowledged → block

    const second = consumeOrRecordAck('session-1', 'rewrite this PIP', {
      storePath,
      now: () => now + 5_000,
    });
    expect(second).toBe(true); // acknowledged → proceed
  });

  it('blocks again when the acknowledgement window has expired', () => {
    const now = 2_000_000;
    expect(consumeOrRecordAck('s', 'p', { storePath, now: () => now })).toBe(false);
    const late = consumeOrRecordAck('s', 'p', { storePath, now: () => now + ACK_WINDOW_MS + 1 });
    expect(late).toBe(false); // stale entry pruned → treated as first submission
  });

  it('consumes the acknowledgement so a third submission blocks again', () => {
    const now = 3_000_000;
    consumeOrRecordAck('s', 'p', { storePath, now: () => now });
    expect(consumeOrRecordAck('s', 'p', { storePath, now: () => now + 1000 })).toBe(true);
    expect(consumeOrRecordAck('s', 'p', { storePath, now: () => now + 2000 })).toBe(false);
  });

  it('never cross-acknowledges different prompts or scopes', () => {
    const now = 4_000_000;
    consumeOrRecordAck('s', 'prompt-A', { storePath, now: () => now });
    expect(consumeOrRecordAck('s', 'prompt-B', { storePath, now: () => now })).toBe(false);
    expect(consumeOrRecordAck('other', 'prompt-A', { storePath, now: () => now })).toBe(false);
  });

  it('stores only hashes, never the prompt text', () => {
    consumeOrRecordAck('sess', 'super-secret-prompt-text', { storePath, now: () => 5_000_000 });
    const raw = fs.readFileSync(storePath, 'utf8');
    expect(raw).not.toContain('super-secret-prompt-text');
  });
});
