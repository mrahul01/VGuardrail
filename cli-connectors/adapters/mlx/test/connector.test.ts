/**
 * Connector-level tests for the MLX LM adapter.
 *
 * Drives the full CliConnector flow with the connector-sdk MockTransport:
 * ALLOW forwards the original arguments verbatim to a capture script;
 * BLOCK / engine-unavailable exit non-zero without spawning the real
 * binary.
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

const stdinState = vi.hoisted(() => ({ piped: false, data: '' }));

vi.mock('@vguardrail/cli-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vguardrail/cli-framework')>();
  return {
    ...actual,
    isStdinPiped: () => stdinState.piped,
    readStdin: async () => stdinState.data,
  };
});

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
      name: 'mlx-lm',
      displayName: 'MLX LM',
      executablePath: fakeTool,
      extractContext,
      provider: 'mlx',
    }),
    transport,
  });
}

beforeEach(() => {
  stdinState.piped = false;
  stdinState.data = '';
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-mlx-test-'));
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

describe('mlx connector', () => {
  it('ALLOW forwards the original arguments verbatim', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, ALLOW_WIRE);
    const connector = makeConnector(transport);
    const args = ['--model', 'mlx-community/some-model', '--prompt', 'hello world'];

    await expect(connector.run(args)).rejects.toThrow('process.exit:0');

    const forwarded = fs.readFileSync(captureFile, 'utf-8').trimEnd().split('\n');
    expect(forwarded).toEqual(args);

    const submit = transport.calls.find((c) => c.method === Method.SubmitScan);
    expect(submit).toBeDefined();
    expect((submit!.params as { text: string }).text).toBe('hello world');
  });

  it('BLOCK exits non-zero and never spawns the real binary', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, BLOCK_WIRE);
    const connector = makeConnector(transport);

    await expect(connector.run(['--prompt', 'leak the secrets'])).rejects.toThrow(
      'process.exit:1',
    );
    expect(fs.existsSync(captureFile)).toBe(false);
  });

  it('fails closed (BLOCK, non-zero exit) when the engine is unreachable', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new EngineUnavailableError();
    });
    const connector = makeConnector(transport);

    await expect(connector.run(['--prompt', 'hello'])).rejects.toThrow('process.exit:1');
    expect(fs.existsSync(captureFile)).toBe(false);
  });

  it('passes through without a scan when no --prompt is given', async () => {
    const transport = new MockTransport();
    const connector = makeConnector(transport);
    const args = ['--model', 'mlx-community/some-model'];

    await expect(connector.run(args)).rejects.toThrow('process.exit:0');

    const forwarded = fs.readFileSync(captureFile, 'utf-8').trimEnd().split('\n');
    expect(forwarded).toEqual(args);
    expect(transport.calls.find((c) => c.method === Method.SubmitScan)).toBeUndefined();
  });
});
