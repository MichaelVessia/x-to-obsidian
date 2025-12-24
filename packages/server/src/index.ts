import { Effect, Logger, LogLevel, Layer } from "effect";
import { handleBookmarks } from "./routes/bookmarks.js";
import { appConfig } from "./config.js";
import {
  LLMService,
  LLMLayer,
} from "./services/LLM.js";
import {
  BookmarkAnalyzerService,
  makeBookmarkAnalyzerService,
} from "./services/BookmarkAnalyzer.js";
import {
  ObsidianWriterService,
  makeObsidianWriterService,
} from "./services/ObsidianWriter.js";

const LoggerLive = Logger.replace(
  Logger.defaultLogger,
  Logger.prettyLogger({ colors: true })
);

const program = Effect.gen(function* () {
  const config = yield* appConfig;

  // Get services from context (provided by layers)
  const llmService = yield* LLMService;
  const analyzerService = yield* makeBookmarkAnalyzerService.pipe(
    Effect.provideService(LLMService, llmService)
  );
  const writerService = yield* makeObsidianWriterService;

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

          const result = await Effect.runPromise(
            handleBookmarks(body).pipe(
              Effect.provideService(BookmarkAnalyzerService, analyzerService),
              Effect.provideService(ObsidianWriterService, writerService),
              Effect.provide(LoggerLive),
              Logger.withMinimumLogLevel(LogLevel.Debug)
            )
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
            }
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

  console.log(`Server running at http://localhost:${server.port}`);
});

// Run with Anthropic layer provided

const MainLayer = Layer.mergeAll(LLMLayer, LoggerLive);

Effect.runPromise(
  program.pipe(
    Effect.provide(MainLayer),
    Logger.withMinimumLogLevel(LogLevel.Debug)
  )
).catch(console.error);
