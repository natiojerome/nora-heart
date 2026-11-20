export interface Memory {
  id: string;
  content: string;
  title?: string;
  version?: number;
}

// Public behavior consumed by tools/context. No SQL or storage-specific types.
export interface MemoryService {
  remember(content: string): Promise<Memory>;
  search(query: string): Promise<Memory[]>;
}

// Persistence operations, injected into memory implementations that need them.
export interface MemoryRepository {
  // Deduplicate exact content atomically, returning the existing ID on a retry.
  save(memory: Memory): Promise<Memory>;
  // Match all literal terms case-insensitively. Return the last `limit` matches
  // in insertion order. Limits are positive integers supplied by the service.
  find(terms: readonly string[], limit: number): Promise<Memory[]>;
}
