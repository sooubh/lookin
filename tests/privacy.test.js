import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Ensure compilation is up-to-date if sources changed
const distFile = './dist/extension/src/privacy/index.js';
if (!fs.existsSync(distFile)) {
  execSync('npx tsc', { stdio: 'pipe' });
} else {
  const privacyDir = './extension/src/privacy';
  const latestSrcTime = Math.max(
    ...fs.readdirSync(privacyDir).map((f) => fs.statSync(`${privacyDir}/${f}`).mtimeMs)
  );
  if (fs.statSync(distFile).mtimeMs < latestSrcTime) {
    execSync('npx tsc', { stdio: 'pipe' });
  }
}

const {
  SENSITIVITY_TIERS,
  CATEGORY_TIER_MAP,
  TIER_WEIGHTS,
  getTierForCategory,
  isSecret,
  getCategoryDisplayName,
  validateLuhn,
  validateIBAN,
  validateSSN,
  DETERMINISTIC_RULES,
  detectPIIFromText,
  detectPIIFromDOMAttributes,
  detectPIIFromPerceptionElements,
  computeRiskScore,
  assessEntityRisk,
  getRiskLevel,
  planTaskRequirements,
  isCategoryForbidden,
  isCategoryRequiredForTask,
  UNIVERSAL_FORBIDDEN_CONTEXT,
  evaluatePolicy,
  evaluateBatchPolicy,
  TokenVault,
  SecurityInvariantViolationError,
  redactText,
  generateRedactionBoxes,
  redactPerceptionElements,
  scanPayload,
  assertSafeToTransmit,
  generatePrivacyReceipt,
  assertReceiptInvariants,
  formatReceiptSummary,
} = await import('../dist/extension/src/privacy/index.js');

// ============================================================================
// SUITE 1: Sensitivity Tiers and Categories Specification
// ============================================================================

test('Phase A5/A7: Sensitivity Tiers and Categories Definition', () => {
  // 4 Sensitivity Tiers
  assert.strictEqual(SENSITIVITY_TIERS.PUBLIC, 0);
  assert.strictEqual(SENSITIVITY_TIERS.PERSONAL, 1);
  assert.strictEqual(SENSITIVITY_TIERS.SENSITIVE, 2);
  assert.strictEqual(SENSITIVITY_TIERS.SECRET, 3);

  // Expected 14 categories plus unknown
  const expectedCategories = [
    'name',
    'email',
    'phone',
    'address',
    'username',
    'password',
    'otp',
    'credit_card',
    'bank_account',
    'government_id',
    'face',
    'api_key',
    'private_document',
    'ip_address',
  ];

  for (const cat of expectedCategories) {
    assert.ok(CATEGORY_TIER_MAP[cat] !== undefined, `Category '${cat}' must be mapped`);
    assert.ok(getCategoryDisplayName(cat).length > 0, `Display name for '${cat}' must exist`);
  }

  // Tier 3 Secrets verification
  assert.strictEqual(getTierForCategory('password'), SENSITIVITY_TIERS.SECRET);
  assert.strictEqual(getTierForCategory('otp'), SENSITIVITY_TIERS.SECRET);
  assert.strictEqual(getTierForCategory('api_key'), SENSITIVITY_TIERS.SECRET);
  assert.ok(isSecret('password'));
  assert.ok(isSecret('otp'));
  assert.ok(isSecret('api_key'));
  assert.ok(isSecret(SENSITIVITY_TIERS.SECRET));

  // Non-secrets verification
  assert.ok(!isSecret('email'));
  assert.ok(!isSecret('credit_card'));
  assert.ok(!isSecret(SENSITIVITY_TIERS.PUBLIC));

  // Weights check
  assert.strictEqual(TIER_WEIGHTS[0], 0.0);
  assert.strictEqual(TIER_WEIGHTS[1], 0.4);
  assert.strictEqual(TIER_WEIGHTS[2], 0.75);
  assert.strictEqual(TIER_WEIGHTS[3], 1.0);
});

// ============================================================================
// SUITE 2: Deterministic Regex and Checksum Rules
// ============================================================================

