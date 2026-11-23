import type { Project } from "./projects.ts";
export const projectStatuses = [
  "planning",
  "active",
  "blocked",
  "paused",
  "completed",
  "archived",
] as const;
export const projectItemStatuses = {
  goal: ["proposed", "active", "blocked", "completed", "cancelled"],
  task: ["todo", "in_progress", "blocked", "done", "cancelled"],
  blocker: ["open", "resolved"],
  decision: ["current", "superseded"],
  reference: ["linked", "removed"],
} as const;
export type ProjectItemKind = keyof typeof projectItemStatuses;
export interface ProjectItem {
  id: string;
  projectId: string;
  kind: ProjectItemKind;
  title: string;
  details: string;
  status: string;
  version: number;
  parentId: string | null;
  successCriteria: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectOverview {
  project: Project;
  statistics: {
    kind: ProjectItemKind;
    status: string;
    count: number;
    documented: number;
  }[];
  items: ProjectItem[];
  nextCursor: string | null;
  asOf: string;
}
export type ProjectChanges = Partial<
  Pick<
    Project,
    | "title"
    | "objective"
    | "description"
    | "nextAction"
    | "status"
    | "successCriteria"
    | "evidence"
  >
>;
export type ProjectItemChanges = Partial<
  Pick<
    ProjectItem,
    "title" | "details" | "status" | "parentId" | "successCriteria" | "evidence"
  >
>;
/** Operational tracking is separate from the small project identity repository used by SQL fixtures. */
export interface ProjectTracking {
  getItem(id: string): Promise<ProjectItem>;
  overview(
    id: string,
    cursor?: string,
    limit?: number,
  ): Promise<ProjectOverview>;
  update(
    id: string,
    version: number,
    changes: ProjectChanges,
  ): Promise<Project>;
  createItem(
    projectId: string,
    kind: ProjectItemKind,
    changes: ProjectItemChanges,
    operationId: string,
  ): Promise<ProjectItem>;
  updateItem(
    id: string,
    version: number,
    changes: ProjectItemChanges,
  ): Promise<ProjectItem>;
}
