// Minimal cross-browser accessor — deliberately not the webextension-polyfill.
// Chromium exposes the WebExtension API on `chrome`; Firefox and Safari expose
// it on `browser` (promise-first, which the async call sites here rely on).
// Resolution is lazy so this module can load under vitest/node, where neither
// global exists.

declare const browser: typeof chrome | undefined;

/** The `runtime` namespace of whichever WebExtension global this browser provides. */
export function webextRuntime(): typeof chrome.runtime {
  return (typeof browser !== 'undefined' ? browser : chrome).runtime;
}
