// Popup script for X to Obsidian extension
// Now just triggers background script and displays state

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

const serverUrlInput = document.getElementById("serverUrl") as HTMLInputElement;
const unbookmarkCheckbox = document.getElementById("unbookmark") as HTMLInputElement;
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

const updateFromState = (state: ProcessState) => {
  const { currentPhase, totalCount, processedCount, successCount, failedCount, unbookmarkSuccessCount, unbookmarkFailedCount, error } = state;

  // Update button states
  const isProcessing = state.isProcessing;
  scrapeVisibleBtn.disabled = isProcessing;
  scrapeAllBtn.disabled = isProcessing;

  switch (currentPhase) {
    case "idle":
      clearStatus();
      break;

    case "scraping":
      setStatus("Scraping bookmarks...", "info");
      if (totalCount > 0) {
        progressEl.textContent = `Found ${totalCount} bookmarks`;
      }
      break;

    case "sending":
      setStatus(`Sending ${totalCount} bookmarks to server...`, "info");
      progressEl.textContent = `Processed ${processedCount}/${totalCount}`;
      break;

    case "unbookmarking":
      setStatus(`Unbookmarking saved tweets...`, "info");
      progressEl.textContent = `Saved: ${successCount}, Unbookmarked: ${unbookmarkSuccessCount}`;
      break;

    case "complete": {
      let msg = `Done! Saved ${successCount}/${totalCount}`;
      if (failedCount > 0) {
        msg += ` (${failedCount} failed)`;
      }
      if (unbookmarkSuccessCount > 0) {
        msg += `. Unbookmarked: ${unbookmarkSuccessCount}`;
        if (unbookmarkFailedCount > 0) {
          msg += ` (${unbookmarkFailedCount} failed)`;
        }
      }
      setStatus(msg, successCount > 0 ? "success" : "info");
      progressEl.textContent = "";
      break;
    }

    case "error":
      setStatus(`Error: ${error || "Unknown error"}`, "error");
      progressEl.textContent = "";
      break;
  }
};

const startProcessing = async (scrapeAll: boolean) => {
  const isOnBookmarks = await checkBookmarksPage();
  if (!isOnBookmarks) return;

  clearStatus();
  setStatus("Starting...", "info");
  scrapeVisibleBtn.disabled = true;
  scrapeAllBtn.disabled = true;

  // Send message to background script
  chrome.runtime.sendMessage(
    {
      type: "START_PROCESSING",
      scrapeAll,
      unbookmark: unbookmarkCheckbox.checked,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        setStatus(`Error: ${chrome.runtime.lastError.message}`, "error");
        scrapeVisibleBtn.disabled = false;
        scrapeAllBtn.disabled = false;
        return;
      }
      
      if (!response?.success) {
        setStatus(`Error: ${response?.error || "Failed to start"}`, "error");
        scrapeVisibleBtn.disabled = false;
        scrapeAllBtn.disabled = false;
      }
      // State updates will come via PROCESS_STATE messages
    }
  );
};

scrapeVisibleBtn.addEventListener("click", () => startProcessing(false));
scrapeAllBtn.addEventListener("click", () => startProcessing(true));

// Listen for state updates from background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PROCESS_STATE") {
    updateFromState(message.state);
  }

  if (message.type === "SCRAPE_PROGRESS") {
    progressEl.textContent = `Scraped ${message.count} bookmarks so far...`;
  }
});

// Get initial state when popup opens
chrome.runtime.sendMessage({ type: "GET_PROCESS_STATE" }, (state) => {
  if (state && state.currentPhase !== "idle") {
    updateFromState(state);
  }
});
