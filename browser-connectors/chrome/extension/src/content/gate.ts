// The site-agnostic gate. Intercepts the submit affordance at the capture phase
// (so the page's own React handlers never see it), runs the async scan, and acts
// on the decision. Enforcement is fail-closed and re-entrancy-safe.

import type { SiteAdapter } from '../adapters/types.js';
import {
  warnTier,
  SEND_ANYWAY_THRESHOLD,
  WARN_MEDIUM_FLOOR,
  type Decision,
} from '../shared/contract.js';
import type { ScanCaptureContext } from '../shared/messages.js';
import type { BlockContent, WarnContent, WarnNoticeContent } from './modal.js';

export interface GateDeps {
  adapter: SiteAdapter;
  /** Calls the SW → native host; the SW always returns a Decision (fail-closed). */
  scan(text: string, context: ScanCaptureContext): Promise<Decision>;
  /** Fire-and-forget audit of the user's WARN response. */
  ack(eventId: string, accepted: boolean): Promise<void>;
  /** Shows the WARN modal; resolves proceed/cancel. */
  warn(content: WarnContent): Promise<boolean>;
  /** Shows a transient low-risk WARN notice (no interaction). */
  warnNotice(content: WarnNoticeContent): void;
  /** Shows a transient BLOCK notice. */
  blockNotice(content: BlockContent): void;
  /** Injectable for tests. */
  doc?: Document;
  loc?: { host: string; href: string };
}

export class Gate {
  private readonly d: GateDeps;
  private readonly doc: Document;
  // One-shot token: true while we re-dispatch an approved submit so our own
  // listeners let it through instead of re-intercepting (no loop).
  private bypass = false;

  constructor(deps: GateDeps) {
    this.d = deps;
    this.doc = deps.doc ?? document;
  }

  install(): void {
    this.doc.addEventListener('keydown', this.onKeydown, true);
    this.doc.addEventListener('click', this.onClick, true);
  }

  uninstall(): void {
    this.doc.removeEventListener('keydown', this.onKeydown, true);
    this.doc.removeEventListener('click', this.onClick, true);
  }

  private readonly onKeydown = (event: Event): void => {
    if (this.bypass) return;
    const ke = event as KeyboardEvent;
    const input = this.d.adapter.getInput();
    if (!input || !this.d.adapter.isSubmitKey(ke, input)) return;
    this.intercept(event, input);
  };

  private readonly onClick = (event: Event): void => {
    if (this.bypass) return;
    const button = this.d.adapter.findSendButton();
    const target = event.target as Node | null;
    if (!button || !target || !(button === target || button.contains(target))) return;
    const input = this.d.adapter.getInput();
    if (!input) return;
    this.intercept(event, input);
  };

  /** Synchronously prevents the original action, then resolves the decision. */
  private intercept(event: Event, input: HTMLElement): void {
    const text = this.d.adapter.getText(input);
    if (!text.trim()) return; // nothing to scan — let the site handle empty input

    // Must be synchronous, before any await, to actually stop the page handler.
    event.preventDefault();
    event.stopImmediatePropagation();

    void this.decide(text, input);
  }

  private async decide(text: string, input: HTMLElement): Promise<void> {
    const context: ScanCaptureContext = {
      provider: this.d.adapter.provider,
      url: this.d.loc?.href ?? location.href,
      title: this.doc.title,
    };
    const model = this.d.adapter.model?.();
    if (model) context.model = model;

    let decision: Decision;
    try {
      decision = await this.d.scan(text, context);
    } catch {
      // The SW maps errors to BLOCK already; this is a last-resort fail-closed.
      this.d.blockNotice({ reason: 'agent unavailable; prompt blocked', categories: [] });
      return;
    }

    const categories = distinctCategories(decision);
    switch (decision.action) {
      case 'allow':
        this.replay(input);
        return;
      case 'block':
        this.d.blockNotice({ reason: decision.reason, categories });
        return;
      case 'warn': {
        // Send-Anyway policy (risk-score banded). When the engine provides a
        // numeric risk score, the "Send anyway" affordance is governed by it:
        //   score >  55     → hard block, no "Send anyway".
        //   20 < score ≤ 55 → "Send anyway" with a MEDIUM warning.
        //   score ≤ 20      → "Send anyway" with a LOW warning.
        if (typeof decision.riskScore === 'number') {
          if (decision.riskScore > SEND_ANYWAY_THRESHOLD) {
            this.d.blockNotice({
              title: 'Blocked by policy — high risk',
              reason: decision.reason,
              categories,
            });
            void this.d.ack(decision.requestId, false);
            return;
          }
          // Both remaining bands show the "Send anyway" button; only the
          // warning level differs (medium vs low).
          const level = decision.riskScore > WARN_MEDIUM_FLOOR ? 'medium' : 'low';
          const proceed = await this.d.warn({
            reason: decision.reason,
            riskLevel: level,
            categories,
          });
          void this.d.ack(decision.requestId, proceed);
          if (proceed) this.replay(input);
          return;
        }

        // Fallback (no numeric signal, e.g. the native transport): keep the
        // original risk-level tiers unchanged.
        switch (warnTier(decision.riskLevel)) {
          case 'block':
            // High/critical warns are escalated to a local hard block: the
            // server-side warn plus this client-side gate is defense in depth,
            // and offering no proceed affordance is a product requirement.
            this.d.blockNotice({
              title: 'Blocked by policy — high risk',
              reason: decision.reason,
              categories,
            });
            void this.d.ack(decision.requestId, false);
            return;
          case 'notice':
            this.d.warnNotice({ reason: decision.reason, categories });
            void this.d.ack(decision.requestId, true);
            this.replay(input);
            return;
          case 'prompt': {
            const proceed = await this.d.warn({
              reason: decision.reason,
              riskLevel: decision.riskLevel,
              categories,
            });
            void this.d.ack(decision.requestId, proceed);
            if (proceed) this.replay(input);
            return;
          }
        }
      }
    }
  }

  /** Re-dispatches the real submission with the bypass token set. */
  private replay(input: HTMLElement): void {
    this.bypass = true;
    try {
      this.d.adapter.submit(input);
    } finally {
      // Clear after the synchronous re-dispatch (and its capture-phase events).
      setTimeout(() => {
        this.bypass = false;
      }, 0);
    }
  }
}

function distinctCategories(decision: Decision): string[] {
  return [...new Set(decision.findings.map((f) => f.category))];
}
