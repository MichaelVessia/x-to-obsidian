// Content script for scraping X/Twitter bookmarks
// Injected into x.com pages

import type { RawBookmark, Media, Link } from "@x-to-obsidian/core";

// Selectors - X changes these frequently, may need updates
const SELECTORS = {
  // Main tweet article container
  tweet: 'article[data-testid="tweet"]',
  // Tweet text content
  tweetText: '[data-testid="tweetText"]',
  // Author info
  userAvatar: '[data-testid="Tweet-User-Avatar"]',
  userName: '[data-testid="User-Name"]',
  // Time element contains the link to the tweet
  time: "time",
  // Media
  tweetPhoto: '[data-testid="tweetPhoto"]',
  videoPlayer: '[data-testid="videoPlayer"]',
  // Quoted tweet
  quoteTweet: '[data-testid="quoteTweet"]',
  // Links in tweet
  cardWrapper: '[data-testid="card.wrapper"]',
  // Bookmark button (for unbookmarking)
  bookmarkButton: '[data-testid="removeBookmark"]',
};

/**
 * Extract tweet ID from a tweet URL
 */
const extractTweetId = (url: string): string | null => {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
};

/**
 * Parse author info from a tweet element
 */
const parseAuthor = (
  tweetEl: Element
): { handle: string; displayName: string } => {
  const userNameEl = tweetEl.querySelector(SELECTORS.userName);
  if (!userNameEl) {
    return { handle: "unknown", displayName: "Unknown" };
  }

  // Display name is usually in the first span/link
  const displayNameEl = userNameEl.querySelector("span");
  const displayName = displayNameEl?.textContent?.trim() || "Unknown";

  // Handle is in a link with @ prefix
  const handleLink = userNameEl.querySelector('a[href^="/"]');
  const href = handleLink?.getAttribute("href") || "";
  const handle = href.replace("/", "").split("/")[0] || "unknown";

  return { handle, displayName };
};

/**
 * Parse tweet text content
 */
const parseTweetText = (tweetEl: Element): string => {
  const textEl = tweetEl.querySelector(SELECTORS.tweetText);
  if (!textEl) return "";

  // Get text preserving line breaks
  const text = textEl.textContent || "";
  return text.trim();
};

/**
 * Parse tweet URL and timestamp
 */
const parseTweetMeta = (
  tweetEl: Element
): { url: string; timestamp: string; tweetId: string } => {
  const timeEl = tweetEl.querySelector(SELECTORS.time);
  const timestamp = timeEl?.getAttribute("datetime") || new Date().toISOString();

  // The time element's parent link contains the tweet URL
  const linkEl = timeEl?.closest("a");
  const href = linkEl?.getAttribute("href") || "";

  // Build full URL
  const url = href.startsWith("http") ? href : `https://x.com${href}`;
  const tweetId = extractTweetId(url) || `unknown-${Date.now()}`;

  return { url, timestamp, tweetId };
};

/**
 * Parse media (images, videos, gifs) from tweet
 */
const parseMedia = (tweetEl: Element): Media[] => {
  const media: Media[] = [];

  // Images
  const photos = tweetEl.querySelectorAll(SELECTORS.tweetPhoto);
  photos.forEach((photo) => {
    const img = photo.querySelector("img");
    if (img) {
      if (img.alt) {
        media.push({
          type: "image",
          url: img.src,
          alt: img.alt,
        });
      } else {
        media.push({
          type: "image",
          url: img.src,
        });
      }
    }
  });

  // Videos/GIFs
  const videos = tweetEl.querySelectorAll(SELECTORS.videoPlayer);
  videos.forEach((video) => {
    const videoEl = video.querySelector("video");
    if (videoEl) {
      // GIFs loop, videos don't (usually)
      const isGif = videoEl.hasAttribute("loop");
      media.push({
        type: isGif ? "gif" : "video",
        url: videoEl.src || videoEl.querySelector("source")?.src || "",
      });
    }
  });

  return media;
};

/**
 * Parse external links from tweet
 */
