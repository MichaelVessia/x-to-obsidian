import { Effect, Context, Data } from "effect";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AnalyzedBookmark, ObsidianNote } from "@x-to-obsidian/core";
import { appConfig } from "../config.js";

export class WriterError extends Data.TaggedError("WriterError")<{
  message: string;
  cause?: unknown;
}> {}

export interface ObsidianWriterService {
  readonly write: (bookmark: AnalyzedBookmark) => Effect.Effect<ObsidianNote, WriterError>;
}

export const ObsidianWriterService = Context.GenericTag<ObsidianWriterService>(
  "ObsidianWriterService"
);

const slugify = (text: string, maxLength = 50): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, maxLength)
    .replace(/-$/, "");
};

const generateFrontmatter = (bookmark: AnalyzedBookmark): string => {
  const date = bookmark.raw.timestamp.split("T")[0];
  const lines = [
    "---",
    "category:",
    '  - "[[Bookmarks]]"',
    "tags:",
    "  - bookmarks",
    "  - twitter",
    "author:",
    `  - "[[${bookmark.raw.authorDisplayName}]]"`,
    `url: ${bookmark.raw.tweetUrl}`,
    `created: ${date}`,
    `published: ${date}`,
    "topics:",
    ...bookmark.tags.map((tag) => `  - "[[${tag}]]"`),
    `tweet_id: "${bookmark.raw.tweetId}"`,
    `bookmark_type: ${bookmark.category}`,
    "---",
  ];
  return lines.join("\n");
};

const generateContent = (bookmark: AnalyzedBookmark): string => {
  const parts: string[] = [];

  // Title
  if (bookmark.category === "thread") {
    parts.push(`# Thread by @${bookmark.raw.authorHandle}`);
  } else {
    parts.push(`# Tweet by @${bookmark.raw.authorHandle}`);
  }
  parts.push("");

  // Original text
  parts.push(`> ${bookmark.raw.text.replace(/\n/g, "\n> ")}`);
  parts.push("");

  // Summary if available
  if (bookmark.summary) {
    parts.push("## Summary");
    parts.push("");
    parts.push(bookmark.summary);
    parts.push("");
  }

  // Thread content
  if (bookmark.category === "thread" && bookmark.raw.threadTweets?.length) {
    parts.push("## Full Thread");
    parts.push("");
    bookmark.raw.threadTweets.forEach((tweet, i) => {
      parts.push(`${i + 1}. ${tweet}`);
    });
    parts.push("");
  }

  // Quoted tweet
  if (bookmark.raw.quotedTweet) {
    parts.push("## Quoted Tweet");
    parts.push("");
    parts.push(`> **@${bookmark.raw.quotedTweet.authorHandle}**: ${bookmark.raw.quotedTweet.text}`);
    parts.push("");
  }

  // Links
  if (bookmark.raw.links.length > 0) {
    parts.push("## Links");
    parts.push("");
    bookmark.raw.links.forEach((link) => {
      parts.push(`- [${link.displayUrl}](${link.url})`);
    });
    parts.push("");
  }

  // Media
  if (bookmark.raw.media.length > 0) {
    parts.push("## Media");
    parts.push("");
    bookmark.raw.media.forEach((media) => {
      if (media.type === "image") {
        parts.push(`![${media.alt || ""}](${media.url})`);
      } else {
        parts.push(`- [${media.type}](${media.url})`);
      }
    });
    parts.push("");
  }

  return parts.join("\n");
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const makeObsidianWriterService = Effect.gen(function* () {
  const config = yield* appConfig;

  const write = (bookmark: AnalyzedBookmark): Effect.Effect<ObsidianNote, WriterError> =>
    Effect.gen(function* () {
      // Generate filename from tweet text or ID
      const slug = slugify(bookmark.raw.text) || bookmark.raw.tweetId;
      const filename = `${slug}.md`;

      // Build full path - flat structure, no subfolders
      const relativePath = join(config.bookmarksFolder, filename);
      const fullPath = join(config.vaultPath, relativePath);

      // Check for duplicates
      const exists = yield* Effect.tryPromise({
        try: () => fileExists(fullPath),
        catch: (error) =>
          new WriterError({
            message: `Failed to check file existence: ${fullPath}`,
            cause: error,
          }),
      });

      if (exists) {
        // Skip duplicate
        return {
          path: relativePath,
          frontmatter: {},
          content: "",
        } satisfies ObsidianNote;
      }

      // Create directory if needed
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(fullPath), { recursive: true }),
        catch: (error) =>
          new WriterError({
            message: `Failed to create directory: ${dirname(fullPath)}`,
            cause: error,
          }),
      });

      // Generate content
      const frontmatter = generateFrontmatter(bookmark);
      const body = generateContent(bookmark);
      const fullContent = `${frontmatter}\n\n${body}`;

      // Write file
      yield* Effect.tryPromise({
        try: () => writeFile(fullPath, fullContent, "utf-8"),
        catch: (error) =>
          new WriterError({
            message: `Failed to write file: ${fullPath}`,
            cause: error,
          }),
      });

      return {
        path: relativePath,
        frontmatter: { source: "x/twitter", tweet_id: bookmark.raw.tweetId },
        content: fullContent,
      } satisfies ObsidianNote;
    });

  return ObsidianWriterService.of({ write });
});
