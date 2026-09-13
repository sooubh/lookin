/**
 * Chrome MV3 Side Panel Application Logic
 * End-to-End Orchestration of Perception, Privacy Firewall, and Action Execution.
 */

import { PageMetadataResponse, PerceptionResponseMessage } from '../common/messages.js';
import {
  PagePerception,
  PerceptionElement,
  AgentAction,
  ActionType,
  PrivacyReceipt,
  SanitizedContext,
} from '../common/types.js';
import { planTaskRequirements } from '../privacy/task-context.js';
import { detectPIIFromPerceptionElements } from '../privacy/pii-detector.js';
import { evaluateBatchPolicy } from '../privacy/policy-engine.js';
import { TokenVault } from '../privacy/token-vault.js';
import { redactPerceptionElements } from '../privacy/redactor.js';
import { assertSafeToTransmit } from '../privacy/payload-sanitizer.js';
import { generatePrivacyReceipt } from '../privacy/privacy-receipt.js';
import { buildTaskContext } from '../privacy/context-planner.js';
import { ActionGuard } from '../agent/action-guard.js';

// DOM element references
const workerStatusEl = document.getElementById('worker-status')!;
const elementCountEl = document.getElementById('element-count')!;
const pageTitleEl = document.getElementById('page-title')!;
const pageUrlEl = document.getElementById('page-url')!;
const taskInputEl = document.getElementById('task-input') as HTMLTextAreaElement;
const runTaskBtn = document.getElementById('run-task-btn') as HTMLButtonElement;
const refreshPageBtn = document.getElementById('refresh-page-btn') as HTMLButtonElement;
const actionGuardStatusEl = document.getElementById('action-guard-status')!;

const metricPiiDetectedEl = document.getElementById('metric-pii-detected')!;
const metricBlockedEl = document.getElementById('metric-blocked')!;
const metricTokenizedEl = document.getElementById('metric-tokenized')!;
const metricAllowedEl = document.getElementById('metric-allowed')!;
const metricContextSizeEl = document.getElementById('metric-context-size')!;
const systemStatusBadgeEl = document.getElementById('system-status-badge')!;

// Active session token vault and action guard
const sessionTokenVault = new TokenVault();
const actionGuard = new ActionGuard();

function checkServiceWorkerHealth(): void {
  chrome.runtime.sendMessage({ type: 'PING', id: 'ping-' + Date.now(), timestamp: Date.now() }, (response) => {
    if (chrome.runtime.lastError || !response || response.status !== 'healthy') {
      workerStatusEl.textContent = 'DISCONNECTED';
      workerStatusEl.className = 'stat-val';
      workerStatusEl.style.color = '#ef4444';
    } else {
      workerStatusEl.textContent = 'CONNECTED';
      workerStatusEl.className = 'stat-val safe';
    }
  });
}

function updatePageMetadata(): void {
  chrome.runtime.sendMessage(
    { type: 'GET_PAGE_METADATA', id: 'meta-' + Date.now(), timestamp: Date.now() },
    (response: PageMetadataResponse) => {
      if (chrome.runtime.lastError || !response) {
        pageTitleEl.textContent = 'Unable to query tab';
        pageUrlEl.textContent = '';
        elementCountEl.textContent = '0';
        return;
      }

      pageTitleEl.textContent = response.title || '(No Title)';
      pageUrlEl.textContent = response.url || '';
      elementCountEl.textContent = String(response.interactiveCount || 0);
    }
  );
}

async function runPerception(): Promise<PagePerception> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'RUN_PERCEPTION', id: 'perc-' + Date.now(), timestamp: Date.now() },
      (response: PerceptionResponseMessage) => {
        if (chrome.runtime.lastError || !response?.perception) {
          reject(new Error(chrome.runtime.lastError?.message || 'Failed to extract page perception.'));
        } else {
          resolve(response.perception);
        }
      }
    );
  });
}

