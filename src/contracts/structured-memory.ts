import type { MemoryService } from "./memory.ts";

export type MemoryKind = "fact" | "preference" | "constraint" | "decision";
export interface MemorySource { type: "manual" | "conversation" | "legacy"; conversationId?: string }
export interface MemoryInput {
  title: string;
  content: string;
  kind: MemoryKind;
  scope: "personal" | "project";
  projectId: string | null;
}
export interface MemoryRecord extends MemoryInput {
  id: string;
  version: number;
  status: "active" | "forgotten";
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
}
export interface MemoryFilter {
  // undefined: owner administration, null: personal only, UUID: personal + project.
  projectId?: string | null;
  includeForgotten?: boolean;
  terms?: readonly string[];
  /** Zero requests all matching candidates; owner view pages are independent. */
  limit: number;
}
export interface StructuredMemoryRepository {
  readonly supportsRestore?:boolean;
  create(record: MemoryRecord): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord | null>;
  list(filter: MemoryFilter): Promise<MemoryRecord[]>;
  replace(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord>;
  revisions(id: string): Promise<MemoryRecord[]>;
}
export interface StructuredMemoryService extends MemoryService {
  readonly supportsRestore?:boolean;
  search(query: string): Promise<MemoryRecord[]>;
  rememberRecord(input: MemoryInput): Promise<MemoryRecord>;
  get(id: string): Promise<MemoryRecord>;
  list(includeForgotten?: boolean): Promise<MemoryRecord[]>;
  update(id: string, version: number, input: MemoryInput): Promise<MemoryRecord>;
  setStatus(id: string, version: number, status: MemoryRecord["status"]): Promise<MemoryRecord>;
  revisions(id: string): Promise<MemoryRecord[]>;
}

/** A confirmed missing/inaccessible record, never a transport or database outage. */
export class MemoryNotFoundError extends Error {
  constructor() { super("Souvenir introuvable."); this.name = "MemoryNotFoundError"; }
}
