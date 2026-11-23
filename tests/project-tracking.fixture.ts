import { randomUUID } from "node:crypto";
import { ExternalCallError } from "../src/contracts/external-tools.ts";
import type {
  ProjectItem,
  ProjectOverview,
  ProjectItemKind,
  ProjectItemChanges,
} from "../src/contracts/project-tracking.ts";
import type { Project } from "../src/contracts/projects.ts";
import { McpProjectsRepository } from "../src/modules/storage/mcp-projects/index.ts";
/** Synthetic remote boundary; SQL hierarchy rules are tested in the independent MCP suite. */
export function projectTrackingFixture() {
  const project: Project = {
    id: randomUUID(),
    title: "Projet de démonstration",
    objective: "Livrer une version utilisable",
    successCriteria: "Parcours utilisateur vérifié",
    evidence: "",
    nextAction: "Définir les étapes",
    version: 1,
    status: "active",
  };
  const items = new Map<string, ProjectItem>(),
    calls: { name: string; args: Record<string, unknown> }[] = [];
  let conflict = false,
    available = true;
  const native = () => {
    const { title, ...fields } = project;
    return { ...fields, name: title };
  };
  const done = (i: ProjectItem) =>
    ["completed", "done", "resolved", "cancelled"].includes(i.status);
  function validate(i: ProjectItem) {
    if (
      ["done", "completed"].includes(i.status) &&
      (!i.successCriteria.trim() || !i.evidence.trim())
    )
      throw new ExternalCallError("INVALID");
    if (
      i.kind === "goal" &&
      i.status === "completed" &&
      [...items.values()].some((c) => c.parentId === i.id && !done(c))
    )
      throw new ExternalCallError("INVALID");
  }
  const repository = new McpProjectsRepository(async (name, args) => {
    calls.push({ name, args });
    if (!available) throw new ExternalCallError("UNAVAILABLE");
    if (name === "projects_search")
      return { items: [native()], nextCursor: null };
    if (name === "projects_get") return native();
    if (name === "projects_overview") {
      const stats = new Map<
        string,
        {
          kind: ProjectItemKind;
          status: string;
          count: number;
          documented: number;
        }
      >();
      for (const i of items.values()) {
        const k = i.kind + ":" + i.status,
          s = stats.get(k) || {
            kind: i.kind,
            status: i.status,
            count: 0,
            documented: 0,
          };
        s.count++;
        if (i.evidence && i.successCriteria) s.documented++;
        stats.set(k, s);
      }
      const start = Number(args.cursor || 0),
        limit = Number(args.limit || 50),
        all = [...items.values()];
      return {
        project: native(),
        items: structuredClone(all.slice(start, start + limit)),
        statistics: [...stats.values()],
        asOf: new Date().toISOString(),
        nextCursor: start + limit < all.length ? String(start + limit) : null,
      } as never;
    }
    if (name === "projects_item_get") {
      const i = items.get(String(args.id));
      if (!i) throw new ExternalCallError("NOT_FOUND");
      return structuredClone(i) as never;
    }
    if (name === "projects_item_create") {
      const i: ProjectItem = {
        id: randomUUID(),
        projectId: project.id,
        kind: args.kind as ProjectItemKind,
        title: String(args.title),
        details: String(args.details || ""),
        status: String(
          args.status ||
            (
              { goal: "proposed", task: "todo", blocker: "open" } as Record<
                string,
                string
              >
            )[String(args.kind)],
        ),
        version: 1,
        parentId: (args.parentId as string | null) || null,
        successCriteria: String(args.successCriteria || ""),
        evidence: String(args.evidence || ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      validate(i);
      items.set(i.id, i);
      return structuredClone(i) as never;
    }
    if (name === "projects_item_update") {
      const i = items.get(String(args.id));
      if (!i) throw new ExternalCallError("NOT_FOUND");
      if (conflict || i.version !== args.expectedVersion) {
        conflict = false;
        throw new ExternalCallError("CONFLICT");
      }
      const { id, expectedVersion, ...changes } = args;
      const updated = {
        ...i,
        ...changes,
        version: i.version + 1,
      } as ProjectItem;
      validate(updated);
      items.set(i.id, updated);
      return structuredClone(updated) as never;
    }
    if (name === "projects_update") {
      if (conflict || project.version !== args.expectedVersion) {
        conflict = false;
        throw new ExternalCallError("CONFLICT");
      }
      if (
        args.status === "completed" &&
        [...items.values()].some((i) => !done(i))
      )
        throw new ExternalCallError("INVALID");
      const { id, expectedVersion, name, ...changes } = args;
      Object.assign(
        project,
        changes,
        ...(name !== undefined ? [{ title: name }] : []),
        { version: project.version! + 1 },
      );
      return native();
    }
    throw new Error("Unexpected synthetic tool " + name);
  });
  return {
    repository,
    project,
    items,
    calls,
    conflict() {
      conflict = true;
    },
    offline(value: boolean) {
      available = !value;
    },
  };
}
