/**
 * Task-Aware Minimum-Context Engine
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Prompt A8).
 */

import { ActionType, TaskRequirement } from '../common/types.js';
import { PrivacyCategory, isSecret } from './categories.js';

/**
 * Universal forbidden contexts that MUST NEVER leave the browser for ANY task.
 */
export const UNIVERSAL_FORBIDDEN_CONTEXT = [
  'password',
  'otp',
  'api_key',
  'private_key',
  'session_token',
  'cvv',
  'token_vault_mappings',
] as const;

/**
 * Parses natural language tasks and outputs the minimum safe context requirement.
 */
export function planTaskRequirements(task: string): TaskRequirement {
  const normalized = task.toLowerCase().trim();

  // 1. Click Intent (e.g. "Click the Submit button", "Click Next")
  if (/\b(?:click|press|tap|hit|push)\b/i.test(normalized)) {
    const isPotentiallyIrreversible = /\b(?:delete|remove|pay|purchase|transfer|order|destroy)\b/i.test(
      normalized
    );

    const highRiskActions: ActionType[] = isPotentiallyIrreversible ? ['click'] : [];

    return {
      task,
      intent: 'click',
      requiredContext: [
        'visible_button_text',
        'button_position',
        'button_enabled',
        'element_role',
      ],
      optionalContext: ['container_heading', 'button_icon'],
      forbiddenContext: [
        ...UNIVERSAL_FORBIDDEN_CONTEXT,
        'name',
        'email',
        'phone',
        'address',
        'account_balance',
        'transaction_history',
      ],
      allowedActions: ['click', 'focus', 'wait', 'scroll'],
      highRiskActions,
    };
  }

  // 2. Form Filling Intent (e.g. "Fill registration form", "Fill this form and submit it")
  if (/\b(?:fill|register|enter|complete form|sign up|input)\b/i.test(normalized)) {
    const willSubmit = /\b(?:submit|send|finish|save)\b/i.test(normalized);
    const highRiskActions: ActionType[] = willSubmit ? ['click'] : [];

    return {
      task,
      intent: 'fill_form',
      requiredContext: [
        'form_fields',
        'field_labels',
        'field_types',
        'field_placeholders',
        'buttons',
      ],
      optionalContext: ['form_title', 'validation_messages', 'field_positions'],
      forbiddenContext: [...UNIVERSAL_FORBIDDEN_CONTEXT],
      allowedActions: ['type', 'click', 'select', 'focus', 'scroll', 'wait'],
      highRiskActions,
    };
  }

  // 3. Statement / Expense Analysis Intent (e.g. "What did I spend this month?", "Check this account statement")
  if (
    /\b(?:spend|spent|statement|expenses?|cost|total monthly|transaction|balance|financial|bill)\b/i.test(
      normalized
    )
  ) {
    return {
      task,
      intent: 'analyze_statement',
      requiredContext: [
        'transactions',
        'transaction_dates',
        'merchant_labels',
        'amounts',
        'currency',
      ],
      optionalContext: ['category', 'statement_period'],
      forbiddenContext: [
        ...UNIVERSAL_FORBIDDEN_CONTEXT,
        'bank_account',
        'account_number',
        'home_address',
        'phone',
        'ssn',
      ],
      allowedActions: ['extract', 'scroll', 'wait'],
      highRiskActions: [],
    };
  }

  // 4. Navigation Intent (e.g. "Go to settings", "Navigate to home page")
  if (/\b(?:go to|navigate|open|visit|switch to)\b/i.test(normalized)) {
    return {
      task,
      intent: 'navigate',
      requiredContext: ['navigation_links', 'url', 'page_title'],
      optionalContext: ['breadcrumbs'],
      forbiddenContext: [
        ...UNIVERSAL_FORBIDDEN_CONTEXT,
        'personal_data',
        'form_fields',
      ],
      allowedActions: ['navigate', 'click', 'wait', 'scroll'],
      highRiskActions: [],
    };
  }

  // 5. Data Extraction Intent (e.g. "Extract table data", "Read summary")
  if (/\b(?:extract|read|scrape|summarize|copy|get text)\b/i.test(normalized)) {
    return {
      task,
      intent: 'extract_data',
      requiredContext: ['target_content', 'headings', 'table_rows'],
      optionalContext: ['pagination'],
      forbiddenContext: [...UNIVERSAL_FORBIDDEN_CONTEXT],
      allowedActions: ['extract', 'scroll', 'wait'],
      highRiskActions: [],
    };
  }

  // 6. General Intent (Fallback)
  return {
    task,
    intent: 'general',
    requiredContext: ['page_structure', 'interactive_elements'],
    optionalContext: ['visible_text'],
    forbiddenContext: [...UNIVERSAL_FORBIDDEN_CONTEXT],
    allowedActions: ['click', 'type', 'select', 'scroll', 'focus', 'extract', 'wait'],
    highRiskActions: ['click', 'type'],
  };
}

/**
 * Checks whether a privacy category is forbidden for the given task requirement.
 * Note: Tier 3 secrets are ALWAYS forbidden regardless of context.
 */
export function isCategoryForbidden(
  category: PrivacyCategory,
  requirement: TaskRequirement
): boolean {
  if (isSecret(category)) return true;

  return requirement.forbiddenContext.some(
    (forbidden) => forbidden === category || forbidden.includes(category)
  );
}

/**
 * Checks whether a privacy category or specific element is explicitly required for the current task.
 */
export function isCategoryRequiredForTask(
  category: PrivacyCategory,
  requirement: TaskRequirement,
  entityText?: string
): boolean {
  // Secrets are NEVER required to be transmitted to the server
  if (isSecret(category)) return false;

  // If entityText is provided and the task explicitly targets or mentions this text
  // (e.g. task is "Click the Submit button" and entityText is "Submit")
  if (entityText && entityText.trim().length > 1) {
    if (requirement.task.toLowerCase().includes(entityText.toLowerCase().trim())) {
      return true;
    }
  }

  // Form filling requires semantic field labels / tokenized personal context
  if (requirement.intent === 'fill_form') {
    if (category === 'name' || category === 'email' || category === 'phone' || category === 'address') {
      return true;
    }
  }

  // For click intent, public target buttons or interactive elements
  if (requirement.intent === 'click' && category === 'unknown') {
    return true;
  }

  return requirement.requiredContext.some(
    (req) => req === category || req.includes(category)
  );
}
