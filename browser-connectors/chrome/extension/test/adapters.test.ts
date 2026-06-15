import { afterEach, describe, expect, it } from 'vitest';
import { matchAdapter, PROVIDERS } from '../src/adapters/registry.js';
import { openaiAdapter } from '../src/adapters/openai.js';
import { anthropicAdapter } from '../src/adapters/anthropic.js';
import { geminiAdapter } from '../src/adapters/gemini.js';
import { perplexityAdapter } from '../src/adapters/perplexity.js';
import type { SiteAdapter } from '../src/adapters/types.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function enter(shift = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Enter', shiftKey: shift, cancelable: true });
}

describe('registry', () => {
  it('matches each target host to its adapter', () => {
    expect(matchAdapter('chatgpt.com')).toBe(openaiAdapter);
    expect(matchAdapter('claude.ai')).toBe(anthropicAdapter);
    expect(matchAdapter('gemini.google.com')).toBe(geminiAdapter);
    expect(matchAdapter('www.perplexity.ai')).toBe(perplexityAdapter);
    expect(matchAdapter('perplexity.ai')).toBe(perplexityAdapter);
  });

  it('returns null for unknown hosts', () => {
    expect(matchAdapter('example.com')).toBeNull();
    expect(matchAdapter('evil-chatgpt.com')).toBeNull();
  });
});

interface Fixture {
  adapter: SiteAdapter;
  html: string;
  expectText: string;
}

const fixtures: Fixture[] = [
  {
    adapter: openaiAdapter,
    html: `<div id="prompt-textarea" contenteditable="true">scan me openai</div><button data-testid="send-button">Send</button>`,
    expectText: 'scan me openai',
  },
  {
    adapter: anthropicAdapter,
    html: `<div class="ProseMirror" contenteditable="true">scan me claude</div><button aria-label="Send Message">x</button>`,
    expectText: 'scan me claude',
  },
  {
    adapter: geminiAdapter,
    html: `<rich-textarea><div class="ql-editor" contenteditable="true">scan me gemini</div></rich-textarea><button aria-label="Send">x</button>`,
    expectText: 'scan me gemini',
  },
  {
    adapter: perplexityAdapter,
    html: `<textarea placeholder="Ask anything">scan me pplx</textarea><button aria-label="Submit">x</button>`,
    expectText: 'scan me pplx',
  },
];

describe.each(fixtures)('adapter $adapter.id', ({ adapter, html, expectText }) => {
  it('resolves input, text, and send button; Enter detection', () => {
    document.body.innerHTML = html;
    const input = adapter.getInput();
    expect(input).not.toBeNull();
    expect(adapter.getText(input!)).toBe(expectText);
    expect(adapter.findSendButton()).not.toBeNull();
    expect(adapter.isSubmitKey(enter(false), input!)).toBe(true);
    expect(adapter.isSubmitKey(enter(true), input!)).toBe(false); // Shift+Enter = newline
  });

  it('submit() clicks the send button', () => {
    document.body.innerHTML = html;
    let clicked = false;
    adapter.findSendButton()!.addEventListener('click', () => {
      clicked = true;
    });
    adapter.submit(adapter.getInput()!);
    expect(clicked).toBe(true);
  });

  it('is registered exactly once', () => {
    expect(PROVIDERS.filter((p) => p.id === adapter.id)).toHaveLength(1);
  });
});
