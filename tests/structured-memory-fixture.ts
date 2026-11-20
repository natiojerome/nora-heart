import type { MemoryRecord, StructuredMemoryRepository, MemoryFilter } from "../src/contracts/structured-memory.ts";
import type { Project, ProjectRepository } from "../src/contracts/projects.ts";
import { StructuredMemory } from "../src/modules/memory/structured/index.ts";
import { Memories } from "../src/app/memories.ts";

export function structuredMemoryFixture() {
  const records = new Map<string, MemoryRecord>();
  const versions = new Map<string, MemoryRecord[]>();
  const clone = <T>(value: T): T => structuredClone(value);
  const accessible = (record: MemoryRecord, filter: MemoryFilter) =>
    (filter.includeForgotten || record.status === "active") && (filter.projectId === undefined || record.scope === "personal" || record.projectId === filter.projectId)
    && (!filter.terms || filter.terms.some(term => (record.title + " " + record.content).toLowerCase().includes(term)));
  const duplicate = (value: MemoryRecord) => [...records.values()].find(record => record.id !== value.id && record.status === "active" && record.scope === value.scope && record.projectId === value.projectId && record.content === value.content);
  const save = (record: MemoryRecord) => { records.set(record.id, clone(record)); versions.set(record.id, [...versions.get(record.id) ?? [], clone(record)]); return clone(record); };
  const repository: StructuredMemoryRepository = {
    async create(record) { return clone(duplicate(record) ?? save(record)); },
    async get(id) { return clone(records.get(id) ?? null); },
    async list(filter) { return clone([...records.values()].filter(record => accessible(record,filter)).slice(filter.limit===0?0:-filter.limit).reverse()); },
    async replace(record, expected) {
      if (records.get(record.id)?.version !== expected) throw new Error("Souvenir modifié depuis sa lecture. Actualiser avant de réessayer.");
      if (record.status === "active" && duplicate(record)) throw new Error("Un souvenir actif identique existe déjà dans cette portée.");
      return save(record);
    },
    async revisions(id) { return clone(versions.get(id) ?? []); },
  };
  const projectRecords = new Map<string,Project>();
  const projects: ProjectRepository = {
    async create(project) { projectRecords.set(project.id,clone(project)); return clone(project); },
    async get(id) { return clone(projectRecords.get(id) ?? null); },
    async list() { return clone([...projectRecords.values()]); },
  };
  const memory = new StructuredMemory(repository, { source: { type: "manual" } });
  return { repository, memory, projects, manager: new Memories(memory, projects) };
}
