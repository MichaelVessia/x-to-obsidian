// Background service worker for X to Obsidian extension

const SERVER_URL = "http://localhost:3000";

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SCRAPE_PROGRESS") {
    // Forward to popup (if open)
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, ignore error
    });
    return false;
  }

  if (message.type === "SEND_TO_OBSIDIAN") {
    // Handle fetch in background script (better CORS handling)
    fetch(`${SERVER_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks: [message.bookmark] }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          sendResponse({ success: false, error: errorData.error || `HTTP ${response.status}` });
        } else {
          sendResponse({ success: true });
        }
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message || "Network error" });
      });
    return true; // Keep channel open for async response
  }

  return false;
});

// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("[x-to-obsidian] Extension installed");
});
