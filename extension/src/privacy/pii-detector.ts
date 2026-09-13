/**
 * Deterministic and DOM-Attribute PII / Secret Detector
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md and 02_PRIVACY_FIREWALL_PLAN.md.
 */

import { DetectedEntity, PerceptionElement } from '../common/types.js';
import {
  PrivacyCategory,
  SensitivityTier,
  SENSITIVITY_TIERS,
  CATEGORY_TIER_MAP,
} from './categories.js';
import { DETERMINISTIC_RULES, DeterministicRule } from './rules.js';

export interface DOMAttributeContext {
  elementId?: string;
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  placeholder?: string;
  ariaLabel?: string;
  title?: string;
  value?: string;
  text?: string;
  bbox?: [number, number, number, number];
}

/**
 * Scans a plain text string using the catalog of deterministic regex and checksum rules.
 */
export function detectPIIFromText(
  text: string,
  elementId?: string,
  bbox?: [number, number, number, number]
): DetectedEntity[] {
  if (!text || typeof text !== 'string') return [];

  const entities: DetectedEntity[] = [];

  for (const rule of DETERMINISTIC_RULES) {
    // Clone regex with global flag if needed to find all occurrences
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g';
    const regex = new RegExp(rule.pattern.source, flags);

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matchedString = match[0];
      const start = match.index;
      const end = start + matchedString.length;

      // Validate through checksum if defined
      if (rule.validator && !rule.validator(matchedString, text)) {
        continue;
      }

      entities.push({
        category: rule.category,
        tier: rule.tier,
        text: matchedString,
        span: { start, end },
        bbox,
        confidence: rule.confidence,
        source: 'regex',
        elementId,
      });
    }
  }

  return entities;
}

/**
 * Inspects element attributes (type, autocomplete, name, id, placeholder, aria-label)
 * and its text/value using DOM heuristics and deterministic rules.
 */
