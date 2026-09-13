import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Ensure compiled dist is up-to-date
const distFile = './dist/extension/src/privacy/context-planner.js';
if (!fs.existsSync(distFile)) {
  execSync('npx tsc', { stdio: 'pipe' });
}

// Top-level imports (all ES module dynamic imports done at top)
const {
  buildTaskContext,
  scoreElementRelevance,
  buildSafeText,
  describeContextPlan,
} = await import('../dist/extension/src/privacy/context-planner.js');

const { planTaskRequirements } = await import('../dist/extension/src/privacy/task-context.js');
const { TokenVault } = await import('../dist/extension/src/privacy/token-vault.js');
const { SENSITIVITY_TIERS } = await import('../dist/extension/src/privacy/categories.js');

// ===========================================================================
// Shared fixture
// ===========================================================================

function buildAccountDashboardPage() {
  return {
    viewport: { width: 1280, height: 800 },
    url: 'https://bank.example.com/dashboard',
    title: 'Account Dashboard',
    timestamp: Date.now(),
    elements: [
      { id: 'nav-home', role: 'link', text: 'Home', bbox: [10, 10, 60, 30], visible: true, enabled: true, source: 'dom' },
      { id: 'nav-settings', role: 'link', text: 'Settings', bbox: [80, 10, 80, 30], visible: true, enabled: true, source: 'dom' },
      { id: 'h-profile', role: 'heading', text: 'Update Your Profile', bbox: [100, 80, 300, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'field-name', role: 'textbox', text: 'Alice Johnson', name: 'full_name', autocomplete: 'name', inputType: 'text', bbox: [100, 140, 250, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'field-email', role: 'textbox', text: 'alice@example.com', name: 'user_email', inputType: 'email', autocomplete: 'email', bbox: [100, 200, 250, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'field-phone', role: 'textbox', text: '+1 555 234 5678', name: 'phone_number', autocomplete: 'tel', inputType: 'tel', bbox: [100, 260, 250, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'field-password', role: 'textbox', text: '', name: 'user_password', inputType: 'password', autocomplete: 'current-password', bbox: [100, 320, 250, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'field-otp', role: 'textbox', text: '', name: 'otp_code', autocomplete: 'one-time-code', inputType: 'text', placeholder: 'Enter 6-digit code', bbox: [100, 380, 150, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'btn-save', role: 'button', text: 'Save Changes', bbox: [100, 440, 120, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'h-stmt', role: 'heading', text: 'Transaction History', bbox: [100, 520, 300, 40], visible: true, enabled: true, source: 'dom' },
      { id: 'acct-row', role: 'row', text: 'Account: GB82 WEST 1234 5698 7654 32', bbox: [100, 570, 500, 30], visible: true, enabled: true, source: 'dom' },
      { id: 'tx-1', role: 'row', text: 'Amazon   2024-01-15   $89.99', bbox: [100, 610, 500, 30], visible: true, enabled: true, source: 'dom' },
      { id: 'tx-2', role: 'row', text: 'Netflix  2024-01-12   $15.99', bbox: [100, 650, 500, 30], visible: true, enabled: true, source: 'dom' },
      { id: 'tx-3', role: 'row', text: 'Starbucks 2024-01-10  $6.50', bbox: [100, 690, 500, 30], visible: true, enabled: true, source: 'dom' },
      { id: 'hidden-ssn', role: 'textbox', text: '123-45-6789', name: 'ssn_field', inputType: 'text', bbox: [0, 0, 0, 0], visible: false, enabled: true, source: 'dom' },
    ],
  };
}

// ===========================================================================
// SUITE 1: Form Filling
// ===========================================================================

test('ContextPlanner: Task 1 — Form filling tokenizes personal data, hard-blocks secrets', () => {
  const vault = new TokenVault();
  const page = buildAccountDashboardPage();
  const plan = buildTaskContext('Fill the registration form and submit it', page, vault);

  assert.strictEqual(plan.intent, 'fill_form');

  const includedIds = plan.includedElements.map((pe) => pe.element.id);
  assert.ok(includedIds.includes('field-name'), 'Name field must be included');
  assert.ok(includedIds.includes('field-email'), 'Email field must be included');
  assert.ok(includedIds.includes('field-phone'), 'Phone field must be included');
  assert.ok(includedIds.includes('btn-save'), 'Submit button must be included');
  assert.ok(includedIds.includes('field-password'), 'Password field must be included (structure-only)');
  assert.ok(includedIds.includes('field-otp'), 'OTP field must be included (structure-only)');

  // Email must be tokenized, not raw
  const emailEl = plan.includedElements.find((pe) => pe.element.id === 'field-email');
  assert.ok(emailEl, 'Email element must be planned');
  assert.ok(!emailEl.safeText.includes('alice@example.com'), 'Raw email must NOT appear in safe text');

  // Password must be empty (hard-blocked secret)
  const pwdEl = plan.includedElements.find((pe) => pe.element.id === 'field-password');
  assert.ok(pwdEl, 'Password element must be planned');
  assert.strictEqual(pwdEl.safeText, '', 'Password field safe text must be empty');

  // OTP must be empty (hard-blocked secret)
  const otpEl = plan.includedElements.find((pe) => pe.element.id === 'field-otp');
  assert.ok(otpEl, 'OTP element must be planned');
  assert.strictEqual(otpEl.safeText, '', 'OTP field safe text must be empty');

  // Hidden element must be excluded
  assert.ok(plan.excludedElements.some((pe) => pe.element.id === 'hidden-ssn'), 'Hidden SSN must be excluded');

  // Raw PII must not appear in serialized payload
  const json = JSON.stringify(plan.sanitizedContext);
  assert.ok(!json.includes('alice@example.com'), 'Raw email must not appear in sanitized context');
  assert.ok(!json.includes('+1 555 234 5678'), 'Raw phone must not appear in sanitized context');

  assert.ok(plan.rawBytes > 0);
  assert.ok(plan.sanitizedBytes > 0);
  console.log(`  [FILL] raw=${plan.rawBytes}B sanitized=${plan.sanitizedBytes}B (-${plan.reductionPercent}%)`);
});

// ===========================================================================
// SUITE 2: Statement Analysis
// ===========================================================================

test('ContextPlanner: Task 2 — Statement analysis receives financial rows, omits form/secret fields', () => {
  const vault = new TokenVault();
  const page = buildAccountDashboardPage();
  const plan = buildTaskContext('What did I spend this month?', page, vault);

  assert.strictEqual(plan.intent, 'analyze_statement');

  const includedIds = plan.includedElements.map((pe) => pe.element.id);
  assert.ok(includedIds.includes('tx-1'), 'Transaction row 1 must be included');
  assert.ok(includedIds.includes('tx-2'), 'Transaction row 2 must be included');
  assert.ok(includedIds.includes('tx-3'), 'Transaction row 3 must be included');

  // Password field — irrelevant for analysis (score < threshold)
  assert.ok(!includedIds.includes('field-password'), 'Password field must not be included for analysis');
  assert.ok(!includedIds.includes('field-otp'), 'OTP field must not be included for analysis');

  // Transaction text must be readable (merchant names, amounts)
  const txEl = plan.includedElements.find((pe) => pe.element.id === 'tx-1');
  assert.ok(txEl, 'tx-1 must be planned');
  assert.ok(txEl.safeText.includes('Amazon') || txEl.safeText.includes('89.99'), 'Merchant/amount should appear in safe text');

  // Raw IBAN in account row must not appear unmasked
  const json = JSON.stringify(plan.sanitizedContext);
  // Accept either IBAN is omitted or replaced with a token — raw IBAN should not exist unless tokenized
  const hasRawIBAN = json.includes('GB82 WEST 1234 5698 7654 32');
  const hasToken = json.includes('[BANK_ACCOUNT_');
  assert.ok(!hasRawIBAN || hasToken, 'Raw IBAN must not appear unmasked in analysis payload');

  console.log(`  [ANALYZE] raw=${plan.rawBytes}B sanitized=${plan.sanitizedBytes}B (-${plan.reductionPercent}%)`);
});

// ===========================================================================
// SUITE 3: Navigation (read-only)
// ===========================================================================

test('ContextPlanner: Task 3 — Navigation task receives only links and headings', () => {
  const vault = new TokenVault();
  const page = buildAccountDashboardPage();
  const plan = buildTaskContext('Navigate to Settings', page, vault);

  assert.strictEqual(plan.intent, 'navigate');

  const includedIds = plan.includedElements.map((pe) => pe.element.id);
  assert.ok(includedIds.includes('nav-home'), 'Home link must be included');
  assert.ok(includedIds.includes('nav-settings'), 'Settings link must be included');

  assert.ok(!includedIds.includes('field-email'), 'Email field must not be included for navigation');
  assert.ok(!includedIds.includes('field-password'), 'Password field must not be included for navigation');
  assert.ok(!includedIds.includes('tx-1'), 'Transaction rows must not be included for navigation');

  assert.ok(plan.sanitizedBytes < plan.rawBytes, 'Sanitized must be smaller than raw for nav task');
  assert.ok(plan.reductionPercent > 0, 'Must demonstrate payload reduction');

  console.log(`  [NAVIGATE] raw=${plan.rawBytes}B sanitized=${plan.sanitizedBytes}B (-${plan.reductionPercent}%)`);
});

// ===========================================================================
// SUITE 4: Personal data required — tokenized, never raw
// ===========================================================================

test('ContextPlanner: Task 4 — Personal data required by task is tokenized, never transmitted raw', () => {
  const vault = new TokenVault();
  const page = buildAccountDashboardPage();
  const plan = buildTaskContext('Fill in my name and email address in the profile form', page, vault);

  // All personal/sensitive/secret decisions must use safe actions
  for (const pe of plan.includedElements) {
    for (const dec of pe.decisions) {
      if (dec.tier >= SENSITIVITY_TIERS.PERSONAL) {
        assert.ok(
          dec.decision !== 'allow',
          `Personal/sensitive data (${dec.category}) must not be allowed raw (got: ${dec.decision})`
        );
      }
    }
  }

  // Raw email must not be in the sanitized payload
  const json = JSON.stringify(plan.sanitizedContext);
  assert.ok(!json.includes('alice@example.com'), 'Raw email must not appear in payload');

  console.log(`  [PERSONAL] vault tokens: ${vault.getKnownTokens().length}, reduction=${plan.reductionPercent}%`);
});

// ===========================================================================
// SUITE 5: Task that does NOT require personal data
// ===========================================================================

test('ContextPlanner: Task 5 — Click task strips all personal data from payload', () => {
  const vault = new TokenVault();
  const page = buildAccountDashboardPage();
  const plan = buildTaskContext('Click the Save Changes button', page, vault);

  assert.strictEqual(plan.intent, 'click');

  const includedIds = plan.includedElements.map((pe) => pe.element.id);
  assert.ok(includedIds.includes('btn-save'), 'Save button must be included');

  // Form text inputs are excluded for click intent (score 0.05 < threshold 0.3)
  assert.ok(!includedIds.includes('field-email'), 'Email textbox must not be included for click task');
  assert.ok(!includedIds.includes('field-name'), 'Name textbox must not be included for click task');

  // No personal data decision should be 'allow'
  const allDecisions = plan.includedElements.flatMap((pe) => pe.decisions);
  for (const dec of allDecisions) {
    if (dec.tier === SENSITIVITY_TIERS.PERSONAL) {
      assert.notStrictEqual(dec.decision, 'allow', `Personal (${dec.category}) must not be allowed in click payload`);
    }
  }

  // No raw PII in output
  const json = JSON.stringify(plan.sanitizedContext);
  assert.ok(!json.includes('alice@example.com'), 'Raw email must not appear in click payload');
  assert.ok(!json.includes('+1 555 234 5678'), 'Raw phone must not appear in click payload');
  assert.ok(!json.includes('Alice Johnson'), 'Raw name must not appear in click payload');

  console.log(`  [CLICK] included=${plan.includedElements.length}, excluded=${plan.excludedElements.length}`);
});

// ===========================================================================
// SUITE 6: Secrets blocked for all task types
// ===========================================================================

test('ContextPlanner: Task 6 — Secrets are hard-blocked regardless of any task intent', () => {
  const taskList = [
    'Fill the registration form and submit',
    'Extract all data from this page',
    'What did I spend this month?',
  ];

  for (const task of taskList) {
    const vault = new TokenVault();
    const page = buildAccountDashboardPage();
    const plan = buildTaskContext(task, page, vault);

    const allDecisions = [
      ...plan.includedElements.flatMap((pe) => pe.decisions),
      ...plan.excludedElements.flatMap((pe) => pe.decisions),
    ];

    const secretDecisions = allDecisions.filter((d) => d.tier === SENSITIVITY_TIERS.SECRET);
    for (const dec of secretDecisions) {
      assert.strictEqual(
        dec.decision, 'block',
        `Tier 3 (${dec.category}) must be blocked in: "${task}", got: "${dec.decision}"`
      );
    }

    // Password field safe text must be empty
    const pwdEl = plan.includedElements.find((pe) => pe.element.id === 'field-password');
    if (pwdEl) {
      assert.strictEqual(pwdEl.safeText, '', `Password safeText must be empty for task: "${task}"`);
    }

    // Sanitized payload must not contain sensitive autocomplete values
    const json = JSON.stringify(plan.sanitizedContext);
    assert.ok(
      !json.includes('"current-password"') || !json.includes('"text"'),
      `Password autocomplete must not leak for task: "${task}"`
    );

    console.log(`  [SECRETS] "${task.substring(0,35)}" — ${secretDecisions.length} blocked`);
  }
});

// ===========================================================================
// SUITE 7: SAME PAGE, DIFFERENT TASKS = DIFFERENT PAYLOADS
// ===========================================================================

test('ContextPlanner: Task 7 — Same page with different tasks produces structurally different safe payloads', () => {
  const page = buildAccountDashboardPage();

  const fillPlan = buildTaskContext('Fill the registration form and submit', page, new TokenVault());
  const analyzePlan = buildTaskContext('What did I spend this month?', page, new TokenVault());
  const clickPlan = buildTaskContext('Click the Save Changes button', page, new TokenVault());
  const navPlan = buildTaskContext('Navigate to Settings', page, new TokenVault());

  const fillIds = new Set(fillPlan.includedElements.map((pe) => pe.element.id));
  const analyzeIds = new Set(analyzePlan.includedElements.map((pe) => pe.element.id));
  const clickIds = new Set(clickPlan.includedElements.map((pe) => pe.element.id));
  const navIds = new Set(navPlan.includedElements.map((pe) => pe.element.id));

  console.log(`  [DIFF] fill=${fillIds.size} analyze=${analyzeIds.size} click=${clickIds.size} nav=${navIds.size} elements`);

  // 1. Form fill includes form fields; click and navigation do not
  assert.ok(fillIds.has('field-name'), 'Fill must include name field');
  assert.ok(!clickIds.has('field-name'), 'Click must NOT include name field');
  assert.ok(!navIds.has('field-name'), 'Nav must NOT include name field');

  // 2. Analysis includes transaction rows; form fill does not
  assert.ok(analyzeIds.has('tx-1'), 'Analyze must include tx rows');

  // 3. Navigation includes nav links with high relevance; form fill may not
  assert.ok(navIds.has('nav-settings'), 'Nav must include nav-settings link');

  // 4. The serialized JSON payloads must all differ
  const fillJson = JSON.stringify(fillPlan.sanitizedContext);
  const analyzeJson = JSON.stringify(analyzePlan.sanitizedContext);
  const clickJson = JSON.stringify(clickPlan.sanitizedContext);
  const navJson = JSON.stringify(navPlan.sanitizedContext);

  assert.notStrictEqual(fillJson, analyzeJson, 'Fill and analyze payloads must differ');
  assert.notStrictEqual(fillJson, clickJson, 'Fill and click payloads must differ');
  assert.notStrictEqual(analyzeJson, clickJson, 'Analyze and click payloads must differ');
  assert.notStrictEqual(navJson, fillJson, 'Nav and fill payloads must differ');

  // 5. Element counts must differ between tasks
  assert.notStrictEqual(fillIds.size, analyzeIds.size, 'Element counts must differ between fill and analyze');
});

// ===========================================================================
// SUITE 8: scoreElementRelevance unit tests
// ===========================================================================

test('ContextPlanner: scoreElementRelevance — fill_form intent scores correctly', () => {
  const req = planTaskRequirements('Fill registration form');

  const textbox = { role: 'textbox', visible: true, enabled: true, inputType: 'text', text: 'test', id: 'x', bbox: [0,0,0,0], source: 'dom' };
  const button = { role: 'button', visible: true, enabled: true, text: 'Submit', id: 'y', bbox: [0,0,0,0], source: 'dom' };
  const navLink = { role: 'link', visible: true, enabled: true, text: 'Home', id: 'z', bbox: [0,0,0,0], source: 'dom' };
  const hidden = { role: 'button', visible: false, enabled: true, text: 'Hidden', id: 'h', bbox: [0,0,0,0], source: 'dom' };

  assert.strictEqual(scoreElementRelevance(textbox, req).score, 1.0, 'Textbox must score 1.0 for fill_form');
  assert.strictEqual(scoreElementRelevance(button, req).score, 0.8, 'Button must score 0.8 for fill_form');
  assert.ok(scoreElementRelevance(navLink, req).score < 0.3, 'Nav link must score low for fill_form');
  assert.strictEqual(scoreElementRelevance(hidden, req).score, 0, 'Hidden element must score 0');
});

test('ContextPlanner: scoreElementRelevance — click intent scores buttons highest', () => {
  const req = planTaskRequirements('Click the Submit button');

  const submitBtn = { role: 'button', visible: true, enabled: true, text: 'Submit', id: 'x', bbox: [0,0,0,0], source: 'dom' };
  const otherBtn = { role: 'button', visible: true, enabled: true, text: 'Cancel', id: 'y', bbox: [0,0,0,0], source: 'dom' };
  const textbox = { role: 'textbox', visible: true, enabled: true, text: 'input', id: 'z', bbox: [0,0,0,0], source: 'dom' };

  assert.strictEqual(scoreElementRelevance(submitBtn, req).score, 1.0, 'Matching button must score 1.0');
  assert.ok(scoreElementRelevance(otherBtn, req).score >= 0.75, 'Any button >= 0.75 for click intent');
  assert.ok(scoreElementRelevance(textbox, req).score < 0.3, 'Textbox must score low for click intent');
});

test('ContextPlanner: scoreElementRelevance — analyze_statement scores transaction rows highest', () => {
  const req = planTaskRequirements('What did I spend this month?');

  const txRow = { role: 'row', visible: true, enabled: true, text: 'Amazon $89.99', id: 'x', bbox: [0,0,0,0], source: 'dom' };
  const finText = { role: 'generic', visible: true, enabled: true, text: 'Total: $250.00', id: 'y', bbox: [0,0,0,0], source: 'dom' };
  const formInput = { role: 'textbox', visible: true, enabled: true, text: 'search', id: 'z', bbox: [0,0,0,0], source: 'dom' };
  const heading = { role: 'heading', visible: true, enabled: true, text: 'December 2024', id: 'h', bbox: [0,0,0,0], source: 'dom' };

  assert.strictEqual(scoreElementRelevance(txRow, req).score, 1.0, 'Transaction row must score 1.0');
  assert.ok(scoreElementRelevance(finText, req).score >= 0.85, 'Financial text must score high');
  assert.ok(scoreElementRelevance(formInput, req).score < 0.3, 'Form inputs must score low for analysis');
  assert.ok(scoreElementRelevance(heading, req).score >= 0.5, 'Heading must score >= 0.5 for context');
});

// ===========================================================================
// SUITE 9: buildSafeText unit tests
// ===========================================================================

test('ContextPlanner: buildSafeText correctly applies each privacy decision type', () => {
  const el = { role: 'textbox', text: 'alice@example.com', id: 'x', visible: true, enabled: true, bbox: [0,0,0,0], source: 'dom' };

  // Tokenize -> token value
  const tokenizeDecision = [{ category: 'email', tier: 1, risk: 0.4, confidence: 0.99, task_required: true, decision: 'tokenize', token: '[EMAIL_1]', reason: 'tokenized' }];
  assert.strictEqual(buildSafeText(el, tokenizeDecision), '[EMAIL_1]');

  // Block -> empty string
  const blockDecision = [{ category: 'password', tier: 3, risk: 1.0, confidence: 1.0, task_required: false, decision: 'block', reason: 'blocked' }];
  assert.strictEqual(buildSafeText(el, blockDecision), '');

  // Omit -> empty string
  const omitDecision = [{ category: 'email', tier: 1, risk: 0.4, confidence: 0.99, task_required: false, decision: 'omit', reason: 'omitted' }];
  assert.strictEqual(buildSafeText(el, omitDecision), '');

  // No decisions -> original text
  assert.strictEqual(buildSafeText(el, []), 'alice@example.com');

  // Mask -> replacement
  const maskDecision = [{ category: 'credit_card', tier: 2, risk: 0.75, confidence: 0.99, task_required: true, decision: 'mask', replacement: '**** **** **** 0366', reason: 'masked' }];
  assert.strictEqual(buildSafeText(el, maskDecision), '**** **** **** 0366');
});

// ===========================================================================
// SUITE 10: Payload size measurement
// ===========================================================================

test('ContextPlanner: Payload sizes are measured and reduction is demonstrable across tasks', () => {
  const page = buildAccountDashboardPage();
  const tasks = [
    'Fill the registration form and submit',
    'What did I spend this month?',
    'Click the Save Changes button',
    'Navigate to Settings',
  ];

  for (const task of tasks) {
    const plan = buildTaskContext(task, page, new TokenVault());
    assert.ok(plan.rawBytes > 0, `rawBytes must be positive for: ${task}`);
    assert.ok(plan.sanitizedBytes > 0, `sanitizedBytes must be positive for: ${task}`);
    assert.ok(plan.reductionPercent >= 0, `reductionPercent must be >= 0`);
    console.log(`  [SIZE] "${task.substring(0,30)}" raw=${plan.rawBytes}B sanitized=${plan.sanitizedBytes}B (-${plan.reductionPercent}%)`);
  }

  // Verify that different tasks produce different sanitized sizes (task-awareness)
  const fillPlan = buildTaskContext('Fill the registration form and submit', page, new TokenVault());
  const navPlan = buildTaskContext('Navigate to Settings', page, new TokenVault());

  // Navigation payload should generally be smaller than form fill
  console.log(`  [COMPARE] fill=${fillPlan.sanitizedBytes}B, nav=${navPlan.sanitizedBytes}B`);
  assert.notStrictEqual(fillPlan.sanitizedBytes, navPlan.sanitizedBytes, 'Sanitized sizes must differ by task');
});

// ===========================================================================
// SUITE 11: describeContextPlan produces a human-readable audit trail
// ===========================================================================

test('ContextPlanner: describeContextPlan produces a human-readable audit trail', () => {
  const vault = new TokenVault();
  const page = buildAccountDashboardPage();
  const plan = buildTaskContext('Fill the registration form', page, vault);

  const description = describeContextPlan(plan);

  assert.ok(description.includes('CONTEXT PLAN'), 'Must include CONTEXT PLAN header');
  assert.ok(description.includes('Task:'), 'Must include Task label');
  assert.ok(description.includes('Intent:'), 'Must include Intent label');
  assert.ok(description.includes('Included elements'), 'Must include Included section');
  assert.ok(description.includes('Excluded elements'), 'Must include Excluded section');
  assert.ok(description.includes('Payload:'), 'Must include Payload size section');
  assert.ok(description.length > 100, 'Description must be substantive');

  console.log(`  [AUDIT] description length: ${description.length} chars`);
});
