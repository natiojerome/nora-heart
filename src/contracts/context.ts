import type {ContextUsage} from "./usage.ts";
import type { ModelProvider, ModelRequest } from "./models.ts";

export interface ContextOptions {
  sessionId: string;
  runId: string;
  provider: ModelProvider;
  request: ModelRequest;
  contextWindow: number;
  reserveTokens: number;
  onPrepared?: (usage:ContextUsage)=>Promise<void>;
}
export interface ContextManager {
  prepare(options: ContextOptions): Promise<ModelRequest>;
}