const parseLinks = (tweetEl: Element): Link[] => {
  const links: Link[] = [];

  // Card links (previews)
  const cards = tweetEl.querySelectorAll(SELECTORS.cardWrapper);
  cards.forEach((card) => {
    const linkEl = card.querySelector("a");
    if (linkEl) {
      const url = linkEl.getAttribute("href") || "";
      // Try to get display URL from card content
      const displayUrl = card.textContent?.trim().split("\n")[0] || url;
      if (url && !url.includes("x.com") && !url.includes("twitter.com")) {
        links.push({ url, displayUrl });
      }
    }
  });

  // Links in tweet text
  const tweetTextEl = tweetEl.querySelector(SELECTORS.tweetText);
  if (tweetTextEl) {
    const textLinks = tweetTextEl.querySelectorAll('a[href^="http"]');
    textLinks.forEach((a) => {
      const url = a.getAttribute("href") || "";
      const displayUrl = a.textContent?.trim() || url;
      // Skip twitter/x.com links and duplicates
      if (
        url &&
        !url.includes("x.com") &&
        !url.includes("twitter.com") &&
        !links.some((l) => l.url === url)
      ) {
        links.push({ url, displayUrl });
      }
    });
  }

  return links;
};

/**
 * Parse a quoted tweet if present
 */
const parseQuotedTweet = (tweetEl: Element): RawBookmark | undefined => {
  const quoteEl = tweetEl.querySelector(SELECTORS.quoteTweet);
  if (!quoteEl) return undefined;

  // Parse the quoted tweet similarly but simpler
  const author = parseAuthor(quoteEl);
  const text = parseTweetText(quoteEl);
  const meta = parseTweetMeta(quoteEl);
  const media = parseMedia(quoteEl);
  const links = parseLinks(quoteEl);

  return {
    tweetId: meta.tweetId,
    tweetUrl: meta.url,
    authorHandle: author.handle,
    authorDisplayName: author.displayName,
    text,
    timestamp: meta.timestamp,
    media,
    isThread: false,
    links,
  };
};

/**
 * Check if a tweet is part of a thread (self-reply)
 */
const isThreadTweet = (tweetEl: Element, authorHandle: string): boolean => {
  // Look for "Replying to" or thread indicator
  const replyingTo = tweetEl.textContent?.includes(`@${authorHandle}`);
  // Check if there's a thread line connecting tweets
  const hasThreadLine = tweetEl.querySelector('[data-testid="Tweet-thread"]') !== null;
  return !!replyingTo || hasThreadLine;
};

/**
 * Scrape a single tweet element into a RawBookmark
 */
const scrapeTweet = (tweetEl: Element): RawBookmark | null => {
  try {
    const author = parseAuthor(tweetEl);
    const text = parseTweetText(tweetEl);
    const meta = parseTweetMeta(tweetEl);
    const media = parseMedia(tweetEl);
    const links = parseLinks(tweetEl);
    const quotedTweet = parseQuotedTweet(tweetEl);
    const isThread = isThreadTweet(tweetEl, author.handle);

    if (quotedTweet) {
      return {
        tweetId: meta.tweetId,
        tweetUrl: meta.url,
        authorHandle: author.handle,
        authorDisplayName: author.displayName,
        text,
        timestamp: meta.timestamp,
        media,
        quotedTweet,
        isThread,
        links,
      };
    }
    
    return {
      tweetId: meta.tweetId,
      tweetUrl: meta.url,
      authorHandle: author.handle,
      authorDisplayName: author.displayName,
      text,
      timestamp: meta.timestamp,
      media,
      isThread,
      links,
    };
  } catch (error) {
    console.error("[x-to-obsidian] Failed to scrape tweet:", error);
    return null;
  }
};

// Rate limiting for unbookmark requests
const UNBOOKMARK_DELAY_MS = 2000; // 2 seconds between unbookmarks to avoid 429

/**
 * Find a tweet element by its ID (re-queries DOM for fresh reference)
 */
const findTweetById = (tweetId: string): Element | null => {
  const tweets = document.querySelectorAll(SELECTORS.tweet);
  for (const tweet of tweets) {
    const meta = parseTweetMeta(tweet);
    if (meta.tweetId === tweetId) {
      return tweet;
    }
  }
  return null;
};

/**
 * Wait for a condition with timeout
 */
const waitFor = async (
  condition: () => boolean,
  timeoutMs: number,
  pollMs = 50
): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
};

/**
 * Click the unbookmark button on a tweet element
 * Returns: "success" | "not_found" | "failed"
 */
