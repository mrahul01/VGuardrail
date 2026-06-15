// Chrome Native Messaging framing: a 4-byte length prefix in NATIVE byte order
// (little-endian on every platform Chrome supports), followed by that many bytes
// of UTF-8 JSON. This is deliberately DIFFERENT from the xpc-bridge's big-endian
// framing — the host speaks Chrome's dialect on stdio and the connector-sdk
// speaks the bridge's dialect downstream.
//
// Chrome caps a single message at 1 MiB; we enforce the same bound on both
// directions and reject anything larger rather than buffering unboundedly.

/** Chrome's single-message cap (1 MiB). */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

/** Thrown on an unrecoverable framing error (oversized / corrupt length). */
export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FramingError';
  }
}

/** Encodes a value as a length-prefixed (LE) Chrome native-messaging frame. */
export function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_MESSAGE_BYTES) {
    throw new FramingError(`outgoing message of ${body.length} bytes exceeds ${MAX_MESSAGE_BYTES}`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Incremental reader. Push stdin chunks; receive complete, JSON-parsed messages.
 * Holds at most one partial frame (< cap) plus the latest chunk, so memory is
 * bounded. Throws `FramingError` on an oversized advertised length (the stream
 * is then unframeable and the caller should stop).
 */
export class MessageDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) {
        throw new FramingError(`incoming message length ${length} exceeds ${MAX_MESSAGE_BYTES}`);
      }
      if (this.buffer.length < 4 + length) break; // await the rest
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      try {
        messages.push(JSON.parse(body.toString('utf8')));
      } catch {
        throw new FramingError('message body is not valid JSON');
      }
    }
    return messages;
  }

  /** Bytes currently buffered awaiting a complete frame. */
  get pending(): number {
    return this.buffer.length;
  }
}
