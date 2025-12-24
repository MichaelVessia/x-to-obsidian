// Popup script for X to Obsidian extension

import type { RawBookmark } from "@x-to-obsidian/core";

interface ScrapeResultMessage {
  type: "SCRAPE_RESULT";
  bookmarks: RawBookmark[];
  error?: string;
}

const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
const scrapeVisibleBtn = document.getElementById("scrapeVisible") as HTMLButtonElement;
const scrapeAllBtn = document.getElementById("scrapeAll") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const progressEl = document.getElementById("progress") as HTMLDivElement;
const notOnBookmarksEl = document.getElementById("notOnBookmarks") as HTMLDivElement;

// Load saved server URL
chrome.storage.sync.get(["serverUrl"], (result) => {
  if (result.serverUrl) {
    serverUrlInput.value = result.serverUrl;
  }
});

// Save server URL on change
serverUrlInput.addEventListener("change", () => {
  chrome.storage.sync.set({ serverUrl: serverUrlInput.value });
});

// Check if we're on the bookmarks page
const checkBookmarksPage = async (): Promise<boolean> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isBookmarksPage = tab.url?.includes("/i/bookmarks") || false;
  
  if (!isBookmarksPage) {
    notOnBookmarksEl.classList.remove("hidden");
    scrapeVisibleBtn.disabled = true;
    scrapeAllBtn.disabled = true;
  } else {
    notOnBookmarksEl.classList.add("hidden");
    scrapeVisibleBtn.disabled = false;
    scrapeAllBtn.disabled = false;
  }
  
  return isBookmarksPage;
};

checkBookmarksPage();

const setStatus = (message: string, type: "info" | "success" | "error") => {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
};

const clearStatus = () => {
  statusEl.className = "status hidden";
  progressEl.textContent = "";
};

const sendToServer = async (bookmarks: RawBookmark[]): Promise<void> => {
  const serverUrl = serverUrlInput.value.replace(/\/$/, "");
  
  const response = await fetch(`${serverUrl}/api/bookmarks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bookmarks }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(error.error || `Server returned ${response.status}`);
  }
  
  return response.json();
};

const scrapeAndSend = async (scrapeAll: boolean) => {
  const isOnBookmarks = await checkBookmarksPage();
  if (!isOnBookmarks) return;
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.id) return;
  
  clearStatus();
  setStatus(scrapeAll ? "Scrolling and scraping..." : "Scraping visible bookmarks...", "info");
  
  scrapeVisibleBtn.disabled = true;
  scrapeAllBtn.disabled = true;
  
  try {
    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: scrapeAll ? "SCRAPE_ALL" : "SCRAPE_VISIBLE",
    }) as ScrapeResultMessage;
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    const bookmarks = response.bookmarks;
    
    if (bookmarks.length === 0) {
      setStatus("No bookmarks found on page.", "info");
      return;
    }
    
    setStatus(`Found ${bookmarks.length} bookmarks. Sending to server...`, "info");
    
    await sendToServer(bookmarks);
    
    setStatus(`Successfully processed ${bookmarks.length} bookmarks!`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    
    // Check if content script isn't loaded
    if (message.includes("Receiving end does not exist")) {
      setStatus("Please refresh the bookmarks page and try again.", "error");
    } else {
      setStatus(`Error: ${message}`, "error");
    }
  } finally {
    scrapeVisibleBtn.disabled = false;
    scrapeAllBtn.disabled = false;
  }
};

scrapeVisibleBtn.addEventListener("click", () => scrapeAndSend(false));
scrapeAllBtn.addEventListener("click", () => scrapeAndSend(true));

// Listen for progress updates from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SCRAPE_PROGRESS") {
    progressEl.textContent = `Scraped ${message.count} bookmarks so far...`;
  }
});
