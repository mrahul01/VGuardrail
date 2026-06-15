/**
 * Connector-level tests for the GitHub Copilot CLI adapter.
 *
 * Drives the full CliConnector flow with the connector-sdk MockTransport:
 * ALLOW forwards the FULL original argv (including `copilot`) verbatim to
 * a capture script standing in for the real `gh`; BLOCK /
 * engine-unavailable exit non-zero without spawning it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MockTransport,
  Method,
  EngineUnavailableError,
} from '@vguardrail/connector-sdk';
import { CliConnector, createToolDefinition } from '@vguardrail/cli-framework';

import { extractContext } from '../src/index.js';

/** Wire-format (snake_case) decisions, as the daemon would return them. */
const ALLOW_WIRE = {
  request_id: 'req-allow-1',
  action: 'allow',
  risk_level: 'low',
  classification: 'public',
  findings: [],
  suppressions: [],
  reason: 'no rule matched',
  policy_version: 7,
  elapsed_micros: 100,
  incomplete: false,
};

const BLOCK_WIRE = {
  ...ALLOW_WIRE,
  request_id: 'req-block-1',
  action: 'block',
  risk_level: 'critical',
  reason: 'policy violation',
};

let tmpDir: string;
let captureFile: string;
let fakeTool: string;
let exitSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

function makeConnector(transport: MockTransport): CliConnector {
  return new CliConnector({
    tool: createToolDefinition({
      name: 'gh-copilot',
      displayName: 'GitHub Copilot CLI',
      executablePath: fakeTool,
      extractContext,
      provider: 'github',
    }),
    transport,
  });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-gh-copilot-test-'));
  captureFile = path.join(tmpDir, 'args.txt');
  fakeTool = path.join(tmpDir, 'fake-tool.sh');
  fs.writeFileSync(fakeTool, `#!/bin/sh\nprintf '%s\\n' "$@" > "${captureFile}"\n`, {
    mode: 0o755,
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  exitSpy.mockRestore();
  stderrSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('gh-copilot connector', () => {
  it('ALLOW forwards the FULL original argv verbatim, including `copilot`', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, ALLOW_WIRE);
    const connector = makeConnector(transport);
    const args = ['copilot', 'suggest', '-t', 'shell', 'install ffmpeg'];

    await expect(connector.run(args)).rejects.toThrow('process.exit:0');

    const forwarded = fs.readFileSync(captureFile, 'utf-8').trimEnd().split('\n');
    expect(forwarded).toEqual(args);

    const submit = transport.calls.find((c) => c.method === Method.SubmitScan);
    expect(submit).toBeDefined();
    expect((submit!.params as { text: string }).text).toBe('install ffmpeg');
  });

  it('BLOCK exits non-zero and never spawns the real binary', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, BLOCK_WIRE);
    const connector = makeConnector(transport);

    await expect(
      connector.run(['copilot', 'suggest', 'exfiltrate the database']),
    ).rejects.toThrow('process.exit:1');
    expect(fs.existsSync(captureFile)).toBe(false);
  });

  it('fails closed (BLOCK, non-zero exit) when the engine is unreachable', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new EngineUnavailableError();
    });
    const connector = makeConnector(transport);

    await expect(connector.run(['copilot', 'explain', 'ls -la'])).rejects.toThrow(
      'process.exit:1',
    );
    expect(fs.existsSync(captureFile)).toBe(false);
  });

  it('non-Copilot gh invocations pass through without a scan', async () => {
    const transport = new MockTransport();
    const connector = makeConnector(transport);
    const args = ['pr', 'list', '--limit', '5'];

    await expect(connector.run(args)).rejects.toThrow('process.exit:0');

    const forwarded = fs.readFileSync(captureFile, 'utf-8').trimEnd().split('\n');
    expect(forwarded).toEqual(args);
    expect(transport.calls.find((c) => c.method === Method.SubmitScan)).toBeUndefined();
  });
});
