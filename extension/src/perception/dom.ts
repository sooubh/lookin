/**
 * DOM Perception Module
 * Extracts interactive and semantic elements from the webpage DOM,
 * computing stable IDs, roles, accessible labels, bounding boxes relative to viewport,
 * and visibility/enabled states.
 */

import { PerceptionElement } from '../common/types.js';
import {
  computeAccessibleRole,
  computeAccessibleName,
  getAccessibilityInfo,
} from './accessibility.js';

/**
 * Stable Element ID Registry
 * Maintains consistent, deterministic IDs across multiple perception runs on the same DOM.
 */
class ElementRegistry {
  private elementToId = new WeakMap<Element, string>();
  private idToElement = new Map<string, Element | WeakRef<Element>>();
  private counter = 1;

  public getOrCreateId(element: Element): string {
    const existingId = this.elementToId.get(element);
    if (existingId) {
      return existingId;
    }

    const id = `e${this.counter++}`;
    this.elementToId.set(element, id);
    if (typeof WeakRef !== 'undefined') {
      this.idToElement.set(id, new WeakRef(element));
    } else {
      this.idToElement.set(id, element);
    }
    return id;
  }

  public getElementById(id: string): Element | null {
    const ref = this.idToElement.get(id);
    if (!ref) return null;
    if (typeof WeakRef !== 'undefined' && ref instanceof WeakRef) {
      return ref.deref() || null;
    }
    return ref as Element;
  }

  public reset(): void {
    this.elementToId = new WeakMap<Element, string>();
    this.idToElement.clear();
    this.counter = 1;
  }
}

export const defaultElementRegistry = new ElementRegistry();

export function resetElementIdRegistry(): void {
  defaultElementRegistry.reset();
}

export function getElementByPerceptionId(id: string): Element | null {
  return defaultElementRegistry.getElementById(id);
}

/**
 * Selectors for interactive and semantic elements to discover in the DOM.
 */
const INTERACTIVE_SELECTORS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const SEMANTIC_TEXT_SELECTORS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'th',
  'td',
  'caption',
  'li',
  'label',
].join(', ');

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'HEAD',
  'META',
  'LINK',
  'SVG',
  'PATH',
  'BR',
  'HR',
]);

/**
 * Computes bounding box relative to the viewport: [x, y, width, height].
 */
export function computeBoundingBox(element: Element): [number, number, number, number] {
  if (typeof element.getBoundingClientRect === 'function') {
    const rect = element.getBoundingClientRect();
    return [
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
    ];
  }
  return [0, 0, 0, 0];
}

/**
 * Determines whether an element is visible in the viewport and not hidden by styling/attributes.
 */
export function isElementVisible(
  element: Element,
  bbox: [number, number, number, number],
  win?: Window | null
): boolean {
  // 1. Zero dimension check (width or height = 0)
  const [, , width, height] = bbox;
  if (width <= 0 || height <= 0) {
    return false;
  }

  // 2. Hidden attribute
  if (element.hasAttribute('hidden')) {
    return false;
  }

  // 3. Hidden input
  if (element.tagName.toUpperCase() === 'INPUT' && (element.getAttribute('type') || '').toLowerCase() === 'hidden') {
    return false;
  }

  // 4. aria-hidden attribute
  if (element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  // 5. CSS computed style check if window is available
  const currentWin = win || (element.ownerDocument ? element.ownerDocument.defaultView : null);
  if (currentWin && typeof currentWin.getComputedStyle === 'function') {
    try {
      const style = currentWin.getComputedStyle(element as HTMLElement);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        parseFloat(style.opacity || '1') === 0
      ) {
        return false;
      }
    } catch {
      // getComputedStyle might fail in synthetic DOM fixtures; ignore and fall back to attribute/bbox checks
    }
  }

  return true;
}

/**
 * Determines whether an element is enabled or disabled.
 */
export function isElementEnabled(element: Element): boolean {
  if (element.hasAttribute('disabled')) {
    return false;
  }

  if (Boolean((element as unknown as { disabled?: boolean }).disabled)) {
    return false;
  }

  if (element.getAttribute('aria-disabled') === 'true') {
    return false;
  }

  // Check if inside a disabled fieldset
  if (typeof element.closest === 'function') {
    try {
      if (element.closest('fieldset[disabled]')) {
        return false;
      }
    } catch {
      // Ignored for synthetic trees without full closest support
    }
  }

  return true;
}

