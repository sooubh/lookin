/**
 * Privacy-Preserving Browser Vision Agent
 * Action Plan Schema & Strict Validation
 *
 * Enforces strict security invariants on all server model outputs:
 * - Allowlist of permitted action types only
 * - Strict target structure { role, text, id, bbox, selector }
 * - Strict risk rating ('low' | 'medium' | 'high')
 * - Complete rejection of arbitrary JavaScript, eval, shell commands, or unknown action types
 */

export const ALLOWED_ACTION_TYPES = Object.freeze([
  'click',
  'type',
  'select',
  'scroll',
  'navigate',
  'focus',
  'extract',
  'wait',
]);

export const ALLOWED_RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

export const ALLOWED_TARGET_KEYS = Object.freeze([
  'role',
  'text',
  'id',
  'bbox',
  'selector',
]);

export const ALLOWED_SCROLL_DIRECTIONS = Object.freeze(['up', 'down', 'left', 'right']);

// Dangerous patterns that must never appear in any string values of the action plan
const DANGEROUS_PATTERNS = [
  /\beval\s*\(/i,
  /\bFunction\s*\(/i,
  /\bsetTimeout\s*\(/i,
  /\bsetInterval\s*\(/i,
  /javascript:/i,
  /<script\b[^>]*>/i,
  /\bdocument\.(?:cookie|location|write)\b/i,
  /\bwindow\.(?:location|localStorage|sessionStorage)\b/i,
  /\b(?:exec|spawn|fork)\s*\(/i,
  /\$\([^)]*\)/, // command substitution $(cmd)
  /`[^`]*`/,     // template literal or command backticks
];

/**
 * Checks if a string contains any dangerous script or command injection patterns
 * @param {string} val
 * @returns {string|null} Name of pattern or null if clean
 */
function findDangerousPattern(val) {
  if (typeof val !== 'string') return null;
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(val)) {
      return pattern.toString();
    }
  }
  return null;
}

/**
 * Recursively scans an object/array for dangerous string injections
 * @param {any} obj
 * @param {string} path
 * @param {string[]} errors
 */
function scanForDangerousContent(obj, path, errors) {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    const matched = findDangerousPattern(obj);
    if (matched) {
      errors.push(`Dangerous code pattern ${matched} detected at ${path}: "${obj}"`);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => scanForDangerousContent(item, `${path}[${index}]`, errors));
  } else if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      scanForDangerousContent(value, `${path}.${key}`, errors);
    }
  }
}

/**
 * Validates a target object against strict schema
 * Allowed keys: { role, text, id, bbox, selector }
 * @param {any} target
 * @param {string} path
 * @param {string[]} errors
 */
function validateTarget(target, path, errors) {
  if (target === null || target === undefined) {
    return; // Some actions like wait or navigate might not require a target
  }

  if (typeof target !== 'object' || Array.isArray(target)) {
    errors.push(`${path}: target must be an object matching { role, text, id, bbox, selector }`);
    return;
  }

  // Check for unknown keys in target
  for (const key of Object.keys(target)) {
    if (!ALLOWED_TARGET_KEYS.includes(key)) {
      errors.push(`${path}.target: unrecognized key '${key}'. Allowed target keys: ${ALLOWED_TARGET_KEYS.join(', ')}`);
    }
  }

  // Validate field types
  if (target.id !== undefined && target.id !== null && typeof target.id !== 'string') {
    errors.push(`${path}.target.id must be a string`);
  }
  if (target.role !== undefined && target.role !== null && typeof target.role !== 'string') {
    errors.push(`${path}.target.role must be a string`);
  }
  if (target.text !== undefined && target.text !== null && typeof target.text !== 'string') {
    errors.push(`${path}.target.text must be a string`);
  }
  if (target.selector !== undefined && target.selector !== null && typeof target.selector !== 'string') {
    errors.push(`${path}.target.selector must be a string`);
  }

  // Bounding box validation: [x, y, width, height]
  if (target.bbox !== undefined && target.bbox !== null) {
    if (!Array.isArray(target.bbox) || target.bbox.length !== 4 || !target.bbox.every(n => typeof n === 'number' && Number.isFinite(n))) {
      errors.push(`${path}.target.bbox must be an array of 4 finite numbers [x, y, width, height]`);
    }
  }
}

/**
 * Validates a single action item
 * @param {any} action
 * @param {number} index
 * @param {string[]} errors
 */
function validateAction(action, index, errors) {
  const path = `actions[${index}]`;

  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    errors.push(`${path} must be a non-null object`);
    return;
  }

  // 1. Validate type
  if (!action.type || typeof action.type !== 'string') {
    errors.push(`${path}.type must be a non-empty string`);
    return;
  }

  const normalizedType = action.type.toLowerCase().trim();
  if (!ALLOWED_ACTION_TYPES.includes(normalizedType)) {
    errors.push(`${path}.type: '${action.type}' is not allowed. Allowed types: ${ALLOWED_ACTION_TYPES.join(', ')}`);
    return;
  }

  // 2. Validate risk
  if (!action.risk || typeof action.risk !== 'string') {
    errors.push(`${path}.risk must be specified ('low', 'medium', or 'high')`);
  } else {
    const normalizedRisk = action.risk.toLowerCase().trim();
    if (!ALLOWED_RISK_LEVELS.includes(normalizedRisk)) {
      errors.push(`${path}.risk: '${action.risk}' is invalid. Allowed risk levels: ${ALLOWED_RISK_LEVELS.join(', ')}`);
    }
  }

  // 3. Validate target
  validateTarget(action.target, path, errors);

  // 4. Validate type-specific constraints
  switch (normalizedType) {
    case 'click':
    case 'focus':
      if (!action.target || (typeof action.target === 'object' && Object.keys(action.target).length === 0)) {
        errors.push(`${path}: '${normalizedType}' action requires a target identifier (id, text, selector, or bbox)`);
      }
      break;

    case 'type':
      if (action.value === undefined || typeof action.value !== 'string') {
        errors.push(`${path}: 'type' action requires a string 'value'`);
      }
      break;

    case 'select':
      if (action.value === undefined && action.option === undefined && action.index === undefined) {
        errors.push(`${path}: 'select' action requires 'value', 'option', or 'index'`);
      }
      break;

    case 'scroll':
      if (action.direction !== undefined) {
        if (typeof action.direction !== 'string' || !ALLOWED_SCROLL_DIRECTIONS.includes(action.direction.toLowerCase())) {
          errors.push(`${path}.direction must be one of: ${ALLOWED_SCROLL_DIRECTIONS.join(', ')}`);
        }
      }
      if (action.amount !== undefined && (typeof action.amount !== 'number' || !Number.isFinite(action.amount))) {
        errors.push(`${path}.amount must be a finite number`);
      }
      break;

    case 'navigate':
      if (!action.url || typeof action.url !== 'string') {
        errors.push(`${path}: 'navigate' action requires a valid string 'url'`);
      } else {
        const urlLower = action.url.toLowerCase().trim();
        if (urlLower.startsWith('javascript:') || urlLower.startsWith('data:') || urlLower.startsWith('vbscript:')) {
          errors.push(`${path}.url: dangerous protocol not permitted`);
        }
      }
      break;

    case 'wait':
      const duration = action.durationMs ?? action.duration;
      if (duration !== undefined && (typeof duration !== 'number' || duration < 0 || duration > 60000)) {
        errors.push(`${path}: wait duration must be a positive number up to 60000ms`);
      }
      break;

    case 'extract':
      // Extract is read-only and safe
      break;
  }

  // 5. Scan for dangerous code or injection patterns in any field of this action
  scanForDangerousContent(action, path, errors);
}

/**
 * Validates the full action plan
 * @param {any} plan
 * @returns {{ valid: boolean, errors: string[], plan?: { actions: any[] } }}
 */
export function validateActionPlan(plan) {
  const errors = [];

  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return {
      valid: false,
      errors: ['Action plan must be a non-null object containing an "actions" array.'],
    };
  }

  if (!Array.isArray(plan.actions)) {
    return {
      valid: false,
      errors: ['Action plan must include an "actions" array.'],
    };
  }

  // Validate each action
  plan.actions.forEach((action, idx) => validateAction(action, idx, errors));

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    errors: [],
    plan: {
      actions: plan.actions.map(action => ({
        type: action.type.toLowerCase().trim(),
        risk: action.risk.toLowerCase().trim(),
        target: action.target ? { ...action.target } : undefined,
        value: action.value !== undefined ? String(action.value) : undefined,
        direction: action.direction ? String(action.direction).toLowerCase() : undefined,
        amount: typeof action.amount === 'number' ? action.amount : undefined,
        url: action.url !== undefined ? String(action.url) : undefined,
        durationMs: action.durationMs ?? action.duration,
        reason: action.reason ? String(action.reason) : undefined,
        field: action.field ? String(action.field) : undefined,
      })),
    },
  };
}

/**
 * Throws an ActionValidationError if the plan fails validation
 * @param {any} plan
 * @returns {{ actions: any[] }}
 */
export function assertValidActionPlan(plan) {
  const result = validateActionPlan(plan);
  if (!result.valid) {
    const error = new Error(`Action plan validation failed: ${result.errors.join('; ')}`);
    error.name = 'ActionValidationError';
    error.errors = result.errors;
    throw error;
  }
  return result.plan;
}
