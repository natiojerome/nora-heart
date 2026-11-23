import {createProject} from "./project-management.ts";
import type { StructuredMemoryService, MemoryInput } from "../contracts/structured-memory.ts";
import type { ProjectRepository } from "../contracts/projects.ts";

export class Memories {
  constructor(private readonly memory: StructuredMemoryService, private readonly projects: ProjectRepository) {}
  async get(id:string){return {memory:await this.memory.get(id)};}
  async list(includeProjects=true) { const [memories,projects]=await Promise.all([this.memory.list(true),includeProjects?this.projects.list():Promise.resolve([])]); return {memories,projects,supportsRestore:this.memory.supportsRestore!==false}; }
  listProjects(){return this.projects.list().then(projects=>({projects}));}
  createProject(body:Record<string,unknown>){return createProject(this.projects,body);}
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
