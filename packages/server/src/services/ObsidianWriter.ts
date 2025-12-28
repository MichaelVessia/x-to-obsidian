import { Effect, Context, Schema, Layer } from "effect";
import { mkdir, writeFile, access, readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AnalyzedBookmark, ObsidianNote } from "@x-to-obsidian/core";
import { AppConfig } from "../config.js";

// In-memory cache of processed tweet IDs (loaded from vault on startup)
let processedTweetIds: Set<string> | null = null;

export class WriterError extends Schema.TaggedError<WriterError>()(
	"WriterError",
	{
		message: Schema.String,
		cause: Schema.optional(Schema.Defect),
	},
) {}

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

	// Title - use LLM-generated title
	parts.push(`# ${bookmark.title}`);
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
		parts.push(
			`> **@${bookmark.raw.quotedTweet.authorHandle}**: ${bookmark.raw.quotedTweet.text}`,
		);
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

const loadProcessedTweetIds = async (
	bookmarksDir: string,
): Promise<Set<string>> => {
	const ids = new Set<string>();
	try {
		const files = await readdir(bookmarksDir);
		for (const file of files) {
			if (!file.endsWith(".md")) continue;
			const content = await readFile(join(bookmarksDir, file), "utf-8");
			const match = content.match(/tweet_id:\s*"?(\d+)"?/);
			if (match) {
				ids.add(match[1]);
			}
		}
	} catch {
		// Directory might not exist yet
	}
	return ids;
};

export class ObsidianWriterService extends Context.Tag(
	"@x-to-obsidian/ObsidianWriterService",
)<
	ObsidianWriterService,
	{
		readonly write: (
			bookmark: AnalyzedBookmark,
		) => Effect.Effect<ObsidianNote, WriterError>;
		readonly isDuplicate: (
			tweetId: string,
		) => Effect.Effect<boolean, WriterError>;
	}
>() {
	static readonly layer = Layer.effect(
		ObsidianWriterService,
		Effect.gen(function* () {
			const config = yield* AppConfig;
			const bookmarksDir = join(config.vaultPath, config.bookmarksFolder);

			const ensureCacheLoaded = Effect.gen(function* () {
				if (processedTweetIds === null) {
					processedTweetIds = yield* Effect.tryPromise({
						try: () => loadProcessedTweetIds(bookmarksDir),
						catch: (error) =>
							new WriterError({
								message: "Failed to load processed tweet IDs",
								cause: error,
							}),
					});
					yield* Effect.logInfo(
						`Loaded ${processedTweetIds.size} existing tweet IDs`,
					);
				}
				return processedTweetIds;
			});

			const isDuplicate = Effect.fn("ObsidianWriterService.isDuplicate")(
				function* (tweetId: string) {
					const cache = yield* ensureCacheLoaded;
					return cache.has(tweetId);
				},
			);

			const write = Effect.fn("ObsidianWriterService.write")(function* (
				bookmark: AnalyzedBookmark,
			) {
				const cache = yield* ensureCacheLoaded;

				// Check for duplicate by tweet ID
				if (cache.has(bookmark.raw.tweetId)) {
					yield* Effect.logDebug(`Skipping duplicate: ${bookmark.raw.tweetId}`);
					return {
						path: "",
						frontmatter: {},
						content: "",
					} satisfies ObsidianNote;
				}

				// Generate filename from LLM-generated title, falling back to tweet text or ID
				const slug =
					slugify(bookmark.title) ||
					slugify(bookmark.raw.text) ||
					bookmark.raw.tweetId;
				const filename = `${slug}.md`;

				// Build full path - flat structure, no subfolders
				const relativePath = join(config.bookmarksFolder, filename);
				const fullPath = join(config.vaultPath, relativePath);

				// Also check file existence (in case file exists but wasn't in cache)
				const exists = yield* Effect.tryPromise({
					try: () => fileExists(fullPath),
					catch: (error) =>
						new WriterError({
							message: `Failed to check file existence: ${fullPath}`,
							cause: error,
						}),
				});

				if (exists) {
					yield* Effect.logDebug(`File already exists: ${relativePath}`);
					cache.add(bookmark.raw.tweetId);
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

				// Add to cache
				cache.add(bookmark.raw.tweetId);

				return {
					path: relativePath,
					frontmatter: { source: "x/twitter", tweet_id: bookmark.raw.tweetId },
					content: fullContent,
				} satisfies ObsidianNote;
			});

			return ObsidianWriterService.of({ write, isDuplicate });
		}),
	);

	static readonly live = ObsidianWriterService.layer.pipe(
		Layer.provide(AppConfig.layer),
	);
}
