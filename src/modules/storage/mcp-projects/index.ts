import {
  projectItemStatuses,
  type ProjectTracking,
  type ProjectOverview,
  type ProjectChanges,
  type ProjectItem,
  type ProjectItemChanges,
  type ProjectItemKind,
} from "../../../contracts/project-tracking.ts";
import type { Json } from "../../../contracts/json.ts";
import type {
  Project,
  ProjectRepository,
} from "../../../contracts/projects.ts";
import { ExternalCallError } from "../../../contracts/external-tools.ts";

export type ProjectsMcpCall = (
  name: string,
  args: Record<string, Json>,
) => Promise<Json>;
/** Maps the remote authority; never writes a local project or retries an effect. */
export class McpProjectsRepository
  implements ProjectRepository, ProjectTracking
{
  private listing?: Promise<Project[]>;
  constructor(private readonly call: ProjectsMcpCall) {}
  private record(value: unknown): Project {
    const r = value as {
      id: string;
      name: string;
      version: number;
      status: string;
      objective?: string;
    };
    if (
      !r ||
      !/^[0-9a-f-]{36}$/i.test(r.id) ||
      typeof r.name !== "string" ||
      !Number.isInteger(r.version) ||
      typeof r.status !== "string"
    )
      throw new Error("Projets MCP : réponse incompatible.");
    const fields = r as unknown as Record<string, unknown>;
    const extras: Record<string, string> = {};
    for (const field of [
      "objective",
      "description",
      "nextAction",
      "successCriteria",
      "evidence",
      "createdAt",
      "updatedAt",
    ])
      if (typeof fields[field] === "string")
        extras[field] = fields[field] as string;
    if (!extras.objective && typeof fields.objectiveExcerpt === "string")
      extras.objective = fields.objectiveExcerpt;
    return {
      id: r.id,
      title: r.name,
      version: r.version,
      status: r.status,
      ...extras,
    };
  }
  async create(input: Project): Promise<Project> {
    return this.record(
      await this.call("projects_create", {
        name: input.title,
        objective: input.objective || input.title,
        operationId: input.id,
        ...(input.successCriteria !== undefined
          ? { successCriteria: input.successCriteria }
          : {}),
      }),
    );
  }
  private item(value: unknown): ProjectItem {
    const r = value as ProjectItem;
    if (
      !r ||
      typeof r.id !== "string" ||
      typeof r.projectId !== "string" ||
      !Object.hasOwn(projectItemStatuses, r.kind) ||
      !(projectItemStatuses[r.kind] as readonly string[]).includes(r.status) ||
      !Number.isSafeInteger(r.version) ||
      r.version < 1 ||
      (r.parentId !== null && typeof r.parentId !== "string") ||
      [
        "title",
        "details",
        "successCriteria",
        "evidence",
        "createdAt",
        "updatedAt",
      ].some(
        (field) =>
          typeof (r as unknown as Record<string, unknown>)[field] !== "string",
      )
    )
      throw Error("Projets MCP : élément incompatible.");
    return r;
  }
  async getItem(id: string) {
    return this.item(await this.call("projects_item_get", { id }));
  }
  async overview(
    id: string,
    cursor?: string,
    limit = 50,
  ): Promise<ProjectOverview> {
    // Do not join a read started before another conversation's write.
    const value = (await this.call("projects_overview", {
      id,
      limit,
      ...(cursor ? { cursor } : {}),
    })) as unknown as Omit<ProjectOverview, "project"> & { project: unknown };
    if (
      !value ||
      !Array.isArray(value.items) ||
      !Array.isArray(value.statistics) ||
      (value.nextCursor !== null && typeof value.nextCursor !== "string")
    )
      throw Error("Projets MCP : suivi incompatible.");
    if (
      typeof value.asOf !== "string" ||
      value.statistics.some(
        (s) =>
          !s ||
          !Object.hasOwn(projectItemStatuses, s.kind) ||
          typeof s.status !== "string" ||
          !Number.isSafeInteger(s.count) ||
          s.count < 0 ||
          !Number.isSafeInteger(s.documented) ||
          s.documented < 0 ||
          s.documented > s.count,
      )
    )
      throw Error("Projets MCP : compteurs incompatibles.");
    return {
      ...value,
      project: this.record(value.project),
      items: value.items.map((item) => this.item(item)),
    };
  }
  async update(id: string, version: number, changes: ProjectChanges) {
    const { title, ...rest } = changes;
    return this.record(
      await this.call("projects_update", {
        id,
        expectedVersion: version,
        ...rest,
        ...(title !== undefined ? { name: title } : {}),
      }),
    );
  }
  async createItem(
    projectId: string,
    kind: ProjectItemKind,
    changes: ProjectItemChanges,
    operationId: string,
  ) {
    return this.item(
      await this.call("projects_item_create", {
        projectId,
        kind,
        ...changes,
        operationId,
      }),
    );
  }
  async updateItem(id: string, version: number, changes: ProjectItemChanges) {
    return this.item(
      await this.call("projects_item_update", {
        id,
        expectedVersion: version,
        ...changes,
      }),
    );
  }
  async get(id: string): Promise<Project | null> {
    try {
      return this.record(await this.call("projects_get", { id }));
    } catch (error) {
      if (error instanceof ExternalCallError && error.code === "NOT_FOUND")
        return null;
      throw error;
    }
  }
  list(): Promise<Project[]> {
    // Coalesce only simultaneous requests. No stale cache across remote writes/users.
    if (!this.listing)
      this.listing = this.readPages().finally(() => {
        this.listing = undefined;
      });
    return this.listing.then((items) => items.map((item) => ({ ...item })));
  }
  private async readPages(): Promise<Project[]> {
    const items: Project[] = [],
      seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = (await this.call("projects_search", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      })) as unknown as { items: unknown[]; nextCursor: string | null };
      if (
        !Array.isArray(page.items) ||
        (page.nextCursor !== null && typeof page.nextCursor !== "string")
      )
        throw new Error("Projets MCP : pagination incompatible.");
      items.push(...page.items.map((item) => this.record(item)));
      cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor))
        throw new Error("Projets MCP : pagination incohérente.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
}
