import { Effect, Context, Layer, Config, Schema } from "effect";
import { LanguageModel } from "@effect/ai";
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { GoogleClient, GoogleLanguageModel } from "@effect/ai-google";
import { FetchHttpClient } from "@effect/platform";

export class LLMError extends Schema.TaggedError<LLMError>()("LLMError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Defect),
}) {}

export class LLMService extends Context.Tag("@x-to-obsidian/LLMService")<
	LLMService,
	{
		readonly analyze: (prompt: string) => Effect.Effect<string, LLMError>;
	}
>() {
	// Implementation using @effect/ai LanguageModel
	static readonly layer = Layer.effect(
		LLMService,
		Effect.gen(function* () {
			const languageModel = yield* LanguageModel.LanguageModel;

			const analyze = Effect.fn("LLMService.analyze")(function* (
				prompt: string,
			) {
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
								}),
						),
					);

				yield* Effect.logInfo(
					`LLM responded (${response.text.length} chars, ${response.usage.totalTokens} tokens)`,
				);
				return response.text;
			});

			return LLMService.of({ analyze });
		}),
	);

	// Anthropic layer
	static readonly anthropicLayer = LLMService.layer.pipe(
		Layer.provide(
			AnthropicLanguageModel.layer({
				model: "claude-haiku-4-5",
			}),
		),
		Layer.provide(
			AnthropicClient.layerConfig({
				apiKey: Config.redacted("ANTHROPIC_API_KEY"),
			}),
		),
		Layer.provide(FetchHttpClient.layer),
	);

	// Google/Gemini layer
	static readonly googleLayer = LLMService.layer.pipe(
		Layer.provide(
			GoogleLanguageModel.layer({
				model: "gemini-flash-lite-latest",
			}),
		),
		Layer.provide(
			GoogleClient.layerConfig({
				apiKey: Config.redacted("GOOGLE_API_KEY"),
			}),
		),
		Layer.provide(FetchHttpClient.layer),
	);

	// Config-based layer selection
	static readonly live = Layer.unwrapEffect(
		Effect.gen(function* () {
			const provider = yield* Config.string("LLM_PROVIDER").pipe(
				Config.withDefault("google"),
			);

			yield* Effect.logInfo(`Using LLM provider: ${provider}`);

			switch (provider.toLowerCase()) {
				case "anthropic":
				case "claude":
					return LLMService.anthropicLayer;
				case "google":
				case "gemini":
				default:
					return LLMService.googleLayer;
			}
		}),
	);
}
