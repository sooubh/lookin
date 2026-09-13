/**
 * Local Action Guard for Privacy-Preserving Browser Vision Agent
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 03_BROWSER_AGENT_AND_AI_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Phase A13).
 *
 * Core Principle: Cloud AI is the reasoning engine. The browser is the privacy
 * boundary and final execution authority. Every action returned by the model
 * must pass local validation, target existence verification, viewport bounds checking,
 * staleness checks, and the risk policy gate.
 */

import { PagePerception, PerceptionElement, RiskLevel } from '../common/types.js';
import {
  validateActionSchema,
  ValidatedAction,
  ValidatedActionTarget,
} from './action-schema.js';

export interface ActionGuardOptions {
  userConfirmed?: boolean;
  currentUrl?: string;
  maxStaleAgeMs?: number; // Default: 30,000ms
}

export interface ActionGuardResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  risk: RiskLevel;
  action: ValidatedAction;
  matchedElement?: PerceptionElement;
  reason: string;
  error?: string;
}

/**
 * Keywords and patterns identifying high-risk actions that require explicit user confirmation.
 */
const HIGH_RISK_PATTERNS = [
  /\b(purchase|buy|pay|payment|checkout|transfer|wire|send\s+money|withdraw|donate|place\s+order)\b/i,
  /\b(delete|destroy|remove\s+account|cancel\s+subscription|terminate|wipe|format|erase)\b/i,
  /\b(bank|credit\s*card|crypto|wallet|debit)\b/i,
  /\b(irreversible|critical|destructive)\b/i,
];

/**
 * Keywords identifying medium-risk actions (e.g. form submissions, updates).
 */
const MEDIUM_RISK_PATTERNS = [
  /\b(submit|sign\s*in|log\s*in|register|sign\s*up|send|post|save|apply|update|confirm)\b/i,
];

export class ActionGuard {
  private defaultMaxStaleAgeMs: number;

  constructor(options?: { maxStaleAgeMs?: number }) {
    this.defaultMaxStaleAgeMs = options?.maxStaleAgeMs ?? 30000;
  }

  /**
   * Validates a proposed action against all safety rules, page perception, and risk policies.
   */
  public validateAction(
    rawAction: unknown,
    perception: PagePerception,
    options: ActionGuardOptions = {}
  ): ActionGuardResult {
    // 1. Validate against action schema & code injection
    const schemaResult = validateActionSchema(rawAction);
    if (!schemaResult.valid || !schemaResult.action) {
      const fallbackAction: ValidatedAction = {
        type: 'wait',
        risk: 'high',
        reason: schemaResult.error || 'Schema validation failed',
      };
      return {
        allowed: false,
        requiresConfirmation: false,
        risk: 'high',
        action: fallbackAction,
        reason: schemaResult.error || 'Invalid action schema',
        error: schemaResult.error,
      };
    }

    const action = schemaResult.action;

    // 2. Validate perception freshness (Staleness Check)
    const maxStaleAge = options.maxStaleAgeMs ?? this.defaultMaxStaleAgeMs;
    const now = Date.now();
    if (perception.timestamp && now - perception.timestamp > maxStaleAge) {
      const ageSec = Math.round((now - perception.timestamp) / 1000);
      return {
        allowed: false,
        requiresConfirmation: false,
        risk: action.risk,
        action,
        reason: `Page state is stale (${ageSec}s old, max allowed: ${Math.round(maxStaleAge / 1000)}s). Re-perception required.`,
        error: 'STALE_PERCEPTION',
      };
    }

    // 3. Verify URL alignment if current URL provided
    if (options.currentUrl && perception.url) {
      try {
        const currentUrlObj = new URL(options.currentUrl);
        const perceptionUrlObj = new URL(perception.url);
        if (
          currentUrlObj.origin !== perceptionUrlObj.origin ||
          currentUrlObj.pathname !== perceptionUrlObj.pathname
        ) {
          return {
            allowed: false,
            requiresConfirmation: false,
            risk: action.risk,
            action,
            reason: `Perception URL (${perception.url}) does not match current tab (${options.currentUrl}).`,
            error: 'URL_MISMATCH',
          };
        }
      } catch {
        // Fallback to strict string equality
        if (options.currentUrl !== perception.url) {
          return {
            allowed: false,
            requiresConfirmation: false,
            risk: action.risk,
            action,
            reason: `Perception URL does not match current tab.`,
            error: 'URL_MISMATCH',
          };
        }
      }
    }

    // 4. Viewport coordinate boundary checks
    const viewport = perception.viewport || { width: 1920, height: 1080 };
    if (action.target?.coordinates) {
      const { x, y } = action.target.coordinates;
      if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) {
        return {
          allowed: false,
          requiresConfirmation: false,
          risk: action.risk,
          action,
          reason: `Coordinates (${x}, ${y}) are outside viewport bounds (${viewport.width}x${viewport.height}).`,
          error: 'OUT_OF_BOUNDS_COORDINATES',
        };
      }
    }

