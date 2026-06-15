// Shared DOM helpers for adapters. Selectors are intentionally layered (most
// specific first, generic fallback last) so a site tweak degrades rather than
// breaks. These are the fragile bits of the connector and are covered by
// per-site fixtures.

/** Returns the first element matching any selector, in order. */
export function queryFirst(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

/** Reads text from a textarea or contenteditable, normalizing NBSP. */
export function readText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return input.value;
  }
  return (input.textContent ?? '').replace(/ /g, ' ').trim();
}

/** True for a plain Enter (submit) — not Shift+Enter (newline), IME, or modifiers. */
export function isPlainEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.isComposing
  );
}

/** Dispatches a trusted-looking click for programmatic re-submit. */
export function clickElement(el: HTMLElement | null): void {
  if (!el) return;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}
