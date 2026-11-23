import { randomUUID } from "node:crypto";
import type { ProjectRepository } from "../contracts/projects.ts";
import {
  projectStatuses,
  projectItemStatuses,
  type ProjectTracking,
  type ProjectChanges,
  type ProjectItemChanges,
  type ProjectItemKind,
} from "../contracts/project-tracking.ts";
export class ProjectManagementError extends Error {}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new ProjectManagementError(
      "Version du suivi requise. Actualise avant de réessayer.",
    );
  return value as number;
}
function strings(body: Record<string, unknown>, fields: readonly string[]) {
  const result: Record<string, string> = {};
  for (const key of fields)
    if (body[key] !== undefined) {
      if (typeof body[key] !== "string")
        throw new ProjectManagementError("Champ de suivi invalide.");
      result[key] = body[key] as string;
    }
  return result;
}
export async function createProject(
  repository: ProjectRepository,
  body: Record<string, unknown>,
) {
  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > 160
  )
    throw new ProjectManagementError("Titre requis (160 caractères maximum).");
  if (
    body.objective !== undefined &&
    (typeof body.objective !== "string" || !body.objective.trim())
  )
    throw new ProjectManagementError("Objectif requis.");
  if (body.operationId !== undefined && !uuid(body.operationId))
    throw new ProjectManagementError("Identifiant de création invalide.");
  strings(body, ["successCriteria"]);
  return {
    project: await repository.create({
      id:
        typeof body.operationId === "string" ? body.operationId : randomUUID(),
      title: body.title.trim(),
      ...(typeof body.objective === "string"
        ? { objective: body.objective.trim() }
        : {}),
      ...(typeof body.successCriteria === "string"
        ? { successCriteria: body.successCriteria }
        : {}),
    }),
  };
}
export class ProjectManagement {
  constructor(
    private readonly tracking: ProjectTracking,
    private readonly repository?: ProjectRepository,
  ) {}
  list() {
    if (!this.repository)
      throw new ProjectManagementError("Connexion Projets requise.");
    return this.repository.list().then((projects) => ({ projects }));
  }
  create(body: Record<string, unknown>) {
    if (!this.repository)
      throw new ProjectManagementError("Connexion Projets requise.");
    return createProject(this.repository, body);
  }
  get(id: string, cursor?: string) {
    if (!uuid(id)) throw new ProjectManagementError("Projet introuvable.");
    return this.tracking.overview(id, cursor);
  }
  update(id: string, body: Record<string, unknown>) {
    if (!uuid(id)) throw new ProjectManagementError("Projet introuvable.");
    const changes = strings(body, [
      "title",
      "objective",
      "description",
      "nextAction",
      "successCriteria",
      "evidence",
      "status",
    ]);
    if (
      changes.status &&
      !projectStatuses.includes(
        changes.status as (typeof projectStatuses)[number],
      )
    )
      throw new ProjectManagementError("Statut de projet invalide.");
    return this.tracking.update(
      id,
      version(body.version),
      changes as ProjectChanges,
    );
  }
  async saveItem(projectId: string, body: Record<string, unknown>) {
    if (
      !uuid(projectId) ||
      !["goal", "task", "blocker"].includes(String(body.kind))
    )
      throw new ProjectManagementError("Type d’objectif ou projet invalide.");
    const kind = body.kind as ProjectItemKind,
      changes: ProjectItemChanges = strings(body, [
        "title",
        "details",
        "status",
        "successCriteria",
        "evidence",
      ]);
    if (!changes.title?.trim())
      throw new ProjectManagementError(
        "Nom de l’objectif ou de l’étape requis.",
      );
    if (
      changes.status &&
      !(projectItemStatuses[kind] as readonly string[]).includes(changes.status)
    )
      throw new ProjectManagementError("Statut incompatible avec cet élément.");
    if (body.parentId !== undefined) {
      if (body.parentId !== null && !uuid(body.parentId))
        throw new ProjectManagementError("Objectif parent invalide.");
      changes.parentId = body.parentId as string | null;
    }
    if (body.id !== undefined) {
      if (!uuid(body.id))
        throw new ProjectManagementError("Élément introuvable.");
      const current = await this.tracking.getItem(body.id);
      if (current.projectId !== projectId || current.kind !== kind)
        throw new ProjectManagementError("Élément hors de ce projet.");
      return this.tracking.updateItem(body.id, version(body.version), changes);
    }
    if (!uuid(body.operationId))
      throw new ProjectManagementError("Identifiant de création requis.");
    return this.tracking.createItem(projectId, kind, changes, body.operationId);
  }
}
