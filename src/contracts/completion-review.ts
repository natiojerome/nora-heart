import type { Json } from "./json.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "./models.ts";

/** Optional final-answer check. Effects are returned as calls for the engine to execute. */
export interface CompletionReview {
  readonly name: string;
  readonly failureMessage: string;
  /** Recover a failed check: append a note, replace the draft, or resume the primary model once. */
  readonly failureMode?: "append" | "replace" | "revise";
  /** A scoped observation for the primary model; never publish it as the final answer. */
  review(input: {
    provider: ModelProvider;
    request: ModelRequest;
    response: ModelResponse;
    contextWindow?: number;
    reserveTokens?: number;
  }): Promise<{ response: ModelResponse; audit: Json; revision?: string }>;
}

/** Safe diagnostic categories only; never include provider payloads or user data. */
export class CompletionReviewError extends Error {
  constructor(
    readonly code:
      | "INPUT_TOO_LARGE"
      | "MISSING_DECISION"
      | "INVALID_DECISION"
      | "INVALID_QUOTE"
      | "UNSOURCED_FACT"
      | "STALE_REVISION"
      | "UNKNOWN_REVISION"
      | "INVALID_SCOPE",
    message: string,
  ) {
    super(message);
  }
}
