/**
 * Task-Aware Context Planner
 *
 * Core Pipeline:
 *   User task
 *     down planTaskRequirements()
 *   Determine intent & required information slots
 *     down scoreElementRelevance()
 *   Determine which page elements are needed
 *     down detectPIIFromDOMAttributes()
 *   Detect PII on relevant elements only
 *     down evaluateBatchPolicy()
 *   Apply privacy policy
 *     down buildSanitizedPayload()
 *   Produce minimum-safe representation
 *
 * The planner does NOT invent private information.
 * Different tasks over the same page produce structurally different safe payloads.
 *
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md and 02_PRIVACY_FIREWALL_PLAN.md.
 */

import {
  PagePerception,
  PerceptionElement,
  SanitizedContext,
  TaskRequirement,
  PrivacyDecision,
} from '../common/types.js';
import { planTaskRequirements, isCategoryForbidden } from './task-context.js';
import { detectPIIFromDOMAttributes, detectPIIFromText } from './pii-detector.js';
import { evaluateBatchPolicy } from './policy-engine.js';
import { TokenVault } from './token-vault.js';
import { assertSafeToTransmit } from './payload-sanitizer.js';
import { generatePrivacyReceipt } from './privacy-receipt.js';
import { redactText } from './redactor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-element classification produced by the planner.
 */
export interface PlannedElement {
  element: PerceptionElement;
  /** Why this element was included or excluded */
  relevanceReason: string;
  /** 0-1 relevance score for current task intent */
  relevanceScore: number;
  /** Privacy decisions applied to this element's PII entities */
  decisions: PrivacyDecision[];
  /** The safe text representation to send to the model */
  safeText: string;
  /** Whether this element should appear in the outbound payload */
  include: boolean;
}

/**
 * Full output of the context planner for one (task, page) pair.
 */
export interface PlannedContext {
  task: string;
  intent: string;
  requirement: TaskRequirement;
  /** Elements included in the minimum-safe payload */
  includedElements: PlannedElement[];
  /** Elements excluded because they are irrelevant or contain forbidden data */
  excludedElements: PlannedElement[];
  /** The final sanitized payload ready for transmission */
  sanitizedContext: SanitizedContext;
  /** Raw representation byte size (for comparison) */
  rawBytes: number;
  /** Sanitized payload byte size */
  sanitizedBytes: number;
  /** Reduction percentage */
  reductionPercent: number;
}

// ---------------------------------------------------------------------------
// Element relevance scoring
// ---------------------------------------------------------------------------

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'menuitem', 'option', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab',
]);

const FORM_FIELD_ROLES = new Set([
  'textbox', 'checkbox', 'radio', 'combobox', 'listbox', 'searchbox',
  'spinbutton', 'slider',
]);

const CONTENT_ROLES = new Set([
  'heading', 'paragraph', 'listitem', 'table', 'row', 'cell', 'columnheader',
  'rowheader', 'article', 'region', 'generic',
]);

/**
 * Scores how relevant a page element is for the given task intent.
 * Returns a [0, 1] score and a human-readable reason.
 */
