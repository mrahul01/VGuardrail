import { describe, expect, it } from 'vitest';
import { encodeMessage, MessageDecoder, MAX_MESSAGE_BYTES, FramingError } from '../src/framing.js';

describe('Chrome native-messaging framing', () => {
  it('encodes a 4-byte little-endian length prefix + JSON', () => {
    const frame = encodeMessage({ a: 1 });
    const body = JSON.stringify({ a: 1 });
    expect(frame.readUInt32LE(0)).toBe(Buffer.byteLength(body));
    expect(frame.subarray(4).toString('utf8')).toBe(body);
  });

  it('round-trips a single message', () => {
    const dec = new MessageDecoder();
    const out = dec.push(encodeMessage({ hello: 'world' }));
    expect(out).toEqual([{ hello: 'world' }]);
  });

  it('reassembles a message split across chunks', () => {
    const dec = new MessageDecoder();
    const frame = encodeMessage({ id: 'x', n: 7 });
    expect(dec.push(frame.subarray(0, 2))).toEqual([]);
    expect(dec.push(frame.subarray(2, 5))).toEqual([]);
    expect(dec.push(frame.subarray(5))).toEqual([{ id: 'x', n: 7 }]);
    expect(dec.pending).toBe(0);
  });

  it('decodes two messages delivered in one chunk', () => {
    const dec = new MessageDecoder();
    const chunk = Buffer.concat([encodeMessage({ a: 1 }), encodeMessage({ b: 2 })]);
    expect(dec.push(chunk)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('rejects an oversized incoming length', () => {
    const dec = new MessageDecoder();
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);
    expect(() => dec.push(header)).toThrow(FramingError);
  });

  it('rejects a non-JSON body', () => {
    const dec = new MessageDecoder();
    const body = Buffer.from('not json', 'utf8');
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(body.length, 0);
    expect(() => dec.push(Buffer.concat([header, body]))).toThrow(FramingError);
  });

  it('refuses to encode an oversized message', () => {
    expect(() => encodeMessage({ big: 'x'.repeat(MAX_MESSAGE_BYTES + 1) })).toThrow(FramingError);
  });
});