test('Phase A5: Luhn Algorithm for Credit Card Verification', () => {
  // Valid credit card numbers (synthetic test vectors)
  assert.ok(validateLuhn('4532015112830366'), 'Valid Visa number must pass Luhn');
  assert.ok(validateLuhn('4532-0151-1283-0366'), 'Hyphenated Visa must pass Luhn');
  assert.ok(validateLuhn('5425 2334 3010 9903'), 'Spaced MasterCard must pass Luhn');
  assert.ok(validateLuhn('378282246310005'), 'Valid Amex must pass Luhn');

  // Invalid credit card numbers
  assert.ok(!validateLuhn('4532015112830367'), 'Single-digit alteration must fail Luhn');
  assert.ok(!validateLuhn('1234567812345671'), 'Random invalid card must fail Luhn');
  assert.ok(!validateLuhn('abc1234'), 'Non-numeric string must fail Luhn');
  assert.ok(!validateLuhn('123'), 'Too short string must fail Luhn');
});

test('Phase A5: ISO 7064 MOD 97 Checksum for IBAN Verification', () => {
  // Valid IBANs (synthetic test vectors)
  assert.ok(validateIBAN('DE89370400440532013000'), 'Valid German IBAN must pass MOD 97');
  assert.ok(validateIBAN('GB82 WEST 1234 5698 7654 32'), 'Valid UK IBAN with spaces must pass');

  // Invalid IBANs
  assert.ok(!validateIBAN('DE89370400440532013001'), 'Altered check digit must fail MOD 97');
  assert.ok(!validateIBAN('INVALIDIBAN1234'), 'Invalid format must fail');
  assert.ok(!validateIBAN('12345'), 'Short string must fail');
});

test('Phase A5: US SSN Deterministic Verification', () => {
  // Valid SSNs
  assert.ok(validateSSN('123-45-6789'), 'Standard valid SSN must pass');
  assert.ok(validateSSN('456 78 9012'), 'Spaced SSN must pass');

  // Invalid SSNs
  assert.ok(!validateSSN('000-45-6789'), 'Area 000 must fail SSN validation');
  assert.ok(!validateSSN('666-45-6789'), 'Area 666 must fail SSN validation');
  assert.ok(!validateSSN('950-45-6789'), 'Area 900+ must fail SSN validation');
  assert.ok(!validateSSN('123-00-6789'), 'Group 00 must fail SSN validation');
  assert.ok(!validateSSN('123-45-0000'), 'Serial 0000 must fail SSN validation');
  assert.ok(!validateSSN('12345'), 'Wrong length must fail');
});

