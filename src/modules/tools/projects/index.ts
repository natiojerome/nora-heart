import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import formats from "ajv-formats";
import type { Json } from "../../../contracts/json.ts";
import type { Tool, ToolContext } from "../../../contracts/tools.ts";
import {
  projectStatuses,
  projectItemStatuses,
  type ProjectTracking,
  type ProjectItemChanges,
  type ProjectChanges,
  type ProjectItemKind,
} from "../../../contracts/project-tracking.ts";
export interface ProjectProgressAccess {
  overview: boolean;
  item: boolean;
  updateProject: boolean;
  createItem: boolean;
  updateItem: boolean;
}
const text = { type: "string" },
  id = { type: "string", format: "uuid" },
  version = { type: "integer", minimum: 1 };
function schema(
  properties: Record<string, Json>,
  required: string[],
): Record<string, Json> {
  return { type: "object", properties, required, additionalProperties: false };
}
function creationId(context: ToolContext) {
  if (!context.runId || !context.callId)
    throw Error("Identité d’écriture projet requise.");
  const bytes = createHash("sha1")
    .update(Buffer.from("ca609b653efb43a49de7ec56611b9a49", "hex"))
    .update(context.runId + ":" + context.callId)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Harness progress, scoped to the current project; storage approval remains enforced by the injected repository. */
export function projectProgressTools(
  tracking: ProjectTracking,
  projectId: string,
  access: ProjectProgressAccess,
): Tool[] {
  const result: Tool[] = [];
  const ajv = new Ajv({ strict: false, logger: false });
  (formats.default ?? formats)(ajv);
  const tool = (
    name: string,
    title: string,
    parameters: Record<string, Json>,
    write: boolean,
    execute: Tool["execute"],
  ): Tool => {
    const validate = ajv.compile(parameters);
    return {
      name,
      title,
      description:
        (write
          ? "Piloter le projet courant : update_project actualise statut/prochaine action/critères/preuve ; create_item ajoute goal, task ou blocker ; update_item actualise une étape existante avec id et expectedVersion. Utiliser ce chemin interne pour le suivi de ce projet, pas les outils MCP globaux d’autres projets."
          : "Lire le projet courant : operation overview retourne fiche, objectifs/étapes, compteurs et nextCursor ; operation item lit un id et sa version.") +
        title +
        ". Projet courant uniquement ; source distante, versions réelles, aucun repli local.",
      permission: write ? "projects.write" : "projects.read",
      parameters,
      async execute(args, context) {
        if (!validate(args))
          throw Error("Arguments de suivi projet invalides.");
        return execute(args, context);
      },
    };
  };
  const reads: Json[] = [];
  if (access.overview)
    reads.push(
      schema({ operation: { const: "overview" }, cursor: text }, ["operation"]),
    );
  if (access.item)
    reads.push(
      schema({ operation: { const: "item" }, id }, ["operation", "id"]),
    );
  if (reads.length)
    result.push(
      tool(
        "projects.read",
        "Lire le suivi du projet",
        { type: "object", oneOf: reads },
        false,
        async (args) => {
          const a = args as Record<string, Json>;
          if (a.operation === "overview")
            return JSON.stringify(
              await tracking.overview(
                projectId,
                typeof a.cursor === "string" ? a.cursor : undefined,
              ),
            );
          const item = await tracking.getItem(String(a.id));
          if (item.projectId !== projectId)
            throw Error("Élément hors du projet courant.");
          return JSON.stringify(item);
        },
      ),
    );
  const progress = {
    status: {
      type: "string",
      enum: [...new Set(Object.values(projectItemStatuses).flat())],
    },
    successCriteria: text,
    evidence: text,
    details: text,
  };
  const writes: Json[] = [];
  if (access.updateProject)
    writes.push(
      schema(
        {
          operation: { const: "update_project" },
          expectedVersion: version,
          nextAction: text,
          status: { type: "string", enum: [...projectStatuses] },
          successCriteria: text,
          evidence: text,
        },
        ["operation", "expectedVersion"],
      ),
    );
  if (access.createItem)
    writes.push(
      schema(
        {
          operation: { const: "create_item" },
          kind: { type: "string", enum: ["goal", "task", "blocker"] },
          title: { type: "string", minLength: 1 },
          parentId: { anyOf: [id, { type: "null" }] },
          ...progress,
        },
        ["operation", "kind", "title"],
      ),
    );
  if (access.updateItem)
    writes.push(
      schema(
        {
          operation: { const: "update_item" },
          id,
          expectedVersion: version,
          title: { type: "string", minLength: 1 },
          parentId: { anyOf: [id, { type: "null" }] },
          ...progress,
        },
        ["operation", "id", "expectedVersion"],
      ),
    );
  if (writes.length)
    result.push(
      tool(
        "projects.write",
        "Mettre à jour le suivi du projet",
        { type: "object", oneOf: writes },
        true,
        async (args, context) => {
          const {
            operation,
            id: target,
            expectedVersion,
            kind,
            ...changes
          } = args as Record<string, Json>;
          if (operation === "update_project") {
            if (!Object.keys(changes).length)
              throw Error("Aucune mise à jour projet.");
            return JSON.stringify({
              operation,
              project: await tracking.update(
                projectId,
                Number(expectedVersion),
                changes as ProjectChanges,
              ),
            });
          }
          if (operation === "create_item")
            return JSON.stringify({
              operation,
              item: await tracking.createItem(
                projectId,
                kind as ProjectItemKind,
                changes as ProjectItemChanges,
                creationId(context),
              ),
            });
          if (!Object.keys(changes).length)
            throw Error("Aucune mise à jour d’élément.");
          const item = await tracking.getItem(String(target));
          if (item.projectId !== projectId)
            throw Error("Élément hors du projet courant.");
          return JSON.stringify({
            operation,
            item: await tracking.updateItem(
              item.id,
              Number(expectedVersion),
              changes as ProjectItemChanges,
            ),
          });
        },
      ),
    );
  return result;
}
