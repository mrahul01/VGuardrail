// Default production Transport. Spawns the signed Swift `xpc-bridge` helper and
// speaks the length-prefixed JSON protocol over its stdio. The helper holds the
// NSXPCConnection to `com.vguardrail.agent.xpc`, so the daemon's code-signing
// peer check still authenticates the caller (the helper), preserving the XPC
// trust boundary.
//
// NOTE: the helper binary itself is specced in bridge/README.md and built as a
// follow-up. This transport is complete and exercised by the protocol unit
// tests; end-to-end use requires the binary on disk. Tests of the client use
// MockTransport, so this file needs no native dependency to compile or ship.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { FrameDecoder, encodeFrame, parseReplyEnvelope, PROTOCOL_VERSION } from '../protocol/envelope.js';
import { NotConnectedError, TransportError, connectorErrorFromWire } from '../resilience/errors.js';
import { noopLogger, type Logger } from '../util/logger.js';
import type { Transport } from './transport.js';

export interface XpcBridgeOptions {
  /**
   * Path to the signed helper binary. Defaults to `$VG_XPC_BRIDGE_PATH`, then a
   * bare `vguardrail-xpc-bridge` (resolved on PATH).
   */
  helperPath?: string;
  /** Mach service the helper should connect to (passed via env). */
  machServiceName?: string;
  /** Optional logger for connection lifecycle + error codes (no payloads). */
  logger?: Logger;
  /** Injectable spawn, for testing. Defaults to `node:child_process.spawn`. */
  spawnFn?: typeof spawn;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const DEFAULT_HELPER = 'vguardrail-xpc-bridge';

export class XpcBridgeTransport implements Transport {
  private readonly helperPath: string;
  private readonly machServiceName: string | undefined;
  private readonly logger: Logger;
  private readonly spawnFn: typeof spawn;

  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<string, Pending>();

  constructor(options: XpcBridgeOptions = {}) {
    this.helperPath = options.helperPath ?? process.env.VG_XPC_BRIDGE_PATH ?? DEFAULT_HELPER;
    this.machServiceName = options.machServiceName;
    this.logger = options.logger ?? noopLogger;
    this.spawnFn = options.spawnFn ?? spawn;
  }

  async connect(): Promise<void> {
    if (this.child !== undefined) return;

    const env = { ...process.env };
    if (this.machServiceName !== undefined) env.VG_MACH_SERVICE = this.machServiceName;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnFn(this.helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      }) as ChildProcessWithoutNullStreams;
    } catch (cause) {
      throw new TransportError(`failed to spawn xpc-bridge "${this.helperPath}"`, { cause });
    }

    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.removeListener('error', onError);
        resolve();
      };
      const onError = (cause: unknown): void => {
        child.removeListener('spawn', onSpawn);
        reject(new TransportError(`xpc-bridge failed to start: ${this.helperPath}`, { cause }));
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
    child.on('exit', (code, signal) => this.onExit(code, signal));
    child.on('error', (error) => this.failAll(new TransportError('xpc-bridge errored', { cause: error })));
    child.stderr.on('data', (chunk: Buffer) => {
      this.logger.warn('xpc-bridge stderr', { line: chunk.toString('utf8').trim() });
    });

    this.child = child;
    this.logger.info('xpc-bridge connected', { helper: this.helperPath });
  }

  async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const child = this.child;
    if (child === undefined || child.exitCode !== null) {
      throw new NotConnectedError();
    }

    const id = randomUUID();
    const frame = encodeFrame({ v: PROTOCOL_VERSION, id, method, params });

    return new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => {
        // Drop the correlation so a late reply is ignored.
        this.pending.delete(id);
        reject(new TransportError(`request "${method}" aborted`));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, {
        resolve: (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      });

      child.stdin.write(frame, (error) => {
        if (error) {
          this.pending.delete(id);
          signal.removeEventListener('abort', onAbort);
          reject(new TransportError(`failed to write request "${method}"`, { cause: error }));
        }
      });
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.failAll(new NotConnectedError('transport closed'));
    if (child !== undefined && child.exitCode === null) {
      child.kill();
    }
  }

  private onStdout(chunk: Buffer): void {
    let frames: unknown[];
    try {
      frames = this.decoder.push(chunk);
    } catch (error) {
      // A corrupt/oversized stream is unrecoverable: fail everything in flight.
      this.failAll(error);
      void this.close();
      return;
    }
    for (const frame of frames) {
      this.dispatch(frame);
    }
  }

  private dispatch(frame: unknown): void {
    let reply;
    try {
      reply = parseReplyEnvelope(frame);
    } catch (error) {
      this.logger.error('dropping malformed reply', {
        code: error instanceof Error ? error.name : 'unknown',
      });
      return;
    }
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return; // unknown/aborted correlation id
    this.pending.delete(reply.id);
    if (reply.ok) {
      pending.resolve(reply.result);
    } else {
      // Preserve the bridge's machine-readable code so the client can tell an
      // availability failure (engine down / agent not reachable) apart from a
      // definitive REMOTE policy error. Collapsing everything to RemoteError
      // here would hide engine-down behind an opaque "connector error" block.
      pending.reject(connectorErrorFromWire(reply.error.code, reply.error.message));
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = undefined;
    this.failAll(new TransportError(`xpc-bridge exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
  }

  private failAll(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
