import { Schema, Effect, Config } from "effect";

export const ConfigSchema = Schema.Struct({
  vaultPath: Schema.String,
  bookmarksFolder: Schema.String,
  claudeModel: Schema.optional(Schema.String),
  claudeTimeout: Schema.Number,
  downloadImages: Schema.Boolean,
  expandLinks: Schema.Boolean,
  port: Schema.Number,
});
export type AppConfig = Schema.Schema.Type<typeof ConfigSchema>;

export const appConfig = Effect.gen(function* () {
  const vaultPath = yield* Config.string("VAULT_PATH");
  const bookmarksFolder = yield* Config.string("BOOKMARKS_FOLDER").pipe(
    Config.withDefault("Bookmarks")
  );
  const claudeModel = yield* Config.string("CLAUDE_MODEL").pipe(
    Config.option
  );
  const claudeTimeout = yield* Config.number("CLAUDE_TIMEOUT").pipe(
    Config.withDefault(30000)
  );
  const downloadImages = yield* Config.boolean("DOWNLOAD_IMAGES").pipe(
    Config.withDefault(false)
  );
  const expandLinks = yield* Config.boolean("EXPAND_LINKS").pipe(
    Config.withDefault(true)
  );
  const port = yield* Config.number("PORT").pipe(Config.withDefault(3000));

  return {
    vaultPath,
    bookmarksFolder,
    claudeModel: claudeModel._tag === "Some" ? claudeModel.value : undefined,
    claudeTimeout,
    downloadImages,
    expandLinks,
    port,
  } satisfies AppConfig;
});