const unbookmarkTweet = async (
  tweetEl: Element,
  tweetId: string,
  retries = 2
): Promise<"success" | "not_found" | "failed"> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Re-query the DOM for a fresh reference on retries
    const currentTweetEl = attempt === 0 ? tweetEl : findTweetById(tweetId);
    
    if (!currentTweetEl) {
      // Tweet no longer in DOM - might have been removed by X after unbookmark
      // Check if that's because unbookmark succeeded
      console.log(`[x-to-obsidian] Tweet ${tweetId} not in DOM (may have been unbookmarked)`);
      return "success"; // Assume success if tweet disappeared
    }

    const bookmarkBtn = currentTweetEl.querySelector(
      SELECTORS.bookmarkButton
    ) as HTMLElement | null;

    if (!bookmarkBtn) {
      // No removeBookmark button - either already unbookmarked or button not rendered
      console.warn(
        `[x-to-obsidian] Attempt ${attempt + 1}: Unbookmark button not found for tweet ${tweetId}`
      );
      
      if (attempt < retries) {
        // Scroll tweet into view and wait for button to render
        currentTweetEl.scrollIntoView({ block: "center", behavior: "smooth" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }
      return "not_found";
    }

    // Scroll button into view to ensure it's interactable
    bookmarkBtn.scrollIntoView({ block: "center", behavior: "smooth" });
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Click the button
    bookmarkBtn.click();
    console.log(`[x-to-obsidian] Clicked unbookmark for tweet ${tweetId}`);

    // Wait for X to process - verify by checking if button changes or tweet removed
    const unbookmarked = await waitFor(() => {
      // Check if tweet was removed from DOM
      const stillExists = findTweetById(tweetId);
      if (!stillExists) return true;

      // Check if bookmark button changed (no longer "removeBookmark")
      const btn = stillExists.querySelector(SELECTORS.bookmarkButton);
      return !btn;
    }, 1500);

    if (unbookmarked) {
      console.log(`[x-to-obsidian] Successfully unbookmarked tweet ${tweetId}`);
      // Rate limit: wait before allowing next unbookmark to avoid 429
      await new Promise((resolve) => setTimeout(resolve, UNBOOKMARK_DELAY_MS));
      return "success";
    }

    console.warn(
      `[x-to-obsidian] Attempt ${attempt + 1}: Unbookmark may not have worked for tweet ${tweetId}`
    );
  }

  return "failed";
};



interface ScrapeOptions {
  unbookmark?: boolean | undefined;
}

interface ScrapeResult {
  bookmarks: RawBookmark[];
  unbookmarkStats: {
    success: number;
    notFound: number;
    failed: number;
  };
}

/**
 * Scrape visible tweets and optionally unbookmark them immediately after scraping each
 */
const scrapeVisibleTweetsWithOptions = async (
  options: ScrapeOptions = {}
): Promise<ScrapeResult> => {
  const tweets = document.querySelectorAll(SELECTORS.tweet);
  const bookmarks: RawBookmark[] = [];
  const seenIds = new Set<string>();
  const unbookmarkStats = { success: 0, notFound: 0, failed: 0 };

  for (const tweet of tweets) {
    const bookmark = scrapeTweet(tweet);
    if (bookmark && !seenIds.has(bookmark.tweetId)) {
      seenIds.add(bookmark.tweetId);
      bookmarks.push(bookmark);

      // Unbookmark immediately after scraping (before any scroll/DOM changes)
      if (options.unbookmark) {
        const result = await unbookmarkTweet(tweet, bookmark.tweetId);
        unbookmarkStats[result === "success" ? "success" : result === "not_found" ? "notFound" : "failed"]++;
      }
    }
  }

  return { bookmarks, unbookmarkStats };
};

/**
 * Scroll and scrape all bookmarks (handles infinite scroll)
 * Unbookmarking happens immediately after scraping each tweet, before scrolling
 */
