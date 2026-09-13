import test from 'node:test';
import assert from 'node:assert';
import { ActionGuard } from '../dist/extension/src/agent/action-guard.js';
import { assertValidActionPlan, validateActionPlan } from '../server/src/schemas/action-plan.js';
import { assertSafeToTransmit as assertPayloadSafe, scanPayload } from '../dist/extension/src/privacy/payload-sanitizer.js';
import { assertSafeToTransmit as assertScreenshotSafe } from '../dist/extension/src/perception/screenshot.js';
import { TokenVault } from '../dist/extension/src/privacy/token-vault.js';
import { detectPIIFromText, detectPIIFromPerceptionElements } from '../dist/extension/src/privacy/pii-detector.js';
import { evaluateBatchPolicy } from '../dist/extension/src/privacy/policy-engine.js';
import { planTaskRequirements } from '../dist/extension/src/privacy/task-context.js';
import { generateRedactionBoxes, redactText } from '../dist/extension/src/privacy/redactor.js';

test('Adversarial 1: Unsanitized Image / Image-embedded PII fails closed', () => {
  // Screenshot module hard guard: raw screenshots are forbidden from transmission
  const rawScreenshot = {
    dataUrl: 'data:image/png;base64,RAW_UNSANITIZED_SCREENSHOT_BYTES',
    width: 1280,
    height: 800,
    timestamp: Date.now(),
    isSanitized: false,
  };

  assert.throws(
    () => {
      assertScreenshotSafe(rawScreenshot);
    },
    /Raw screenshot transmission blocked/,
    'Raw screenshot module must strictly fail closed'
  );

  // Payload sanitizer: payload containing raw secret pattern fails closed
  const vault = new TokenVault();
  const token = vault.tokenize('email', 'secret.alice@example.com');
  const leakingPayload = {
    task: 'Fill form',
    text: 'Leaked raw value: secret.alice@example.com',
  };

  assert.throws(
    () => {
      assertPayloadSafe(leakingPayload, vault);
    },
    /Security Invariant Violation/,
    'Outbound payload containing raw personal data instead of token must fail closed'
  );
});

test('Adversarial 2: Sensitive text split across contiguous elements', () => {
  // GitHub PAT format: ghp_[A-Za-z0-9_]{36}
  const pieces = ['ghp_12345678901234567890', '1234567890123456'];
  const fullText = pieces.join('');
  const detections = detectPIIFromText(fullText);

  assert.ok(detections.length > 0, 'Must detect API key even when assembled from nodes');
  assert.strictEqual(detections[0].tier, 3, 'Must be classified as Tier 3 secret');
  assert.strictEqual(detections[0].category, 'api_key');
});

test('Adversarial 3: Password in visually styled text container', () => {
  const elements = [
    {
      id: 'e1',
      role: 'generic',
      text: 'MyMasterPassword!2026',
      bbox: [100, 100, 200, 30],
      visible: true,
      enabled: true,
      source: 'dom',
      name: 'pwd-display',
    },
  ];

  const detections = detectPIIFromPerceptionElements(elements);
  const passDetections = detections.filter((d) => d.category === 'password');
  assert.ok(passDetections.length > 0, 'Password pattern detected regardless of input type');
  assert.strictEqual(passDetections[0].tier, 3, 'Must be Tier 3 Secret');

  const taskReq = planTaskRequirements('Click submit button');
  const decisions = evaluateBatchPolicy(passDetections, taskReq);
  assert.strictEqual(decisions[0].decision, 'block', 'Passwords must be BLOCKED');
});

test('Adversarial 4: Secret-looking non-secret string (Luhn check verification)', () => {
  // Invalid credit card number (fails Luhn)
  const fakeCardInvalidLuhn = '4000 1234 5678 9010';
  const detections = detectPIIFromText(fakeCardInvalidLuhn);
  const cardDetections = detections.filter((d) => d.category === 'credit_card');
  assert.strictEqual(cardDetections.length, 0, 'Invalid Luhn card number should not generate false positive');

  // Valid Luhn 16-digit card number
  const validLuhnCard = '4532-0151-1283-0366';
  const validDetections = detectPIIFromText(validLuhnCard);
  const validCardDetections = validDetections.filter((d) => d.category === 'credit_card');
  assert.strictEqual(validCardDetections.length, 1, 'Valid Luhn card number must be detected');
});

test('Adversarial 5: Disabled form fields cannot be interacted with', () => {
  const guard = new ActionGuard();
  const perception = {
    viewport: { width: 1280, height: 800 },
    url: 'https://example.com/checkout',
    title: 'Checkout',
    timestamp: Date.now(),
    elements: [
      {
        id: 'e10',
        role: 'button',
        text: 'Pay Now',
        bbox: [500, 600, 120, 40],
        visible: true,
        enabled: false, // DISABLED
        source: 'dom',
      },
    ],
  };

  const action = {
    type: 'click',
    target: { id: 'e10', text: 'Pay Now', role: 'button' },
    risk: 'low',
    reason: 'Click disabled pay button',
  };

  const result = guard.validateAction(action, perception);
  assert.strictEqual(result.allowed, false, 'Action on disabled element must be rejected');
  assert.ok(result.reason.includes('disabled'), 'Reason must mention disabled state');
});

