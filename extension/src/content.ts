/**
 * Chrome MV3 Content Script
 * Responsible for local DOM inspection and returning safe page metadata.
 */

import { PageMetadataResponse } from './common/messages.js';

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
