/**
 * Extraction unit tests for the Shell-GPT adapter.
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

describe('sgpt extraction', () => {
  it('extracts the first positional argument as the prompt', async () => {
    const result = await extractContext(['what is the meaning of life']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('what is the meaning of life');
  });

  it('skips value flags and their values', async () => {
    const result = await extractContext([
      '--model',
      'gpt-4',
      '--temperature',
      '0.5',
      'explain quines',
    ]);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('explain quines');
  });

  it('skips boolean flags', async () => {
    const result = await extractContext(['--code', '--no-cache', 'fizzbuzz in python']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('fizzbuzz in python');
  });

  it('extracts the prompt from `--chat <session> <prompt>`', async () => {
    const result = await extractContext(['--chat', 'session-1', 'continue the story']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('continue the story');
  });

  it('passes through `--repl <session>` (interactive) with a notice', async () => {
    const result = await extractContext(['--repl', 'session-1']);
    expect(result.found).toBe(false);
    expect(result.error).toBeUndefined();
    const stderr = stderrSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(stderr).toContain('REPL session');
  });

  it('scans piped stdin and uses it as the prompt when no positional is given', async () => {
    stdinState.piped = true;
    stdinState.data = 'piped error log';
    const result = await extractContext([]);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('piped error log');
    expect(result.context?.stdinData).toBe('piped error log');
  });

  it('captures stdin alongside a positional prompt', async () => {
    stdinState.piped = true;
    stdinState.data = 'stack trace contents';
    const result = await extractContext(['explain this error']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('explain this error');
    expect(result.context?.stdinData).toBe('stack trace contents');
  });

  it('passes through when there is no prompt and no stdin', async () => {
    const result = await extractContext(['--list-chats']);
    expect(result.found).toBe(false);
  });
});
