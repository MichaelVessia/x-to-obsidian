import { Schema, Effect, Config, Context, Layer, Option } from "effect";

export const ConfigSchema = Schema.Struct({
	vaultPath: Schema.String,
	bookmarksFolder: Schema.String,
	claudeModel: Schema.optional(Schema.String),
	claudeTimeout: Schema.Number,
	downloadImages: Schema.Boolean,
	expandLinks: Schema.Boolean,
	port: Schema.Number,
});
export type AppConfigShape = Schema.Schema.Type<typeof ConfigSchema>;

export class AppConfig extends Context.Tag("@x-to-obsidian/AppConfig")<
	AppConfig,
	AppConfigShape
>() {
	static readonly layer = Layer.effect(
		AppConfig,
		Effect.gen(function* () {
			const vaultPath = yield* Config.string("VAULT_PATH");
			const bookmarksFolder = yield* Config.string("BOOKMARKS_FOLDER").pipe(
				Config.withDefault("Bookmarks"),
			);
			const claudeModel = yield* Config.string("CLAUDE_MODEL").pipe(
				Config.option,
			);
			const claudeTimeout = yield* Config.number("CLAUDE_TIMEOUT").pipe(
				Config.withDefault(30000),
			);
			const downloadImages = yield* Config.boolean("DOWNLOAD_IMAGES").pipe(
				Config.withDefault(false),
			);
			const expandLinks = yield* Config.boolean("EXPAND_LINKS").pipe(
				Config.withDefault(true),
			);
			const port = yield* Config.number("PORT").pipe(Config.withDefault(3000));

			return AppConfig.of({
				vaultPath,
				bookmarksFolder,
				claudeModel: Option.getOrUndefined(claudeModel),
				claudeTimeout,
				downloadImages,
				expandLinks,
				port,
			});
		}),
	);
}
