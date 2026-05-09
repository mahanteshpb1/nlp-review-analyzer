// background.js — Service worker
// Handles extension lifecycle, optional message passing

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ReviewIntel] Extension installed');
});

// Relay messages between content script and popup if needed
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYSIS_COMPLETE') {
    // Could update badge, store results, etc.
    chrome.action.setBadgeText({ text: '✓', tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#4dbe9f' });
  }
  return true;
});
