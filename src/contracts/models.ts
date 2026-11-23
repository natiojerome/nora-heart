import type { Message, ToolCall } from "./messages.ts";
import type { ToolDefinition } from "./tools.ts";

export type ModelPhase = "context" | "waiting" | "reasoning" | "answer";
/** Public assistant commentary only; never hidden reasoning tokens or traces. */
export interface ModelProgress { kind:"commentary"; text:string }

export interface ModelRequest {
  /** Internal diagnostics only, never a provider instruction. */
  purpose?: {kind:"response"|"compression"|"review";name?:string};
  instructions: string;
  messages: readonly Message[];
  tools: readonly ToolDefinition[];
  signal?: AbortSignal;
  onActivity?: (phase: ModelPhase) => void;
  onProgress?: (progress: ModelProgress) => void;
}

export interface ModelResponse {
  content: string;
  toolCalls: ToolCall[];
}

/** Safe validation feedback only: no provider response, arguments, or credentials. */
export class ModelToolCallError extends Error {
  readonly code = "invalid-tool-call";
  constructor(readonly issues: readonly {code: "unknown-tool" | "invalid-arguments"; tool?: string}[]) {
    super("Échec du modèle : appel d’outil invalide. Aucun outil de cette réponse exécuté.");
    this.name = "ModelToolCallError";
  }
}

// An adapter translates the provider protocol; it never executes tools.
export interface ModelProvider {
  id: string;
  /** False only when the selected model is known not to support tool calls. */
  supportsTools?: boolean;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelCapabilities {id:string;name?:string;contextWindow?:number;reasoningEfforts?:string[];defaultReasoningEffort?:string;}
