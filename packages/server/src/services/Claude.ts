import { Effect, Context, Data, Schedule, Duration } from "effect";
import { appConfig } from "../config.js";

export class ClaudeError extends Data.TaggedError("ClaudeError")<{
  message: string;
  cause?: unknown;
}> {}

export interface ClaudeService {
  readonly analyze: (prompt: string) => Effect.Effect<string, ClaudeError>;
}

export const ClaudeService = Context.GenericTag<ClaudeService>("ClaudeService");

export const ClaudeServiceLive = Effect.gen(function* () {
  const config = yield* appConfig;

  const analyze = (prompt: string): Effect.Effect<string, ClaudeError> =>
    Effect.gen(function* () {
      const args = ["--print", "--output-format", "text"];
      if (config.claudeModel) {
        args.push("--model", config.claudeModel);
      }
      args.push(prompt);

      const proc = Bun.spawn(["claude", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeout = config.claudeTimeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          proc.kill();
          reject(new Error(`Claude CLI timed out after ${timeout}ms`));
        }, timeout);
      });

      const result = yield* Effect.tryPromise({
        try: () =>
          Promise.race([
            proc.exited.then(async (exitCode) => {
              if (exitCode !== 0) {
                const stderr = await new Response(proc.stderr).text();
                throw new Error(`Claude CLI exited with code ${exitCode}: ${stderr}`);
              }
              return new Response(proc.stdout).text();
            }),
            timeoutPromise,
          ]),
        catch: (error) =>
          new ClaudeError({
            message: error instanceof Error ? error.message : "Unknown error",
            cause: error,
          }),
      });

      return result.trim();
    }).pipe(
      Effect.retry(
        Schedule.exponential(Duration.seconds(1)).pipe(
          Schedule.compose(Schedule.recurs(2))
        )
      )
    );

  return ClaudeService.of({ analyze });
}).pipe(Effect.map((service) => service));

export const makeClaudeService = ClaudeServiceLive;
