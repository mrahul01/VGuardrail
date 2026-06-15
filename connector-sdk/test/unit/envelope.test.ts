import { describe, expect, it } from 'vitest';
import {
  FrameDecoder,
  encodeFrame,
  parseReplyEnvelope,
  MAX_FRAME_BYTES,
} from '../../src/protocol/envelope.js';
import { ValidationError } from '../../src/resilience/errors.js';

describe('frame codec', () => {
  it('encodes a 4-byte big-endian length prefix + JSON body', () => {
    const frame = encodeFrame({ a: 1 });
    const body = JSON.stringify({ a: 1 });
    expect(frame.readUInt32BE(0)).toBe(Buffer.byteLength(body));
    expect(frame.subarray(4).toString('utf8')).toBe(body);
  });

  it('decodes a single whole frame', () => {
    const dec = new FrameDecoder();
    expect(dec.push(encodeFrame({ hello: 'world' }))).toEqual([{ hello: 'world' }]);
  });

  it('reassembles a frame split across chunks', () => {
    const dec = new FrameDecoder();
    const frame = encodeFrame({ id: 'x', n: 42 });
    const a = frame.subarray(0, 3);
    const b = frame.subarray(3, 6);
    const c = frame.subarray(6);
    expect(dec.push(a)).toEqual([]);
    expect(dec.push(b)).toEqual([]);
    expect(dec.push(c)).toEqual([{ id: 'x', n: 42 }]);
    expect(dec.pending).toBe(0);
  });

  it('decodes two frames delivered in one chunk', () => {
    const dec = new FrameDecoder();
    const chunk = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 2 })]);
    expect(dec.push(chunk)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('holds a partial trailing frame until completed', () => {
    const dec = new FrameDecoder();
    const f1 = encodeFrame({ a: 1 });
    const f2 = encodeFrame({ b: 2 });
    const chunk = Buffer.concat([f1, f2.subarray(0, 2)]);
    expect(dec.push(chunk)).toEqual([{ a: 1 }]);
    expect(dec.pending).toBe(2);
    expect(dec.push(f2.subarray(2))).toEqual([{ b: 2 }]);
  });

  it('rejects a frame whose advertised length exceeds the cap', () => {
    const dec = new FrameDecoder();
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
    expect(() => dec.push(header)).toThrow(ValidationError);
  });

  it('rejects a frame body that is not valid JSON', () => {
    const dec = new FrameDecoder();
    const body = Buffer.from('not json', 'utf8');
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(body.length, 0);
    expect(() => dec.push(Buffer.concat([header, body]))).toThrow(ValidationError);
  });

  it('refuses to encode an oversized frame', () => {
    const huge = 'x'.repeat(MAX_FRAME_BYTES + 1);
    expect(() => encodeFrame({ huge })).toThrow(ValidationError);
  });
});

describe('parseReplyEnvelope', () => {
  it('accepts an ok reply', () => {
    expect(parseReplyEnvelope({ v: 1, id: 'a', ok: true, result: { x: 1 } })).toEqual({
      v: 1,
      id: 'a',
      ok: true,
      result: { x: 1 },
    });
  });

  it('accepts an error reply', () => {
    const reply = parseReplyEnvelope({ v: 1, id: 'a', ok: false, error: { code: 'E', message: 'm' } });
    expect(reply.ok).toBe(false);
  });

  it('rejects a malformed reply', () => {
    expect(() => parseReplyEnvelope({ v: 1, id: 'a' })).toThrow(ValidationError);
    expect(() => parseReplyEnvelope({ v: 1, id: 'a', ok: false })).toThrow(ValidationError);
  });
});