test('Phase A5: Deterministic Pattern Scanning in Raw Text', () => {
  const sample = `
    User account: alice.wonder@cyber.example.com
    Contact phone: +1 (555) 234-5678
    Client IP: 192.168.1.105
    Payment Card: 4532-0151-1283-0366
    AWS Token: AKIAIOSFODNN7EXAMPLE
    GitHub Auth: ghp_111122223333444455556666777788889999
    Stripe Key: sk_test_51AbcDefGhiJklMnoPqrStuVwXyz1234567890
    JWT Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozGztrpepepepepepepepepepep
    Auth OTP: otp: 748392
    Plain secret: password = superSecretPassword123!
    Private Key:
    -----BEGIN RSA PRIVATE KEY-----
    MIIEowIBAAKCAQEA0Y7
    -----END RSA PRIVATE KEY-----
  `;

  const detections = detectPIIFromText(sample);

  // Verify email detection
  const emailMatch = detections.find((d) => d.category === 'email');
  assert.ok(emailMatch, 'Must detect email address');
  assert.strictEqual(emailMatch.tier, SENSITIVITY_TIERS.PERSONAL);
  assert.strictEqual(emailMatch.text, 'alice.wonder@cyber.example.com');

  // Verify phone detection
  const phoneMatch = detections.find((d) => d.category === 'phone');
  assert.ok(phoneMatch, 'Must detect phone number');
  assert.strictEqual(phoneMatch.tier, SENSITIVITY_TIERS.PERSONAL);

  // Verify IP detection
  const ipMatch = detections.find((d) => d.category === 'ip_address');
  assert.ok(ipMatch, 'Must detect IP address');
  assert.strictEqual(ipMatch.text, '192.168.1.105');

  // Verify credit card detection with Luhn check
  const cardMatch = detections.find((d) => d.category === 'credit_card');
  assert.ok(cardMatch, 'Must detect valid Luhn credit card');
  assert.strictEqual(cardMatch.tier, SENSITIVITY_TIERS.SENSITIVE);

  // Verify AWS API key detection
  const awsMatch = detections.find((d) => d.text === 'AKIAIOSFODNN7EXAMPLE');
  assert.ok(awsMatch, 'Must detect AWS API key');
  assert.strictEqual(awsMatch.tier, SENSITIVITY_TIERS.SECRET);

  // Verify GitHub token detection
  const ghMatch = detections.find((d) => d.text.startsWith('ghp_'));
  assert.ok(ghMatch, 'Must detect GitHub personal access token');
  assert.strictEqual(ghMatch.tier, SENSITIVITY_TIERS.SECRET);

  // Verify Stripe key detection
  const stripeMatch = detections.find((d) => d.text.startsWith('sk_test_'));
  assert.ok(stripeMatch, 'Must detect Stripe key');
  assert.strictEqual(stripeMatch.tier, SENSITIVITY_TIERS.SECRET);

  // Verify JWT token detection
  const jwtMatch = detections.find((d) => d.text.startsWith('eyJhbGci'));
  assert.ok(jwtMatch, 'Must detect JWT token');
  assert.strictEqual(jwtMatch.tier, SENSITIVITY_TIERS.SECRET);

  // Verify OTP detection
  const otpMatch = detections.find((d) => d.category === 'otp');
  assert.ok(otpMatch, 'Must detect OTP code');
  assert.strictEqual(otpMatch.tier, SENSITIVITY_TIERS.SECRET);

  // Verify Password detection
  const pwdMatch = detections.find((d) => d.category === 'password');
  assert.ok(pwdMatch, 'Must detect explicit password');
  assert.strictEqual(pwdMatch.tier, SENSITIVITY_TIERS.SECRET);

  // Verify PEM Private Key detection
  const pemMatch = detections.find((d) => d.text.includes('BEGIN RSA PRIVATE KEY'));
  assert.ok(pemMatch, 'Must detect PEM private key header');
  assert.strictEqual(pemMatch.tier, SENSITIVITY_TIERS.SECRET);
});

// ============================================================================
// SUITE 3: DOM Attribute Inspection & Perception Detection
// ============================================================================

test('Phase A5: DOM Attribute PII Detection', () => {
  // 1. Password input field
  const pwdEntities = detectPIIFromDOMAttributes({
    elementId: 'input-pwd',
    type: 'password',
    name: 'user_password',
    value: 'secret123',
    bbox: [100, 200, 150, 30],
  });
  assert.strictEqual(pwdEntities.length, 1);
  assert.strictEqual(pwdEntities[0].category, 'password');
  assert.strictEqual(pwdEntities[0].tier, SENSITIVITY_TIERS.SECRET);
  assert.strictEqual(pwdEntities[0].confidence, 1.0);
  assert.strictEqual(pwdEntities[0].source, 'dom');

  // 2. Autocomplete attributes
  const otpEntities = detectPIIFromDOMAttributes({
    elementId: 'input-otp',
    type: 'text',
    autocomplete: 'one-time-code',
    placeholder: 'Enter 6-digit code',
  });
  assert.ok(otpEntities.some((e) => e.category === 'otp' && e.tier === SENSITIVITY_TIERS.SECRET));

  const cvvEntities = detectPIIFromDOMAttributes({
    elementId: 'input-cvv',
    autocomplete: 'cc-csc',
    placeholder: 'CVV',
  });
  assert.ok(cvvEntities.some((e) => e.category === 'password' && e.tier === SENSITIVITY_TIERS.SECRET));

  const cardEntities = detectPIIFromDOMAttributes({
    elementId: 'input-card',
    autocomplete: 'cc-number',
  });
  assert.ok(cardEntities.some((e) => e.category === 'credit_card' && e.tier === SENSITIVITY_TIERS.SENSITIVE));

  // 3. Name & ID keywords
  const ssnEntities = detectPIIFromDOMAttributes({
    elementId: 'input-ssn',
    name: 'applicant_ssn',
    ariaLabel: 'Social Security Number',
  });
  assert.ok(ssnEntities.some((e) => e.category === 'government_id'));

  const userEntities = detectPIIFromDOMAttributes({
    elementId: 'input-user',
    name: 'user_login',
    autocomplete: 'username',
  });
  assert.ok(userEntities.some((e) => e.category === 'username' && e.tier === SENSITIVITY_TIERS.PERSONAL));
});

