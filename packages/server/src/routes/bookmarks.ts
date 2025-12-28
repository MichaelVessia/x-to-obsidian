import { Effect, Schema } from "effect";
import { RawBookmarkSchema, type ObsidianNote } from "@x-to-obsidian/core";
import { BookmarkAnalyzerService } from "../services/BookmarkAnalyzer.js";
import { ObsidianWriterService } from "../services/ObsidianWriter.js";

const BookmarksRequestSchema = Schema.Struct({
	bookmarks: Schema.Array(RawBookmarkSchema),
});

export class BookmarkResult extends Schema.Class<BookmarkResult>(
	"BookmarkResult",
)({
	tweetId: Schema.String,
	success: Schema.Boolean,
	path: Schema.optional(Schema.String),
	error: Schema.optional(Schema.String),
}) {}

export const handleBookmarks = (body: unknown) =>
	Effect.gen(function* () {
		const analyzer = yield* BookmarkAnalyzerService;
		const writer = yield* ObsidianWriterService;

		// Validate request body
		yield* Effect.logDebug("Validating request body");
		const parseResult =
			Schema.decodeUnknownEither(BookmarksRequestSchema)(body);
		if (parseResult._tag === "Left") {
			yield* Effect.logError(`Validation failed: ${parseResult.left.message}`);
			return [
				BookmarkResult.make({
					tweetId: "unknown",
					success: false,
					error: `Invalid request body: ${parseResult.left.message}`,
				}),
			];
		}

		const bookmarks = parseResult.right.bookmarks;
		yield* Effect.logInfo(`Received ${bookmarks.length} bookmarks`);
		const results: BookmarkResult[] = [];

		for (const bookmark of bookmarks) {
			yield* Effect.logInfo(`Processing ${bookmark.tweetId}`);
			const result = yield* Effect.gen(function* () {
				// Check for duplicate before calling LLM
				const isDupe = yield* writer.isDuplicate(bookmark.tweetId);
				if (isDupe) {
					yield* Effect.logDebug(`Skipping duplicate: ${bookmark.tweetId}`);
					return BookmarkResult.make({
						tweetId: bookmark.tweetId,
						success: true,
						path: "",
					});
				}

				yield* Effect.logDebug(`Analyzing ${bookmark.tweetId}`);
				const analyzed = yield* analyzer.analyze(bookmark);
				yield* Effect.logDebug(`Writing ${bookmark.tweetId}`);
				const note: ObsidianNote = yield* writer.write(analyzed);
				return BookmarkResult.make({
					tweetId: bookmark.tweetId,
					success: true,
					path: note.path,
				});
			}).pipe(
				Effect.catchAll((error) => {
					return Effect.gen(function* () {
						yield* Effect.logError(
							`Error processing ${bookmark.tweetId}: ${error.message}`,
						);
						return BookmarkResult.make({
							tweetId: bookmark.tweetId,
							success: false,
							error: error.message,
						});
					});
				}),
			);

			results.push(result);
			yield* Effect.logInfo(
				`Processed ${bookmark.tweetId}: ${result.success ? "success" : "error" in result ? result.error : "unknown error"}`,
			);
		}

		yield* Effect.logInfo(`Completed processing ${results.length} bookmarks`);
		return results;
	});
