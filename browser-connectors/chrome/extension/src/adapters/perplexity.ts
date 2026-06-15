// perplexity.ai — textarea (Ask field) with a contenteditable fallback; submit
// button via aria-label.

import type { SiteAdapter } from './types.js';
import { clickElement, isPlainEnter, queryFirst, readText } from './common.js';

const INPUT = ['textarea[placeholder*="Ask" i]', 'main textarea', 'textarea', 'div[contenteditable="true"]'];
const SEND = ['button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]'];

export const perplexityAdapter: SiteAdapter = {
  id: 'perplexity',
  provider: 'perplexity',
  hostPatterns: ['perplexity.ai', 'www.perplexity.ai'],
  getInput: () => queryFirst(INPUT),
  getText: (input) => readText(input),
  isSubmitKey: (event) => isPlainEnter(event),
  findSendButton: () => queryFirst(SEND),
  submit: () => clickElement(queryFirst(SEND)),
};
