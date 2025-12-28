import { Schema } from "effect";

// Media attached to a tweet
export const MediaSchema = Schema.Struct({
  type: Schema.Literal("image", "video", "gif"),
  url: Schema.String,
  alt: Schema.optionalWith(Schema.String, { exact: true }),
});
export type Media = Schema.Schema.Type<typeof MediaSchema>;

// External link in a tweet
export const LinkSchema = Schema.Struct({
  url: Schema.String,
  displayUrl: Schema.String,
});
export type Link = Schema.Schema.Type<typeof LinkSchema>;

// What the extension scrapes from X DOM
export interface RawBookmark {
  readonly tweetId: string;
  readonly tweetUrl: string;
  readonly authorHandle: string;
  readonly authorDisplayName: string;
  readonly text: string;
  readonly timestamp: string;
  readonly media: readonly Media[];
  readonly quotedTweet?: RawBookmark;
  readonly isThread: boolean;
  readonly threadTweets?: readonly string[];
  readonly links: readonly Link[];
}

export const RawBookmarkSchema: Schema.Schema<RawBookmark> = Schema.Struct({
  tweetId: Schema.String,
  tweetUrl: Schema.String,
  authorHandle: Schema.String,
  authorDisplayName: Schema.String,
  text: Schema.String,
  timestamp: Schema.String,
  media: Schema.Array(MediaSchema),
  quotedTweet: Schema.optionalWith(Schema.suspend((): Schema.Schema<RawBookmark> => RawBookmarkSchema), { exact: true }),
  isThread: Schema.Boolean,
  threadTweets: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  links: Schema.Array(LinkSchema),
});

// Bookmark category after analysis
export const BookmarkCategorySchema = Schema.Literal(
  "thread",
  "link",
  "image",
  "quote",
  "standalone"
);
export type BookmarkCategory = Schema.Schema.Type<typeof BookmarkCategorySchema>;

// After LLM processing
export const AnalyzedBookmarkSchema = Schema.Struct({
  raw: RawBookmarkSchema,
  category: BookmarkCategorySchema,
  suggestedPath: Schema.String,
  tags: Schema.Array(Schema.String),
  title: Schema.String,
  summary: Schema.optionalWith(Schema.String, { exact: true }),
  extractedContent: Schema.optionalWith(Schema.String, { exact: true }),
});
export type AnalyzedBookmark = Schema.Schema.Type<typeof AnalyzedBookmarkSchema>;

// Final output for Obsidian
export const ObsidianNoteSchema = Schema.Struct({
  path: Schema.String,
  frontmatter: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  content: Schema.String,
});
export type ObsidianNote = Schema.Schema.Type<typeof ObsidianNoteSchema>;
