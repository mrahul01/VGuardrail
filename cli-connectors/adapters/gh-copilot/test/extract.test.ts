/**
 * Extraction unit tests for the GitHub Copilot CLI adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { extractContext } from '../src/index.js';

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

function stderrOutput(): string {
  return stderrSpy.mock.calls.map((call) => String(call[0])).join('');
}

describe('gh-copilot extraction', () => {
  it('extracts the prompt from `gh copilot suggest "<prompt>"`', async () => {
    const result = await extractContext(['copilot', 'suggest', 'install ffmpeg']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('install ffmpeg');
  });

  it('extracts the command from `gh copilot explain "<command>"`', async () => {
    const result = await extractContext(['copilot', 'explain', 'sudo chmod -R 777 /']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('sudo chmod -R 777 /');
  });

  it('skips the -t/--target flag and its value', async () => {
    let result = await extractContext(['copilot', 'suggest', '-t', 'shell', 'list open ports']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('list open ports');

    result = await extractContext(['copilot', 'suggest', '--target', 'git', 'undo last commit']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('undo last commit');
  });

  it('handles flags placed before the subcommand', async () => {
    const result = await extractContext(['copilot', '--hostname', 'github.example.com', 'suggest', 'list files']);
    expect(result.found).toBe(true);
    expect(result.context?.prompt).toBe('list files');
  });

  it('passes through `gh copilot suggest` with no inline prompt (interactive)', async () => {
    const result = await extractContext(['copilot', 'suggest']);
    expect(result.found).toBe(false);
    expect(result.error).toBeUndefined();
    expect(stderrOutput()).toContain('interactive');
  });

  it('passes through `gh copilot` alone (interactive)', async () => {
    const result = await extractContext(['copilot']);
    expect(result.found).toBe(false);
    expect(stderrOutput()).toContain('Interactive Copilot session');
  });

  it('passes through other copilot subcommands with a notice', async () => {
    const result = await extractContext(['copilot', 'config']);
    expect(result.found).toBe(false);
    expect(stderrOutput()).toContain('maintenance command "config"');
  });

  it('passes through non-Copilot gh invocations', async () => {
    for (const args of [['pr', 'list'], ['issue', 'view', '42'], ['api', '/user'], []]) {
      const result = await extractContext(args);
      expect(result.found).toBe(false);
    }
    expect(stderrOutput()).toContain('Not a GitHub Copilot invocation');
  });
});