export function detectPIIFromDOMAttributes(ctx: DOMAttributeContext): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  // 1. Password input type (Hard Invariant: Tier 3 Secret)
  if (ctx.type === 'password') {
    entities.push({
      category: 'password',
      tier: SENSITIVITY_TIERS.SECRET,
      text: ctx.value || '[PASSWORD_FIELD]',
      confidence: 1.0,
      source: 'dom',
      elementId: ctx.elementId,
      bbox: ctx.bbox,
    });
  }

  // 2. Autocomplete attributes
  if (ctx.autocomplete) {
    const auto = ctx.autocomplete.toLowerCase().trim();
    if (auto === 'current-password' || auto === 'new-password') {
      entities.push({
        category: 'password',
        tier: SENSITIVITY_TIERS.SECRET,
        text: ctx.value || '[PASSWORD_AUTOCOMPLETE]',
        confidence: 1.0,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    } else if (auto === 'one-time-code') {
      entities.push({
        category: 'otp',
        tier: SENSITIVITY_TIERS.SECRET,
        text: ctx.value || '[OTP_AUTOCOMPLETE]',
        confidence: 0.99,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    } else if (auto === 'cc-csc') {
      // CVV/CVC is a Tier 3 secret
      entities.push({
        category: 'password',
        tier: SENSITIVITY_TIERS.SECRET,
        text: ctx.value || '[CVV_AUTOCOMPLETE]',
        confidence: 0.99,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    } else if (auto === 'cc-number') {
      entities.push({
        category: 'credit_card',
        tier: SENSITIVITY_TIERS.SENSITIVE,
        text: ctx.value,
        confidence: 0.98,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    } else if (auto === 'email') {
      entities.push({
        category: 'email',
        tier: SENSITIVITY_TIERS.PERSONAL,
        text: ctx.value,
        confidence: 0.98,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    } else if (auto.startsWith('tel')) {
      entities.push({
        category: 'phone',
        tier: SENSITIVITY_TIERS.PERSONAL,
        text: ctx.value,
        confidence: 0.98,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    } else if (auto.includes('address') || auto.includes('postal-code')) {
      entities.push({
        category: 'address',
        tier: SENSITIVITY_TIERS.PERSONAL,
        text: ctx.value,
        confidence: 0.95,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    } else if (auto === 'name' || auto === 'given-name' || auto === 'family-name') {
      entities.push({
        category: 'name',
        tier: SENSITIVITY_TIERS.PERSONAL,
        text: ctx.value,
        confidence: 0.92,
        source: 'dom',
        elementId: ctx.elementId,
        bbox: ctx.bbox,
      });
    }
  }

  // 3. Name, ID, Placeholder, ARIA-Label keyword heuristics
  const attributeDescriptor = [
    ctx.name,
    ctx.id,
    ctx.placeholder,
    ctx.ariaLabel,
    ctx.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (attributeDescriptor) {
    // Password signals
    if (/\b(?:password|passwd|pwd|master[-_\s]?key)\b/i.test(attributeDescriptor)) {
      if (!entities.some((e) => e.category === 'password')) {
        entities.push({
          category: 'password',
          tier: SENSITIVITY_TIERS.SECRET,
          text: ctx.value,
          confidence: 0.96,
          source: 'dom',
          elementId: ctx.elementId,
          bbox: ctx.bbox,
        });
      }
    }

    // OTP signals
    if (/\b(?:otp|one[-_\s]?time|2fa|verification[-_\s]?code|auth(?:entication)?[-_\s]?code|pin[-_\s]?code)\b/i.test(attributeDescriptor)) {
      if (!entities.some((e) => e.category === 'otp')) {
        entities.push({
          category: 'otp',
          tier: SENSITIVITY_TIERS.SECRET,
          text: ctx.value,
          confidence: 0.95,
          source: 'dom',
          elementId: ctx.elementId,
          bbox: ctx.bbox,
        });
      }
    }

    // CVV / CVC signals (Tier 3)
    if (/\b(?:cvv|cvc|security[-_\s]?code|card[-_\s]?verification)\b/i.test(attributeDescriptor)) {
      if (!entities.some((e) => e.category === 'password')) {
        entities.push({
          category: 'password',
          tier: SENSITIVITY_TIERS.SECRET,
          text: ctx.value,
          confidence: 0.98,
          source: 'dom',
          elementId: ctx.elementId,
          bbox: ctx.bbox,
        });
      }
    }

    // Credit Card signals
    if (/\b(?:credit[-_\s]?card|card[-_\s]?num(?:ber)?|debit[-_\s]?card|cc[-_\s]?num)\b/i.test(attributeDescriptor)) {
      if (!entities.some((e) => e.category === 'credit_card')) {
        entities.push({
          category: 'credit_card',
          tier: SENSITIVITY_TIERS.SENSITIVE,
          text: ctx.value,
          confidence: 0.92,
          source: 'dom',
          elementId: ctx.elementId,
          bbox: ctx.bbox,
        });
      }
    }

    // SSN / Government ID signals
    if (/\b(?:ssn|social[-_\s]?security|national[-_\s]?id|passport[-_\s]?num)\b/i.test(attributeDescriptor)) {
      if (!entities.some((e) => e.category === 'government_id')) {
        entities.push({
          category: 'government_id',
          tier: SENSITIVITY_TIERS.SENSITIVE,
          text: ctx.value,
          confidence: 0.92,
          source: 'dom',
          elementId: ctx.elementId,
          bbox: ctx.bbox,
        });
      }
    }

    // IBAN / Bank Account signals
    if (/\b(?:iban|bank[-_\s]?acc(?:ount)?|routing[-_\s]?num(?:ber)?)\b/i.test(attributeDescriptor)) {
      if (!entities.some((e) => e.category === 'bank_account')) {
        entities.push({
          category: 'bank_account',
          tier: SENSITIVITY_TIERS.SENSITIVE,
          text: ctx.value,
          confidence: 0.92,
          source: 'dom',
          elementId: ctx.elementId,
          bbox: ctx.bbox,
        });
      }
    }
  }

  // 4. Scan element value and text content with deterministic rules
  const contentToScan = [ctx.value, ctx.text].filter((v): v is string => Boolean(v && typeof v === 'string'));
  for (const text of contentToScan) {
    const textEntities = detectPIIFromText(text, ctx.elementId, ctx.bbox);
    for (const ent of textEntities) {
      // If we already detected the same category from DOM, keep the higher confidence
      const existingIdx = entities.findIndex((e) => e.category === ent.category);
      if (existingIdx >= 0) {
        if (ent.confidence > entities[existingIdx].confidence) {
          entities[existingIdx] = ent;
        }
      } else {
        entities.push(ent);
      }
    }
  }

  return entities;
}

/**
 * High-level detection across a list of PerceptionElements extracted from the page.
 */
export function detectPIIFromPerceptionElements(elements: PerceptionElement[]): DetectedEntity[] {
  const allDetections: DetectedEntity[] = [];

  for (const el of elements) {
    const detections = detectPIIFromDOMAttributes({
      elementId: el.id,
      type: el.inputType,
      name: el.name,
      autocomplete: el.autocomplete,
      placeholder: el.placeholder,
      text: el.text,
      bbox: el.bbox,
    });

    allDetections.push(...detections);
  }

  return allDetections;
}

/**
 * Utility for in-browser DOM element scanning.
 */
export function detectPIIFromDOMElement(el: HTMLElement): DetectedEntity[] {
  const inputEl = el as HTMLInputElement;
  return detectPIIFromDOMAttributes({
    elementId: el.id,
    type: inputEl.type,
    name: inputEl.name,
    id: el.id,
    autocomplete: inputEl.autocomplete,
    placeholder: inputEl.placeholder,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    title: el.title,
    value: inputEl.value,
    text: el.innerText,
  });
}
