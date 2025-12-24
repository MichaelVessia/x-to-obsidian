import { Effect, Context, Data, Layer, Config } from "effect";
import { LanguageModel } from "@effect/ai";
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { GoogleClient, GoogleLanguageModel } from "@effect/ai-google";
import { NodeHttpClient } from "@effect/platform-node";

export class LLMError extends Data.TaggedError("LLMError")<{
  message: string;
  cause?: unknown;
}> {}

// Our service interface - agnostic of provider
export interface LLMService {
  readonly analyze: (prompt: string) => Effect.Effect<string, LLMError>;
}

export const LLMService = Context.GenericTag<LLMService>("LLMService");



// Implementation using @effect/ai LanguageModel
const makeLLMServiceEffect = Effect.gen(function* () {
  const languageModel = yield* LanguageModel.LanguageModel;

  const analyze = (prompt: string): Effect.Effect<string, LLMError> =>
    Effect.gen(function* () {
      yield* Effect.logInfo(`Sending prompt to LLM (${prompt.length} chars)`);

      const response = yield* languageModel
        .generateText({
          prompt,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new LLMError({
                message: `LLM request failed: ${error}`,
                cause: error,
              })
          )
        );

      yield* Effect.logInfo(
        `LLM responded (${response.text.length} chars, ${response.usage.totalTokens} tokens)`
      );
      return response.text;
    });

  return LLMService.of({ analyze });
});

// Anthropic/Claude layer
export const AnthropicLLMLayer = Layer.effect(LLMService, makeLLMServiceEffect).pipe(
  Layer.provide(
    AnthropicLanguageModel.layer({
      model: "claude-haiku-4-5",
    })
  ),
  Layer.provide(
    AnthropicClient.layerConfig({
      apiKey: Config.redacted("ANTHROPIC_API_KEY"),
    })
  ),
  Layer.provide(NodeHttpClient.layer)
);

// Google/Gemini layer
export const GoogleLLMLayer = Layer.effect(LLMService, makeLLMServiceEffect).pipe(
  Layer.provide(
    GoogleLanguageModel.layer({
      model: "gemini-flash-lite-latest",
    })
  ),
  Layer.provide(
    GoogleClient.layerConfig({
      apiKey: Config.redacted("GOOGLE_API_KEY"),
    })
  ),
  Layer.provide(NodeHttpClient.layer)
);

// Config-based layer selection
export const LLMLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const provider = yield* Config.string("LLM_PROVIDER").pipe(
      Config.withDefault("google")
    );
    
    yield* Effect.logInfo(`Using LLM provider: ${provider}`);
    
    switch (provider.toLowerCase()) {
      case "anthropic":
      case "claude":
        return AnthropicLLMLayer;
      case "google":
      case "gemini":
      default:
        return GoogleLLMLayer;
    }
  })
);
