import { randomUUID } from "node:crypto";
import type { StructuredMemoryService, MemoryInput } from "../contracts/structured-memory.ts";
import type { ProjectRepository } from "../contracts/projects.ts";

export class Memories {
  constructor(private readonly memory: StructuredMemoryService, private readonly projects: ProjectRepository) {}
  async get(id:string){return {memory:await this.memory.get(id)};}
  async list() { const [memories,projects]=await Promise.all([this.memory.list(true),this.projects.list()]); return {memories,projects,supportsRestore:this.memory.supportsRestore!==false}; }
  async createProject(body: Record<string, unknown>) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 160) throw new Error("Titre requis (160 caractères maximum).");
    if (body.objective !== undefined && (typeof body.objective !== "string" || !body.objective.trim())) throw new Error("Objectif requis.");
    if (body.operationId !== undefined && (typeof body.operationId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.operationId))) throw new Error("Identifiant de création invalide.");
    const project = await this.projects.create({ id: typeof body.operationId === "string" ? body.operationId : randomUUID(), title: body.title.trim(), ...(typeof body.objective === "string" ? {objective:body.objective.trim()} : {}) });
    return { project };
  }
  private async input(body: Record<string, unknown>): Promise<MemoryInput> {
    const projectId = body.scope === "project" ? body.projectId : null;
    if (body.scope === "project" && (typeof projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(projectId) || !await this.projects.get(projectId))) throw new Error("Projet introuvable.");
    return { title: body.title as string, content: body.content as string, kind: body.kind as MemoryInput["kind"], scope: body.scope as MemoryInput["scope"], projectId: projectId as string | null };
  }
  async create(body: Record<string, unknown>) { return { memory: await this.memory.rememberRecord(await this.input(body)) }; }
  async update(id: string, body: Record<string, unknown>) {
    return { memory: await this.memory.update(id, body.version as number, await this.input(body)) };
  }
  async status(id: string, body: Record<string, unknown>) {
    return { memory: await this.memory.setStatus(id, body.version as number, body.status as "active" | "forgotten") };
  }
  async revisions(id: string) { return { revisions: await this.memory.revisions(id) }; }
}
