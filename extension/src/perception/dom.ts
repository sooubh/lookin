/**
 * DOM Perception Module
 * Extracts interactive and semantic elements from the webpage DOM,
 * computing stable IDs, roles, accessible labels, bounding boxes relative to viewport,
 * and visibility/enabled states.
 */

import { PerceptionElement, CompactElement, ElementBounds, PagePerception } from '../common/types.js';
import {
  computeAccessibleRole,
  computeAccessibleName,
  computeNearbyContext,
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
    const [bx, by, bw, bh] = bbox;
    const bounds: ElementBounds = { x: bx, y: by, width: bw, height: bh };
    const visible = isElementVisible(el, bbox, win);
    const enabled = isElementEnabled(el);
    const role = computeAccessibleRole(el);
    const text = computeAccessibleName(el, doc);
    const id = registry.getOrCreateId(el);
    const context = computeNearbyContext(el, doc);

    const tag = el.tagName.toUpperCase();
    let inputType: string | undefined;
    if (tag === 'INPUT') {
      inputType = (el.getAttribute('type') || 'text').toLowerCase();
    } else if (tag === 'TEXTAREA') {
      inputType = 'textarea';
    } else if (tag === 'SELECT') {
      inputType = 'select';
    }

    const nameAttr = el.getAttribute('name');

    const perceptionEl: PerceptionElement = {
      id,
      role,
      name: nameAttr || text,
      text,
      type: inputType,
      inputType,
      bbox,
      bounds,
      visible,
      enabled,
      source: 'dom',
    };

    if (context) perceptionEl.context = context;

    const autocomplete = el.getAttribute('autocomplete');
    if (autocomplete) perceptionEl.autocomplete = autocomplete;

    const placeholder = el.getAttribute('placeholder');
    if (placeholder) perceptionEl.placeholder = placeholder;

    // Checkbox and radio checked state
    if (
      inputType === 'checkbox' ||
      inputType === 'radio' ||
      role === 'checkbox' ||
      role === 'radio' ||
      role === 'switch'
    ) {
      if ('checked' in el) {
        perceptionEl.checked = Boolean((el as unknown as { checked?: boolean }).checked);
      } else if (el.getAttribute('aria-checked') === 'true') {
        perceptionEl.checked = true;
      } else if (el.hasAttribute('checked')) {
        perceptionEl.checked = true;
      } else {
        perceptionEl.checked = false;
      }
    }

    // Select option selected state
    if (tag === 'OPTION' || role === 'option') {
      if ('selected' in el) {
        perceptionEl.selected = Boolean((el as unknown as { selected?: boolean }).selected);
      } else if (el.getAttribute('aria-selected') === 'true') {
        perceptionEl.selected = true;
      } else if (el.hasAttribute('selected')) {
        perceptionEl.selected = true;
      }
    }

    // Field value for non-password fields
    if ('value' in el && inputType !== 'password') {
      const val = String((el as unknown as { value?: string }).value || '').trim();
      if (val) perceptionEl.value = val;
    }

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
      const [bx, by, bw, bh] = bbox;
      const bounds: ElementBounds = { x: bx, y: by, width: bw, height: bh };
      const visible = isElementVisible(el, bbox, win);
      const enabled = isElementEnabled(el);
      const role = computeAccessibleRole(el);
      const id = registry.getOrCreateId(el);
      const context = computeNearbyContext(el, doc);

      const perceptionEl: PerceptionElement = {
        id,
        role,
        name: text,
        text,
        bbox,
        bounds,
        visible,
        enabled,
        source: 'dom',
      };
      if (context) perceptionEl.context = context;

      results.push(perceptionEl);
    }
  }

  return results;
}

/**
 * Converts a PerceptionElement to the compact representation required for local page understanding.
 */
export function toCompactElement(el: PerceptionElement): CompactElement {
  const compact: CompactElement = {
    id: el.id,
    role: el.role,
    name: el.name || el.text || '',
    visible: el.visible,
    enabled: el.enabled,
    bounds: el.bounds || {
      x: el.bbox[0],
      y: el.bbox[1],
      width: el.bbox[2],
      height: el.bbox[3],
    },
  };

  const type = el.type || el.inputType;
  if (type) compact.type = type;
  if (el.placeholder) compact.placeholder = el.placeholder;
  if (el.context) compact.context = el.context;
  if (typeof el.checked === 'boolean') compact.checked = el.checked;

  return compact;
}

/**
 * Creates a complete compact structured representation of the page perception.
 */
export function toCompactRepresentation(perception: PagePerception): {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: CompactElement[];
} {
  return {
    url: perception.url,
    title: perception.title,
    viewport: perception.viewport,
    elements: perception.elements.map(toCompactElement),
  };
}
