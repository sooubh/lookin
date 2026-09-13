/**
 * Chrome MV3 Side Panel Application Logic
 */

import { PageMetadataResponse } from '../common/messages.js';

const workerStatusEl = document.getElementById('worker-status')!;
const elementCountEl = document.getElementById('element-count')!;
const pageTitleEl = document.getElementById('page-title')!;
const pageUrlEl = document.getElementById('page-url')!;
const taskInputEl = document.getElementById('task-input') as HTMLTextAreaElement;
const runTaskBtn = document.getElementById('run-task-btn') as HTMLButtonElement;
const refreshPageBtn = document.getElementById('refresh-page-btn') as HTMLButtonElement;
const actionGuardStatusEl = document.getElementById('action-guard-status')!;

function checkServiceWorkerHealth() {
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

function updatePageMetadata() {
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

runTaskBtn.addEventListener('click', () => {
  const task = taskInputEl.value.trim();
  if (!task) {
    alert('Please enter a user task first.');
    return;
  }

  actionGuardStatusEl.innerHTML = `
    <strong>Task received:</strong> "${task}"<br/>
    <span style="color: #38bdf8;">[Phase A1 Shell Ready]</span> Awaiting perception and privacy pipeline integration.
  `;
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