export function scoreElementRelevance(
  element: PerceptionElement,
  requirement: TaskRequirement
): { score: number; reason: string } {
  const intent = requirement.intent;
  const role = (element.role ?? '').toLowerCase();

  if (!element.visible) {
    return { score: 0, reason: 'Element not visible — excluded' };
  }

  if (!element.enabled && intent !== 'extract_data' && intent !== 'analyze_statement') {
    return { score: 0, reason: 'Element disabled — excluded for interactive intent' };
  }

  if (intent === 'fill_form') {
    if (FORM_FIELD_ROLES.has(role) || element.inputType) {
      return { score: 1.0, reason: 'Form field directly required for fill intent' };
    }
    if (role === 'button') {
      return { score: 0.8, reason: 'Button needed for form submission' };
    }
    if (role === 'heading' || role === 'label') {
      return { score: 0.5, reason: 'Heading/label provides form section context' };
    }
    return { score: 0.1, reason: 'Non-form element — low relevance for fill intent' };
  }

  if (intent === 'click') {
    if (role === 'button' || role === 'link') {
      const taskLower = requirement.task.toLowerCase();
      const elTextLower = (element.text || '').toLowerCase();
      if (elTextLower && taskLower.includes(elTextLower)) {
        return { score: 1.0, reason: 'Element text matches click target in task' };
      }
      return { score: 0.75, reason: 'Button or link relevant for click intent' };
    }
    if (role === 'heading' || role === 'menuitem') {
      return { score: 0.4, reason: 'Heading provides contextual orientation for click' };
    }
    return { score: 0.05, reason: 'Non-clickable element — low relevance for click intent' };
  }

  if (intent === 'analyze_statement') {
    if (['table', 'row', 'cell', 'rowheader', 'columnheader', 'listitem'].includes(role)) {
      return { score: 1.0, reason: 'Tabular/list data required for statement analysis' };
    }
    if (role === 'heading') {
      return { score: 0.6, reason: 'Section heading provides statement period context' };
    }
    if (role === 'generic' || role === 'paragraph') {
      if (/[\d.,$]+/.test(element.text || '')) {
        return { score: 0.85, reason: 'Element contains financial data relevant to analysis' };
      }
      return { score: 0.15, reason: 'Generic element without financial data' };
    }
    if (INTERACTIVE_ROLES.has(role) || FORM_FIELD_ROLES.has(role) || role === 'button') {
      return { score: 0.05, reason: 'Form/interactive element irrelevant for statement analysis' };
    }
    return { score: 0.1, reason: 'Content element with indirect analysis relevance' };
  }

  if (intent === 'navigate') {
    if (role === 'link' || role === 'menuitem' || role === 'tab') {
      return { score: 1.0, reason: 'Navigation element directly required' };
    }
    if (role === 'heading') {
      return { score: 0.5, reason: 'Heading provides navigational context' };
    }
    return { score: 0.1, reason: 'Non-navigation element — low relevance' };
  }

  if (intent === 'extract_data') {
    if (role === 'table' || role === 'row' || role === 'cell') {
      return { score: 1.0, reason: 'Tabular data required for extraction' };
    }
    if (CONTENT_ROLES.has(role) || role === 'heading') {
      return { score: 0.9, reason: 'Content element included for data extraction' };
    }
    if (INTERACTIVE_ROLES.has(role)) {
      return { score: 0.3, reason: 'Interactive element included as structure reference' };
    }
    return { score: 0.5, reason: 'General content element included for extraction' };
  }

  if (INTERACTIVE_ROLES.has(role)) {
    return { score: 0.6, reason: 'Interactive element included for general task' };
  }
  return { score: 0.3, reason: 'Generic element included with moderate relevance' };
}

// ---------------------------------------------------------------------------
// Safe text builder
// ---------------------------------------------------------------------------

/**
 * Constructs the safe text representation for an element given its privacy decisions.
 *
 * Handles the case where the decision was derived from a DOM-attribute entity with
 * no explicit text (e.g. autocomplete='tel' detects phone category but entity.text
 * is undefined). In that case we fall back to tokenizing the element's own text.
 */
