// Background service worker for X to Obsidian extension
// Handles the full scrape → send → unbookmark flow to ensure data safety

import type { RawBookmark } from "@x-to-obsidian/core";

const DEFAULT_SERVER_URL = "http://localhost:3000";

interface BookmarkResult {
  tweetId: string;
  success: boolean;
  path?: string;
  error?: string;
}

interface ScrapeResult {
  bookmarks: RawBookmark[];
  error?: string | undefined;
}

interface ProcessState {
  isProcessing: boolean;
  totalCount: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  unbookmarkSuccessCount: number;
  unbookmarkFailedCount: number;
  currentPhase: "idle" | "scraping" | "sending" | "unbookmarking" | "complete" | "error";
  error?: string;
}

let processState: ProcessState = {
  isProcessing: false,
  totalCount: 0,
  processedCount: 0,
  successCount: 0,
  failedCount: 0,
  unbookmarkSuccessCount: 0,
  unbookmarkFailedCount: 0,
  currentPhase: "idle",
};

const resetState = () => {
  processState = {
    isProcessing: false,
    totalCount: 0,
    processedCount: 0,
    successCount: 0,
    failedCount: 0,
    unbookmarkSuccessCount: 0,
    unbookmarkFailedCount: 0,
    currentPhase: "idle",
  };
};

const broadcastState = () => {
  chrome.runtime.sendMessage({ type: "PROCESS_STATE", state: processState }).catch(() => {
    // Popup might be closed, ignore
  });
};

const getServerUrl = async (): Promise<string> => {
  const result = await chrome.storage.sync.get(["serverUrl"]);
  return (result.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
};

const sendBookmarksToServer = async (bookmarks: RawBookmark[]): Promise<BookmarkResult[]> => {
  const serverUrl = await getServerUrl();
  
  const response = await fetch(`${serverUrl}/api/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookmarks }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
};

const scrapeFromContentScript = async (
  tabId: number,
  scrapeAll: boolean
): Promise<ScrapeResult> => {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: scrapeAll ? "SCRAPE_ALL" : "SCRAPE_VISIBLE", unbookmark: false },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ bookmarks: [], error: chrome.runtime.lastError.message });
        } else if (response?.error) {
          resolve({ bookmarks: [], error: response.error as string });
        } else {
          resolve({ bookmarks: response?.bookmarks || [] });
        }
      }
    );
  });
};

const unbookmarkTweets = async (
  tabId: number,
  tweetIds: string[]
): Promise<{ success: number; failed: number }> => {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: "UNBOOKMARK_TWEETS", tweetIds },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ success: 0, failed: tweetIds.length });
        } else {
          resolve({
            success: response.success || 0,
            failed: response.failed || 0,
          });
        }
      }
    );
  });
};

const processBookmarks = async (
  tabId: number,
  scrapeAll: boolean,
  shouldUnbookmark: boolean
) => {
  if (processState.isProcessing) {
    console.log("[x-to-obsidian] Already processing, ignoring request");
    return;
  }

  resetState();
  processState.isProcessing = true;
  processState.currentPhase = "scraping";
  broadcastState();

  try {
    // Phase 1: Scrape bookmarks (no unbookmarking yet!)
    console.log("[x-to-obsidian] Phase 1: Scraping bookmarks...");
    const scrapeResult = await scrapeFromContentScript(tabId, scrapeAll);

    if (scrapeResult.error) {
      throw new Error(scrapeResult.error);
    }

    const bookmarks = scrapeResult.bookmarks;
    processState.totalCount = bookmarks.length;
    broadcastState();

    if (bookmarks.length === 0) {
      processState.currentPhase = "complete";
      processState.isProcessing = false;
      broadcastState();
      console.log("[x-to-obsidian] No bookmarks found");
      return;
    }

    console.log(`[x-to-obsidian] Scraped ${bookmarks.length} bookmarks`);

    // Phase 2: Send to server
    processState.currentPhase = "sending";
    broadcastState();
    console.log("[x-to-obsidian] Phase 2: Sending to server...");

    const results = await sendBookmarksToServer(bookmarks);

    // Track which tweets were successfully saved
    const successfulTweetIds: string[] = [];
    for (const result of results) {
      processState.processedCount++;
      if (result.success) {
        processState.successCount++;
        successfulTweetIds.push(result.tweetId);
      } else {
        processState.failedCount++;
        console.warn(`[x-to-obsidian] Failed to save ${result.tweetId}: ${result.error}`);
      }
    }
    broadcastState();

    console.log(
      `[x-to-obsidian] Server saved ${processState.successCount}/${processState.totalCount} bookmarks`
    );

    // Phase 3: Unbookmark ONLY the successfully saved tweets
    if (shouldUnbookmark && successfulTweetIds.length > 0) {
      processState.currentPhase = "unbookmarking";
      broadcastState();
      console.log(
        `[x-to-obsidian] Phase 3: Unbookmarking ${successfulTweetIds.length} tweets...`
      );

      const unbookmarkResult = await unbookmarkTweets(tabId, successfulTweetIds);
      processState.unbookmarkSuccessCount = unbookmarkResult.success;
      processState.unbookmarkFailedCount = unbookmarkResult.failed;
      broadcastState();

      console.log(
        `[x-to-obsidian] Unbookmarked ${unbookmarkResult.success}/${successfulTweetIds.length}`
      );
    }

    // Done!
    processState.currentPhase = "complete";
    processState.isProcessing = false;
    broadcastState();
    console.log("[x-to-obsidian] Processing complete!");
  } catch (error) {
    processState.currentPhase = "error";
    processState.error = error instanceof Error ? error.message : "Unknown error";
    processState.isProcessing = false;
    broadcastState();
    console.error("[x-to-obsidian] Processing failed:", error);
  }
};

// Handle messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Forward scrape progress from content script to popup
  if (message.type === "SCRAPE_PROGRESS") {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  // Inline button: send single tweet to Obsidian
  if (message.type === "SEND_TO_OBSIDIAN") {
    (async () => {
      try {
        const serverUrl = await getServerUrl();
        const response = await fetch(`${serverUrl}/api/bookmarks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookmarks: [message.bookmark] }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          sendResponse({ success: false, error: errorData.error || `HTTP ${response.status}` });
        } else {
          sendResponse({ success: true });
        }
      } catch (error) {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Network error",
        });
      }
    })();
    return true;
  }

  // Popup: start processing bookmarks
  if (message.type === "START_PROCESSING") {
    const { scrapeAll, unbookmark } = message;

    // Get the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ success: false, error: "No active tab" });
        return;
      }

      // Start async processing
      processBookmarks(tab.id, scrapeAll, unbookmark);
      sendResponse({ success: true });
    });

    return true;
  }

  // Popup: get current state
  if (message.type === "GET_PROCESS_STATE") {
    sendResponse(processState);
    return false;
  }

  return false;
});

// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("[x-to-obsidian] Extension installed");
});
