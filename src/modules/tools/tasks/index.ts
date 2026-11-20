import { createHash } from "node:crypto";
import type { Json } from "../../../contracts/json.ts";
import type { Tool, ToolContext } from "../../../contracts/tools.ts";
import {
  TaskError,
  type TaskService,
  type TaskDraft,
  type TaskRun,
  type Task,
} from "../../../contracts/tasks.ts";
const string = { type: "string" };
const identity = string;
const version = { type: "integer", minimum: 1 };
const schedule = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["once", "recurring"] },
    timezone: string,
    at: string,
    frequency: { type: "string", enum: ["daily", "weekdays", "weekly"] },
    time: string,
    weekday: { type: "integer", minimum: 0, maximum: 6 },
  },
  required: ["kind", "timezone"],
  additionalProperties: false,
  description:
    "once: at ISO ; recurring: frequency,time HH:mm, weekly ajoute weekday 0=dim…6=sam. timezone IANA établi.",
};
const fields = {
  title: string,
  prompt: string,
  conversationId: identity,
  schedule,
  missed: { type: "string", enum: ["catch_up", "skip"] },
  notify: { type: "boolean" },
  active: { type: "boolean" },
};
function record(args: Json): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new TaskError("Arguments de tâche invalides.");
  return args;
}
/** RFC 9562 UUIDv5, fixed namespace; identities use run/call IDs, never titles or paths. */
function operationId(context: ToolContext, operation: string): string {
  if (!context.runId || !context.callId)
    throw new TaskError("Identité d’exécution manquante pour cette action.");
  const namespace = Buffer.from("9987b592e9ad493c9492f1d1d1b012f2", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(JSON.stringify([operation, context.runId, context.callId]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const briefRun = (run: TaskRun) => ({
  id: run.id,
  taskId: run.task.id,
  title: run.task.title,
  status: run.status,
  detail: run.detail,
  conversationId: run.task.conversationId,
  dueAt: run.dueAt,
  createdAt: run.createdAt,
  ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
});
const briefTask = (task: Task) => ({
  id: task.id,
  version: task.version,
  title: task.title,
  conversationId: task.conversationId,
  schedule: task.schedule,
  active: task.active,
  nextAt: task.nextAt,
  notify: task.notify,
  missed: task.missed,
});
export function taskTools(
  service: TaskService,
  currentConversationId: string,
): Tool[] {
  const action = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    write: boolean,
    execute: (
      args: Record<string, unknown>,
      context: ToolContext,
    ) => Promise<unknown>,
  ): Tool => ({
    name,
    description,
    permission: write ? "tasks.write" : "tasks.read",
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    } as Record<string, Json>,
    async execute(args, context) {
      context.signal?.throwIfAborted();
      return JSON.stringify(await execute(record(args), context));
    },
  });
  return [
    action(
      "tasks.list",
      "Tâches/versions, observedAt UTC, pagination nextCursor.",
      { after: identity, limit: { type: "integer", minimum: 1 } },
      [],
      false,
      async (args) => {
        const page = await service.list(
          args as { after?: string; limit?: number },
        );
        return {
          ...page,
          tasks: page.tasks.map((task) => ({
            ...briefTask(task),
            lastRun: task.lastRun ? briefRun(task.lastRun) : null,
          })),
          currentConversationId,
        };
      },
    ),
    action(
      "tasks.read",
      "Sans runId : tâche/version/occurrences (before). Avec runId : réponses réelles (after). Pagination nextCursor.",
      {
        id: identity,
        runId: identity,
        before: string,
        after: string,
        limit: { type: "integer", minimum: 1 },
      },
      ["id"],
      false,
      async (args) => {
        if (args.runId) {
          if (args.before !== undefined)
            throw new TaskError(
              "Pour les réponses, utiliser le curseur after.",
            );
          const result = await service.result(
            args.id as string,
            args.runId as string,
            args.after as string | undefined,
            args.limit as number | undefined,
          );
          return { ...result, run: briefRun(result.run) };
        }
        if (args.after !== undefined)
          throw new TaskError(
            "Pour les occurrences, utiliser le curseur before.",
          );
        const page = await service.get(
          args.id as string,
          args.before as string | undefined,
          args.limit as number | undefined,
        );
        return { ...page, runs: page.runs.map(briefRun) };
      },
    ),
    action(
      "tasks.write",
      "create : title,prompt,schedule ; défaut fil courant, notify/active=true, missed=catch_up. Sinon id/version actuels ; seuls champs fournis modifiés. run_now met en file après ce tour : conclure sans polling ni décaler le planning. Pas de secret ; notifications internes à Heart.",
      {
        action: {
          type: "string",
          enum: ["create", "update", "pause", "resume", "run_now"],
        },
        id: identity,
        version,
        ...fields,
      },
      ["action"],
      true,
      async (args, context) => {
        const kind = String(args.action);
        if (kind === "create")
          return {
            action: kind,
            ...(await service.create(
              {
                title: args.title,
                prompt: args.prompt,
                conversationId: args.conversationId ?? currentConversationId,
                schedule: args.schedule,
                missed: args.missed ?? "catch_up",
                notify: args.notify ?? true,
                active: args.active ?? true,
              } as TaskDraft,
              operationId(context, "create"),
            )),
          };
        if (
          typeof args.id !== "string" ||
          !Number.isSafeInteger(args.version) ||
          Number(args.version) < 1
        )
          throw new TaskError("ID et version actuels requis.");
        if (kind === "pause" || kind === "resume")
          return {
            action: kind,
            ...(await service.active(args.id, {
              version: args.version as number,
              active: kind === "resume",
            })),
          };
        if (kind === "run_now") {
          const result = await service.runNow(args.id, {
            version: args.version as number,
            executionId: operationId(context, "run"),
          });
          return {
            action: kind,
            run: briefRun(result.run),
            queued: result.run.status === "queued",
          };
        }
        if (kind !== "update") throw new TaskError("Action de tâche invalide.");
        const changes = Object.fromEntries(
          Object.keys(fields)
            .filter((key) => Object.hasOwn(args, key))
            .map((key) => [key, args[key]]),
        );
        if (!Object.keys(changes).length)
          throw new TaskError("Changements de tâche requis.");
        const current = (await service.get(args.id, undefined, 1)).task;
        return {
          action: kind,
          ...(await service.save({
            ...current,
            ...changes,
            id: args.id,
            version: args.version,
          } as TaskDraft & { id: string; version: number })),
        };
      },
    ),
  ];
}