const scrapeAllBookmarks = async (
  onProgress?: (count: number, stats?: ScrapeResult["unbookmarkStats"]) => void,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> => {
  const allBookmarks: RawBookmark[] = [];
  const seenIds = new Set<string>();
  const totalStats = { success: 0, notFound: 0, failed: 0 };
  let lastHeight = 0;
  let noNewContentCount = 0;
  const maxNoNewContent = 3;

  while (noNewContentCount < maxNoNewContent) {
    // Scrape current visible tweets (unbookmarking happens inside this function)
    const { bookmarks: visible, unbookmarkStats } = await scrapeVisibleTweetsWithOptions(options);
    let newCount = 0;

    // Aggregate stats
    totalStats.success += unbookmarkStats.success;
    totalStats.notFound += unbookmarkStats.notFound;
    totalStats.failed += unbookmarkStats.failed;

    for (const bookmark of visible) {
      if (!seenIds.has(bookmark.tweetId)) {
        seenIds.add(bookmark.tweetId);
        allBookmarks.push(bookmark);
        newCount++;
      }
    }

    if (newCount > 0) {
      noNewContentCount = 0;
      onProgress?.(allBookmarks.length, totalStats);
    }

    // Scroll down
    window.scrollTo(0, document.body.scrollHeight);

    // Wait for content to load
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Check if we've reached the end
    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      noNewContentCount++;
    }
    lastHeight = newHeight;
  }

  return { bookmarks: allBookmarks, unbookmarkStats: totalStats };
};

// Message types for communication with popup/background
interface ScrapeVisibleMessage {
  type: "SCRAPE_VISIBLE";
  unbookmark?: boolean;
}

interface ScrapeAllMessage {
  type: "SCRAPE_ALL";
  unbookmark?: boolean;
}

interface UnbookmarkTweetsMessage {
  type: "UNBOOKMARK_TWEETS";
  tweetIds: string[];
}

interface ScrapeProgressMessage {
  type: "SCRAPE_PROGRESS";
  count: number;
}

interface ScrapeResultMessage {
  type: "SCRAPE_RESULT";
  bookmarks: RawBookmark[];
  unbookmarkStats?: {
    success: number;
    notFound: number;
    failed: number;
  } | undefined;
  error?: string | undefined;
}

type IncomingMessage = ScrapeVisibleMessage | ScrapeAllMessage | UnbookmarkTweetsMessage;

interface UnbookmarkResult {
  success: number;
  failed: number;
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ScrapeResultMessage | ScrapeProgressMessage | UnbookmarkResult) => void
  ) => {
    if (message.type === "SCRAPE_VISIBLE") {
      const options = { unbookmark: message.unbookmark };
      scrapeVisibleTweetsWithOptions(options)
        .then(({ bookmarks, unbookmarkStats }) => {
          // Unbookmarking already happened inside scrapeVisibleTweetsWithOptions
          sendResponse({
            type: "SCRAPE_RESULT",
            bookmarks,
            unbookmarkStats: options.unbookmark ? unbookmarkStats : undefined,
          });
        })
        .catch((error) => {
          sendResponse({
            type: "SCRAPE_RESULT",
            bookmarks: [],
            error: error instanceof Error ? error.message : "Unknown error",
          });
        });
      return true;
    }

    if (message.type === "SCRAPE_ALL") {
      const options = { unbookmark: message.unbookmark };
      scrapeAllBookmarks((count, stats) => {
        chrome.runtime.sendMessage({
          type: "SCRAPE_PROGRESS",
          count,
          unbookmarkStats: stats,
        } as ScrapeProgressMessage);
      }, options)
        .then(({ bookmarks, unbookmarkStats }) => {
          sendResponse({
            type: "SCRAPE_RESULT",
            bookmarks,
            unbookmarkStats: options.unbookmark ? unbookmarkStats : undefined,
          });
        })
        .catch((error) => {
          sendResponse({
            type: "SCRAPE_RESULT",
            bookmarks: [],
            error: error instanceof Error ? error.message : "Unknown error",
          });
        });
      return true; // Keep message channel open for async response
    }

    // Unbookmark specific tweets by ID (called after server confirms save)
    if (message.type === "UNBOOKMARK_TWEETS") {
      const { tweetIds } = message;
      (async () => {
        let success = 0;
        let failed = 0;

        for (const tweetId of tweetIds) {
          const tweetEl = findTweetById(tweetId);
          if (!tweetEl) {
            // Tweet not in DOM - might have scrolled away or already unbookmarked
            console.log(`[x-to-obsidian] Tweet ${tweetId} not in DOM, skipping unbookmark`);
            failed++;
            continue;
          }

          const result = await unbookmarkTweet(tweetEl, tweetId);
          if (result === "success") {
            success++;
          } else {
            failed++;
          }
        }

        sendResponse({ success, failed });
      })();
      return true;
    }

    return false;
  }
);

// ============================================
// INLINE SEND BUTTON - Works on any X page
// ============================================

