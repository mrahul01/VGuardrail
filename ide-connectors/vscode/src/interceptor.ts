// PromptInterceptor — turns an engine decision into a user-facing verdict.
//
// Deliberately free of any `vscode` import: the UI is injected via DecisionUi
// so the allow/warn/block/fail-closed flow is unit-testable against the SDK's
// MockTransport (extension.ts provides the real vscode implementation).

import { randomUUID } from 'node:crypto';
import {
  makeScanResponse,
  syntheticDecision,
  type Decision,
  type Finding,
  type ScanResponse,
} from '@vguardrail/connector-sdk';
import { findingCategories } from './categories';
import type { EditorPromptContext, ScanService } from './scan-service';

export const PROCEED_ACTION = 'Proceed';
export const CANCEL_ACTION = 'Cancel';
export const ENGINE_UNAVAILABLE_MESSAGE =
  'VGuardrail: policy engine unavailable — prompt blocked';

/** The notification surface the interceptor renders decisions through. */
export interface DecisionUi {
  /** Modal-ish warning with action buttons; resolves to the chosen action. */
  showWarning(message: string, ...actions: string[]): Promise<string | undefined>;
  /** Non-recoverable error notification (block / engine unavailable). */
  showError(message: string): void;
}

export interface InterceptOutcome {
  /** Whether the prompt may proceed to the AI provider. */
  allowed: boolean;
  response: ScanResponse;
}

/** Message shown for a WARN decision, including finding categories. */
export function warnMessage(decision: Decision): string {
  return withCategories(`VGuardrail warning: ${decision.reason}`, decision.findings);
}

/** Message shown for a BLOCK decision, including finding categories. */
export function blockMessage(decision: Decision): string {
  return withCategories(`VGuardrail blocked: ${decision.reason}`, decision.findings);
}

/** Message shown for a high/critical WARN escalated to a local block. */
export function highRiskBlockMessage(decision: Decision): string {
  return withCategories(`VGuardrail blocked (high risk): ${decision.reason}`, decision.findings);
}

/** How a WARN decision is enforced locally, derived from its risk level. */
export type WarnTier = 'block' | 'prompt' | 'notice';

/**
 * Maps a WARN decision's risk level to its local enforcement tier.
 * High/critical warns are escalated to a hard block with no proceed
 * affordance — the server-side warn plus this client-side gate is defense in
 * depth, and the no-override UX is a product requirement. Legacy decisions
 * without a risk level get the safe middle: the interactive prompt.
 */
export function warnTier(riskLevel: Decision['riskLevel'] | undefined): WarnTier {
  switch (riskLevel) {
    case 'critical':
    case 'high':
      return 'block';
    case 'low':
      return 'notice';
    default:
      return 'prompt';
  }
}

function withCategories(prefix: string, findings: readonly Finding[]): string {
  const categories = findingCategories(findings);
  return categories.length > 0 ? `${prefix} [${categories.join(', ')}]` : prefix;
}

export class PromptInterceptor {
  constructor(
    private readonly service: ScanService,
    private readonly ui: DecisionUi,
    private readonly onDecision?: (outcome: InterceptOutcome) => void,
  ) {}

  /**
   * Scans a prompt and renders the decision:
   *  - allow  → silently allowed
   *  - warn   → tiered by risk level (see warnTier): high/critical is a local
   *             block, medium/unknown is Proceed/Cancel, low is a passive
   *             notice; the outcome is acknowledged to the daemon
   *             (WarningAccepted/WarningRejected) on a best-effort basis
   *  - block  → error notification with reason + finding categories
   *  - engine unreachable → fail-closed block with an explicit message
   */
  async intercept(text: string, ctx: EditorPromptContext): Promise<InterceptOutcome> {
    let response: ScanResponse;
    try {
      response = await this.service.scan(text, ctx);
    } catch {
      // safeScan absorbs availability errors; this covers the remaining
      // (validation/version/remote) cases so an error never allows a prompt.
      const requestId = randomUUID();
      const decision = syntheticDecision({
        requestId,
        action: 'block',
        reason: 'connector error; fail-closed block',
      });
      response = makeScanResponse(decision, { requestId, elapsedMs: 0, fromFallback: true });
    }

    const outcome = await this.resolve(response);
    this.onDecision?.(outcome);
    return outcome;
  }

  private async resolve(response: ScanResponse): Promise<InterceptOutcome> {
    const { decision } = response;

    if (response.fromFallback) {
      this.ui.showError(ENGINE_UNAVAILABLE_MESSAGE);
      return { allowed: false, response };
    }

    switch (decision.action) {
      case 'allow':
        return { allowed: true, response };

      case 'warn':
        return this.resolveWarn(decision, response);

      case 'block':
        this.ui.showError(blockMessage(decision));
        return { allowed: false, response };
    }
  }

  private async resolveWarn(decision: Decision, response: ScanResponse): Promise<InterceptOutcome> {
    switch (warnTier(decision.riskLevel)) {
      case 'block': {
        this.ui.showError(highRiskBlockMessage(decision));
        await this.acknowledge(decision.requestId, false);
        return { allowed: false, response };
      }

      case 'notice': {
        // Non-blocking notice: no action buttons, and the prompt proceeds
        // without waiting for the notification to be dismissed.
        void this.ui.showWarning(warnMessage(decision));
        await this.acknowledge(decision.requestId, true);
        return { allowed: true, response };
      }

      case 'prompt': {
        const choice = await this.ui.showWarning(warnMessage(decision), PROCEED_ACTION, CANCEL_ACTION);
        const accepted = choice === PROCEED_ACTION;
        await this.acknowledge(decision.requestId, accepted);
        return { allowed: accepted, response };
      }
    }
  }

  private async acknowledge(requestId: string, accepted: boolean): Promise<void> {
    try {
      await this.service.acknowledgeWarning(requestId, accepted);
    } catch {
      // Ack is audit bookkeeping; a failure must not change enforcement.
    }
  }
}
