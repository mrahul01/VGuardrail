// The Chrome Native Messaging host. Reads length-prefixed (LE) JSON messages on
// stdin, drives the connector-sdk, and writes framed replies on stdout. stdout
// is the message channel, so ALL diagnostics go to stderr and NEVER include
// prompt text, findings, or secrets.

import type { Readable, Writable } from 'node:stream';
import { encodeMessage, FramingError, MessageDecoder } from './framing.js';
import { handleRequest, type ScanClient } from './handlers.js';
import { parseRequest } from './protocol.js';
import type { ConnectorIdentity } from './identity.js';

export interface HostLogger {
  warn(message: string): void;
}

const stderrLogger: HostLogger = {
  warn(message: string) {
    process.stderr.write(`vguardrail-connector-host: ${message}\n`);
  },
};

export interface RunHostOptions {
  client: ScanClient & { close?(): Promise<void> };
  identity: ConnectorIdentity;
  input: Readable;
  output: Writable;
  logger?: HostLogger;
}

/**
 * Runs the host loop until stdin ends (Chrome closed the port) or an
 * unrecoverable framing error occurs. Resolves after in-flight handlers finish
 * and the client is closed. Replies are serialized so frames never interleave.
 */
export function runHost(options: RunHostOptions): Promise<void> {
  const { client, identity, input, output } = options;
  const logger = options.logger ?? stderrLogger;
  const decoder = new MessageDecoder();

  return new Promise<void>((resolve) => {
    let ended = false;
    let inFlight = 0;
    let writeChain: Promise<void> = Promise.resolve();
    let finished = false;

    const enqueueWrite = (buf: Buffer): void => {
      writeChain = writeChain.then(
        () =>
          new Promise<void>((res) => {
            output.write(buf, () => res());
          }),
      );
    };

    const maybeFinish = (): void => {
      if (finished || !ended || inFlight > 0) return;
      finished = true;
      void writeChain
        .then(() => client.close?.())
        .catch(() => undefined)
        .finally(() => resolve());
    };

    const dispatch = (raw: unknown): void => {
      const parsed = parseRequest(raw);
      if ('invalid' in parsed) {
        if (parsed.id !== null) {
          enqueueWrite(
            encodeMessage({ id: parsed.id, ok: false, error: { code: 'BAD_REQUEST', message: 'malformed request' } }),
          );
        }
        // No id → cannot correlate a reply; drop (the extension times out → BLOCK).
        return;
      }
      inFlight++;
      handleRequest(client, identity, parsed)
        .then((reply) => enqueueWrite(encodeMessage(reply)))
        .catch(() => logger.warn('handler error'))
        .finally(() => {
          inFlight--;
          maybeFinish();
        });
    };

    input.on('data', (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch (error) {
        // Corrupt/oversized stream is unframeable; stop reading.
        logger.warn(error instanceof FramingError ? 'framing error; shutting down' : 'decode error; shutting down');
        ended = true;
        maybeFinish();
        return;
      }
      for (const message of messages) dispatch(message);
    });

    input.on('end', () => {
      ended = true;
      maybeFinish();
    });
    input.on('error', () => {
      ended = true;
      maybeFinish();
    });
  });
}