    if (action.target?.bbox) {
      const [bx, by, bw, bh] = action.target.bbox;
      if (
        bx < 0 ||
        by < 0 ||
        bx > viewport.width ||
        by > viewport.height ||
        bx + bw > viewport.width + 50 ||
        by + bh > perception.viewport.height + 50
      ) {
        return {
          allowed: false,
          requiresConfirmation: false,
          risk: action.risk,
          action,
          reason: `Target bbox [${bx}, ${by}, ${bw}, ${bh}] extends outside viewport bounds (${viewport.width}x${viewport.height}).`,
          error: 'OUT_OF_BOUNDS_BBOX',
        };
      }
    }

    // 5. Target existence and property verification in local page perception
    let matchedElement: PerceptionElement | undefined;
    if (this.actionRequiresTarget(action.type)) {
      const target = action.target;
      if (!target && !action.target?.coordinates) {
        return {
          allowed: false,
          requiresConfirmation: false,
          risk: action.risk,
          action,
          reason: `Action "${action.type}" requires a target element.`,
          error: 'MISSING_TARGET',
        };
      }

      if (target) {
        matchedElement = this.resolveTargetInPerception(target, perception.elements);
        if (!matchedElement) {
          const targetDesc = target.id || target.text || target.role || target.selector || 'unspecified';
          return {
            allowed: false,
            requiresConfirmation: false,
            risk: action.risk,
            action,
            reason: `Target element "${targetDesc}" not found in current local page perception.`,
            error: 'TARGET_NOT_FOUND',
          };
        }

        // Verify element is visible
        if (matchedElement.visible === false) {
          return {
            allowed: false,
            requiresConfirmation: false,
            risk: action.risk,
            action,
            matchedElement,
            reason: `Target element "${matchedElement.id}" is not visible in the DOM.`,
            error: 'ELEMENT_NOT_VISIBLE',
          };
        }

        // Verify element is enabled for interactive actions
        if (['click', 'type', 'select'].includes(action.type) && matchedElement.enabled === false) {
          return {
            allowed: false,
            requiresConfirmation: false,
            risk: action.risk,
            action,
            matchedElement,
            reason: `Target element "${matchedElement.id}" is disabled.`,
            error: 'ELEMENT_DISABLED',
          };
        }

        // Verify role alignment
        if (target.role && matchedElement.role) {
          const expectedRole = target.role.toLowerCase().trim();
          const actualRole = matchedElement.role.toLowerCase().trim();
          if (expectedRole !== actualRole && !this.isRoleCompatible(expectedRole, actualRole)) {
            return {
              allowed: false,
              requiresConfirmation: false,
              risk: action.risk,
              action,
              matchedElement,
              reason: `Role mismatch for target: expected "${target.role}", but found "${matchedElement.role}".`,
              error: 'ROLE_MISMATCH',
            };
          }
        }

        // Verify text/label alignment if specified
        if (target.text && matchedElement.text) {
          const expectedText = target.text.toLowerCase().trim();
          const actualText = matchedElement.text.toLowerCase().trim();
          if (
            !actualText.includes(expectedText) &&
            !expectedText.includes(actualText) &&
            actualText !== expectedText
          ) {
            return {
              allowed: false,
              requiresConfirmation: false,
              risk: action.risk,
              action,
              matchedElement,
              reason: `Label mismatch for target: expected "${target.text}", but found "${matchedElement.text}".`,
              error: 'LABEL_MISMATCH',
            };
          }
        }

        // Verify bbox consistency if both provided
        if (target.bbox && matchedElement.bbox) {
          if (!this.isBboxConsistent(target.bbox, matchedElement.bbox)) {
            return {
              allowed: false,
              requiresConfirmation: false,
              risk: action.risk,
              action,
              matchedElement,
              reason: `BBox mismatch: proposed coordinates [${target.bbox.join(', ')}] deviate excessively from perception [${matchedElement.bbox.join(', ')}].`,
              error: 'BBOX_MISMATCH',
            };
          }
        }
      }
    }

    // 6. Check Risk Policy
    const assessedRisk = this.evaluateRiskTier(action, matchedElement);
    action.risk = assessedRisk;

    if (assessedRisk === 'high') {
      if (options.userConfirmed === true) {
        return {
          allowed: true,
          requiresConfirmation: false,
          risk: 'high',
          action,
          matchedElement,
          reason: 'High-risk action authorized via explicit user confirmation.',
        };
      }
      return {
        allowed: false,
        requiresConfirmation: true,
        risk: 'high',
        action,
        matchedElement,
        reason: `High-risk action (${action.type} on "${matchedElement?.text || action.target?.text || 'target'}") requires explicit user confirmation.`,
      };
    }

