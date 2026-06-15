// The only per-site surface. Everything else (the gate, the modal, the SW
// bridge) is site-agnostic. Adding a site = one adapter + one registry entry +
// one manifest host + one fixture.

export interface SiteAdapter {
  /** Stable id, e.g. 'openai'. */
  id: string;
  /** Provider label put on ScanContext.provider. */
  provider: string;
  /** location.host values this adapter handles (exact or suffix match). */
  hostPatterns: string[];

  /** The prompt input element (textarea / contenteditable), or null if absent. */
  getInput(): HTMLElement | null;
  /** Extracts the prompt text from the input. */
  getText(input: HTMLElement): string;
  /** True if this keyboard event is a submit (Enter, not Shift/IME/modifier). */
  isSubmitKey(event: KeyboardEvent, input: HTMLElement): boolean;
  /** The send button, for click interception and programmatic re-submit. */
  findSendButton(): HTMLElement | null;
  /** Re-dispatches the real submission after approval. */
  submit(input: HTMLElement): void;
  /** Optional model id from the DOM. */
  model?(): string | undefined;
}
