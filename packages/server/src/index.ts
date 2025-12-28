import { Effect, Logger, LogLevel, Layer, Runtime } from "effect";
import { handleBookmarks } from "./routes/bookmarks.js";
import { AppConfig } from "./config.js";
import { LLMService } from "./services/LLM.js";
import { BookmarkAnalyzerService } from "./services/BookmarkAnalyzer.js";
import { ObsidianWriterService } from "./services/ObsidianWriter.js";

const LoggerLive = Logger.replace(
	Logger.defaultLogger,
	Logger.prettyLogger({ colors: true }),
);

// Compose all layers
const MainLayer = Layer.mergeAll(
	BookmarkAnalyzerService.layer,
	ObsidianWriterService.layer,
).pipe(
	Layer.provideMerge(LLMService.live),
	Layer.provideMerge(AppConfig.layer),
	Layer.provideMerge(LoggerLive),
);

const program = Effect.gen(function* () {
	const config = yield* AppConfig;
	const runtime = yield* Effect.runtime<
		BookmarkAnalyzerService | ObsidianWriterService
	>();

	const server = Bun.serve({
		port: config.port,
		async fetch(req) {
			const url = new URL(req.url);

			// CORS headers
			const corsHeaders = {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			};

			if (req.method === "OPTIONS") {
				return new Response(null, { headers: corsHeaders });
			}

			if (url.pathname === "/api/bookmarks" && req.method === "POST") {
				try {
					const body = await req.json();

					const result = await Runtime.runPromise(runtime)(
						handleBookmarks(body).pipe(
							Logger.withMinimumLogLevel(LogLevel.Debug),
						),
					);

					return new Response(JSON.stringify(result), {
						headers: { "Content-Type": "application/json", ...corsHeaders },
					});
				} catch (error) {
					return new Response(
						JSON.stringify({
							error: error instanceof Error ? error.message : "Unknown error",
						}),
						{
							status: 500,
							headers: { "Content-Type": "application/json", ...corsHeaders },
						},
					);
				}
			}

			if (url.pathname === "/health") {
				return new Response(JSON.stringify({ status: "ok" }), {
					headers: { "Content-Type": "application/json" },
				});
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	yield* Effect.logInfo(`Server running at http://localhost:${server.port}`);

	// Keep server running
	return yield* Effect.never;
});

Effect.runPromise(
	program.pipe(
		Effect.provide(MainLayer),
		Logger.withMinimumLogLevel(LogLevel.Debug),
	),
).catch(console.error);
