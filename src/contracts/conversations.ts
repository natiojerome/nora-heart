import type { FileAccess } from "./files.ts";
import type { ModelPhase } from "./models.ts";
export interface ConversationWork {
  status:"idle"|"running"|"waiting"|"completed"|"failed"|"cancelled"|"interrupted";
  at?:string;
  phase?:ModelPhase;
  commentary?:string;
}
export interface ModelSelection {
  provider: "demo" | "chatgpt" | "openai" | "anthropic" | "openrouter";
  modelId: string;
  contextWindow: number;
  capacitySource: "catalog" | "configured";
  reasoningEffort?: string;
}
export interface ConversationPosition { at:string; id:string; }
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  selection: ModelSelection | null;
  projectId?: string | null;
  fileAccess?: FileAccess;
  networkAccess?: boolean;
  maxSteps?: number;
  /** Derived read model, not a persisted preference. */
  work?:ConversationWork;
  /** Read-only exact ordering key; never stored as a preference. */
  position?:ConversationPosition;
}
export interface ConversationRepository {
  create(conversation: Conversation): Promise<void>;
  get(id: string): Promise<Conversation | null>;
  list(options?:{before?:ConversationPosition;limit?:number;projectId?:string;query?:string}): Promise<Conversation[]>;
  select(id: string, selection: ModelSelection, expected?:ModelSelection|null): Promise<void>;
  setFileAccess(id: string, access: FileAccess): Promise<void>;
  setExecutionPolicy(id:string,network:boolean,maxSteps:number):Promise<void>;
}
