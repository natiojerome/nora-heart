import type { StorageConnection, SessionStore } from "./storage.ts";
import type { StructuredMemoryRepository } from "./structured-memory.ts";
import type { ConversationRepository } from "./conversations.ts";
import type { ProjectRepository } from "./projects.ts";
import type { AssistantProfileRepository } from "./assistant.ts";
import type { ChatAssetsRepository } from "./chat-assets.ts";
import type { ExternalToolRepository } from "./external-tools.ts";

/** Behaviour shared by SQL adapters; no SQL dialect or database client crosses this boundary. */
export interface SqlStorageConnection extends StorageConnection {
  tasks:import("./tasks.ts").TaskRepository;
  sessions: Required<SessionStore>;
  structuredMemories: StructuredMemoryRepository;
  conversations: ConversationRepository;
  projects: ProjectRepository;
  assistant: AssistantProfileRepository;
  chatAssets: ChatAssetsRepository;
  externalTools: ExternalToolRepository;
}