test('Phase A5: Perception Elements Batch Detection', () => {
  const elements = [
    {
      id: 'btn-submit',
      role: 'button',
      text: 'Submit Application',
      bbox: [50, 400, 120, 40],
      visible: true,
      enabled: true,
      source: 'dom',
    },
    {
      id: 'field-email',
      role: 'textbox',
      text: 'test.user@company.com',
      inputType: 'email',
      name: 'user_email',
      bbox: [50, 100, 200, 30],
      visible: true,
      enabled: true,
      source: 'dom',
    },
    {
      id: 'field-pass',
      role: 'textbox',
      text: '',
      inputType: 'password',
      name: 'passwd',
      bbox: [50, 150, 200, 30],
      visible: true,
      enabled: true,
      source: 'dom',
    },
  ];

  const detections = detectPIIFromPerceptionElements(elements);
  assert.strictEqual(detections.length, 2);

  const emailDet = detections.find((d) => d.elementId === 'field-email');
  assert.ok(emailDet);
  assert.strictEqual(emailDet.category, 'email');

  const passDet = detections.find((d) => d.elementId === 'field-pass');
  assert.ok(passDet);
  assert.strictEqual(passDet.category, 'password');
  assert.strictEqual(passDet.tier, SENSITIVITY_TIERS.SECRET);
});

// ============================================================================
// SUITE 4: Risk Engine Calculations
// ============================================================================

test('Phase A7: Engineering Risk Score Calculation', () => {
  // Formula: sensitivity_weight * confidence * exposure_impact

  // Tier 0 (Public): weight 0.0 -> risk 0.0
  const publicScore = computeRiskScore(SENSITIVITY_TIERS.PUBLIC, 0.99, 1.0);
  assert.strictEqual(publicScore, 0.0);

  // Tier 1 (Personal): weight 0.40, confidence 0.95, exposure 1.0 -> 0.38
  const personalScore = computeRiskScore(SENSITIVITY_TIERS.PERSONAL, 0.95, 1.0);
  assert.strictEqual(personalScore, 0.38);

  // Tier 2 (Sensitive): weight 0.75, confidence 0.90, exposure 1.0 -> 0.675
  const sensitiveScore = computeRiskScore(SENSITIVITY_TIERS.SENSITIVE, 0.90, 1.0);
  assert.strictEqual(sensitiveScore, 0.675);

  // Tier 3 (Secret): weight 1.0, confidence 1.0, exposure 1.0 -> 1.0
  const secretScore = computeRiskScore(SENSITIVITY_TIERS.SECRET, 1.0, 1.0);
  assert.strictEqual(secretScore, 1.0);

  // Qualitative Levels
  assert.strictEqual(getRiskLevel(secretScore, SENSITIVITY_TIERS.SECRET), 'critical');
  assert.strictEqual(getRiskLevel(sensitiveScore, SENSITIVITY_TIERS.SENSITIVE), 'high');
  assert.strictEqual(getRiskLevel(personalScore, SENSITIVITY_TIERS.PERSONAL), 'medium');
  assert.strictEqual(getRiskLevel(publicScore, SENSITIVITY_TIERS.PUBLIC), 'low');

  // Full assessment object
  const assessment = assessEntityRisk({
    category: 'password',
    tier: SENSITIVITY_TIERS.SECRET,
    confidence: 0.99,
    source: 'dom',
  });
  assert.strictEqual(assessment.level, 'critical');
  assert.ok(assessment.score >= 0.85);
  assert.ok(assessment.formula.includes('weight'));
});

