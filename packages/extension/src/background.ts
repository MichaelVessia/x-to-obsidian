// Background service worker for X to Obsidian extension

// Forward progress messages from content script to popup
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.type === "SCRAPE_PROGRESS") {
    // Forward to popup (if open)
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, ignore error
    });
  }
  return false;
});

// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("[x-to-obsidian] Extension installed");
});
