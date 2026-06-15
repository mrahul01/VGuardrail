/**
 * Interactive prompt module for user interactions.
 *
 * Handles displaying warnings, block messages, and
 * prompting users for acknowledgement.
 */

import type { Decision } from '@vguardrail/connector-sdk';

import inquirer from 'inquirer';

/**
 * ANSI color codes for terminal output.
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  bold: '\x1b[1m',
};

/**
 * Show the WARNING message block (no prompt).
 */
export function showWarningMessage(decision: Decision): void {
  process.stderr.write(`${COLORS.yellow}${COLORS.bold}[VGuardrail] WARNING: Policy violation detected${COLORS.reset}\n`);
  process.stderr.write(`${COLORS.yellow}${decision.reason}${COLORS.reset}\n\n`);

  if (decision.findings && decision.findings.length > 0) {
    process.stderr.write('Findings:\n');
    decision.findings.forEach((finding: { category?: string; kind: string; redactedPreview?: string }) => {
      const category = finding.category ? `[${finding.category}] ` : '';
      const preview = finding.redactedPreview ? `: ${finding.redactedPreview}` : '';
      process.stderr.write(`  ${COLORS.yellow}-${COLORS.reset} ${category}${finding.kind}${preview}\n`);
    });
    process.stderr.write('\n');
  }
}

/**
 * Show a warning message to the user and ask for acknowledgement.
 */
export function showWarningPrompt(decision: Decision): Promise<boolean> {
  showWarningMessage(decision);

  return new Promise<boolean>((resolve) => {
    inquirer
      .prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Do you want to acknowledge and proceed?',
          default: false,
        },
      ])
      .then((answer: { proceed: boolean }) => {
        if (answer.proceed) {
          // Record the acknowledgement
          process.stderr.write(`${COLORS.green}[VGuardrail] Proceeding with acknowledgement${COLORS.reset}\n\n`);
          resolve(true);
        } else {
          process.stderr.write(`${COLORS.red}[VGuardrail] Cancelled by user${COLORS.reset}\n\n`);
          resolve(false);
        }
      })
      .catch(() => {
        // If prompt fails, default to not proceeding
        resolve(false);
      });
  });
}

/**
 * Show a block message to the user.
 *
 * @param note - Optional extra line under the header (e.g. the no-override
 *   notice when a high-risk warning is escalated to a local block)
 */
export function showBlockMessage(decision: Decision, note?: string): void {
  process.stderr.write(`${COLORS.red}${COLORS.bold}[VGuardrail] BLOCKED: ${decision.reason}${COLORS.reset}\n`);
  if (note) {
    process.stderr.write(`${COLORS.red}${note}${COLORS.reset}\n`);
  }

  if (decision.findings && decision.findings.length > 0) {
    process.stderr.write('\nFindings:\n');
    decision.findings.forEach((finding: { category?: string; kind: string; redactedPreview?: string }) => {
      const category = finding.category ? `[${finding.category}] ` : '';
      const preview = finding.redactedPreview ? `: ${finding.redactedPreview}` : '';
      process.stderr.write(`  ${COLORS.red}-${COLORS.reset} ${category}${finding.kind}${preview}\n`);
    });
  }

  process.stderr.write('\n');
}

/**
 * Show an informational message.
 */
export function showInfoMessage(message: string): void {
  process.stderr.write(`${COLORS.green}[VGuardrail] ${message}${COLORS.reset}\n`);
}

/**
 * Show an error message.
 */
export function showErrorMessage(message: string): void {
  process.stderr.write(`${COLORS.red}[VGuardrail] Error: ${message}${COLORS.reset}\n`);
}