test('Adversarial 6: Hidden DOM elements cannot be targeted', () => {
  const guard = new ActionGuard();
  const perception = {
    viewport: { width: 1280, height: 800 },
    url: 'https://example.com/form',
    title: 'Form',
    timestamp: Date.now(),
    elements: [
      {
        id: 'e20',
        role: 'button',
        text: 'Hidden Submit',
        bbox: [0, 0, 0, 0],
        visible: false, // HIDDEN
        enabled: true,
        source: 'dom',
      },
    ],
  };

  const action = {
    type: 'click',
    target: { id: 'e20', text: 'Hidden Submit' },
    risk: 'low',
    reason: 'Click hidden element',
  };

  const result = guard.validateAction(action, perception);
  assert.strictEqual(result.allowed, false, 'Action on hidden element must be rejected');
  assert.ok(result.reason.includes('not visible'), 'Reason must cite invisible state');
});

test('Adversarial 7: Off-screen coordinates outside viewport are rejected', () => {
  const guard = new ActionGuard();
  const perception = {
    viewport: { width: 1280, height: 800 },
    url: 'https://example.com',
    title: 'Test',
    timestamp: Date.now(),
    elements: [],
  };

  const offScreenAction = {
    type: 'click',
    target: { bbox: [1500, 2000, 50, 50] }, // Beyond 1280x800
    risk: 'low',
    reason: 'Click off-screen coordinates',
  };

  const result = guard.validateAction(offScreenAction, perception);
  assert.strictEqual(result.allowed, false, 'Target outside viewport coordinates must be rejected');
});

test('Adversarial 8: Canvas-rendered sensitive bounding box redaction', () => {
  const secretEntity = {
    category: 'password',
    tier: 3,
    text: 'supersecret',
    bbox: [200, 300, 150, 30],
    confidence: 0.99,
    source: 'dom',
  };

  const decisions = evaluateBatchPolicy([secretEntity], planTaskRequirements('Submit form'));
  const redactionBoxes = generateRedactionBoxes([secretEntity], decisions);

  assert.strictEqual(redactionBoxes.length, 1);
  assert.strictEqual(redactionBoxes[0].action, 'fill_black', 'Secret canvas region must be blacked out');
  assert.deepStrictEqual(redactionBoxes[0].bbox, [200, 300, 150, 30]);
});

test('Adversarial 9: Page state changed (staleness / URL divergence) blocks action', () => {
  const guard = new ActionGuard({ defaultMaxStaleAgeMs: 5000 });
  const stalePerception = {
    viewport: { width: 1280, height: 800 },
    url: 'https://example.com/page1',
    title: 'Page 1',
    timestamp: Date.now() - 40000, // 40s old (exceeds 30s default)
    elements: [
      {
        id: 'e1',
        role: 'button',
        text: 'Continue',
        bbox: [100, 100, 100, 40],
        visible: true,
        enabled: true,
        source: 'dom',
      },
    ],
  };

  const action = {
    type: 'click',
    target: { id: 'e1', text: 'Continue' },
    risk: 'low',
    reason: 'Click continue on stale page',
  };

  const staleResult = guard.validateAction(action, stalePerception, { maxStaleAgeMs: 5000 });
  assert.strictEqual(staleResult.allowed, false, 'Stale perception must reject execution');
  assert.ok(staleResult.reason.includes('stale'), 'Reason must cite staleness');

  // URL divergence
  const currentPerception = {
    ...stalePerception,
    timestamp: Date.now(),
    url: 'https://attacker.com/phishing',
  };

  const divergedResult = guard.validateAction(action, currentPerception, {
    currentUrl: 'https://example.com/page1',
  });
  assert.strictEqual(divergedResult.allowed, false, 'URL mismatch must reject execution');
});

test('Adversarial 10: Malicious model action (eval, script injection, shell) rejected', () => {
  const maliciousPlans = [
    {
      actions: [{ type: 'click', target: { text: 'evil', selector: '<script>alert(1)</script>' }, risk: 'low' }],
    },
    {
      actions: [{ type: 'type', value: 'javascript:alert(document.cookie)', risk: 'low' }],
    },
    {
      actions: [{ type: 'eval', code: 'window.localStorage.clear()', risk: 'low' }],
    },
    {
      actions: [{ type: 'execute_shell', command: 'rm -rf /', risk: 'high' }],
    },
  ];

  for (const plan of maliciousPlans) {
    const validation = validateActionPlan(plan);
    assert.strictEqual(validation.valid, false, `Malicious action must be rejected: ${JSON.stringify(plan)}`);
    assert.throws(
      () => assertValidActionPlan(plan),
      /ActionValidationError/,
      'Must throw ActionValidationError on malicious action'
    );
  }
});
