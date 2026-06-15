/**
 * Extraction unit tests for the llama.cpp adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { extractContext } from '../src/index.js';

let tmpDir: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-llama-test-'));
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('llama.cpp extraction', () => {
  it('extracts -p prompts', async () => {
    const result = await extractContext(['-m', 'model.gguf', '-p', 'hello world']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('hello world');
  });

  it('extracts --prompt prompts', async () => {
    const result = await extractContext(['--prompt', 'hello world']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('hello world');
  });

  it('extracts --prompt=value and -p=value forms', async () => {
    let result = await extractContext(['--prompt="quoted prompt"']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('quoted prompt');

    result = await extractContext(['-p=inline prompt']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('inline prompt');
  });

  it('reads and scans -f prompt files', async () => {
    const promptFile = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'file prompt content');
    const result = await extractContext(['-f', promptFile]);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('file prompt content');
    expect(result.context?.files).toEqual([
      { path: promptFile, content: 'file prompt content' },
    ]);
  });

  it('supports the --file=value form', async () => {
    const promptFile = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'from equals form');
    const result = await extractContext([`--file=${promptFile}`]);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('from equals form');
  });

  it('fails closed on an unreadable prompt file', async () => {
    const result = await extractContext(['-f', path.join(tmpDir, 'missing.txt')]);
    expect(result.found).toBe(false);
    expect(result.error).toContain('Cannot read prompt file');
  });

  it('scans both the inline prompt and the prompt file when both are given', async () => {
    const promptFile = path.join(tmpDir, 'prompt.txt');
    fs.writeFileSync(promptFile, 'system instructions');
    const result = await extractContext(['-p', 'inline', '-f', promptFile]);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('inline');
    expect(result.context?.files).toHaveLength(1);
    expect(result.context?.files[0].content).toBe('system instructions');
  });

  it('passes through interactive sessions (no prompt flag) with a notice', async () => {
    const result = await extractContext(['-m', 'model.gguf', '--interactive']);
    expect(result.found).toBe(false);
    expect(result.error).toBeUndefined();
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toContain('Passing through without scanning');
  });
});