// ============================================================================
// SUITE 5: Task Context Requirement Planner
// ============================================================================

test('Phase A8: Task-Aware Minimum-Context Planning for Workflows', () => {
  // Workflow 1: "Click the Submit button"
  const clickReq = planTaskRequirements('Click the Submit button');
  assert.strictEqual(clickReq.intent, 'click');
  assert.ok(clickReq.requiredContext.includes('visible_button_text'));
  assert.ok(clickReq.requiredContext.includes('button_position'));
  assert.ok(clickReq.allowedActions.includes('click'));
  assert.ok(isCategoryForbidden('email', clickReq), 'Email must be forbidden for simple click');
  assert.ok(isCategoryForbidden('password', clickReq), 'Password must be forbidden');

  // Workflow 2: "What did I spend this month?"
  const spendReq = planTaskRequirements('What did I spend this month?');
  assert.strictEqual(spendReq.intent, 'analyze_statement');
  assert.ok(spendReq.requiredContext.includes('transactions'));
  assert.ok(spendReq.requiredContext.includes('amounts'));
  assert.ok(spendReq.allowedActions.includes('extract'));
  assert.ok(isCategoryForbidden('bank_account', spendReq), 'Bank account number forbidden');
  assert.ok(isCategoryForbidden('password', spendReq), 'Password forbidden');

  // Workflow 3: "Fill registration form and submit"
  const formReq = planTaskRequirements('Fill registration form and submit');
  assert.strictEqual(formReq.intent, 'fill_form');
  assert.ok(formReq.requiredContext.includes('form_fields'));
  assert.ok(formReq.allowedActions.includes('type'));
  assert.ok(formReq.allowedActions.includes('click'));
  assert.ok(isCategoryRequiredForTask('email', formReq), 'Email required for registration form');
  assert.ok(!isCategoryRequiredForTask('password', formReq), 'Raw password never required for transmission');

  // Invariant across all tasks: Tier 3 secrets are in forbiddenContext
  for (const req of [clickReq, spendReq, formReq]) {
    for (const secretName of UNIVERSAL_FORBIDDEN_CONTEXT) {
      assert.ok(req.forbiddenContext.includes(secretName), `${secretName} must be forbidden`);
    }
  }
});

// ============================================================================
// SUITE 6: Client-Side Local Token Vault
// ============================================================================

test('Phase A9: Local Token Vault Behavior and Security Invariants', () => {
  const vault = new TokenVault();

  // 1. Basic Tokenization
  const emailToken = vault.tokenize('email', 'john.doe@example.com');
  assert.strictEqual(emailToken, '[EMAIL_1]');

  // 2. Deterministic reuse within session
  const repeatedToken = vault.tokenize('email', 'john.doe@example.com');
  assert.strictEqual(repeatedToken, '[EMAIL_1]', 'Same raw value must yield identical token');

  // 3. Sequential numbering for different values
  const secondEmailToken = vault.tokenize('email', 'jane.smith@example.com');
  assert.strictEqual(secondEmailToken, '[EMAIL_2]');

  const personToken = vault.tokenize('name', 'Alice Wonderland');
  assert.strictEqual(personToken, '[PERSON_1]');

  const usernameToken = vault.tokenize('username', 'alice_wonder2026');
  assert.strictEqual(usernameToken, '[USER_1]');

  // 4. Detokenization locally
  assert.strictEqual(vault.detokenize('[EMAIL_1]'), 'john.doe@example.com');
  assert.strictEqual(vault.detokenize('[PERSON_1]'), 'Alice Wonderland');
  assert.strictEqual(vault.detokenize('[USER_1]'), 'alice_wonder2026');
  assert.strictEqual(vault.detokenize('[NON_EXISTENT]'), undefined);

  // 5. Detokenize entire text
  const message = 'Hello [PERSON_1], your email is [EMAIL_1].';
  const detokenized = vault.detokenizeText(message);
  assert.strictEqual(detokenized, 'Hello Alice Wonderland, your email is john.doe@example.com.');

  // 6. Security Invariant: Tier 3 Secrets MUST NOT be tokenized
  assert.throws(
    () => {
      vault.tokenize('password', 'superSecretP@ssword1');
    },
    SecurityInvariantViolationError,
    'Attempting to tokenize password must throw SecurityInvariantViolationError'
  );

  assert.throws(
    () => {
      vault.tokenize('otp', '123456');
    },
    SecurityInvariantViolationError,
    'Attempting to tokenize OTP must throw SecurityInvariantViolationError'
  );

  assert.throws(
    () => {
      vault.tokenize('api_key', 'AKIAIOSFODNN7EXAMPLE');
    },
    SecurityInvariantViolationError,
    'Attempting to tokenize API key must throw SecurityInvariantViolationError'
  );

  // 7. Security Invariant: exportForServer MUST NEVER succeed
  assert.throws(
    () => {
      vault.exportForServer();
    },
    SecurityInvariantViolationError,
    'Exporting token vault mappings to server must throw SecurityInvariantViolationError'
  );
});

