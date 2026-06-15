// claude.ai — ProseMirror contenteditable; send button via aria-label.

import type { SiteAdapter } from './types.js';
import { clickElement, isPlainEnter, queryFirst, readText } from './common.js';

const INPUT = ['div[contenteditable="true"].ProseMirror', 'div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'];
const SEND = ['button[aria-label="Send Message"]', 'button[aria-label*="Send" i]'];

export const anthropicAdapter: SiteAdapter = {
  id: 'anthropic',
  provider: 'anthropic',
  hostPatterns: ['claude.ai'],
  getInput: () => queryFirst(INPUT),
  getText: (input) => readText(input),
  isSubmitKey: (event) => isPlainEnter(event),
  findSendButton: () => queryFirst(SEND),
  submit: () => clickElement(queryFirst(SEND)),
};
