import { Effect } from "effect";
import { handleBookmarks } from "./routes/bookmarks.js";
import { appConfig } from "./config.js";
import { ClaudeService, makeClaudeService } from "./services/Claude.js";
import {
  BookmarkAnalyzerService,
  makeBookmarkAnalyzerService,
} from "./services/BookmarkAnalyzer.js";
import {
  ObsidianWriterService,
  makeObsidianWriterService,
} from "./services/ObsidianWriter.js";

const program = Effect.gen(function* () {
  const config = yield* appConfig;

  // Build service layers
  const claudeService = yield* makeClaudeService;
  const analyzerService = yield* makeBookmarkAnalyzerService.pipe(
    Effect.provideService(ClaudeService, claudeService)
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
              Effect.provideService(ObsidianWriterService, writerService)
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

Effect.runPromise(program).catch(console.error);
