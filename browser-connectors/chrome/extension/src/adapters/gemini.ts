// gemini.google.com — Quill editor (.ql-editor contenteditable) inside
// <rich-textarea>; send button via aria-label / class.

import type { SiteAdapter } from './types.js';
import { clickElement, isPlainEnter, queryFirst, readText } from './common.js';

const INPUT = ['rich-textarea div.ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"]'];
const SEND = ['button[aria-label*="Send" i]', 'button.send-button', 'button[mattooltip*="Send" i]'];

export const geminiAdapter: SiteAdapter = {
  id: 'gemini',
  provider: 'google',
  hostPatterns: ['gemini.google.com'],
  getInput: () => queryFirst(INPUT),
  getText: (input) => readText(input),
  isSubmitKey: (event) => isPlainEnter(event),
  findSendButton: () => queryFirst(SEND),
  submit: () => clickElement(queryFirst(SEND)),
};