async function executeActionInTab(action: AgentAction, confirmed: boolean): Promise<any> {
  // Collect necessary token mappings so content script can resolve them locally
  const tokenMappings: Record<string, string> = {};
  if (action.value) {
    const tokenMatches = action.value.match(/\[[A-Z_]+_\d+\]/g) || [];
    for (const token of tokenMatches) {
      const secret = sessionTokenVault.detokenize(token);
      if (secret) tokenMappings[token] = secret;
    }
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'EXECUTE_ACTION',
        id: 'exec-' + Date.now(),
        action,
        confirmed,
        tokenMappings,
        timestamp: Date.now(),
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      }
    );
  });
}

function buildSanitizedPayload(
  task: string,
  url: string,
  redactedElements: PerceptionElement[],
  viewport: { width: number; height: number },
  capabilities: ActionType[],
  receipt: PrivacyReceipt
): SanitizedContext {
  return {
    task,
    url,
    safeDom: {
      viewport,
      elements: redactedElements.map((el) => ({
        id: el.id,
        role: el.role,
        text: el.text,
        bbox: el.bbox,
        enabled: el.enabled,
        inputType: el.inputType,
      })),
    },
    safeText: redactedElements.filter((el) => el.text).map((el) => el.text),
    sanitizedImage: null,
    capabilities,
    privacyReceipt: receipt,
  };
}