export function buildSafeText(
  element: PerceptionElement,
  decisions: PrivacyDecision[],
  vault?: TokenVault
): string {
  if (decisions.some((d) => d.decision === 'block')) {
    return '';
  }

  let text = element.text ?? '';

  for (const dec of decisions) {
    if (dec.decision === 'tokenize') {
      if (dec.token) {
        // Token already issued by the policy engine
        text = dec.token;
      } else if (vault && text) {
        // Token was not issued because entity.text was undefined at detection time.
        // Issue the token now using the element's own text.
        try {
          text = vault.tokenize(dec.category, text);
        } catch {
          // Invariant violation (e.g. trying to tokenize a secret) — treat as block
          text = '';
        }
      } else {
        text = dec.replacement ?? '';
      }
      break;
    }
    if (dec.decision === 'omit' || dec.decision === 'structure_only') {
      text = '';
      break;
    }
    if (dec.decision === 'mask' && dec.replacement) {
      text = dec.replacement;
      break;
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// Core planner
// ---------------------------------------------------------------------------

const RELEVANCE_THRESHOLD = 0.3;

/**
 * Builds the minimum-safe context from a raw page and a user task.
 * This is the primary entry point for the Task-Aware Context Planner.
 *
 * @param task    - Natural language task from the user
 * @param page    - Raw page perception (full DOM extraction)
 * @param vault   - Client-side token vault (stays strictly local)
 * @param startMs - Optional timestamp for latency tracking
 */
export function buildTaskContext(
  task: string,
  page: PagePerception,
  vault: TokenVault,
  startMs = Date.now()
): PlannedContext {
  // Step 1: Parse intent and requirements from the task
  const requirement = planTaskRequirements(task);

  // Step 2: Score each element for relevance, detect PII, apply policy
  const included: PlannedElement[] = [];
  const excluded: PlannedElement[] = [];

  for (const element of page.elements) {
    const { score, reason } = scoreElementRelevance(element, requirement);

    // Detect PII via DOM attributes (input type, autocomplete, name, id, etc.)
    const domEntities = detectPIIFromDOMAttributes({
      elementId: element.id,
      type: element.inputType,
      name: element.name,
      autocomplete: element.autocomplete,
      placeholder: element.placeholder,
      value: element.value,
      text: element.text,
      bbox: element.bbox,
    });

    // Also run regex detection over the element's visible text to catch
    // sensitive values that appear as rendered content (e.g. IBAN in a row).
    const textEntities = element.text
      ? detectPIIFromText(element.text, element.id, element.bbox)
      : [];

    // Merge: deduplicate by category, keeping higher-confidence match
    const allEntities = [...domEntities];
    for (const te of textEntities) {
      const existingIdx = allEntities.findIndex((e) => e.category === te.category);
      if (existingIdx >= 0) {
        if (te.confidence > allEntities[existingIdx].confidence) {
          allEntities[existingIdx] = te;
        }
      } else {
        allEntities.push(te);
      }
    }

    const decisions = evaluateBatchPolicy(allEntities, requirement, vault);
    const hasHardBlock = decisions.some((d) => d.decision === 'block');

    // Build safe text; pass vault so missing tokens can be issued on-demand
    const safeText = hasHardBlock
      ? ''
      : buildSafeText(element, decisions, vault);

    if (score < RELEVANCE_THRESHOLD) {
      excluded.push({ element, relevanceReason: reason, relevanceScore: score, decisions, safeText: '', include: false });
      continue;
    }

    if (hasHardBlock) {
      included.push({
        element,
        relevanceReason: `${reason} [structure-only: secret field blocked]`,
        relevanceScore: score,
        decisions,
        safeText: '',
        include: true,
      });
      continue;
    }

    included.push({ element, relevanceReason: reason, relevanceScore: score, decisions, safeText, include: true });
  }

  // Step 3: Assemble sanitized payload
  const allDecisions = [...included, ...excluded].flatMap((pe) => pe.decisions);

  const safeElements = included.map((pe) => ({
    id: pe.element.id,
    role: pe.element.role,
    text: pe.safeText,
    bbox: pe.element.bbox,
    enabled: pe.element.enabled,
    inputType: pe.element.inputType,
    placeholder: pe.element.placeholder,
  }));

  const privacyReceipt = generatePrivacyReceipt(allDecisions, {
    localInferenceMs: Date.now() - startMs,
    payloadBytes: 0,
  });

  const sanitizedContext: SanitizedContext = {
    task,
    url: page.url,
    safeDom: { viewport: page.viewport, elements: safeElements },
    safeText: included.map((pe) => pe.safeText).filter(Boolean),
    sanitizedImage: null,
    capabilities: requirement.allowedActions,
    privacyReceipt,
  };

  // Step 4: Measure raw vs sanitized sizes
  const rawJson = JSON.stringify({ task, url: page.url, viewport: page.viewport, elements: page.elements });
  const sanitizedJson = JSON.stringify(sanitizedContext);

  let rawBytes: number;
  let sanitizedBytes: number;
  if (typeof Buffer !== 'undefined' && Buffer.byteLength) {
    rawBytes = Buffer.byteLength(rawJson, 'utf8');
    sanitizedBytes = Buffer.byteLength(sanitizedJson, 'utf8');
  } else {
    rawBytes = new TextEncoder().encode(rawJson).length;
    sanitizedBytes = new TextEncoder().encode(sanitizedJson).length;
  }

  const reductionPercent = rawBytes > 0
    ? Math.round(((rawBytes - sanitizedBytes) / rawBytes) * 100)
    : 0;

  (sanitizedContext.privacyReceipt as any).payloadBytes = sanitizedBytes;

  // Step 5: Pre-transmission safety check (fail-closed)
  assertSafeToTransmit(sanitizedContext, vault);

  return {
    task,
    intent: requirement.intent,
    requirement,
    includedElements: included,
    excludedElements: excluded,
    sanitizedContext,
    rawBytes,
    sanitizedBytes,
    reductionPercent,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable audit summary of what the model receives.
 */
export function describeContextPlan(plan: PlannedContext): string {
  const lines: string[] = [
    '=== CONTEXT PLAN ===',
    `Task:    ${plan.task}`,
    `Intent:  ${plan.intent}`,
    '',
    `Included elements (${plan.includedElements.length}):`,
    ...plan.includedElements.map(
      (pe) => `  [${pe.element.role}] "${pe.safeText}" score=${pe.relevanceScore.toFixed(2)} — ${pe.relevanceReason}`
    ),
    '',
    `Excluded elements (${plan.excludedElements.length}):`,
    ...plan.excludedElements.map(
      (pe) => `  [${pe.element.role}] score=${pe.relevanceScore.toFixed(2)} — ${pe.relevanceReason}`
    ),
    '',
    `Payload:  raw=${plan.rawBytes}B  sanitized=${plan.sanitizedBytes}B  reduction=${plan.reductionPercent}%`,
    '',
    'Privacy decisions:',
    ...plan.includedElements.flatMap((pe) =>
      pe.decisions.map(
        (d) => `  ${d.category} -> ${d.decision}${d.token ? ` (${d.token})` : ''}`
      )
    ),
    '===================',
  ];
  return lines.join('\n');
}
