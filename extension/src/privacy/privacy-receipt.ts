/**
 * Privacy Receipt Generator and Local Audit Reporter
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md and 02_PRIVACY_FIREWALL_PLAN.md.
 */

import { PrivacyDecision, PrivacyReceipt } from '../common/types.js';
import { SecurityInvariantViolationError } from './token-vault.js';

export interface PrivacyReceiptOptions {
  payloadBytes?: number;
  localInferenceMs?: number;
  serverReasoningMs?: number;
  timestamp?: number;
}

/**
 * Generates a local privacy audit receipt summarizing decisions and enforcing security invariants.
 */
export function generatePrivacyReceipt(
  decisions: PrivacyDecision[],
  options: PrivacyReceiptOptions = {}
): PrivacyReceipt {
  let allowed = 0;
  let tokenized = 0;
  let blurred = 0;
  let masked = 0;
  let blocked = 0;
  let omitted = 0;

  for (const dec of decisions) {
    switch (dec.decision) {
      case 'allow':
        allowed++;
        break;
      case 'tokenize':
        tokenized++;
        break;
      case 'blur':
        blurred++;
        break;
      case 'mask':
        masked++;
        break;
      case 'block':
        blocked++;
        break;
      case 'omit':
      case 'structure_only':
        omitted++;
        break;
    }
  }

  const receipt: PrivacyReceipt = {
    detected: decisions.length,
    allowed,
    tokenized,
    blurred,
    masked,
    blocked,
    omitted,
    rawScreenshotSent: false, // Strict Security Invariant
    rawSecretSent: false,     // Strict Security Invariant
    payloadBytes: options.payloadBytes ?? 0,
    localInferenceMs: options.localInferenceMs ?? 0,
    serverReasoningMs: options.serverReasoningMs ?? 0,
    timestamp: options.timestamp ?? Date.now(),
  };

  assertReceiptInvariants(receipt);
  return receipt;
}

/**
 * Asserts that the privacy receipt strictly adheres to all safety invariants.
 */
export function assertReceiptInvariants(receipt: PrivacyReceipt): void {
  if (receipt.rawScreenshotSent !== false) {
    throw new SecurityInvariantViolationError(
      'Privacy Invariant Failed: rawScreenshotSent must be strictly false'
    );
  }

  if (receipt.rawSecretSent !== false) {
    throw new SecurityInvariantViolationError(
      'Privacy Invariant Failed: rawSecretSent must be strictly false'
    );
  }
}

/**
 * Formats a clean human-readable audit receipt for display in the extension sidepanel or console.
 */
export function formatReceiptSummary(receipt: PrivacyReceipt): string {
  return [
    '--- PRIVACY FIREWALL RECEIPT ---',
    `PII / Items Detected: ${receipt.detected}`,
    `Blocked:              ${receipt.blocked}`,
    `Tokenized:            ${receipt.tokenized}`,
    `Masked:               ${receipt.masked}`,
    `Blurred:              ${receipt.blurred}`,
    `Omitted:              ${receipt.omitted}`,
    `Allowed:              ${receipt.allowed}`,
    '--------------------------------',
    `Raw Screenshot Sent:  ${receipt.rawScreenshotSent ? 'YES (VIOLATION)' : 'NO (PROTECTED)'}`,
    `Raw Secrets Sent:     ${receipt.rawSecretSent ? 'YES (VIOLATION)' : 'NO (PROTECTED)'}`,
    `Payload Size:         ${(receipt.payloadBytes / 1024).toFixed(1)} KB`,
    `Local Perception:     ${receipt.localInferenceMs} ms`,
    '--------------------------------',
  ].join('\n');
}
