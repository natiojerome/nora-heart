import type { Json } from "./json.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "./models.ts";

/** Optional final-answer check. Effects are returned as calls for the engine to execute. */
export interface CompletionReview {
  readonly name: string;
  readonly failureMessage: string;
  /** Replace an unverified draft rather than publish it with a warning. */
  readonly failureMode?: "append" | "replace";
  review(input: {
    provider: ModelProvider;
    request: ModelRequest;
    response: ModelResponse;
    contextWindow?: number;
    reserveTokens?: number;
  }): Promise<{ response: ModelResponse; audit: Json }>;
}
