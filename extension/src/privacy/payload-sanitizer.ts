/**
 * Pre-Fetch Payload Leak Scanner and Sanitizer Guard
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Prompt A10).
 *
 * Enforces Fail-Closed behavior before ANY network transmission.
 */

import { DETERMINISTIC_RULES } from './rules.js';
import { SENSITIVITY_TIERS } from './categories.js';
import { TokenVault, SecurityInvariantViolationError } from './token-vault.js';

export interface LeakScanResult {
  safe: boolean;
  violations: string[];
}

/**
 * Performs a deep pre-fetch leak scan over a payload before it leaves the browser.
 */
export function scanPayload(
  payload: unknown,
  tokenVault?: TokenVault
): LeakScanResult {
  const violations: string[] = [];

  if (payload === undefined || payload === null) {
    return { safe: true, violations: [] };
  }

  let serialized: string;
  try {
    serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  } catch (err) {
    return {
      safe: false,
      violations: [`Failed to serialize payload for leak scan: ${String(err)}`],
    };
  }

  // 1. Scan for Tier 3 Secrets (Passwords, OTPs, API keys, JWTs, PEM keys)
  const tier3Rules = DETERMINISTIC_RULES.filter(
    (rule) => rule.tier === SENSITIVITY_TIERS.SECRET
  );

  for (const rule of tier3Rules) {
    const flags = rule.pattern.flags.includes('g')
      ? rule.pattern.flags
      : rule.pattern.flags + 'g';
    const regex = new RegExp(rule.pattern.source, flags);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(serialized)) !== null) {
      // If validator is defined, verify match
      if (rule.validator && !rule.validator(match[0], serialized)) {
        continue;
      }

      violations.push(
        `Critical Secret Leak: Detected Tier 3 pattern '${rule.id}' in payload (${rule.description}).`
      );
      break; // One violation per rule category is sufficient
    }
  }

  // 2. Scan for raw token vault values leaking into the payload
  if (tokenVault) {
    const rawValues = tokenVault.getRawValues();
    for (const rawVal of rawValues) {
      if (!rawVal || rawVal.length < 3) continue;

      // Check if raw value exists in serialized string (using word boundary or JSON quoted string)
      if (serialized.includes(rawVal)) {
        violations.push(
          `Token Vault Leak: Raw personal value '${rawVal.substring(0, 3)}...' was detected in outbound payload instead of its safe token placeholder.`
        );
      }
    }
  }

  // 3. Scan for token-vault mapping structures
  // Server must NEVER receive a map of token -> raw value
  if (
    /"\[[A-Z0-9_]+_\d+\]"\s*:\s*"[^"]+"/i.test(serialized) ||
    /tokenMappings?/i.test(serialized) ||
    /vaultMappings?/i.test(serialized)
  ) {
    violations.push(
      'Security Invariant Violation: Outbound payload appears to contain raw token-to-value mapping structures.'
    );
  }

  // 4. Verify Privacy Receipt and Raw Screenshot Invariants
  if (typeof payload === 'object' && payload !== null) {
    const p = payload as Record<string, any>;
    if (p.privacyReceipt) {
      if (p.privacyReceipt.rawScreenshotSent !== false) {
        violations.push(
          'Security Invariant Violation: privacyReceipt.rawScreenshotSent must strictly be false.'
        );
      }
      if (p.privacyReceipt.rawSecretSent !== false) {
        violations.push(
          'Security Invariant Violation: privacyReceipt.rawSecretSent must strictly be false.'
        );
      }
    }

    // Check for raw screenshot attribute or indicator
    if (p.rawScreenshot || p.originalScreenshot) {
      violations.push(
        'Security Invariant Violation: Raw unredacted screenshot attached to outbound payload.'
      );
    }
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Hard guard function. Aborts and throws SecurityInvariantViolationError
 * if any leak is detected.
 */
export function assertSafeToTransmit(
  payload: unknown,
  tokenVault?: TokenVault
): void {
  const result = scanPayload(payload, tokenVault);
  if (!result.safe) {
    throw new SecurityInvariantViolationError(
      `Transmission ABORTED due to privacy leak violations:\n${result.violations.map((v) => ` - ${v}`).join('\n')}`
    );
  }
}
