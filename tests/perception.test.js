import test from 'node:test';
import assert from 'node:assert';

import {
  extractDomElements,
  computeBoundingBox,
  isElementVisible,
  isElementEnabled,
  resetElementIdRegistry,
  getElementByPerceptionId,
} from '../dist/extension/src/perception/dom.js';

import {
  computeAccessibleRole,
  computeAccessibleName,
  getAccessibilityInfo,
} from '../dist/extension/src/perception/accessibility.js';

import {
  createInMemoryScreenshot,
  disposeScreenshot,
  assertSafeToTransmit,
} from '../dist/extension/src/perception/screenshot.js';

import { fusePerception } from '../dist/extension/src/perception/fusion.js';

/**
 * Lightweight Synthetic DOM implementation for Node.js test environment.
 * Complies with DOM Level 2/3 interfaces needed for perception extraction.
 */
class SyntheticElement {
  constructor(tagName, attrs = {}, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this._textContent = textContent;
    this.rect = { left: 0, top: 0, width: 100, height: 30 };
    this.disabled = false;
    this.checked = false;
    this.selected = false;

    for (const [key, val] of Object.entries(attrs)) {
      this.setAttribute(key, String(val));
    }
  }

  setAttribute(name, val) {
    this.attributes.set(name.toLowerCase(), String(val));
    if (name.toLowerCase() === 'disabled') {
      this.disabled = true;
    }
    if (name.toLowerCase() === 'checked') {
      this.checked = true;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name.toLowerCase()) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name.toLowerCase());
  }

  removeAttribute(name) {
    this.attributes.delete(name.toLowerCase());
    if (name.toLowerCase() === 'disabled') {
      this.disabled = false;
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setRect(left, top, width, height) {
    this.rect = { left, top, width, height };
  }

  getBoundingClientRect() {
    return {
      left: this.rect.left,
      top: this.rect.top,
      x: this.rect.left,
      y: this.rect.top,
      width: this.rect.width,
      height: this.rect.height,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
    };
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    if (this.children.length > 0) {
      return this.children.map((c) => c.textContent).join(' ');
    }
    return '';
  }

  set textContent(val) {
    this._textContent = val;
    this.children = [];
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matchesSelector(curr, selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

class SyntheticDocument {
  constructor() {
    this.documentElement = new SyntheticElement('html');
    this.body = new SyntheticElement('body');
    this.documentElement.appendChild(this.body);
    this.title = 'Test Synthetic Page';
    this.location = { href: 'https://example.com/test-perception' };
  }

  createElement(tagName, attrs = {}, text = '') {
    return new SyntheticElement(tagName, attrs, text);
  }

  getElementById(id) {
    const traverse = (node) => {
      if (node.getAttribute('id') === id) return node;
      for (const child of node.children) {
        const found = traverse(child);
        if (found) return found;
      }
      return null;
    };
    return traverse(this.documentElement);
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    // Handle comma-separated selectors
    const subSelectors = selector.split(',').map((s) => s.trim());
    const results = [];
    const seen = new Set();

    const traverse = (node) => {
      for (const sub of subSelectors) {
        if (matchesSelector(node, sub) && !seen.has(node)) {
          results.push(node);
          seen.add(node);
        }
      }
      for (const child of node.children) {
        traverse(child);
      }
    };

    traverse(this.documentElement);
    return results;
  }
}

function matchesSelector(el, selector) {
  if (!el || !selector) return false;
  selector = selector.trim();

  // 1. Tag name match (e.g. "button", "h1")
  if (/^[a-zA-Z0-9]+$/.test(selector)) {
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }

  // 2. ID match (e.g. "#submit-btn")
  if (selector.startsWith('#')) {
    return el.getAttribute('id') === selector.slice(1);
  }

  // 3. Class match (e.g. ".btn")
  if (selector.startsWith('.')) {
    const cls = el.getAttribute('class') || '';
    return cls.split(/\s+/).includes(selector.slice(1));
  }

  // 4. Attribute match (e.g. "[role='button']", "[role=\"button\"]", "a[href]", "input:not([type=\"hidden\"])")
  if (selector === 'a[href]') {
    return el.tagName === 'A' && el.hasAttribute('href');
  }

  if (selector === 'input:not([type="hidden"])') {
    return el.tagName === 'INPUT' && el.getAttribute('type') !== 'hidden';
  }

  if (selector === '[tabindex]:not([tabindex="-1"])') {
    return el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1';
  }

  const roleMatch = selector.match(/^\[role=["']?([a-zA-Z0-9_-]+)["']?\]$/);
  if (roleMatch) {
    return el.getAttribute('role') === roleMatch[1];
  }

  const labelForMatch = selector.match(/^label\[for=["']?([^"']+)["']?\]$/);
  if (labelForMatch) {
    return el.tagName === 'LABEL' && el.getAttribute('for') === labelForMatch[1];
  }

  const attrMatch = selector.match(/^\[([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?\]$/);
  if (attrMatch) {
    const [, attrName, attrVal] = attrMatch;
    if (attrVal !== undefined) {
      return el.getAttribute(attrName) === attrVal;
    }
    return el.hasAttribute(attrName);
  }

  return false;
}

// ----------------------------------------------------------------------------
// TEST SUITE 1: DOM ELEMENT EXTRACTION & BOUNDING BOXES
// ----------------------------------------------------------------------------

test('Perception DOM: Extracts interactive and semantic elements with proper bounding boxes', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();

  // Create headings
  const h1 = doc.createElement('h1', {}, 'Welcome to Test Store');
  h1.setRect(20, 20, 400, 40);
  doc.body.appendChild(h1);

  // Create paragraph text
  const p = doc.createElement('p', {}, 'Please enter your shipping address below.');
  p.setRect(20, 70, 500, 24);
  doc.body.appendChild(p);

  // Form inputs
  const inputEmail = doc.createElement('input', {
    type: 'email',
    name: 'emailAddress',
    placeholder: 'user@example.com',
    id: 'email-field',
  });
  inputEmail.setRect(20, 100, 250, 35);
  doc.body.appendChild(inputEmail);

  const inputPass = doc.createElement('input', {
    type: 'password',
    name: 'userPassword',
    id: 'pass-field',
    autocomplete: 'current-password',
  });
  inputPass.setRect(20, 150, 250, 35);
  doc.body.appendChild(inputPass);

  // Select dropdown
  const select = doc.createElement('select', { name: 'country', id: 'country-select' });
  select.setRect(20, 200, 200, 35);
  doc.body.appendChild(select);

  // Textarea
  const textarea = doc.createElement('textarea', { name: 'notes', placeholder: 'Delivery instructions' });
  textarea.setRect(20, 250, 400, 80);
  doc.body.appendChild(textarea);

  // Buttons
  const submitBtn = doc.createElement('button', { id: 'submit-btn' }, 'Complete Order');
  submitBtn.setRect(20, 350, 160, 45);
  doc.body.appendChild(submitBtn);

  // Link
  const privacyLink = doc.createElement('a', { href: '/privacy' }, 'Privacy Policy');
  privacyLink.setRect(200, 360, 100, 25);
  doc.body.appendChild(privacyLink);

  const elements = extractDomElements({ document: doc });

  assert.ok(elements.length >= 7, `Expected at least 7 extracted elements, got ${elements.length}`);

  // Find submit button
  const foundBtn = elements.find((el) => el.text === 'Complete Order');
  assert.ok(foundBtn, 'Submit button must be extracted');
  assert.strictEqual(foundBtn.role, 'button');
  assert.strictEqual(foundBtn.source, 'dom');
  assert.strictEqual(foundBtn.visible, true);
  assert.strictEqual(foundBtn.enabled, true);
  assert.deepStrictEqual(foundBtn.bbox, [20, 350, 160, 45], 'Bbox must match [x, y, width, height] relative to viewport');

  // Find email input
  const foundEmail = elements.find((el) => el.inputType === 'email');
  assert.ok(foundEmail, 'Email input must be extracted');
  assert.strictEqual(foundEmail.role, 'textbox');
  assert.strictEqual(foundEmail.name, 'emailAddress');
  assert.strictEqual(foundEmail.placeholder, 'user@example.com');
  assert.deepStrictEqual(foundEmail.bbox, [20, 100, 250, 35]);

  // Find password input
  const foundPass = elements.find((el) => el.inputType === 'password');
  assert.ok(foundPass, 'Password input must be extracted');
  assert.strictEqual(foundPass.autocomplete, 'current-password');

  // Find heading
  const foundHeading = elements.find((el) => el.role === 'heading');
  assert.ok(foundHeading, 'Heading must be extracted');
  assert.strictEqual(foundHeading.text, 'Welcome to Test Store');

  // Find link
  const foundLink = elements.find((el) => el.role === 'link');
  assert.ok(foundLink, 'Link must be extracted');
  assert.strictEqual(foundLink.text, 'Privacy Policy');
});

// ----------------------------------------------------------------------------
// TEST SUITE 2: ID STABILITY
// ----------------------------------------------------------------------------

test('Perception DOM: Element IDs remain completely stable across multiple extractions', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();

  const btn1 = doc.createElement('button', {}, 'Button Alpha');
  btn1.setRect(10, 10, 80, 30);
  doc.body.appendChild(btn1);

  const btn2 = doc.createElement('button', {}, 'Button Beta');
  btn2.setRect(10, 50, 80, 30);
  doc.body.appendChild(btn2);

  const run1 = extractDomElements({ document: doc });
  assert.strictEqual(run1.length, 2);
  const id1Alpha = run1[0].id;
  const id1Beta = run1[1].id;

  assert.ok(id1Alpha.startsWith('e'), 'IDs should have e-prefix (e.g. e1)');
  assert.ok(id1Beta.startsWith('e'), 'IDs should have e-prefix (e.g. e2)');
  assert.notStrictEqual(id1Alpha, id1Beta, 'Unique elements must have distinct IDs');

  // Second extraction pass on same document
  const run2 = extractDomElements({ document: doc });
  assert.strictEqual(run2.length, 2);
  assert.strictEqual(run2[0].id, id1Alpha, 'Re-extracted element must maintain exact same stable ID');
  assert.strictEqual(run2[1].id, id1Beta, 'Re-extracted element must maintain exact same stable ID');

  // Query element by perception ID
  const retrievedEl = getElementByPerceptionId(id1Alpha);
  assert.strictEqual(retrievedEl, btn1, 'Registry must retrieve original element by perception ID');
});

// ----------------------------------------------------------------------------
// TEST SUITE 3: DISABLED & INVISIBLE ELEMENT HANDLING
// ----------------------------------------------------------------------------

test('Perception DOM: Correctly identifies enabled/disabled and visible/hidden elements', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();

  // 1. Normal enabled button
  const enabledBtn = doc.createElement('button', {}, 'Enabled');
  enabledBtn.setRect(10, 10, 100, 30);
  doc.body.appendChild(enabledBtn);

  // 2. Disabled attribute button
  const disabledBtn = doc.createElement('button', { disabled: 'true' }, 'Disabled 1');
  disabledBtn.setRect(10, 50, 100, 30);
  doc.body.appendChild(disabledBtn);

  // 3. aria-disabled button
  const ariaDisabledBtn = doc.createElement('button', { 'aria-disabled': 'true' }, 'Disabled 2');
  ariaDisabledBtn.setRect(10, 90, 100, 30);
  doc.body.appendChild(ariaDisabledBtn);

  // 4. Hidden element via hidden attribute
  const hiddenBtn = doc.createElement('button', { hidden: 'true' }, 'Hidden 1');
  hiddenBtn.setRect(10, 130, 100, 30);
  doc.body.appendChild(hiddenBtn);

  // 5. Hidden element via aria-hidden="true"
  const ariaHiddenBtn = doc.createElement('button', { 'aria-hidden': 'true' }, 'Hidden 2');
  ariaHiddenBtn.setRect(10, 170, 100, 30);
  doc.body.appendChild(ariaHiddenBtn);

  // 6. Zero-dimension element (collapsed)
  const zeroSizeBtn = doc.createElement('button', {}, 'Zero Size');
  zeroSizeBtn.setRect(10, 210, 0, 0);
  doc.body.appendChild(zeroSizeBtn);

  const elements = extractDomElements({ document: doc });

  const elEnabled = elements.find((e) => e.text === 'Enabled');
  assert.ok(elEnabled);
  assert.strictEqual(elEnabled.enabled, true);
  assert.strictEqual(elEnabled.visible, true);

  const elDisabled = elements.find((e) => e.text === 'Disabled 1');
  assert.ok(elDisabled);
  assert.strictEqual(elDisabled.enabled, false);

  const elAriaDisabled = elements.find((e) => e.text === 'Disabled 2');
  assert.ok(elAriaDisabled);
  assert.strictEqual(elAriaDisabled.enabled, false);

  const elHidden = elements.find((e) => e.text === 'Hidden 1');
  assert.ok(elHidden);
  assert.strictEqual(elHidden.visible, false);

  const elAriaHidden = elements.find((e) => e.text === 'Hidden 2');
  assert.ok(elAriaHidden);
  assert.strictEqual(elAriaHidden.visible, false);

  const elZeroSize = elements.find((e) => e.text === 'Zero Size');
  assert.ok(elZeroSize);
  assert.strictEqual(elZeroSize.visible, false);
});

// ----------------------------------------------------------------------------
// TEST SUITE 4: ACCESSIBILITY COMPUTATION & LABEL RESOLUTION
// ----------------------------------------------------------------------------

test('Accessibility: Computes roles and names according to AccName hierarchy', () => {
  const doc = new SyntheticDocument();

  // Test 1: aria-labelledby overrides all
  const labelTarget = doc.createElement('span', { id: 'header-label' }, 'Profile Settings');
  doc.body.appendChild(labelTarget);
  const sectionBtn = doc.createElement('button', { 'aria-labelledby': 'header-label' }, 'Fallback');
  doc.body.appendChild(sectionBtn);
  assert.strictEqual(computeAccessibleName(sectionBtn, doc), 'Profile Settings');

  // Test 2: aria-label overrides inner text
  const iconBtn = doc.createElement('button', { 'aria-label': 'Close Dialog' }, 'X');
  assert.strictEqual(computeAccessibleName(iconBtn, doc), 'Close Dialog');

  // Test 3: <label for="id"> associated form control
  const formInput = doc.createElement('input', { id: 'first-name-input', type: 'text' });
  const explicitLabel = doc.createElement('label', { for: 'first-name-input' }, 'First Name');
  doc.body.appendChild(explicitLabel);
  doc.body.appendChild(formInput);
  assert.strictEqual(computeAccessibleName(formInput, doc), 'First Name');

  // Test 4: Enclosing <label>
  const enclosingLabel = doc.createElement('label', {}, 'Agree to terms');
  const checkbox = doc.createElement('input', { type: 'checkbox' });
  enclosingLabel.appendChild(checkbox);
  doc.body.appendChild(enclosingLabel);
  assert.strictEqual(computeAccessibleName(checkbox, doc), 'Agree to terms');

  // Test 5: Submit input value
  const submitInput = doc.createElement('input', { type: 'submit', value: 'Log In Now' });
  assert.strictEqual(computeAccessibleName(submitInput, doc), 'Log In Now');

  // Test 6: Image alt
  const img = doc.createElement('img', { alt: 'Company Logo' });
  assert.strictEqual(computeAccessibleName(img, doc), 'Company Logo');

  // Test 7: Placeholder fallback
  const searchInput = doc.createElement('input', { type: 'search', placeholder: 'Search products...' });
  assert.strictEqual(computeAccessibleName(searchInput, doc), 'Search products...');
});

test('Accessibility: Resolves ARIA state and attributes accurately', () => {
  const el = new SyntheticElement('button', {
    'aria-expanded': 'true',
    'aria-checked': 'false',
    'aria-required': 'true',
    'aria-invalid': 'true',
    'aria-level': '2',
    disabled: 'true',
  }, 'Expandable Filter');

  const info = getAccessibilityInfo(el);
  assert.strictEqual(info.role, 'button');
  assert.strictEqual(info.name, 'Expandable Filter');
  assert.strictEqual(info.disabled, true);
  assert.strictEqual(info.expanded, true);
  assert.strictEqual(info.checked, false);
  assert.strictEqual(info.required, true);
  assert.strictEqual(info.invalid, true);
  assert.strictEqual(info.headingLevel, 2);
});

// ----------------------------------------------------------------------------
// TEST SUITE 5: SCREENSHOT MODULE & FAIL-CLOSED SECURITY GUARD
// ----------------------------------------------------------------------------

test('Screenshot Module: In-memory capture initializes without disk persistence', () => {
  const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const screenshot = createInMemoryScreenshot(fakeDataUrl, 1920, 1080);

  assert.strictEqual(screenshot.width, 1920);
  assert.strictEqual(screenshot.height, 1080);
  assert.strictEqual(screenshot.isSanitized, false, 'Raw screenshot must have isSanitized = false');
  assert.ok(screenshot.timestamp > 0);
  assert.strictEqual(screenshot.dataUrl, fakeDataUrl);

  // Test disposal wipes buffer from memory
  disposeScreenshot(screenshot);
  assert.strictEqual(screenshot.dataUrl, '', 'Disposed screenshot must wipe memory dataUrl');
});

test('Screenshot Security Guard: assertSafeToTransmit strictly throws for raw screenshots and payloads', () => {
  const rawScreenshot = createInMemoryScreenshot('data:image/png;base64,rawdata123', 800, 600);

  // 1. Raw screenshot object must fail closed
  assert.throws(
    () => {
      assertSafeToTransmit(rawScreenshot);
    },
    /\[Security Violation\] Raw screenshot transmission blocked: Image is not sanitized/,
    'Must fail closed when raw screenshot is passed'
  );

  // 2. Direct string (data URL) must fail closed
  assert.throws(
    () => {
      assertSafeToTransmit('data:image/png;base64,rawdata123');
    },
    /\[Security Violation\] Transmission of raw image string is strictly forbidden/,
    'Must fail closed when direct raw image string is passed'
  );

  // 3. Object with isSanitized: true but missing proof must fail closed
  assert.throws(
    () => {
      assertSafeToTransmit({
        dataUrl: 'data:image/png;base64,fakedata',
        isSanitized: true,
      });
    },
    /\[Security Violation\] Sanitized image lacks valid sanitization proof/,
    'Must fail closed if sanitization proof is missing'
  );

  // 4. Object with invalid/incomplete proof must fail closed
  assert.throws(
    () => {
      assertSafeToTransmit({
        dataUrl: 'data:image/png;base64,fakedata',
        isSanitized: true,
        sanitizationProof: {},
      });
    },
    /\[Security Violation\] Incomplete sanitization proof/,
    'Must fail closed if proof is incomplete'
  );

  // 5. Null or undefined payload must fail closed
  assert.throws(
    () => {
      assertSafeToTransmit(null);
    },
    /\[Security Violation\] Transmission guard failed: No image payload provided/,
    'Must fail closed on null payload'
  );

  // 6. Valid sanitized screenshot with complete proof must pass without error
  const validSanitized = {
    dataUrl: 'data:image/png;base64,redacted_image_data',
    width: 1280,
    height: 720,
    timestamp: Date.now(),
    isSanitized: true,
    sanitizationProof: {
      appliedMasksCount: 3,
      sanitizedAt: Date.now(),
      proofHash: 'sha256-mock-hash-12345',
    },
  };

  assert.doesNotThrow(() => {
    assertSafeToTransmit(validSanitized);
  }, 'Sanitized screenshot with valid proof must pass guard check');
});

// ----------------------------------------------------------------------------
// TEST SUITE 6: PERCEPTION FUSION
// ----------------------------------------------------------------------------

test('Perception Fusion: Produces valid structured PagePerception in reading order', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();
  doc.title = 'Checkout Confirmation';
  doc.location = { href: 'https://store.example.com/checkout' };

  // Bottom element added first
  const payBtn = doc.createElement('button', {}, 'Pay Now');
  payBtn.setRect(50, 400, 120, 40);
  doc.body.appendChild(payBtn);

  // Top header added second
  const header = doc.createElement('h1', {}, 'Order Summary');
  header.setRect(50, 50, 300, 35);
  doc.body.appendChild(header);

  // Middle input added third
  const promoInput = doc.createElement('input', { placeholder: 'Promo Code' });
  promoInput.setRect(50, 200, 200, 35);
  doc.body.appendChild(promoInput);

  const pagePerception = fusePerception({
    document: doc,
    viewport: { width: 1440, height: 900 },
  });

  // Verify structure adheres strictly to PagePerception type
  assert.strictEqual(pagePerception.title, 'Checkout Confirmation');
  assert.strictEqual(pagePerception.url, 'https://store.example.com/checkout');
  assert.deepStrictEqual(pagePerception.viewport, { width: 1440, height: 900 });
  assert.ok(pagePerception.timestamp > 0);
  assert.strictEqual(pagePerception.elements.length, 3);

  // Verify elements are sorted in natural reading order (header at top, input in middle, button at bottom)
  assert.strictEqual(pagePerception.elements[0].role, 'heading');
  assert.strictEqual(pagePerception.elements[0].text, 'Order Summary');

  assert.strictEqual(pagePerception.elements[1].role, 'textbox');
  assert.strictEqual(pagePerception.elements[1].placeholder, 'Promo Code');

  assert.strictEqual(pagePerception.elements[2].role, 'button');
  assert.strictEqual(pagePerception.elements[2].text, 'Pay Now');
});
