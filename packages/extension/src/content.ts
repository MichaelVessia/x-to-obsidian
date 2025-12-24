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

/**
 * Click the unbookmark button on a tweet element
 */
const unbookmarkTweet = async (tweetEl: Element): Promise<boolean> => {
  const bookmarkBtn = tweetEl.querySelector(SELECTORS.bookmarkButton) as HTMLElement | null;
  if (bookmarkBtn) {
    bookmarkBtn.click();
    // Small delay to let X process the unbookmark
    await new Promise((resolve) => setTimeout(resolve, 300));
    return true;
  }
  return false;
};



interface ScrapeOptions {
  unbookmark?: boolean | undefined;
}

/**
 * Scrape visible tweets and optionally unbookmark them
 */
const scrapeVisibleTweetsWithOptions = async (
  options: ScrapeOptions = {}
): Promise<{ bookmarks: RawBookmark[]; tweetElements: Map<string, Element> }> => {
  const tweets = document.querySelectorAll(SELECTORS.tweet);
  const bookmarks: RawBookmark[] = [];
  const tweetElements = new Map<string, Element>();
  const seenIds = new Set<string>();

  for (const tweet of tweets) {
    const bookmark = scrapeTweet(tweet);
    if (bookmark && !seenIds.has(bookmark.tweetId)) {
      seenIds.add(bookmark.tweetId);
      bookmarks.push(bookmark);
      tweetElements.set(bookmark.tweetId, tweet);
    }
  }

  return { bookmarks, tweetElements };
};

/**
 * Scroll and scrape all bookmarks (handles infinite scroll)
 */
const scrapeAllBookmarks = async (
  onProgress?: (count: number) => void,
  options: ScrapeOptions = {}
): Promise<RawBookmark[]> => {
  const allBookmarks: RawBookmark[] = [];
  const seenIds = new Set<string>();
  let lastHeight = 0;
  let noNewContentCount = 0;
  const maxNoNewContent = 3;

  while (noNewContentCount < maxNoNewContent) {
    // Scrape current visible tweets
    const { bookmarks: visible, tweetElements } = await scrapeVisibleTweetsWithOptions(options);
    let newCount = 0;

    for (const bookmark of visible) {
      if (!seenIds.has(bookmark.tweetId)) {
        seenIds.add(bookmark.tweetId);
        allBookmarks.push(bookmark);
        newCount++;

        // Unbookmark after scraping if requested
        if (options.unbookmark) {
          const tweetEl = tweetElements.get(bookmark.tweetId);
          if (tweetEl) {
            await unbookmarkTweet(tweetEl);
          }
        }
      }
    }

    if (newCount > 0) {
      noNewContentCount = 0;
      onProgress?.(allBookmarks.length);
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

  return allBookmarks;
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
  error?: string;
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
        .then(async ({ bookmarks, tweetElements }) => {
          // Unbookmark after scraping if requested
          if (options.unbookmark) {
            for (const bookmark of bookmarks) {
              const tweetEl = tweetElements.get(bookmark.tweetId);
              if (tweetEl) {
                await unbookmarkTweet(tweetEl);
              }
            }
          }
          sendResponse({ type: "SCRAPE_RESULT", bookmarks });
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
      scrapeAllBookmarks((count) => {
        chrome.runtime.sendMessage({
          type: "SCRAPE_PROGRESS",
          count,
        } satisfies ScrapeProgressMessage);
      }, options)
        .then((bookmarks) => {
          sendResponse({ type: "SCRAPE_RESULT", bookmarks });
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
