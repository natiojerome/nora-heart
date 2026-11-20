import type { AttachmentRef } from "./chat-assets.ts";
import type { Json } from "./json.ts";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Json;
}

export type Message =
  | { role: "user"; content: string; attachments?: AttachmentRef[] }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string; error: boolean };
