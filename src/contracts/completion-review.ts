import type { Json } from "./json.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "./models.ts";

/** Optional final-answer check. Effects are returned as calls for the engine to execute. */
export interface CompletionReview {
  readonly name: string;
  readonly failureMessage: string;
  /** Recover a failed check: append a note, replace the draft, or resume the primary model once. */
  readonly failureMode?: "append" | "replace" | "revise";
  /** Revisit once after primary recovery to verify its effects, without repeating the assessment. */
  readonly verifyAfterRevision?: boolean;
  /** A scoped observation for the primary model; never publish it as the final answer. */
  review(input: {
    runId?: string;
    /** Canonical messages before compaction, with transient values removed by the engine. */
    evidenceMessages?: readonly import("./messages.ts").Message[];
    provider: ModelProvider;
    request: ModelRequest;
    response: ModelResponse;
    contextWindow?: number;
    reserveTokens?: number;
  }): Promise<{
    response: ModelResponse;
    audit: Json;
    revision?: string;
    verifyAfterTools?: boolean;
  }>;
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
