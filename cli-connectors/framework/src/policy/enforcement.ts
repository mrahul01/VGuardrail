/**
 * Decision enforcement module.
 *
 * Handles the enforcement of policy decisions (Allow/Warn/Block)
 * and user interaction for warning acknowledgements.
 */

import type { Decision } from '@vguardrail/connector-sdk';
import { showWarningPrompt, showWarningMessage, showBlockMessage } from './prompt.js';

/**
 * Result of enforcing a policy decision.
 */
export interface EnforcementResult {
  /** The original decision from the policy engine */
  decision: Decision;
  /** Whether execution should proceed */
  shouldProceed: boolean;
  /** Whether user acknowledged a warning */
  warningAcknowledged?: boolean;
}

/**
 * Enforce a policy decision.
 *
 * - ALLOW: Proceed immediately
 * - WARN: Enforce by risk tier (see warnTier): local block, prompt, or notice
 * - BLOCK: Display error and prevent execution
 *
 * @param decision - The policy decision to enforce
 * @returns Whether execution should proceed
 */
export async function enforceDecision(decision: Decision): Promise<EnforcementResult> {
  switch (decision.action) {
    case 'allow':
      return {
        decision,
        shouldProceed: true,
      };

    case 'warn':
      return await handleWarning(decision);

    case 'block':
      showBlockMessage(decision);
      return {
        decision,
        shouldProceed: false,
      };

    default:
      // Unknown action - treat as block for safety
      process.stderr.write(`[VGuardrail] Unknown decision action: ${decision.action}\n`);
      return {
        decision,
        shouldProceed: false,
      };
  }
}

/**
 * How a WARN decision is enforced locally, derived from its risk level.
 */
export type WarnTier = 'block' | 'prompt' | 'notice';

/**
 * Map a WARN decision's risk level to its local enforcement tier.
 *
 * High/critical warns are escalated to a hard block with no override — the
 * server-side warn plus this client-side gate is defense in depth, and the
 * no-override UX is a product requirement. Legacy decisions without a risk
 * level get the safe middle: the interactive prompt.
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

/**
 * Handle a WARN decision according to its risk tier:
 *
 * - high/critical: escalate to a local block (no prompt, no override)
 * - medium/unknown: prompt the user for acknowledgement
 * - low: print the warning and proceed with an automatic acknowledgement
 */
export async function handleWarning(decision: Decision): Promise<EnforcementResult> {
  switch (warnTier(decision.riskLevel)) {
    case 'block':
      showBlockMessage(decision, 'high risk — blocked, no override');
      return {
        decision,
        shouldProceed: false,
        warningAcknowledged: false,
      };

    case 'notice':
      showWarningMessage(decision);
      return {
        decision,
        shouldProceed: true,
        warningAcknowledged: true,
      };

    case 'prompt': {
      // showWarningPrompt prints the yellow warning itself; a red BLOCKED
      // header here would contradict the proceed/cancel question that follows.
      const acknowledged = await showWarningPrompt(decision);

      return {
        decision,
        shouldProceed: acknowledged,
        warningAcknowledged: acknowledged,
      };
    }
  }
}

/**
 * Format a decision for display.
 */
export function formatDecisionMessage(decision: Decision): string {
  const action = decision.action.toUpperCase();
  let message = `[VGuardrail] ${action}: ${decision.reason}`;

  if (decision.findings && decision.findings.length > 0) {
    message += '\n\nFindings:';
    decision.findings.forEach((finding) => {
      message += `\n  - [${finding.category}] ${finding.kind}`;
      if (finding.redactedPreview) {
        message += `: ${finding.redactedPreview}`;
      }
    });
  }

  return message;
}