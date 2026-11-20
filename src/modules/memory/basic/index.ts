import { randomUUID } from "node:crypto";
import type { Memory, MemoryRepository, MemoryService } from "../../../contracts/memory.ts";

export class BasicMemory implements MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  async remember(content: string): Promise<Memory> {
    if (!content.trim() || content.length > 4000) throw new Error("Souvenir vide ou trop long.");
    return this.repository.save({ id: randomUUID(), content });
  }

  async search(query: string): Promise<Memory[]> {
    const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return this.repository.find(terms, 20);
  }
}
