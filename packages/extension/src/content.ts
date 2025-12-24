// Content script for scraping X/Twitter bookmarks
// Injected into x.com/i/bookmarks

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

type IncomingMessage = ScrapeVisibleMessage | ScrapeAllMessage;

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener(
  (
    message: IncomingMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ScrapeResultMessage | ScrapeProgressMessage) => void
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

    return false;
  }
);

// Signal that content script is loaded
console.log("[x-to-obsidian] Content script loaded on", window.location.href);