    if (assessedRisk === 'medium') {
      return {
        allowed: true,
        requiresConfirmation: false,
        risk: 'medium',
        action,
        matchedElement,
        reason: `Medium-risk action validated and approved for local execution.`,
      };
    }

    // Low risk action: auto-allowed
    return {
      allowed: true,
      requiresConfirmation: false,
      risk: 'low',
      action,
      matchedElement,
      reason: `Low-risk action validated and approved for auto execution.`,
    };
  }

  private actionRequiresTarget(type: string): boolean {
    return ['click', 'type', 'select', 'focus', 'extract'].includes(type);
  }

  private resolveTargetInPerception(
    target: ValidatedActionTarget,
    elements: PerceptionElement[]
  ): PerceptionElement | undefined {
    // 1. Direct ID match
    if (target.id) {
      const byId = elements.find((el) => el.id === target.id);
      if (byId) return byId;
    }

    // 2. Coordinates hit test
    if (target.coordinates) {
      const { x, y } = target.coordinates;
      const hit = elements.find((el) => {
        const [bx, by, bw, bh] = el.bbox;
        return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
      });
      if (hit) return hit;
    }

    // 3. Role + Text match
    if (target.role && target.text) {
      const expectedRole = target.role.toLowerCase().trim();
      const expectedText = target.text.toLowerCase().trim();
      const match = elements.find((el) => {
        const roleMatch = el.role.toLowerCase().trim() === expectedRole || this.isRoleCompatible(expectedRole, el.role.toLowerCase().trim());
        const textMatch = el.text.toLowerCase().trim().includes(expectedText) || expectedText.includes(el.text.toLowerCase().trim());
        return roleMatch && textMatch;
      });
      if (match) return match;
    }

    // 4. Text match alone if distinct
    if (target.text) {
      const expectedText = target.text.toLowerCase().trim();
      const match = elements.find((el) => el.text.toLowerCase().trim() === expectedText);
      if (match) return match;
    }

    // 5. Selector match if matches element id or attribute
    if (target.selector) {
      const cleanId = target.selector.replace(/^#/, '');
      const match = elements.find((el) => el.id === cleanId || el.name === cleanId);
      if (match) return match;
    }

    return undefined;
  }

  private isRoleCompatible(expected: string, actual: string): boolean {
    if (expected === actual) return true;
    if ((expected === 'button' || expected === 'submit') && (actual === 'button' || actual === 'link' || actual === 'input')) return true;
    if ((expected === 'textbox' || expected === 'input') && (actual === 'textbox' || actual === 'input' || actual === 'textarea')) return true;
    return false;
  }

  private isBboxConsistent(
    bboxA: [number, number, number, number],
    bboxB: [number, number, number, number]
  ): boolean {
    const [ax, ay, aw, ah] = bboxA;
    const [bx, by, bw, bh] = bboxB;

    const centerAX = ax + aw / 2;
    const centerAY = ay + ah / 2;
    const centerBX = bx + bw / 2;
    const centerBY = by + bh / 2;

    const dist = Math.hypot(centerAX - centerBX, centerAY - centerBY);
    // Allow up to 150px center distance tolerance for responsive reflows
    return dist < 150;
  }

  /**
   * Evaluates the risk tier based on action properties, keywords, and target element context.
   */
  public evaluateRiskTier(action: ValidatedAction, element?: PerceptionElement): RiskLevel {
    const textCorpus = [
      action.reason,
      action.value,
      action.target?.text,
      element?.text,
      element?.role,
      element?.name,
      action.url,
    ]
      .filter((s): s is string => typeof s === 'string')
      .join(' ');

    // 1. High risk check
    if (action.risk === 'high' || HIGH_RISK_PATTERNS.some((pattern) => pattern.test(textCorpus))) {
      return 'high';
    }

    // 2. Medium risk check: form submission, posting, account modifying
    // Applies to interactive/mutating actions (click, type, select)
    const isInteractive = ['click', 'type', 'select'].includes(action.type);
    if (
      action.risk === 'medium' ||
      (isInteractive && MEDIUM_RISK_PATTERNS.some((pattern) => pattern.test(textCorpus))) ||
      (action.type === 'click' && element?.inputType === 'submit') ||
      (action.type === 'click' && element?.role === 'button' && /submit|apply|save|register/i.test(element.text))
    ) {
      return 'medium';
    }

    // 3. Low risk check: scroll, focus, wait, non-destructive navigation / click
    return 'low';
  }
}
