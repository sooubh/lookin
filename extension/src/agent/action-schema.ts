/**
 * Action Schema and Allowlist Definition for Privacy-Preserving Browser Vision Agent
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 03_BROWSER_AGENT_AND_AI_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Phases A13, A14).
 *
 * Core Principle: Cloud AI proposes actions as structured JSON.
 * The browser is the privacy boundary and final execution authority.
 * Arbitrary JS, eval, and unknown action types are strictly rejected.
 */

import { ActionType, RiskLevel, ActionTarget } from '../common/types.js';

export const ALLOWED_ACTION_TYPES: readonly ActionType[] = [
  'click',
  'type',
  'fill',
  'select',
  'check',
  'uncheck',
  'scroll',
  'navigate',
  'focus',
  'extract',
  'wait',
] as const;

export type AllowedActionType = ActionType;

export interface ValidatedActionTarget extends ActionTarget {
  coordinates?: { x: number; y: number };
}

export interface ProposedAction {
  type: string;
  target?: ValidatedActionTarget;
  value?: string;
  url?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  distance?: number;
  durationMs?: number;
  property?: string;
  risk?: RiskLevel;
  reason?: string;
  [key: string]: unknown;
}

export interface ValidatedAction {
  type: AllowedActionType;
  target?: ValidatedActionTarget;
  value?: string;
  url?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  distance?: number;
  durationMs?: number;
  property?: string;
  risk: RiskLevel;
  reason: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  error?: string;
  action?: ValidatedAction;
}

/**
 * Patterns that indicate code injection, eval, or dangerous script execution.
 */
const DANGEROUS_PATTERNS = [
  /eval\s*\(/i,
  /Function\s*\(/i,
  /setTimeout\s*\(\s*["'`]/i,
  /setInterval\s*\(\s*["'`]/i,
  /javascript\s*:/i,
  /<script\b/i,
  /\bon\w+\s*=/i, // inline event handlers e.g. onclick=
  /data:\s*text\/html/i,
  /document\.cookie/i,
  /window\.localStorage/i,
];

function containsCodeInjection(val: unknown): boolean {
  if (typeof val === 'string') {
    return DANGEROUS_PATTERNS.some((pattern) => pattern.test(val));
  }
  if (val && typeof val === 'object') {
    for (const key of Object.keys(val)) {
      if (containsCodeInjection((val as Record<string, unknown>)[key])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validates a proposed action against the strict action schema and security invariants.
 */
export function validateActionSchema(rawAction: unknown): SchemaValidationResult {
  if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) {
    return {
      valid: false,
      error: 'Action must be a non-null JSON object',
    };
  }

  const action = rawAction as ProposedAction;

  // 1. Check for code injection in any action field
  if (containsCodeInjection(action)) {
    return {
      valid: false,
      error: 'Action contains forbidden script or code injection patterns',
    };
  }

  // 2. Validate action type against allowlist
  if (typeof action.type !== 'string') {
    return {
      valid: false,
      error: 'Action type must be a string',
    };
  }

  // Support targetId field
  if ((action as any).targetId && !action.target) {
    action.target = { id: String((action as any).targetId) };
  } else if (action.target && (action as any).targetId && !action.target.id) {
    action.target.id = String((action as any).targetId);
  }

  const normalizedType = action.type.trim().toLowerCase() as AllowedActionType;
  if (!ALLOWED_ACTION_TYPES.includes(normalizedType)) {
    return {
      valid: false,
      error: `Action type "${action.type}" is not in the allowlist [${ALLOWED_ACTION_TYPES.join(', ')}]`,
    };
  }

  // 3. Action-specific validation
  switch (normalizedType) {
    case 'click':
    case 'focus':
    case 'extract':
    case 'check':
    case 'uncheck': {
      if (!action.target && !action.coordinates) {
        return {
          valid: false,
          error: `Action "${normalizedType}" requires a target element or coordinates`,
        };
      }
      break;
    }

    case 'type':
    case 'fill': {
      if (!action.target && !action.coordinates) {
        return {
          valid: false,
          error: `Action "${normalizedType}" requires a target element or coordinates`,
        };
      }
      if (typeof action.value !== 'string') {
        return {
          valid: false,
          error: `Action "${normalizedType}" requires a string value`,
        };
      }
      break;
    }

    case 'select': {
      if (!action.target) {
        return {
          valid: false,
          error: 'Action "select" requires a target element',
        };
      }
      if (typeof action.value !== 'string') {
        return {
          valid: false,
          error: 'Action "select" requires a string value to select',
        };
      }
      break;
    }

    case 'scroll': {
      const validDirections = ['up', 'down', 'left', 'right'];
      if (action.direction && !validDirections.includes(action.direction)) {
        return {
          valid: false,
          error: `Scroll direction "${action.direction}" is invalid. Must be one of: ${validDirections.join(', ')}`,
        };
      }
      if (action.distance !== undefined && (typeof action.distance !== 'number' || isNaN(action.distance) || action.distance < 0)) {
        return {
          valid: false,
          error: 'Scroll distance must be a positive number',
        };
      }
      break;
    }

    case 'navigate': {
      if (!action.url || typeof action.url !== 'string') {
        return {
          valid: false,
          error: 'Action "navigate" requires a valid url string',
        };
      }
      try {
        const parsedUrl = new URL(action.url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return {
            valid: false,
            error: `Protocol "${parsedUrl.protocol}" is forbidden. Only http: and https: allowed.`,
          };
        }
      } catch {
        return {
          valid: false,
          error: `Invalid URL format: "${action.url}"`,
        };
      }
      break;
    }

    case 'wait': {
      if (action.durationMs !== undefined) {
        if (typeof action.durationMs !== 'number' || isNaN(action.durationMs) || action.durationMs < 0) {
          return {
            valid: false,
            error: 'Wait durationMs must be a non-negative number',
          };
        }
        if (action.durationMs > 30000) {
          return {
            valid: false,
            error: 'Wait duration exceeds maximum limit of 30,000ms',
          };
        }
      }
      break;
    }
  }

  // 4. Validate target properties if present
  if (action.target) {
    if (action.target.bbox !== undefined) {
      if (
        !Array.isArray(action.target.bbox) ||
        action.target.bbox.length !== 4 ||
        action.target.bbox.some((n) => typeof n !== 'number' || isNaN(n) || n < 0)
      ) {
        return {
          valid: false,
          error: 'Target bbox must be an array of 4 non-negative numbers [x, y, width, height]',
        };
      }
    }
    if (action.target.coordinates !== undefined) {
      const { x, y } = action.target.coordinates;
      if (typeof x !== 'number' || isNaN(x) || typeof y !== 'number' || isNaN(y)) {
        return {
          valid: false,
          error: 'Target coordinates must contain numeric x and y values',
        };
      }
    }
  }

  // 5. Risk level normalization
  const validRisks: RiskLevel[] = ['low', 'medium', 'high'];
  const risk: RiskLevel = action.risk && validRisks.includes(action.risk) ? action.risk : 'low';

  const validated: ValidatedAction = {
    type: normalizedType,
    target: action.target,
    value: action.value,
    url: action.url,
    direction: action.direction,
    distance: action.distance,
    durationMs: action.durationMs ?? (normalizedType === 'wait' ? 1000 : undefined),
    property: action.property,
    risk,
    reason: typeof action.reason === 'string' ? action.reason : `Executed ${normalizedType} action`,
  };

  return {
    valid: true,
    action: validated,
  };
}
