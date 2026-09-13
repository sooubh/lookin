import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createServer } from '../server/src/index.js';
import { createDemoServer } from '../demo-site/serve.js';
import { detectPIIFromText, detectPIIFromPerceptionElements } from '../dist/extension/src/privacy/pii-detector.js';
import { planTaskRequirements } from '../dist/extension/src/privacy/task-context.js';
import { evaluateBatchPolicy } from '../dist/extension/src/privacy/policy-engine.js';
import { TokenVault } from '../dist/extension/src/privacy/token-vault.js';
import { redactPerceptionElements } from '../dist/extension/src/privacy/redactor.js';
import { assertSafeToTransmit } from '../dist/extension/src/privacy/payload-sanitizer.js';
import { generatePrivacyReceipt } from '../dist/extension/src/privacy/privacy-receipt.js';
import { ActionGuard } from '../dist/extension/src/agent/action-guard.js';
import { BrowserExecutor } from '../dist/extension/src/agent/executor.js';

test('Live E2E: Full pipeline across live Gateway and Demo site', async () => {
  // 1. Launch Gateway Server on dynamic port
  const gatewayServer = createServer();
  await new Promise((resolve) => gatewayServer.listen(0, '127.0.0.1', resolve));
  const gatewayPort = gatewayServer.address().port;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

  // 2. Launch Demo Server on dynamic port
  const demoServer = createDemoServer();
  await new Promise((resolve) => demoServer.listen(0, '127.0.0.1', resolve));
  const demoPort = demoServer.address().port;
  const demoUrl = `http://127.0.0.1:${demoPort}`;

  try {
    // 3. Verify Gateway Health
    const healthRes = await fetch(`${gatewayUrl}/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, 'ok');

    // 4. Fetch Demo Site Form Workflow
    const demoRes = await fetch(`${demoUrl}/index.html`);
    assert.strictEqual(demoRes.status, 200);
    const htmlText = await demoRes.text();
    assert.ok(htmlText.includes('Private Form Assistant'));

    // 5. Simulate Perception on planted demo page elements
    const pageElements = [
      {
        id: 'e1',
        role: 'textbox',
        text: 'Alice Vance',
        name: 'full_name',
        placeholder: 'Full legal name',
        bbox: [200, 150, 300, 40],
        visible: true,
        enabled: true,
        source: 'dom',
      },
      {
        id: 'e2',
        role: 'textbox',
        text: 'alice.vance@privacy-test.corp',
        name: 'email',
        placeholder: 'name@company.com',
        bbox: [200, 210, 300, 40],
        visible: true,
        enabled: true,
        source: 'dom',
      },
      {
        id: 'e3',
        role: 'textbox',
        text: 'SuperSecretAuthPass!2026',
        name: 'password',
        inputType: 'password',
        bbox: [200, 270, 300, 40],
        visible: true,
        enabled: true,
        source: 'dom',
      },
      {
        id: 'e4',
        role: 'button',
        text: 'Submit Application',
        bbox: [200, 350, 150, 45],
        visible: true,
        enabled: true,
        source: 'dom',
      },
    ];

    const perception = {
      viewport: { width: 1280, height: 800 },
      url: `${demoUrl}/index.html`,
      title: 'Demo Form Assistant',
      timestamp: Date.now(),
      elements: pageElements,
    };

    // 6. Plan Task Requirements
    const task = 'Fill the form and submit it';
    const taskReq = planTaskRequirements(task);
    assert.strictEqual(taskReq.intent, 'fill_form');

    // 7. Run Local PII Detection
    const detections = detectPIIFromPerceptionElements(pageElements);
    assert.ok(detections.length >= 2, 'Must detect at least email and password');
    const passEntity = detections.find((d) => d.category === 'password');
    assert.ok(passEntity, 'Password must be detected');
    assert.strictEqual(passEntity.tier, 3, 'Password must be Tier 3 Secret');

    // 8. Run Adaptive Privacy Decisions
    const tokenVault = new TokenVault();
    const decisions = evaluateBatchPolicy(detections, taskReq, tokenVault);

    const passDecision = decisions.find((d) => d.category === 'password');
    assert.strictEqual(passDecision?.decision, 'block', 'Password must be BLOCKED');

    const emailDecision = decisions.find((d) => d.category === 'email');
    assert.strictEqual(emailDecision?.decision, 'tokenize', 'Email must be tokenized');
    assert.ok(emailDecision?.token?.startsWith('[EMAIL_'), 'Token placeholder must be created');

    // 9. Redact Perception Elements
    const redactedElements = redactPerceptionElements(pageElements, detections, decisions);
    const redactedEmail = redactedElements.find((e) => e.id === 'e2');
    assert.strictEqual(redactedEmail?.text, emailDecision?.token);

    // 10. Build Sanitized Context & Local Privacy Receipt
    const receipt = generatePrivacyReceipt(decisions, { localInferenceMs: 15, serverReasoningMs: 0 });
    assert.strictEqual(receipt.rawScreenshotSent, false);
    assert.strictEqual(receipt.rawSecretSent, false);

    const sanitizedPayload = {
      task,
      url: perception.url,
      context: {
        dom: {
          viewport: perception.viewport,
          elements: redactedElements.map((e) => ({
            id: e.id,
            role: e.role,
            text: e.text,
            bbox: e.bbox,
            enabled: e.enabled,
            inputType: e.inputType,
          })),
        },
        safeText: redactedElements.map((e) => e.text).filter(Boolean),
        sanitizedImage: null,
      },
      capabilities: taskReq.allowedActions,
      privacyReceipt: receipt,
    };

    // 11. Pre-fetch leak scan
    assertSafeToTransmit(sanitizedPayload, tokenVault);

    // 12. Post to Live Gateway
    const gatewayRes = await fetch(`${gatewayUrl}/agent/reason`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitizedPayload),
    });

    assert.strictEqual(gatewayRes.status, 200, 'Gateway should successfully respond with 200 OK');
    const plan = await gatewayRes.json();
    assert.ok(Array.isArray(plan.actions), 'Must return array of actions');
    assert.ok(plan.actions.length > 0, 'Must have at least 1 action');

    // 13. Validate through Local Action Guard
    const actionGuard = new ActionGuard();
    const firstAction = plan.actions[0];
    const guardResult = actionGuard.validateAction(firstAction, perception);
    assert.strictEqual(guardResult.allowed, true, 'Vetted action must be allowed by guard');

    // 14. Execute action via BrowserExecutor with Token Resolution
    const executor = new BrowserExecutor(tokenVault, actionGuard);
    // Simulate DOM element for execution
    const mockDoc = {
      getElementById: (id) => ({
        id,
        tagName: 'INPUT',
        type: 'text',
        value: '',
        focus: () => {},
        click: () => {},
        dispatchEvent: () => true,
        setAttribute: () => {},
        getAttribute: () => '',
      }),
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    const execResult = await executor.execute(
      firstAction,
      perception,
      { document: mockDoc, tokenVault }
    );
    assert.strictEqual(execResult.success, true, 'Execution must succeed');

    // 15. Verify token resolution during local DOM write
    const tokenExecResult = await executor.execute(
      {
        type: 'type',
        target: { id: 'e2', role: 'textbox' },
        value: emailDecision.token,
        risk: 'low',
        reason: 'Fill email with token placeholder',
      },
      perception,
      { document: mockDoc, tokenVault }
    );
    assert.strictEqual(tokenExecResult.success, true, 'Tokenized action must execute');
    assert.deepStrictEqual(tokenExecResult.tokensResolved, [emailDecision.token]);
  } finally {
    await Promise.all([
      new Promise((resolve) => {
        gatewayServer.closeAllConnections?.();
        gatewayServer.close(resolve);
      }),
      new Promise((resolve) => {
        demoServer.closeAllConnections?.();
        demoServer.close(resolve);
      }),
    ]);
  }
});
