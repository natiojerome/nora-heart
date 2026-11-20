import type { StructuredMemoryRepository } from "./structured-memory.ts";
import type { Json } from "./json.ts";
import type { MemoryRepository } from "./memory.ts";

export interface Event {
  id: string;
  at: string;
  runId: string;
  type: "run.started" | "run.progress" | "message" | "tool.started" | "tool.finished" | "run.completed" | "run.failed" | "context.checkpoint" | "context.usage" | "interaction.requested" | "interaction.resolved";
  data: Json;
}

export interface SessionStore {
  read(sessionId: string): Promise<Event[]>;
  /** Bounded owner-view reading; never changes the model context. */
  page?(sessionId:string, window:import("./history.ts").EventWindow):Promise<import("./history.ts").EventPage>;
  append(sessionId: string, event: Event): Promise<void>;
  /** All events or none; required to resolve a human-input pause safely. */
  appendBatch?(sessionId: string, events: Event[]): Promise<void>;
  claim?(sessionId: string, runId: string): Promise<void>;
  release?(sessionId: string, runId: string): Promise<void>;
  recoveryClaim?(sessionId: string): Promise<string | null>;
  /** Atomic tail/owner check, append repair and release; never executes an action. */
  reconcile?(sessionId: string, lastEventId: string | null, events: Event[]): Promise<void>;
}

export interface StorageConnection {
  sessions: SessionStore;
  memories: MemoryRepository;
  structuredMemories?: StructuredMemoryRepository;
  instanceId: string;
  close(): Promise<void>;
}
