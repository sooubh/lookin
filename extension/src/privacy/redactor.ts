/**
 * Coordinate-Preserving Redaction Engine
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 02_PRIVACY_FIREWALL_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Prompt A9).
 */

import { DetectedEntity, PerceptionElement, PrivacyDecision } from '../common/types.js';
import { PrivacyCategory, isSecret } from './categories.js';

export interface RedactionBox {
  bbox: [number, number, number, number]; // [x, y, width, height]
  category: PrivacyCategory;
  action: 'fill_black' | 'blur' | 'placeholder';
  replacementText?: string;
}

/**
 * Redacts spans of sensitive entities inside a string with their policy replacement.
 * Operates from end of text to beginning so span indices remain stable during replacement.
 */
export function redactText(
  originalText: string,
  entities: DetectedEntity[],
  decisions: PrivacyDecision[]
): string {
  if (!originalText || typeof originalText !== 'string') return originalText;
  if (!entities.length || !decisions.length) return originalText;

  // Filter entities that have valid span coordinates and associate with decision
  const spanItems: Array<{
    start: number;
    end: number;
    replacement: string;
    rawText?: string;
  }> = [];

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    const dec = decisions[i] || decisions.find((d) => d.category === ent.category);
    if (!dec) continue;

    let rep = dec.replacement ?? '';
    if (dec.decision === 'block') {
      rep = '[BLOCKED_SECRET]';
    } else if (dec.decision === 'tokenize' && dec.token) {
      rep = dec.token;
    } else if (dec.decision === 'omit') {
      rep = '';
    }

    if (ent.span && typeof ent.span.start === 'number' && typeof ent.span.end === 'number') {
      spanItems.push({
        start: ent.span.start,
        end: ent.span.end,
        replacement: rep,
        rawText: ent.text,
      });
    } else if (ent.text && originalText.includes(ent.text)) {
      // If span is missing, locate all occurrences of ent.text
      let searchIdx = 0;
      while ((searchIdx = originalText.indexOf(ent.text, searchIdx)) !== -1) {
        spanItems.push({
          start: searchIdx,
          end: searchIdx + ent.text.length,
          replacement: rep,
          rawText: ent.text,
        });
        searchIdx += ent.text.length;
      }
    }
  }

  // Sort descending by start index to avoid invalidating coordinates
  spanItems.sort((a, b) => b.start - a.start);

  let result = originalText;
  for (const item of spanItems) {
    const clampedStart = Math.max(0, Math.min(item.start, result.length));
    const clampedEnd = Math.max(clampedStart, Math.min(item.end, result.length));

    if (clampedStart < result.length) {
      result = result.substring(0, clampedStart) + item.replacement + result.substring(clampedEnd);
    }
  }

  // Final fallback pass: if any blocked or tokenized text still appears verbatim, replace it
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    const dec = decisions[i] || decisions.find((d) => d.category === ent.category);
    if (!dec || !ent.text || ent.text.length < 3) continue;

    if (dec.decision === 'block' && result.includes(ent.text)) {
      result = result.replaceAll(ent.text, '[BLOCKED_SECRET]');
    } else if (dec.decision === 'tokenize' && dec.token && result.includes(ent.text)) {
      result = result.replaceAll(ent.text, dec.token);
    }
  }

  return result;
}

/**
 * Creates coordinate-preserving visual redaction boxes from detected entities and decisions.
 */
