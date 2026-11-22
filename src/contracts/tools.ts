import type { ToolMediaResult } from "./messages.ts";
import type { InputRequest, InputResponse } from "./interactions.ts";
import type { Json } from "./json.ts";

export interface ToolDefinition {
  title?: string;
  name: string;
  description: string;
  parameters: Record<string, Json>;
}

export interface ToolContext {
  workspace: string;
  runId?: string;
  callId?: string;
  signal?: AbortSignal;
}

export type Permission =
  | "history.read"
  | "skills.read"
  | "files.read"
  | "files.write"
  | "memory.read"
  | "memory.write"
  | "process.execute"
  | "user.input"
  | "external.read"
  | "external.write"
  | "tasks.read"
  | "tasks.write";

export interface Tool<T = string> extends ToolDefinition {
  permission: Permission;
  /** Tool arguments/results are only available during this run, not in durable history. */
  transient?: boolean;
  execute(args: Json, context: ToolContext): Promise<T>;
  executeWithMedia?(args: Json, context: ToolContext): Promise<ToolMediaResult>;
  resolveInput?(request: InputRequest, response: InputResponse): InputResponse;
}
