import { Effect, Schema } from "effect";
import { RawBookmarkSchema, type ObsidianNote } from "@x-to-obsidian/core";
import { BookmarkAnalyzerService } from "../services/BookmarkAnalyzer.js";
import { ObsidianWriterService } from "../services/ObsidianWriter.js";

const BookmarksRequestSchema = Schema.Array(RawBookmarkSchema);

export interface BookmarkResult {
  tweetId: string;
  success: boolean;
  path?: string;
  error?: string;
}

export const handleBookmarks = (
  body: unknown
): Effect.Effect<
  BookmarkResult[],
  never,
  BookmarkAnalyzerService | ObsidianWriterService
> =>
  Effect.gen(function* () {
    const analyzer = yield* BookmarkAnalyzerService;
    const writer = yield* ObsidianWriterService;

    // Validate request body
    const parseResult = Schema.decodeUnknownEither(BookmarksRequestSchema)(body);
    if (parseResult._tag === "Left") {
      return [
        {
          tweetId: "unknown",
          success: false,
          error: `Invalid request body: ${parseResult.left.message}`,
        },
      ];
    }

    const bookmarks = parseResult.right;
    const results: BookmarkResult[] = [];

    for (const bookmark of bookmarks) {
      const result = yield* Effect.gen(function* () {
        const analyzed = yield* analyzer.analyze(bookmark);
        const note: ObsidianNote = yield* writer.write(analyzed);
        return {
          tweetId: bookmark.tweetId,
          success: true,
          path: note.path,
        };
      }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({
            tweetId: bookmark.tweetId,
            success: false,
            error: error.message,
          })
        )
      );

      results.push(result);
    }

    return results;
  });