export function generateRedactionBoxes(
  entities: DetectedEntity[],
  decisions: PrivacyDecision[]
): RedactionBox[] {
  const boxes: RedactionBox[] = [];

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const decision = decisions[i] || decisions.find((d) => d.category === entity.category);
    if (!decision || !entity.bbox) continue;

    if (decision.decision === 'block' || isSecret(entity.category)) {
      boxes.push({
        bbox: entity.bbox,
        category: entity.category,
        action: 'fill_black',
        replacementText: '[SECRET BLOCKED]',
      });
    } else if (decision.decision === 'blur' || entity.category === 'face') {
      boxes.push({
        bbox: entity.bbox,
        category: entity.category,
        action: 'blur',
        replacementText: '[FACE BLURRED]',
      });
    } else if (decision.decision === 'tokenize') {
      boxes.push({
        bbox: entity.bbox,
        category: entity.category,
        action: 'placeholder',
        replacementText: decision.token || '[TOKEN]',
      });
    } else if (decision.decision === 'mask' || decision.decision === 'omit') {
      boxes.push({
        bbox: entity.bbox,
        category: entity.category,
        action: 'fill_black',
        replacementText: decision.replacement || '[REDACTED]',
      });
    }
  }

  return boxes;
}

/**
 * Redacts a list of PerceptionElements according to privacy decisions, preserving UI geometry.
 */
export function redactPerceptionElements(
  elements: PerceptionElement[],
  entities: DetectedEntity[],
  decisions: PrivacyDecision[]
): PerceptionElement[] {
  return elements.map((el) => {
    // Find all detections for this element
    const matchingIndices: number[] = [];
    entities.forEach((ent, idx) => {
      if (ent.elementId && ent.elementId === el.id) {
        matchingIndices.push(idx);
      }
    });

    if (matchingIndices.length === 0) {
      return { ...el };
    }

    // Determine the most restrictive decision among matches
    let mostRestrictiveDec: PrivacyDecision | undefined;
    for (const idx of matchingIndices) {
      const dec = decisions[idx];
      if (!dec) continue;
      if (!mostRestrictiveDec || getDecisionSeverity(dec) > getDecisionSeverity(mostRestrictiveDec)) {
        mostRestrictiveDec = dec;
      }
    }

    if (!mostRestrictiveDec) {
      return { ...el };
    }

    const cloned: PerceptionElement = { ...el };

    switch (mostRestrictiveDec.decision) {
      case 'block':
        // Strip text and values completely; preserve element role and geometry
        cloned.text = '[BLOCKED_SECRET]';
        cloned.placeholder = undefined;
        break;

      case 'omit':
        cloned.text = '';
        cloned.placeholder = undefined;
        break;

      case 'tokenize':
        cloned.text = mostRestrictiveDec.token || '[TOKEN]';
        cloned.placeholder = mostRestrictiveDec.token;
        break;

      case 'mask':
        cloned.text = mostRestrictiveDec.replacement || '****';
        cloned.placeholder = undefined;
        break;

      case 'structure_only':
        cloned.text = '';
        cloned.placeholder = undefined;
        break;

      case 'allow':
      default:
        // Keep original
        break;
    }

    return cloned;
  });
}

/**
 * Applies redaction boxes to an HTML5 Canvas 2D context.
 * Used for in-memory screenshot sanitization before transmission.
 */
export function applyRedactionToCanvas(
  ctx: {
    fillStyle: string;
    fillRect: (x: number, y: number, w: number, h: number) => void;
    filter: string;
    font?: string;
    fillText?: (text: string, x: number, y: number) => void;
  },
  boxes: RedactionBox[]
): void {
  for (const box of boxes) {
    const [x, y, w, h] = box.bbox;

    if (box.action === 'fill_black') {
      ctx.fillStyle = '#0f172a'; // Neutral solid dark fill
      ctx.fillRect(x, y, w, h);
    } else if (box.action === 'blur') {
      ctx.filter = 'blur(10px)';
      ctx.fillStyle = 'rgba(100, 116, 139, 0.85)';
      ctx.fillRect(x, y, w, h);
      ctx.filter = 'none';
    } else if (box.action === 'placeholder') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x, y, w, h);
    }
  }
}

function getDecisionSeverity(dec: PrivacyDecision): number {
  switch (dec.decision) {
    case 'block':
      return 5;
    case 'omit':
      return 4;
    case 'mask':
      return 3;
    case 'tokenize':
      return 2;
    case 'structure_only':
      return 1;
    case 'allow':
    default:
      return 0;
  }
}
