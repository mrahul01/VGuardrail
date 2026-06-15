// Shadow-buffer reconstruction of the line a user is typing into a raw-mode
// TUI. The PTY guard forwards keystrokes to the child immediately and only
// needs to know, at the moment Enter is pressed, what text the child's input
// box most likely contains.
//
// Handled: printable characters, backspace, Ctrl+U (kill line), Ctrl+W (kill
// word), bracketed paste (ESC[200~ … ESC[201~, captured verbatim). Any other
// escape sequence (arrow keys, etc.) can move the cursor in ways we cannot
// track, so it marks the buffer `dirty` — the reconstruction is then an
// approximation, still scanned best-effort.

const ESC = 0x1b;
const BS = 0x08;
const DEL = 0x7f;
const CTRL_U = 0x15;
const CTRL_W = 0x17;
const CR = 0x0d;
const LF = 0x0a;

const PASTE_START = '[200~';
const PASTE_END = '[201~';

/** A submitted line, produced when the user presses Enter. */
export interface SubmittedLine {
  /** The reconstructed text (without the terminating CR/LF). */
  text: string;
  /** True when untracked escape sequences made the buffer approximate. */
  dirty: boolean;
}

/**
 * Feed raw stdin chunks with `push()`; every Enter keypress yields one
 * `SubmittedLine`. The caller decides what to do with the raw bytes — this
 * class never forwards anything itself.
 */
export class LineReconstructor {
  private buffer = '';
  private dirty = false;
  private pasting = false;
  private pending = ''; // partial escape sequence split across chunks

  /** Processes a raw input chunk and returns any lines submitted within it. */
  push(chunk: Buffer | string): SubmittedLine[] {
    const text = this.pending + chunk.toString('binary');
    this.pending = '';
    const submitted: SubmittedLine[] = [];

    let i = 0;
    while (i < text.length) {
      // Bracketed paste content is captured verbatim until the end marker.
      if (this.pasting) {
        const end = text.indexOf(PASTE_END, i);
        if (end === -1) {
          this.buffer += text.slice(i);
          return submitted; // remainder of the paste arrives in a later chunk
        }
        this.buffer += text.slice(i, end);
        this.pasting = false;
        i = end + PASTE_END.length;
        continue;
      }

      const code = text.charCodeAt(i);

      if (code === ESC) {
        if (text.startsWith(PASTE_START, i)) {
          this.pasting = true;
          i += PASTE_START.length;
          continue;
        }
        const seqEnd = this.escapeSequenceEnd(text, i);
        if (seqEnd === -1) {
          // Sequence split across chunks — stash and wait for the rest.
          this.pending = text.slice(i);
          return submitted;
        }
        this.dirty = true; // untracked cursor movement / function key
        i = seqEnd;
        continue;
      }

      if (code === CR || code === LF) {
        submitted.push({ text: this.buffer, dirty: this.dirty });
        this.buffer = '';
        this.dirty = false;
        // Swallow a LF immediately following a CR (CRLF).
        if (code === CR && i + 1 < text.length && text.charCodeAt(i + 1) === LF) i += 1;
        i += 1;
        continue;
      }

      if (code === BS || code === DEL) {
        this.buffer = this.buffer.slice(0, -1);
        i += 1;
        continue;
      }
      if (code === CTRL_U) {
        this.buffer = '';
        this.dirty = false;
        i += 1;
        continue;
      }
      if (code === CTRL_W) {
        this.buffer = this.buffer.replace(/\S+\s*$/, '');
        i += 1;
        continue;
      }
      if (code < 0x20) {
        // Other control characters (Ctrl+C, Ctrl+A, tab, …): many move the
        // cursor or mutate state we cannot see.
        if (code === 0x03) {
          // Ctrl+C clears the input box in common REPLs.
          this.buffer = '';
          this.dirty = false;
        } else {
          this.dirty = true;
        }
        i += 1;
        continue;
      }

      this.buffer += text[i];
      i += 1;
    }
    return submitted;
  }

  /** Current (unsubmitted) buffer — exposed for diagnostics/tests. */
  current(): SubmittedLine {
    return { text: this.buffer, dirty: this.dirty };
  }

  /**
   * Returns the index just past a complete escape sequence starting at
   * `start`, or -1 when the sequence is incomplete (split across chunks).
   */
  private escapeSequenceEnd(text: string, start: number): number {
    if (start + 1 >= text.length) return -1;
    const second = text[start + 1];
    if (second === '[') {
      // CSI: ESC [ parameters… final-byte (0x40–0x7e)
      for (let j = start + 2; j < text.length; j += 1) {
        const c = text.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) return j + 1;
      }
      return -1;
    }
    if (second === 'O') {
      // SS3 (e.g. F1–F4): ESC O final
      return start + 2 < text.length ? start + 3 : -1;
    }
    // Two-byte sequence (ESC + one char), e.g. alt-keys.
    return start + 2;
  }
}
