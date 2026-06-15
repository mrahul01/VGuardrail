/**
 * Unit tests for the PTY shadow-buffer line reconstructor.
 *
 * Tests cover:
 * - plain typing + Enter submission
 * - backspace / DEL, Ctrl+U (kill line), Ctrl+W (kill word), Ctrl+C
 * - bracketed paste captured verbatim (incl. split across chunks)
 * - untracked escape sequences mark the line dirty (still surfaced)
 * - escape sequences split across chunks are reassembled
 * - CRLF submits once
 */

import { describe, it, expect } from 'vitest';
import { LineReconstructor } from '../../src/process/line-reconstructor.js';

function feed(chunks: string[]): ReturnType<LineReconstructor['push']> {
  const r = new LineReconstructor();
  return chunks.flatMap((c) => r.push(c));
}

describe('LineReconstructor', () => {
  it('reconstructs a plainly typed line on Enter', () => {
    const out = feed(['hello world\r']);
    expect(out).toEqual([{ text: 'hello world', dirty: false }]);
  });

  it('handles backspace and DEL', () => {
    expect(feed(['abcX\x7f\r'])).toEqual([{ text: 'abc', dirty: false }]);
    expect(feed(['abcX\x08\r'])).toEqual([{ text: 'abc', dirty: false }]);
  });

  it('Ctrl+U clears the line, Ctrl+W kills the last word', () => {
    expect(feed(['secret stuff\x15clean\r'])).toEqual([{ text: 'clean', dirty: false }]);
    expect(feed(['foo bar baz\x17\r'])).toEqual([{ text: 'foo bar ', dirty: false }]);
  });

  it('Ctrl+C clears the input box', () => {
    expect(feed(['oops\x03\r'])).toEqual([{ text: '', dirty: false }]);
  });

  it('captures bracketed-paste content verbatim', () => {
    const out = feed(['\x1b[200~AKIAIOSFODNN7EXAMPLE\x1b[201~\r']);
    expect(out).toEqual([{ text: 'AKIAIOSFODNN7EXAMPLE', dirty: false }]);
  });

  it('reassembles a paste split across chunks', () => {
    const r = new LineReconstructor();
    expect(r.push('\x1b[200~part-one ')).toEqual([]);
    expect(r.push('part-two\x1b[201~\r')).toEqual([{ text: 'part-one part-two', dirty: false }]);
  });

  it('marks the line dirty on an untracked arrow-key sequence', () => {
    const out = feed(['ab\x1b[Dc\r']); // left-arrow between b and c
    expect(out).toHaveLength(1);
    expect(out[0]?.dirty).toBe(true);
  });

  it('reassembles an escape sequence split across chunks', () => {
    const r = new LineReconstructor();
    expect(r.push('ab\x1b')).toEqual([]); // ESC alone — incomplete
    const out = r.push('[Dc\r');
    expect(out).toHaveLength(1);
    expect(out[0]?.dirty).toBe(true);
  });

  it('submits once on CRLF', () => {
    expect(feed(['line\r\n'])).toEqual([{ text: 'line', dirty: false }]);
  });

  it('handles multiple lines in one chunk', () => {
    expect(feed(['one\rtwo\r'])).toEqual([
      { text: 'one', dirty: false },
      { text: 'two', dirty: false },
    ]);
  });
});
