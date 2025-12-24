import { Effect, Context, Data, Schema } from "effect";
import type { RawBookmark, AnalyzedBookmark, BookmarkCategory } from "@x-to-obsidian/core";
import { ClaudeService, ClaudeError } from "./Claude.js";

export class AnalyzerError extends Data.TaggedError("AnalyzerError")<{
  message: string;
  cause?: unknown;
}> {}

const ClaudeResponseSchema = Schema.Struct({
  category: Schema.Literal("thread", "link", "image", "quote", "standalone"),
  suggestedPath: Schema.String,
  tags: Schema.Array(Schema.String),
  summary: Schema.optionalWith(Schema.String, { exact: true }),
});

export interface BookmarkAnalyzerService {
  readonly analyze: (
    bookmark: RawBookmark
  ) => Effect.Effect<AnalyzedBookmark, AnalyzerError | ClaudeError>;
}

export const BookmarkAnalyzerService = Context.GenericTag<BookmarkAnalyzerService>(
  "BookmarkAnalyzerService"
);

const buildPrompt = (bookmark: RawBookmark): string => {
  const parts = [
    `Analyze this Twitter/X bookmark and provide categorization for saving to Obsidian.`,
    ``,
    `Tweet by @${bookmark.authorHandle} (${bookmark.authorDisplayName}):`,
    `"${bookmark.text}"`,
    ``,
    `URL: ${bookmark.tweetUrl}`,
    `Is Thread: ${bookmark.isThread}`,
    `Has Media: ${bookmark.media.length > 0} (${bookmark.media.map((m) => m.type).join(", ")})`,
    `Has Links: ${bookmark.links.length > 0}`,
    bookmark.quotedTweet ? `Quotes: @${bookmark.quotedTweet.authorHandle}` : "",
    ``,
    `Respond with JSON only, no markdown:`,
    `{`,
    `  "category": "thread" | "link" | "image" | "quote" | "standalone",`,
    `  "suggestedPath": "folder/subfolder",`,
    `  "tags": ["tag1", "tag2"],`,
    `  "summary": "Brief summary if useful"`,
    `}`,
    ``,
    `Category rules:`,
    `- "thread": if isThread is true`,
    `- "link": if main content is about an external link`,
    `- "image": if main content is images/media`,
    `- "quote": if quoting another tweet is the main point`,
    `- "standalone": single tweet with text content`,
    ``,
    `For suggestedPath, just return empty string (we use flat folder structure).`,
    `For tags, use Title Case names suitable for Obsidian wikilinks (e.g., "TypeScript", "Functional Programming", "Machine Learning").`,
  ];

  return parts.filter(Boolean).join("\n");
};

export const makeBookmarkAnalyzerService = Effect.gen(function* () {
  const claude = yield* ClaudeService;

  const analyze = (
    bookmark: RawBookmark
  ): Effect.Effect<AnalyzedBookmark, AnalyzerError | ClaudeError> =>
    Effect.gen(function* () {
      const prompt = buildPrompt(bookmark);
      const response = yield* claude.analyze(prompt);

      // Parse JSON response
      const parsed = yield* Effect.try({
        try: () => JSON.parse(response),
        catch: (error) =>
          new AnalyzerError({
            message: `Failed to parse Claude response as JSON: ${response}`,
            cause: error,
          }),
      });

      // Validate against schema
      const validated = yield* Schema.decodeUnknown(ClaudeResponseSchema)(parsed).pipe(
        Effect.mapError(
          (error) =>
            new AnalyzerError({
              message: `Invalid Claude response structure: ${error.message}`,
              cause: error,
            })
        )
      );

      return {
        raw: bookmark,
        category: validated.category as BookmarkCategory,
        suggestedPath: validated.suggestedPath,
        tags: validated.tags,
        ...(validated.summary !== undefined && { summary: validated.summary }),
      } as AnalyzedBookmark;
    });

  return BookmarkAnalyzerService.of({ analyze });
});
