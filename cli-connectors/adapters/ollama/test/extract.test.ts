/**
 * Extraction unit tests for the Ollama adapter.
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

function stderrOutput(): string {
  return stderrSpy.mock.calls.map((call) => String(call[0])).join('');
}

describe('ollama extraction', () => {
  it('extracts the prompt words after the model for `ollama run`', async () => {
    const result = await extractContext(['run', 'llama3', 'hello', 'world']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('hello world');
    expect(result.context?.stdinData).toBeUndefined();
  });

  it('skips value flags and their values when locating model and prompt', async () => {
    const result = await extractContext([
      'run',
      '--format',
      'json',
      'llama3',
      '--keepalive',
      '5m',
      'summarize',
      'this',
    ]);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('summarize this');
  });

  it('skips boolean flags and --flag=value forms', async () => {
    const result = await extractContext([
      'run',
      '--format=json',
      'llama3',
      '--verbose',
      'tell',
      'me',
    ]);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('tell me');
  });

  it('scans piped stdin when `ollama run <model>` has no inline prompt', async () => {
    stdinState.piped = true;
    stdinState.data = 'piped secret content';
    const result = await extractContext(['run', 'llama3']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('piped secret content');
    expect(result.context?.stdinData).toBe('piped secret content');
  });

  it('captures stdin alongside an inline prompt', async () => {
    stdinState.piped = true;
    stdinState.data = 'extra context';
    const result = await extractContext(['run', 'llama3', 'summarize']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('summarize');
    expect(result.context?.stdinData).toBe('extra context');
  });

  it('passes through `ollama run <model>` with no prompt and no stdin (interactive)', async () => {
    const result = await extractContext(['run', 'llama3']);
    expect(result.found).toBe(false);
    expect(result.error).toBeUndefined();
    expect(stderrOutput()).toContain('Interactive Ollama run session');
  });

  it('passes through maintenance subcommands with a notice', async () => {
    for (const subcommand of ['pull', 'list', 'serve', 'ps', 'rm']) {
      const result = await extractContext([subcommand, 'llama3']);
      expect(result.found).toBe(false);
    }
    expect(stderrOutput()).toContain('maintenance command "pull"');
  });

  it('passes through `ollama chat` noting per-message interception is impossible', async () => {
    const result = await extractContext(['chat', 'llama3']);
    expect(result.found).toBe(false);
    expect(stderrOutput()).toContain('cannot be intercepted per-message');
  });

  it('passes through when no subcommand is present', async () => {
    const result = await extractContext(['--version']);
    expect(result.found).toBe(false);
  });
});