// ============================================================================
// SUITE 7: Adaptive Privacy Policy Engine
// ============================================================================

test('Phase A7: Adaptive Privacy Decisions and Fail-Closed Invariants', () => {
  const vault = new TokenVault();

  // Test Case A: Tier 3 Secret (Password) during form fill
  // INVARIANT: Tier 3 is ALWAYS blocked, regardless of task
  const formTask = planTaskRequirements('Fill this form and submit it');
  const passwordEntity = {
    category: 'password',
    tier: SENSITIVITY_TIERS.SECRET,
    text: 'MySecretPassw0rd!',
    confidence: 1.0,
    source: 'dom',
  };

  const passDecision = evaluatePolicy(passwordEntity, formTask, vault);
  assert.strictEqual(passDecision.decision, 'block', 'Passwords must ALWAYS be blocked');
  assert.strictEqual(passDecision.task_required, false);
  assert.ok(passDecision.reason.includes('prohibited'));

  // Test Case B: Task-Required Personal Data (Email in Form Fill) -> Tokenize
  const emailEntity = {
    category: 'email',
    tier: SENSITIVITY_TIERS.PERSONAL,
    text: 'user@test.org',
    confidence: 0.99,
    source: 'regex',
  };

  const emailDecision = evaluatePolicy(emailEntity, formTask, vault);
  assert.strictEqual(emailDecision.decision, 'tokenize');
  assert.strictEqual(emailDecision.task_required, true);
  assert.strictEqual(emailDecision.token, '[EMAIL_1]');

  // Test Case C: Unnecessary Personal Data (Email in Click Task) -> Omit
  const clickTask = planTaskRequirements('Click the Submit button');
  const unneededEmailDecision = evaluatePolicy(emailEntity, clickTask, vault);
  assert.strictEqual(unneededEmailDecision.decision, 'omit');
  assert.strictEqual(unneededEmailDecision.task_required, false);

  // Test Case D: Visual Face Region -> Blur
  const faceEntity = {
    category: 'face',
    tier: SENSITIVITY_TIERS.SENSITIVE,
    confidence: 0.95,
    source: 'visual',
    bbox: [10, 10, 50, 50],
  };
  const faceDecision = evaluatePolicy(faceEntity, clickTask, vault);
  assert.strictEqual(faceDecision.decision, 'blur');

  // Test Case E: Public Button Element -> Allow
  const publicBtnEntity = {
    category: 'unknown',
    tier: SENSITIVITY_TIERS.PUBLIC,
    text: 'Submit',
    confidence: 1.0,
    source: 'dom',
  };
  const btnDecision = evaluatePolicy(publicBtnEntity, clickTask, vault);
  assert.strictEqual(btnDecision.decision, 'allow');
});

// ============================================================================
// SUITE 8: Redaction Engine
// ============================================================================

