import test from 'node:test';
import assert from 'node:assert';

import {
  extractDomElements,
  computeBoundingBox,
  isElementVisible,
  isElementEnabled,
  resetElementIdRegistry,
  getElementByPerceptionId,
  toCompactElement,
  toCompactRepresentation,
} from '../dist/extension/src/perception/dom.js';

import {
  computeAccessibleRole,
  computeAccessibleName,
  computeNearbyContext,
  getFormLabelText,
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

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }

  get ownerDocument() {
    let curr = this;
    while (curr.parentElement) {
      curr = curr.parentElement;
    }
    return curr._document || null;
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
    const subSelectors = selector.split(',').map((s) => s.trim());
    const results = [];
    const seen = new Set();
    const traverse = (node) => {
      for (const child of node.children) {
        for (const sub of subSelectors) {
          if (matchesSelector(child, sub) && !seen.has(child)) {
            results.push(child);
            seen.add(child);
            break;
          }
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
    this.documentElement._document = this;
    this.body = new SyntheticElement('body');
    this.body._document = this;
    this.documentElement.appendChild(this.body);
    this.title = 'Test Synthetic Page';
    this.location = { href: 'https://example.com/test-perception' };
  }

  createElement(tagName, attrs = {}, text = '') {
    const el = new SyntheticElement(tagName, attrs, text);
    el._document = this;
    return el;
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

// ----------------------------------------------------------------------------
// TEST SUITE 7: ACCESSIBILITY NAME PRIORITY HIERARCHY
// ----------------------------------------------------------------------------

test('Accessibility Name Priority: Strict resolution order', () => {
  const doc = new SyntheticDocument();

  // Heading element for aria-labelledby
  const header = doc.createElement('span', { id: 'hdr-label' }, 'Header Reference Label');
  doc.body.appendChild(header);

  // 1. aria-labelledby beats everything (aria-label, associated label, placeholder, title)
  const input1 = doc.createElement('input', {
    id: 'inp-1',
    'aria-labelledby': 'hdr-label',
    'aria-label': 'Ignored Aria Label',
    placeholder: 'Ignored Placeholder',
    title: 'Ignored Title',
  });
  doc.body.appendChild(input1);
  assert.strictEqual(computeAccessibleName(input1, doc), 'Header Reference Label');

  // 2. aria-label beats associated label, placeholder, title
  const labelFor2 = doc.createElement('label', { for: 'inp-2' }, 'Associated Label Text');
  doc.body.appendChild(labelFor2);
  const input2 = doc.createElement('input', {
    id: 'inp-2',
    'aria-label': 'Winning Aria Label',
    placeholder: 'Ignored Placeholder',
    title: 'Ignored Title',
  });
  doc.body.appendChild(input2);
  assert.strictEqual(computeAccessibleName(input2, doc), 'Winning Aria Label');

  // 3. Associated <label for="..."> beats placeholder, title, name
  const labelFor3 = doc.createElement('label', { for: 'inp-3' }, 'Winning Associated Label');
  doc.body.appendChild(labelFor3);
  const input3 = doc.createElement('input', {
    id: 'inp-3',
    placeholder: 'Secondary Placeholder',
    title: 'Secondary Title',
    name: 'tertiaryName',
  });
  doc.body.appendChild(input3);
  assert.strictEqual(computeAccessibleName(input3, doc), 'Winning Associated Label');

  // 4. Enclosing parent <label> beats placeholder and title
  const parentLabel = doc.createElement('label', {}, 'Enclosing Label Text');
  const input4 = doc.createElement('input', {
    type: 'checkbox',
    placeholder: 'Ignored Placeholder',
    title: 'Ignored Title',
  });
  parentLabel.appendChild(input4);
  doc.body.appendChild(parentLabel);
  assert.strictEqual(computeAccessibleName(input4, doc), 'Enclosing Label Text');

  // 5. Sibling <label> for checkboxes/radios
  const input5 = doc.createElement('input', { type: 'checkbox', id: 'inp-5' });
  const siblingLabel = doc.createElement('label', {}, 'Adjacent Sibling Label');
  doc.body.appendChild(input5);
  doc.body.appendChild(siblingLabel);
  assert.strictEqual(computeAccessibleName(input5, doc), 'Adjacent Sibling Label');

  // 6. Placeholder beats title and name when no labels are present
  const input6 = doc.createElement('input', {
    type: 'text',
    placeholder: 'Winning Placeholder',
    title: 'Fallback Title',
    name: 'fallbackName',
  });
  doc.body.appendChild(input6);
  assert.strictEqual(computeAccessibleName(input6, doc), 'Winning Placeholder');

  // 7. Title beats name attribute
  const input7 = doc.createElement('input', {
    type: 'text',
    title: 'Winning Title',
    name: 'fallbackName',
  });
  doc.body.appendChild(input7);
  assert.strictEqual(computeAccessibleName(input7, doc), 'Winning Title');

  // 8. Fallback name attribute
  const input8 = doc.createElement('input', {
    type: 'text',
    name: 'fallbackFieldName',
  });
  doc.body.appendChild(input8);
  assert.strictEqual(computeAccessibleName(input8, doc), 'fallbackFieldName');
});

// ----------------------------------------------------------------------------
// TEST SUITE 8: COMMON INTERACTIVE ELEMENTS & ROLES
// ----------------------------------------------------------------------------

test('Perception DOM: Comprehensive support for common interactive elements', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();

  // 1. Button
  const btn = doc.createElement('button', { id: 'btn-test' }, 'Save Changes');
  btn.setRect(10, 10, 120, 36);
  doc.body.appendChild(btn);

  // 2. Link
  const link = doc.createElement('a', { href: '/dashboard' }, 'Go to Dashboard');
  link.setRect(10, 50, 150, 24);
  doc.body.appendChild(link);

  // 3. Text input with label
  const labelEmail = doc.createElement('label', { for: 'email-in' }, 'Email Address');
  doc.body.appendChild(labelEmail);
  const inputEmail = doc.createElement('input', { id: 'email-in', type: 'email', placeholder: 'user@example.com' });
  inputEmail.setRect(10, 80, 250, 36);
  doc.body.appendChild(inputEmail);

  // 4. Password input
  const inputPass = doc.createElement('input', { id: 'pass-in', type: 'password', 'aria-label': 'Password' });
  inputPass.setRect(10, 120, 250, 36);
  doc.body.appendChild(inputPass);

  // 5. Textarea
  const textarea = doc.createElement('textarea', { id: 'bio-in', placeholder: 'About you' });
  textarea.setRect(10, 160, 300, 80);
  doc.body.appendChild(textarea);

  // 6. Select
  const select = doc.createElement('select', { id: 'role-select', 'aria-label': 'Select Role' });
  select.setRect(10, 250, 180, 36);
  doc.body.appendChild(select);

  // 7. Checkbox (checked)
  const labelTerms = doc.createElement('label', { for: 'terms-check' }, 'Agree to Terms');
  doc.body.appendChild(labelTerms);
  const check = doc.createElement('input', { id: 'terms-check', type: 'checkbox', checked: 'true' });
  check.checked = true;
  check.setRect(10, 300, 20, 20);
  doc.body.appendChild(check);

  // 8. Radio (unchecked)
  const labelRadio = doc.createElement('label', { for: 'radio-opt' }, 'Standard Shipping');
  doc.body.appendChild(labelRadio);
  const radio = doc.createElement('input', { id: 'radio-opt', type: 'radio' });
  radio.checked = false;
  radio.setRect(10, 330, 20, 20);
  doc.body.appendChild(radio);

  const elements = extractDomElements({ document: doc, includeTextBlocks: false });
  assert.strictEqual(elements.length, 8);

  // Button
  assert.strictEqual(elements[0].role, 'button');
  assert.strictEqual(elements[0].name, 'Save Changes');

  // Link
  assert.strictEqual(elements[1].role, 'link');
  assert.strictEqual(elements[1].name, 'Go to Dashboard');

  // Email input
  assert.strictEqual(elements[2].role, 'textbox');
  assert.strictEqual(elements[2].type, 'email');
  assert.strictEqual(elements[2].name, 'Email Address');

  // Password input
  assert.strictEqual(elements[3].role, 'textbox');
  assert.strictEqual(elements[3].type, 'password');
  assert.strictEqual(elements[3].name, 'Password');

  // Textarea
  assert.strictEqual(elements[4].role, 'textbox');
  assert.strictEqual(elements[4].type, 'textarea');
  assert.strictEqual(elements[4].placeholder, 'About you');

  // Select
  assert.strictEqual(elements[5].role, 'combobox');
  assert.strictEqual(elements[5].type, 'select');
  assert.strictEqual(elements[5].name, 'Select Role');

  // Checkbox
  assert.strictEqual(elements[6].role, 'checkbox');
  assert.strictEqual(elements[6].type, 'checkbox');
  assert.strictEqual(elements[6].checked, true);
  assert.strictEqual(elements[6].name, 'Agree to Terms');

  // Radio
  assert.strictEqual(elements[7].role, 'radio');
  assert.strictEqual(elements[7].type, 'radio');
  assert.strictEqual(elements[7].checked, false);
  assert.strictEqual(elements[7].name, 'Standard Shipping');
});

// ----------------------------------------------------------------------------
// TEST SUITE 9: NEARBY SEMANTIC CONTEXT EXTRACTION
// ----------------------------------------------------------------------------

test('Perception DOM: Extracts nearby semantic context from fieldsets and headings', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();

  // Fieldset with legend
  const fieldset = doc.createElement('fieldset');
  const legend = doc.createElement('legend', {}, 'Payment Method');
  fieldset.appendChild(legend);

  const radioCard = doc.createElement('input', { type: 'radio', id: 'pay-card', 'aria-label': 'Credit Card' });
  radioCard.setRect(20, 20, 20, 20);
  fieldset.appendChild(radioCard);
  doc.body.appendChild(fieldset);

  // Section with heading
  const section = doc.createElement('section');
  const h2 = doc.createElement('h2', {}, 'Billing Address');
  section.appendChild(h2);

  const inputStreet = doc.createElement('input', { type: 'text', placeholder: 'Street Address' });
  inputStreet.setRect(20, 60, 200, 35);
  section.appendChild(inputStreet);
  doc.body.appendChild(section);

  const elements = extractDomElements({ document: doc, includeTextBlocks: false });
  assert.strictEqual(elements.length, 2);

  assert.strictEqual(elements[0].context, 'Payment Method');
  assert.strictEqual(elements[1].context, 'Billing Address');
});

// ----------------------------------------------------------------------------
// TEST SUITE 10: DUPLICATE-LOOKING ELEMENTS
// ----------------------------------------------------------------------------

test('Perception DOM: Duplicate-looking elements receive unique stable IDs and distinct bounds', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();

  // Two identical "Delete" buttons in different rows
  const deleteBtnRow1 = doc.createElement('button', { class: 'btn-danger' }, 'Delete');
  deleteBtnRow1.setRect(500, 100, 80, 30);
  doc.body.appendChild(deleteBtnRow1);

  const deleteBtnRow2 = doc.createElement('button', { class: 'btn-danger' }, 'Delete');
  deleteBtnRow2.setRect(500, 150, 80, 30);
  doc.body.appendChild(deleteBtnRow2);

  const elements = extractDomElements({ document: doc, includeTextBlocks: false });
  assert.strictEqual(elements.length, 2);

  // Both have identical text and role
  assert.strictEqual(elements[0].role, 'button');
  assert.strictEqual(elements[1].role, 'button');
  assert.strictEqual(elements[0].name, 'Delete');
  assert.strictEqual(elements[1].name, 'Delete');

  // But strictly distinct unique stable IDs
  assert.notStrictEqual(elements[0].id, elements[1].id);
  assert.deepStrictEqual(elements[0].bounds, { x: 500, y: 100, width: 80, height: 30 });
  assert.deepStrictEqual(elements[1].bounds, { x: 500, y: 150, width: 80, height: 30 });

  // And getElementByPerceptionId resolves each to the exact distinct element
  assert.strictEqual(getElementByPerceptionId(elements[0].id), deleteBtnRow1);
  assert.strictEqual(getElementByPerceptionId(elements[1].id), deleteBtnRow2);
});

// ----------------------------------------------------------------------------
// TEST SUITE 11: COMPACT STRUCTURED PAGE REPRESENTATION
// ----------------------------------------------------------------------------

test('Perception DOM: Produces compact structured representations for agent reasoning', () => {
  resetElementIdRegistry();
  const doc = new SyntheticDocument();
  doc.title = 'User Profile';
  doc.location = { href: 'https://example.com/profile' };

  const inputEmail = doc.createElement('input', {
    type: 'email',
    id: 'user-email',
    placeholder: 'alex@example.com',
    'aria-label': 'Email address',
  });
  inputEmail.setRect(210, 340, 320, 42);
  doc.body.appendChild(inputEmail);

  const pagePerception = fusePerception({ document: doc, viewport: { width: 1280, height: 800 } });
  const compact = toCompactRepresentation(pagePerception);

  assert.strictEqual(compact.url, 'https://example.com/profile');
  assert.strictEqual(compact.title, 'User Profile');
  assert.deepStrictEqual(compact.viewport, { width: 1280, height: 800 });
  assert.strictEqual(compact.elements.length, 1);

  const compactEl = compact.elements[0];
  assert.strictEqual(compactEl.role, 'textbox');
  assert.strictEqual(compactEl.name, 'Email address');
  assert.strictEqual(compactEl.type, 'email');
  assert.strictEqual(compactEl.visible, true);
  assert.strictEqual(compactEl.enabled, true);
  assert.deepStrictEqual(compactEl.bounds, {
    x: 210,
    y: 340,
    width: 320,
    height: 42,
  });
});