/**
 * Checks whether an element is an ancestor or descendant of an already collected interactive element
 * to prevent duplicate extraction of sub-tree text.
 */
function isDescendantOf(child: Element, parent: Element): boolean {
  let curr = child.parentElement;
  while (curr) {
    if (curr === parent) return true;
    curr = curr.parentElement;
  }
  return false;
}

export interface DomExtractionOptions {
  document?: Document;
  window?: Window;
  registry?: ElementRegistry;
  includeTextBlocks?: boolean;
}

/**
 * Extracts interactive and semantic elements from the document DOM.
 */
export function extractDomElements(options: DomExtractionOptions = {}): PerceptionElement[] {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    return [];
  }

  const win = options.window || (doc.defaultView || (typeof window !== 'undefined' ? window : null));
  const registry = options.registry || defaultElementRegistry;
  const includeTextBlocks = options.includeTextBlocks !== false;

  const results: PerceptionElement[] = [];
  const processedElements = new Set<Element>();
  const interactiveNodes: Element[] = [];

  // Helper to query elements safely in both standard DOM and synthetic fixtures
  const queryAll = (selector: string): Element[] => {
    if (typeof doc.querySelectorAll === 'function') {
      try {
        const nodeList = doc.querySelectorAll(selector);
        return Array.from(nodeList);
      } catch {
        return [];
      }
    }
    return [];
  };

  // 1. Collect Interactive Elements first
  const candidateInteractive = queryAll(INTERACTIVE_SELECTORS);
  for (const el of candidateInteractive) {
    if (IGNORED_TAGS.has(el.tagName.toUpperCase())) continue;
    interactiveNodes.push(el);
  }

  for (const el of interactiveNodes) {
    if (processedElements.has(el)) continue;
    processedElements.add(el);

    const bbox = computeBoundingBox(el);
    const visible = isElementVisible(el, bbox, win);
    const enabled = isElementEnabled(el);
    const role = computeAccessibleRole(el);
    const text = computeAccessibleName(el, doc);
    const id = registry.getOrCreateId(el);

    const perceptionEl: PerceptionElement = {
      id,
      role,
      text,
      bbox,
      visible,
      enabled,
      source: 'dom',
    };

    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT') {
      perceptionEl.inputType = (el.getAttribute('type') || 'text').toLowerCase();
    } else if (tag === 'TEXTAREA') {
      perceptionEl.inputType = 'textarea';
    } else if (tag === 'SELECT') {
      perceptionEl.inputType = 'select';
    }

    const name = el.getAttribute('name');
    if (name) perceptionEl.name = name;

    const autocomplete = el.getAttribute('autocomplete');
    if (autocomplete) perceptionEl.autocomplete = autocomplete;

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) perceptionEl.placeholder = placeholder;

    results.push(perceptionEl);
  }

  // 2. Collect Semantic Headings and Text Blocks
  if (includeTextBlocks) {
    const candidateSemantic = queryAll(SEMANTIC_TEXT_SELECTORS);
    for (const el of candidateSemantic) {
      if (processedElements.has(el)) continue;
      if (IGNORED_TAGS.has(el.tagName.toUpperCase())) continue;

      // Skip text elements if they are direct descendants of an already captured interactive element
      // (e.g. <button><span>Click me</span></button>)
      let isInsideInteractive = false;
      for (const interactive of interactiveNodes) {
        if (isDescendantOf(el, interactive)) {
          isInsideInteractive = true;
          break;
        }
      }
      if (isInsideInteractive) {
        continue;
      }

      const text = computeAccessibleName(el, doc);
      if (!text || !text.trim()) {
        continue;
      }

      processedElements.add(el);
      const bbox = computeBoundingBox(el);
      const visible = isElementVisible(el, bbox, win);
      const enabled = isElementEnabled(el);
      const role = computeAccessibleRole(el);
      const id = registry.getOrCreateId(el);

      const perceptionEl: PerceptionElement = {
        id,
        role,
        text,
        bbox,
        visible,
        enabled,
        source: 'dom',
      };

      results.push(perceptionEl);
    }
  }

  return results;
}
