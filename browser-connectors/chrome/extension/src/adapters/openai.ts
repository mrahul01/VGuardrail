// chatgpt.com — ProseMirror contenteditable (#prompt-textarea), legacy textarea
// fallback; send button via data-testid / aria-label.

import type { SiteAdapter } from './types.js';
import { clickElement, isPlainEnter, queryFirst, readText } from './common.js';

const INPUT = ['#prompt-textarea', 'div[contenteditable="true"]#prompt-textarea', 'textarea[data-id]', 'main textarea'];
const SEND = ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]'];

export const openaiAdapter: SiteAdapter = {
  id: 'openai',
  provider: 'openai',
  hostPatterns: ['chatgpt.com', 'chat.openai.com'],
  getInput: () => queryFirst(INPUT),
  getText: (input) => readText(input),
  isSubmitKey: (event) => isPlainEnter(event),
  findSendButton: () => queryFirst(SEND),
  submit: () => clickElement(queryFirst(SEND)),
};
