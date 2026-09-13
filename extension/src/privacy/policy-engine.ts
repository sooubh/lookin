/**
 * Adaptive Privacy Policy Engine
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Prompt A7).
 *
 * Primary Decision Actions:
 * - allow: element/value is safe and required
 * - omit: element/value is unnecessary and dropped
 * - mask: sensitive value replaced with partial/pattern mask
 * - tokenize: personal/sensitive value replaced with local client token ([EMAIL_1])
 * - blur: visual regions (faces) obscured
 * - structure_only: retain DOM/accessibility structure but omit text
 * - block: strictly prohibited (Hard invariant for Tier 3 secrets)
 */

import { DetectedEntity, PrivacyDecision, TaskRequirement } from '../common/types.js';
import {
  SensitivityTier,
  SENSITIVITY_TIERS,
  isSecret,
} from './categories.js';
import { computeRiskScore } from './risk-engine.js';
import { isCategoryForbidden, isCategoryRequiredForTask } from './task-context.js';
import { TokenVault } from './token-vault.js';

/**
 * Evaluates policy for a single detected entity within a given task context.
 */
export function evaluatePolicy(
  entity: DetectedEntity,
  requirement: TaskRequirement,
  tokenVault?: TokenVault
): PrivacyDecision {
  const risk = computeRiskScore(entity.tier, entity.confidence, 1.0);

  // 1. HARD INVARIANT: Tier 3 Secrets are ALWAYS blocked
  if (isSecret(entity.tier) || isSecret(entity.category)) {
    return {
      category: entity.category,
      tier: SENSITIVITY_TIERS.SECRET,
      risk: Math.max(0.9, risk),
      confidence: entity.confidence,
      task_required: false,
      decision: 'block',
      replacement: '[BLOCKED_SECRET]',
      reason: 'Tier 3 secret: transmission strictly prohibited by policy',
    };
  }

  // 2. Visual Face Regions
  if (entity.category === 'face') {
    return {
      category: entity.category,
      tier: entity.tier,
      risk,
      confidence: entity.confidence,
      task_required: false,
      decision: 'blur',
      replacement: '[BLURRED_FACE]',
      reason: 'Visual face region blurred to preserve individual identity',
    };
  }

  // 3. Check if forbidden by task requirement
  if (isCategoryForbidden(entity.category, requirement)) {
    return {
      category: entity.category,
      tier: entity.tier,
      risk,
      confidence: entity.confidence,
      task_required: false,
      decision: 'omit',
      replacement: '',
      reason: `Category '${entity.category}' forbidden by task context requirements`,
    };
  }

  // Check if category or element is needed by the task
  const taskRequired = isCategoryRequiredForTask(entity.category, requirement, entity.text);

  // 4. Tier 2: Sensitive Data (Financial, IDs, Private Documents)
  if (entity.tier === SENSITIVITY_TIERS.SENSITIVE) {
    if (taskRequired) {
      // If task requires it, tokenize or mask. Never send raw.
      let token: string | undefined;
      let replacement = '[REDACTED_SENSITIVE]';

      if (tokenVault && entity.text) {
        token = tokenVault.tokenize(entity.category, entity.text);
        replacement = token;
      } else if (entity.category === 'credit_card' && entity.text) {
        // Mask credit card (keep last 4 digits)
        const clean = entity.text.replace(/\D/g, '');
        replacement = `**** **** **** ${clean.slice(-4)}`;
      }

      return {
        category: entity.category,
        tier: entity.tier,
        risk,
        confidence: entity.confidence,
        task_required: true,
        decision: token ? 'tokenize' : 'mask',
        token,
        replacement,
        reason: 'Task-required sensitive data sanitized into safe representation',
      };
    }

    // Unnecessary sensitive data is omitted
    return {
      category: entity.category,
      tier: entity.tier,
      risk,
      confidence: entity.confidence,
      task_required: false,
      decision: 'omit',
      replacement: '',
      reason: 'Sensitive data omitted as unnecessary for current task',
    };
  }

  // 5. Tier 1: Personal Data (Name, Email, Phone, Address, IP)
  if (entity.tier === SENSITIVITY_TIERS.PERSONAL) {
    if (taskRequired) {
      let token: string | undefined;
      let replacement = '[REDACTED_PERSONAL]';

      if (tokenVault && entity.text) {
        token = tokenVault.tokenize(entity.category, entity.text);
        replacement = token;
      }

      return {
        category: entity.category,
        tier: entity.tier,
        risk,
        confidence: entity.confidence,
        task_required: true,
        decision: 'tokenize',
        token,
        replacement,
        reason: 'Task-required personal data tokenized with client-side token',
      };
    }

    // Unnecessary personal data is omitted
    return {
      category: entity.category,
      tier: entity.tier,
      risk,
      confidence: entity.confidence,
      task_required: false,
      decision: 'omit',
      replacement: '',
      reason: 'Personal data omitted as unnecessary for current task',
    };
  }

  // 6. Tier 0: Public Data
  if (taskRequired) {
    return {
      category: entity.category,
      tier: SENSITIVITY_TIERS.PUBLIC,
      risk: 0.0,
      confidence: entity.confidence,
      task_required: true,
      decision: 'allow',
      replacement: entity.text,
      reason: 'Public data allowed for task execution',
    };
  }

  return {
    category: entity.category,
    tier: SENSITIVITY_TIERS.PUBLIC,
    risk: 0.0,
    confidence: entity.confidence,
    task_required: false,
    decision: 'structure_only',
    replacement: '',
    reason: 'Public element structure preserved without detailed content',
  };
}

/**
 * Batch evaluates policy for a list of detected entities.
 */
export function evaluateBatchPolicy(
  entities: DetectedEntity[],
  requirement: TaskRequirement,
  tokenVault?: TokenVault
): PrivacyDecision[] {
  return entities.map((entity) => evaluatePolicy(entity, requirement, tokenVault));
}