test('Phase A9: Coordinate-Preserving Redaction and Text Span Replacement', () => {
  const original = 'Please notify Alice at alice@mail.com about card 4532015112830366 and password=secret123';
  const entities = [
    {
      category: 'email',
      tier: SENSITIVITY_TIERS.PERSONAL,
      span: { start: 23, end: 37 }, // 'alice@mail.com'
      text: 'alice@mail.com',
      confidence: 0.99,
      source: 'regex',
    },
    {
      category: 'password',
      tier: SENSITIVITY_TIERS.SECRET,
      span: { start: 70, end: 88 }, // 'password=secret123'
      text: 'password=secret123',
      confidence: 1.0,
      source: 'regex',
    },
  ];

  const decisions = [
    {
      category: 'email',
      tier: SENSITIVITY_TIERS.PERSONAL,
      risk: 0.4,
      confidence: 0.99,
      task_required: true,
      decision: 'tokenize',
      token: '[EMAIL_1]',
      reason: 'Tokenized',
    },
    {
      category: 'password',
      tier: SENSITIVITY_TIERS.SECRET,
      risk: 1.0,
      confidence: 1.0,
      task_required: false,
      decision: 'block',
      reason: 'Blocked',
    },
  ];

  const redactedText = redactText(original, entities, decisions);

  assert.ok(!redactedText.includes('alice@mail.com'), 'Original email must be redacted');
  assert.ok(!redactedText.includes('secret123'), 'Original secret must be redacted');
  assert.ok(redactedText.includes('[EMAIL_1]'), 'Token must be present in redacted text');
  assert.ok(redactedText.includes('[BLOCKED_SECRET]'), 'Secret must be replaced with blocked sentinel');

  // Redaction boxes for visual canvas
  const entitiesWithBoxes = [
    {
      category: 'password',
      tier: SENSITIVITY_TIERS.SECRET,
      confidence: 1.0,
      bbox: [100, 200, 150, 30],
      source: 'dom',
    },
    {
      category: 'face',
      tier: SENSITIVITY_TIERS.SENSITIVE,
      confidence: 0.9,
      bbox: [400, 50, 80, 80],
      source: 'visual',
    },
  ];
  const visualDecisions = [
    {
      category: 'password',
      tier: SENSITIVITY_TIERS.SECRET,
      risk: 1.0,
      confidence: 1.0,
      task_required: false,
      decision: 'block',
      reason: 'Blocked',
    },
    {
      category: 'face',
      tier: SENSITIVITY_TIERS.SENSITIVE,
      risk: 0.7,
      confidence: 0.9,
      task_required: false,
      decision: 'blur',
      reason: 'Blurred',
    },
  ];

  const boxes = generateRedactionBoxes(entitiesWithBoxes, visualDecisions);
  assert.strictEqual(boxes.length, 2);
  assert.strictEqual(boxes[0].action, 'fill_black');
  assert.strictEqual(boxes[1].action, 'blur');
});

// ============================================================================
// SUITE 9: Payload Sanitizer & Pre-Fetch Leak Scanner
// ============================================================================

