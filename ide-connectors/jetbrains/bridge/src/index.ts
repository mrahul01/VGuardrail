#!/usr/bin/env node
// One-shot bridge entry point: read exactly one JSON request line from stdin,
// print exactly one JSON reply line on stdout, exit 0. The JetBrains plugin
// spawns this per request (`node dist/index.js`), so the contract stays
// trivially debuggable:  echo '{"text":"hi"}' | node dist/index.js
//
// Exit code is always 0 with a decision line on stdout — including every
// failure path, which prints a fail-closed BLOCK decision. Diagnostics go to
// stderr only; stdout carries nothing but the reply line.

import { randomUUID } from 'node:crypto';
import { ConnectorClient, syntheticDecision } from '@vguardrail/connector-sdk';
import { handleLine } from './handler.js';
import { loadIdentity } from './identity.js';

/** Reads stdin up to the first newline (or EOF). */
async function readFirstLine(stream: NodeJS.ReadStream): Promise<string> {
  stream.setEncoding('utf8');
  let buffered = '';
  for await (const chunk of stream) {
    buffered += chunk as string;
    const newline = buffered.indexOf('\n');
    if (newline >= 0) return buffered.slice(0, newline);
  }
  return buffered;
}

async function main(): Promise<void> {
  const client = new ConnectorClient();
  try {
    const line = await readFirstLine(process.stdin);
    const reply = await handleLine(line, client, loadIdentity());
    process.stdout.write(`${reply}\n`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    // Catastrophic path (e.g. stdin failure): still emit a fail-closed block.
    process.stderr.write(`vguardrail-jetbrains-bridge: ${String(error)}\n`);
    const decision = {
      ...syntheticDecision({
        requestId: randomUUID(),
        action: 'block',
        reason: 'bridge error; fail-closed block',
      }),
      fromFallback: true,
    };
    process.stdout.write(`${JSON.stringify(decision)}\n`);
    process.exit(0);
  },
);
