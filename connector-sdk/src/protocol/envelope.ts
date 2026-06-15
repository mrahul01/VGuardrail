// Bridge wire envelopes + length-prefixed framing.
//
// Frame = 4-byte big-endian unsigned length, then that many bytes of UTF-8
// JSON. The length prefix lets the reader reassemble messages from arbitrary
// stdio chunk boundaries and bounds memory (oversized frames are rejected
// rather than buffered without limit). 

import { z } from 'zod';
import { ValidationError } from '../resilience/errors.js';

/** Current bridge protocol version. */
export const PROTOCOL_VERSION = 1;

/** Hard cap on a single frame (8 MiB) — guards against runaway buffers. */
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** A request from the SDK to the bridge. */
export interface RequestEnvelope {
  v: number;
  id: string;
  method: string;
  params: unknown;
}

/** A reply from the bridge to the SDK. */
export type ReplyEnvelope =
  | { v: number; id: string; ok: true; result: unknown }
  | { v: number; id: string; ok: false; error: { code: string; message: string } };

const ReplyEnvelopeSchema = z.union([
  z.object({ v: z.number(), id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    v: z.number(),
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

/** Encodes a value as a length-prefixed JSON frame. */
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_FRAME_BYTES) {
    throw new ValidationError(`frame of ${body.length} bytes exceeds ${MAX_FRAME_BYTES} cap`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Validates a parsed reply envelope, throwing `ValidationError` on mismatch. */
export function parseReplyEnvelope(raw: unknown): ReplyEnvelope {
  const result = ReplyEnvelopeSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError('malformed reply envelope', { cause: result.error });
  }
  return result.data as ReplyEnvelope;
}

/**
 * Incremental frame reader. Push raw chunks as they arrive; receive the list of
 * complete, JSON-parsed frame bodies decoded so far. Partial frames are held
 * until the rest arrives. Throws `ValidationError` if a frame advertises a
 * length over the cap (a corrupt or hostile stream).
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames: unknown[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > MAX_FRAME_BYTES) {
        throw new ValidationError(`incoming frame length ${length} exceeds ${MAX_FRAME_BYTES} cap`);
      }
      if (this.buffer.length < 4 + length) break; // wait for the rest
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      try {
        frames.push(JSON.parse(body.toString('utf8')));
      } catch (cause) {
        throw new ValidationError('frame body is not valid JSON', { cause });
      }
    }
    return frames;
  }

  /** Number of bytes currently buffered awaiting a complete frame. */
  get pending(): number {
    return this.buffer.length;
  }
}