test('Phase A10: Payload Sanitizer Guard and Fail-Closed Leak Detection', () => {
  const vault = new TokenVault();
  const emailToken = vault.tokenize('email', 'real.user@enterprise.com');
  const nameToken = vault.tokenize('name', 'Bruce Wayne');

  // Test Case 1: Perfectly sanitized payload passes
  const cleanPayload = {
    task: 'Fill contact form',
    safeDom: {
      elements: [
        { id: '1', role: 'button', text: 'Submit', bbox: [10, 10, 50, 30] },
        { id: '2', role: 'textbox', text: emailToken, bbox: [10, 50, 200, 30] },
        { id: '3', role: 'textbox', text: nameToken, bbox: [10, 90, 200, 30] },
      ],
    },
    privacyReceipt: {
      rawScreenshotSent: false,
      rawSecretSent: false,
    },
  };

  const cleanScan = scanPayload(cleanPayload, vault);
  assert.strictEqual(cleanScan.safe, true);
  assert.strictEqual(cleanScan.violations.length, 0);
  assert.doesNotThrow(() => assertSafeToTransmit(cleanPayload, vault));

  // Test Case 2: Leak of raw token-vault value
  const leakingPersonalPayload = {
    task: 'Fill contact form',
    notes: 'Sending user real.user@enterprise.com in plaintext note',
  };
  const personalLeakScan = scanPayload(leakingPersonalPayload, vault);
  assert.strictEqual(personalLeakScan.safe, false);
  assert.ok(personalLeakScan.violations.some((v) => v.includes('Token Vault Leak')));
  assert.throws(
    () => assertSafeToTransmit(leakingPersonalPayload, vault),
    SecurityInvariantViolationError
  );

  // Test Case 3: Leak of raw password
  const leakingPasswordPayload = {
    task: 'Login',
    creds: 'password = dangerousPassword999',
  };
  const pwdLeakScan = scanPayload(leakingPasswordPayload, vault);
  assert.strictEqual(pwdLeakScan.safe, false);
  assert.ok(pwdLeakScan.violations.some((v) => v.includes('Critical Secret Leak')));
  assert.throws(
    () => assertSafeToTransmit(leakingPasswordPayload, vault),
    SecurityInvariantViolationError
  );

  // Test Case 4: Leak of AWS API key
  const leakingAwsPayload = {
    task: 'Deploy',
    env: { AWS_KEY: 'AKIAIOSFODNN7EXAMPLE' },
  };
  const awsLeakScan = scanPayload(leakingAwsPayload, vault);
  assert.strictEqual(awsLeakScan.safe, false);
  assert.ok(awsLeakScan.violations.some((v) => v.includes('sec-aws-access-key')));

  // Test Case 5: Leak of raw token mapping dictionary
  const leakingMappingsPayload = {
    task: 'Submit',
    tokenMappings: {
      '[EMAIL_1]': 'real.user@enterprise.com',
    },
  };
  const mapLeakScan = scanPayload(leakingMappingsPayload, vault);
  assert.strictEqual(mapLeakScan.safe, false);
  assert.ok(mapLeakScan.violations.some((v) => v.includes('token-to-value mapping')));

  // Test Case 6: Attempting to send raw screenshot
  const leakingScreenshotPayload = {
    rawScreenshot: 'data:image/png;base64,RAW_UNSANITIZED_DATA',
    privacyReceipt: {
      rawScreenshotSent: false,
      rawSecretSent: false,
    },
  };
  const ssLeakScan = scanPayload(leakingScreenshotPayload, vault);
  assert.strictEqual(ssLeakScan.safe, false);
  assert.ok(ssLeakScan.violations.some((v) => v.includes('Raw unredacted screenshot')));
});

// ============================================================================
// SUITE 10: Privacy Receipt Generation and Verification
// ============================================================================

test('Phase A10: Local Privacy Receipt Generation and Invariant Verification', () => {
  const decisions = [
    { category: 'password', decision: 'block' },
    { category: 'otp', decision: 'block' },
    { category: 'email', decision: 'tokenize' },
    { category: 'name', decision: 'tokenize' },
    { category: 'phone', decision: 'omit' },
    { category: 'face', decision: 'blur' },
    { category: 'unknown', decision: 'allow' },
  ];

  const receipt = generatePrivacyReceipt(decisions, {
    payloadBytes: 14200,
    localInferenceMs: 82,
    serverReasoningMs: 250,
  });

  assert.strictEqual(receipt.detected, 7);
  assert.strictEqual(receipt.blocked, 2);
  assert.strictEqual(receipt.tokenized, 2);
  assert.strictEqual(receipt.omitted, 1);
  assert.strictEqual(receipt.blurred, 1);
  assert.strictEqual(receipt.allowed, 1);

  // Invariants must be strictly false
  assert.strictEqual(receipt.rawScreenshotSent, false);
  assert.strictEqual(receipt.rawSecretSent, false);

  assert.doesNotThrow(() => assertReceiptInvariants(receipt));

  // Receipt summary formatting
  const summary = formatReceiptSummary(receipt);
  assert.ok(summary.includes('PRIVACY FIREWALL RECEIPT'));
  assert.ok(summary.includes('Raw Screenshot Sent:  NO (PROTECTED)'));
  assert.ok(summary.includes('Raw Secrets Sent:     NO (PROTECTED)'));
  assert.ok(summary.includes('13.9 KB')); // 14200 / 1024 ~ 13.9 KB
});