// Obsidian icon SVG (simplified gem shape)
const OBSIDIAN_ICON = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <path d="M382.3 475.6c-3.1 23.4-26 41.6-48.7 35.3-32.4-8.9-69.9-22.8-103.6-25.4l-51.7-4a34 34 0 0 1-22-10.2l-89-91.7a34 34 0 0 1-6.7-37.7s55-121 57.1-127.3c2-6.3 9.6-61.2 14-90.6 1.2-7.9 5-15 11-20.3L248 8.9a34.1 34.1 0 0 1 49.6 4.3L386 125.6a37 37 0 0 1 7.6 22.4c0 21.3 1.8 65 13.6 93.2 11.5 27.3 32.5 57 43.5 71.5a17.3 17.3 0 0 1 1.3 19.2 1494 1494 0 0 1-44.8 70.6c-15 22.3-21.9 49.9-25 73.1z"/>
</svg>`;

/**
 * Send a single tweet to the server via background script
 */
const sendTweetToServer = (bookmark: RawBookmark): Promise<{ success: boolean; error?: string }> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "SEND_TO_OBSIDIAN", bookmark },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message || "Unknown error" });
        } else {
          resolve(response || { success: false, error: "No response" });
        }
      }
    );
  });
};

/**
 * Handle click on the send-to-obsidian button
 */
const handleSendClick = async (btn: HTMLButtonElement, tweetEl: Element) => {
  // Prevent double-clicks
  if (btn.classList.contains("sending")) return;

  const bookmark = scrapeTweet(tweetEl);
  if (!bookmark) {
    btn.classList.add("error");
    btn.setAttribute("data-tooltip", "Failed to parse tweet");
    setTimeout(() => {
      btn.classList.remove("error");
      btn.setAttribute("data-tooltip", "Send to Obsidian");
    }, 2000);
    return;
  }

  // Set sending state
  btn.classList.add("sending");
  btn.setAttribute("data-tooltip", "Sending...");

  const result = await sendTweetToServer(bookmark);

  btn.classList.remove("sending");

  if (result.success) {
    btn.classList.add("success");
    btn.setAttribute("data-tooltip", "Sent!");
    setTimeout(() => {
      btn.classList.remove("success");
      btn.setAttribute("data-tooltip", "Send to Obsidian");
    }, 2000);
  } else {
    btn.classList.add("error");
    btn.setAttribute("data-tooltip", result.error || "Failed");
    setTimeout(() => {
      btn.classList.remove("error");
      btn.setAttribute("data-tooltip", "Send to Obsidian");
    }, 3000);
  }
};

/**
 * Create the send-to-obsidian button element
 */
const createSendButton = (): HTMLButtonElement => {
  const btn = document.createElement("button");
  btn.className = "x-to-obsidian-btn";
  btn.innerHTML = OBSIDIAN_ICON;
  btn.setAttribute("data-tooltip", "Send to Obsidian");
  btn.setAttribute("aria-label", "Send to Obsidian");
  return btn;
};

/**
 * Inject send button into a tweet's action bar
 */
const injectSendButton = (tweetArticle: Element) => {
  // Skip if already injected
  if (tweetArticle.querySelector(".x-to-obsidian-btn")) return;

  // Find the action bar (contains reply, retweet, like, etc.)
  const actionBar = tweetArticle.querySelector('[role="group"]');
  if (!actionBar) return;

  const btn = createSendButton();
  
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSendClick(btn, tweetArticle);
  });

  actionBar.appendChild(btn);
};

/**
 * Process all visible tweets and inject buttons
 */
const processVisibleTweets = () => {
  const tweets = document.querySelectorAll(SELECTORS.tweet);
  tweets.forEach(injectSendButton);
};

// MutationObserver to handle dynamically loaded tweets
const observer = new MutationObserver((mutations) => {
  // Debounce: only process if there are actual added nodes
  let hasNewNodes = false;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      hasNewNodes = true;
      break;
    }
  }
  
  if (hasNewNodes) {
    processVisibleTweets();
  }
});

// Start observing when DOM is ready
const startObserver = () => {
  processVisibleTweets(); // Process existing tweets
  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
};

// Initialize based on document state
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startObserver);
} else {
  startObserver();
}

// Signal that content script is loaded
console.log("[x-to-obsidian] Content script loaded on", window.location.href);
