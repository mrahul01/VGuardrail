// The provider registry — the one place sites are enumerated. matchAdapter
// resolves the adapter for the current host (exact or subdomain-suffix match).

import type { SiteAdapter } from './types.js';
import { openaiAdapter } from './openai.js';
import { anthropicAdapter } from './anthropic.js';
import { geminiAdapter } from './gemini.js';
import { perplexityAdapter } from './perplexity.js';

export const PROVIDERS: SiteAdapter[] = [
  openaiAdapter,
  anthropicAdapter,
  geminiAdapter,
  perplexityAdapter,
];

/** Returns the adapter handling `host`, or null. */
export function matchAdapter(host: string): SiteAdapter | null {
  for (const adapter of PROVIDERS) {
    for (const pattern of adapter.hostPatterns) {
      if (host === pattern || host.endsWith(`.${pattern}`)) return adapter;
    }
  }
  return null;
}
