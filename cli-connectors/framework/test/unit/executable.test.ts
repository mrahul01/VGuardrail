/**
 * Unit tests for real-executable resolution.
 *
 * Tests cover:
 * - environment variable override
 * - PATH scanning
 * - skipping VGuardrail launchers (vg- prefixed, symlinked)
 * - bare-name fallback
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveRealExecutable } from '../../src/util/executable.js';

let tmpDir: string;

function makeExecutable(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(file, 0o755);
  return file;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-exec-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveRealExecutable', () => {
  it('prefers the environment variable override', () => {
    const resolved = resolveRealExecutable({
      names: ['gemini'],
      envVar: 'VG_GEMINI_PATH',
      extraDirs: [],
      env: { VG_GEMINI_PATH: '/custom/gemini', PATH: tmpDir },
    });
    expect(resolved).toBe('/custom/gemini');
  });

  it('finds the binary on PATH', () => {
    const real = makeExecutable(tmpDir, 'gemini');
    const resolved = resolveRealExecutable({
      names: ['gemini'],
      extraDirs: [],
      env: { PATH: tmpDir },
    });
    expect(resolved).toBe(real);
  });

  it('tries candidate names in order', () => {
    const real = makeExecutable(tmpDir, 'codex-cli');
    const resolved = resolveRealExecutable({
      names: ['codex', 'codex-cli'],
      extraDirs: [],
      env: { PATH: tmpDir },
    });
    expect(resolved).toBe(real);
  });

  it('skips symlinks that resolve to a vg- launcher', () => {
    const wrapper = makeExecutable(tmpDir, 'vg-gemini');
    const firstDir = path.join(tmpDir, 'first');
    fs.mkdirSync(firstDir);
    // A `gemini` symlink pointing back at our wrapper (recursion hazard).
    fs.symlinkSync(wrapper, path.join(firstDir, 'gemini'));
    const laterDir = path.join(tmpDir, 'later');
    fs.mkdirSync(laterDir);
    const real = makeExecutable(laterDir, 'gemini');

    const resolved = resolveRealExecutable({
      names: ['gemini'],
      extraDirs: [],
      env: { PATH: [firstDir, laterDir].join(path.delimiter) },
    });
    expect(resolved).toBe(real);
  });

  it('falls back to the bare name when nothing is found', () => {
    const resolved = resolveRealExecutable({
      names: ['aider'],
      extraDirs: [],
      env: { PATH: tmpDir },
    });
    expect(resolved).toBe('aider');
  });

  it('ignores non-executable files', () => {
    const file = path.join(tmpDir, 'gemini');
    fs.writeFileSync(file, 'not executable');
    fs.chmodSync(file, 0o644);
    const resolved = resolveRealExecutable({
      names: ['gemini'],
      extraDirs: [],
      env: { PATH: tmpDir },
    });
    expect(resolved).toBe('gemini');
  });
});
