/**
 * Chrome MV3 Content Script
 * Responsible for local DOM inspection and returning safe page metadata.
 */

import { PageMetadataResponse, PerceptionResponseMessage } from './common/messages.js';
import { fusePerception } from './perception/fusion.js';
import { BrowserExecutor } from './agent/executor.js';

function getPageMetadata(): Omit<PageMetadataResponse, 'id' | 'timestamp'> {
  const interactiveSelectors = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="textbox"]';
  const interactiveElements = document.querySelectorAll(interactiveSelectors);

  return {
    type: 'PAGE_METADATA_RESPONSE',
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    interactiveCount: interactiveElements.length,
  };
}

// Listen for messages from the background service worker or side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PAGE_METADATA') {
    const meta = getPageMetadata();
    sendResponse({
      ...meta,
      id: message.id,
      timestamp: Date.now(),
    });
    return true;
  }

  if (message.type === 'RUN_PERCEPTION') {
    const perception = fusePerception({ document, window });
    const response: PerceptionResponseMessage = {
      type: 'PERCEPTION_RESPONSE',
      id: message.id,
      perception,
      timestamp: Date.now(),
    };
    sendResponse(response);
    return true;
  }

  if (message.type === 'EXECUTE_ACTION') {
    const perception = fusePerception({ document, window });
    const executor = new BrowserExecutor();
    if (message.tokenMappings) {
      for (const [token, secret] of Object.entries(message.tokenMappings)) {
        executor.getTokenVault().store(token, secret as string);
      }
    }
    executor.execute(message.action, perception, { document, window }, { userConfirmed: message.confirmed })
      .then((res) => {
        sendResponse({
          type: 'ACTION_EXECUTION_RESULT',
          id: message.id,
          success: res.success,
          action: message.action,
          error: res.error,
          timestamp: Date.now(),
        });
      })
      .catch((err) => {
        sendResponse({
          type: 'ACTION_EXECUTION_RESULT',
          id: message.id,
          success: false,
          action: message.action,
          error: err?.message || String(err),
          timestamp: Date.now(),
        });
      });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({
      type: 'PONG',
      id: message.id,
      status: 'healthy',
      details: { url: window.location.href },
      timestamp: Date.now(),
    });
    return true;
  }

  return false;
});
