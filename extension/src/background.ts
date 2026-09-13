/**
 * Chrome MV3 Background Service Worker
 * Coordinates message routing, sidepanel behavior, and lifecycle events.
 */

// Configure side panel behavior to open when user clicks extension action icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Failed to set side panel behavior:', error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Privacy Agent] Extension installed successfully. MV3 Service Worker ready.');
});

// Message routing hub
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({
      type: 'PONG',
      id: message.id,
      status: 'healthy',
      details: { serviceWorker: 'active', time: Date.now() },
      timestamp: Date.now(),
    });
    return true;
  }

  // Forward GET_PAGE_METADATA to active tab content script
  if (message.type === 'GET_PAGE_METADATA') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      if (!activeTab?.id) {
        sendResponse({
          type: 'PAGE_METADATA_RESPONSE',
          id: message.id,
          url: '',
          title: 'No active tab',
          viewport: { width: 0, height: 0 },
          interactiveCount: 0,
          timestamp: Date.now(),
        });
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, message, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            type: 'PAGE_METADATA_RESPONSE',
            id: message.id,
            url: activeTab.url || '',
            title: activeTab.title || '',
            viewport: { width: 0, height: 0 },
            interactiveCount: 0,
            timestamp: Date.now(),
          });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // Keep channel open for async response
  }

  return false;
});