runTaskBtn.addEventListener('click', async () => {
  const task = taskInputEl.value.trim();
  if (!task) {
    alert('Please enter a user task first.');
    return;
  }

  runTaskBtn.disabled = true;
  systemStatusBadgeEl.textContent = 'ANALYZING';
  systemStatusBadgeEl.className = 'badge badge-idle';
  actionGuardStatusEl.innerHTML = `<em>Running local page perception and privacy analysis...</em>`;

  const startTime = Date.now();

  try {
    // 1. Run local page perception
    const perception = await runPerception();

    // 2. Task-Aware Context Planning:
    // Determine required info, evaluate policies, tokenize/block/omit, and build minimum-safe payload
    const planned = buildTaskContext(task, perception, sessionTokenVault);
    const sanitizedPayload = planned.sanitizedContext;
    const receipt = sanitizedPayload.privacyReceipt;
    const localInferenceMs = Date.now() - startTime;

    // Update Live Metrics in Side Panel
    metricPiiDetectedEl.textContent = String(receipt.detected);
    metricBlockedEl.textContent = String(receipt.blocked);
    metricTokenizedEl.textContent = String(receipt.tokenized);
    metricAllowedEl.textContent = String(receipt.allowed);
    metricContextSizeEl.textContent = `${(planned.sanitizedBytes / 1024).toFixed(1)} KB (-${planned.reductionPercent}%)`;

    // 3. Call Node Gateway /agent/reason
    actionGuardStatusEl.innerHTML = `<em>Querying reasoning gateway (sanitized context only)...</em>`;
    const gatewayUrl = 'http://127.0.0.1:3000/agent/reason';

    let gatewayRes: Response;
    try {
      gatewayRes = await fetch(gatewayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          context: {
            dom: sanitizedPayload.safeDom,
            safeText: sanitizedPayload.safeText,
            sanitizedImage: null,
          },
          capabilities: sanitizedPayload.capabilities,
        }),
      });
    } catch (netErr) {
      throw new Error(`Gateway unreachable at ${gatewayUrl}. Please ensure server is running (npm run start:server).`);
    }

    if (!gatewayRes.ok) {
      const errData = await gatewayRes.json().catch(() => ({ error: gatewayRes.statusText }));
      throw new Error(`Gateway returned error (${gatewayRes.status}): ${errData.error || errData.message}`);
    }

    const actionPlan = await gatewayRes.json();
    const serverReasoningMs = Date.now() - startTime - localInferenceMs;
    receipt.serverReasoningMs = serverReasoningMs;

    // 9. Local Action Guard verification
    const actions: AgentAction[] = actionPlan.actions || [];
    if (actions.length === 0) {
      actionGuardStatusEl.innerHTML = `
        <span style="color: #10b981; font-weight: 600;">Task Analysis Complete</span><br/>
        No further browser actions required for this task.
      `;
      systemStatusBadgeEl.textContent = 'READY';
      systemStatusBadgeEl.className = 'badge badge-success';
      return;
    }

    const firstAction = actions[0];
    const guardEval = actionGuard.validateAction(firstAction, perception);

    if (!guardEval.allowed) {
      actionGuardStatusEl.innerHTML = `
        <span style="color: #ef4444; font-weight: 600;">ACTION BLOCKED BY GUARD</span><br/>
        Action: <code>${firstAction.type}</code><br/>
        Reason: ${guardEval.reason}
      `;
      systemStatusBadgeEl.textContent = 'BLOCKED';
      return;
    }

    // Check for high-risk action confirmation
    if (guardEval.requiresConfirmation) {
      systemStatusBadgeEl.textContent = 'CONFIRMATION';
      actionGuardStatusEl.innerHTML = `
        <span style="color: #f59e0b; font-weight: 600;">HIGH-RISK ACTION CONFIRMATION</span><br/>
        Target: <strong>${firstAction.target?.text || firstAction.target?.role || firstAction.type}</strong><br/>
        Reason: ${firstAction.reason}<br/>
        <div style="margin-top: 8px;">
          <button id="confirm-action-btn" style="background: #10b981; margin-right: 6px;">Confirm & Execute</button>
          <button id="cancel-action-btn" style="background: #ef4444;">Cancel</button>
        </div>
      `;

      document.getElementById('confirm-action-btn')?.addEventListener('click', async () => {
        actionGuardStatusEl.innerHTML = `<em>Executing confirmed action...</em>`;
        const result = await executeActionInTab(firstAction, true);
        actionGuardStatusEl.innerHTML = `
          <span style="color: #10b981; font-weight: 600;">EXECUTED ✓</span><br/>
          Action: <code>${firstAction.type}</code> on <strong>${firstAction.target?.text || firstAction.target?.role}</strong><br/>
          Result: ${result.success ? 'Success' : result.error}
        `;
        systemStatusBadgeEl.textContent = 'READY';
        systemStatusBadgeEl.className = 'badge badge-success';
      });

      document.getElementById('cancel-action-btn')?.addEventListener('click', () => {
        actionGuardStatusEl.innerHTML = `<span style="color: #94a3b8;">Action cancelled by user.</span>`;
        systemStatusBadgeEl.textContent = 'READY';
        systemStatusBadgeEl.className = 'badge badge-success';
      });
      return;
    }

    // Auto-allowed low/medium risk action
    actionGuardStatusEl.innerHTML = `<em>Executing verified action: ${firstAction.type}...</em>`;
    const execResult = await executeActionInTab(firstAction, false);

    actionGuardStatusEl.innerHTML = `
      <span style="color: #10b981; font-weight: 600;">VERIFIED & EXECUTED ✓</span><br/>
      Action: <code>${firstAction.type}</code> on <strong>${firstAction.target?.text || firstAction.target?.role || 'viewport'}</strong><br/>
      Result: ${execResult.success ? 'Success' : execResult.error}<br/>
      <small style="color: #94a3b8;">Local: ${localInferenceMs}ms | Gateway: ${serverReasoningMs}ms</small>
    `;
    systemStatusBadgeEl.textContent = 'READY';
    systemStatusBadgeEl.className = 'badge badge-success';
  } catch (err: any) {
    actionGuardStatusEl.innerHTML = `
      <span style="color: #ef4444; font-weight: 600;">ERROR</span><br/>
      ${err.message || String(err)}
    `;
    systemStatusBadgeEl.textContent = 'ERROR';
  } finally {
    runTaskBtn.disabled = false;
  }
});

refreshPageBtn.addEventListener('click', () => {
  checkServiceWorkerHealth();
  updatePageMetadata();
});

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  checkServiceWorkerHealth();
  updatePageMetadata();
});
