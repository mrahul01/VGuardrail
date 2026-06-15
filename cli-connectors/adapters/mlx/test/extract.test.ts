/**
 * Extraction unit tests for the MLX LM adapter.
 *
 * Stdin is mocked at the framework boundary so the tests control
 * piped-vs-TTY behavior deterministically.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const stdinState = vi.hoisted(() => ({ piped: false, data: '' }));

vi.mock('@vguardrail/cli-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vguardrail/cli-framework')>();
  return {
    ...actual,
    isStdinPiped: () => stdinState.piped,
    readStdin: async () => stdinState.data,
  };
});

import { extractContext } from '../src/index.js';

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdinState.piped = false;
  stdinState.data = '';
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('mlx extraction', () => {
  it('extracts --prompt <value>', async () => {
    const result = await extractContext(['--model', 'mlx-community/some-model', '--prompt', 'hello world']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('hello world');
    expect(result.context?.stdinData).toBeUndefined();
  });

  it('extracts --prompt=value', async () => {
    const result = await extractContext(['--prompt="quoted prompt"', '--max-tokens', '100']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('quoted prompt');
  });

  it('captures piped stdin for --prompt -', async () => {
    stdinState.piped = true;
    stdinState.data = 'piped prompt content';
    const result = await extractContext(['--prompt', '-']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('piped prompt content');
    expect(result.context?.stdinData).toBe('piped prompt content');
  });

  it('passes through --prompt - on a TTY (nothing piped to scan)', async () => {
    const result = await extractContext(['--prompt', '-']);
    expect(result.found).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('passes through when no --prompt is given, with a notice', async () => {
    const result = await extractContext(['--model', 'mlx-community/some-model']);
    expect(result.found).toBe(false);
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toContain('No --prompt detected');
  });

  it('does not mistake a value flag value for a prompt', async () => {
    const result = await extractContext(['--max-tokens', '256', '--temp', '0.7']);
    expect(result.found).toBe(false);
  });
});
