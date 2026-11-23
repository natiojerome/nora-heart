import type { Message } from "./messages.ts";
import type { ContextUsage } from "./usage.ts";
import type { ModelProvider, ModelRequest } from "./models.ts";

export interface ContextOptions {
  sessionId: string;
  runId: string;
  provider: ModelProvider;
  request: ModelRequest;
  /** Same message positions, with transient arguments/results removed before persistent summaries. */
  summaryMessages?: readonly Message[];
  contextWindow: number;
  reserveTokens: number;
  onPrepared?: (usage: ContextUsage) => Promise<void>;
}
export interface ContextManager {
  prepare(options: ContextOptions): Promise<ModelRequest>;
}

export class ContextError extends Error {
  constructor(
    readonly code:
      "INVALID_HISTORY" | "INVALID_BUDGET" | "CAPACITY" | "COMPRESSION",
    message: string,
  ) {
    super(message);
  }
}
