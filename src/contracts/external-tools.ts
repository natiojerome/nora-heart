import type { ToolMediaResult } from "./messages.ts";
import type { Json } from "./json.ts";
/** Heart stores plain JSON Schema snapshots, never SDK objects or credentials. */
export interface ExternalToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, Json>;
  readOnlyHint?: boolean;
}
export type ExternalToolAuth =
  | { type: "none" }
  | { type: "bearer_env"; envVar: string }
  | { type: "header_env"; envVar: string; headerName: string };
export interface ExternalToolConnection {
  id: string;
  version: number;
  label: string;
  url: string;
  auth: ExternalToolAuth;
  enabled: boolean;
  timeoutMs: number;
  /** Explicit owner grant; server annotations alone never enable writes. */
  allowWrites?: boolean;
  /** Exclude arguments/results from durable chat history. */
  transient?: boolean;
  /** Explicit owner approval, pinned to these definitions. Annotations alone grant nothing. */
  tools: ExternalToolDefinition[];
}
export interface ExternalToolRepository {
  list(): Promise<ExternalToolConnection[]>;
  get(id: string): Promise<ExternalToolConnection | null>;
  save(
    connection: ExternalToolConnection,
    expectedVersion: number,
  ): Promise<ExternalToolConnection>;
}
export interface ExternalToolSession {
  definitions: ExternalToolDefinition[];
  call(name: string, args: Json, signal?: AbortSignal): Promise<string>;
  callWithMedia?(
    name: string,
    args: Json,
    signal?: AbortSignal,
  ): Promise<ToolMediaResult>;
  close(): Promise<void>;
}
export type ConnectExternalTools = (
  connection: ExternalToolConnection,
  signal?: AbortSignal,
) => Promise<ExternalToolSession>;

export type ExternalErrorCode =
  "INVALID" | "NOT_FOUND" | "CONFLICT" | "GONE" | "UNAVAILABLE";
export class ExternalCallError extends Error {
  constructor(public code: ExternalErrorCode) {
    super(`MCP : ${code}. Aucun appel rejoué.`);
  }
}
