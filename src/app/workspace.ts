import { randomUUID } from "node:crypto";
import { Engine } from "../core/engine.ts";
import {
  fileTools,
  LocalFiles,
  WorkspaceError,
} from "../modules/tools/files/index.ts";
import type { SessionStore } from "../contracts/storage.ts";
import type { Json } from "../contracts/json.ts";

/** Owner actions use the same permission checks, claim and tool journal as model actions. */
export class Workspace {
  constructor(private readonly sessions: SessionStore) {}
  async inspect(
    directory: string,
    input: string,
    read: boolean,
    offset?: number,
    count?: number,
  ) {
    const files = new LocalFiles(directory);
    return read
      ? { document: await files.read(input, offset, count) }
      : await files.list(input, offset, count);
  }
  async download(directory: string, input: string) {
    return new LocalFiles(directory).download(input);
  }
  async info(directory: string, input: string) {
    return { document: await new LocalFiles(directory).info(input) };
  }
  async action(
    id: string,
    directory: string,
    body: Record<string, unknown>,
    source?: AsyncIterable<Uint8Array>,
  ) {
    const names: Record<string, string> = {
      create: "files.create",
      update: "files.update",
      move: "files.move",
      delete: "files.delete",
      mkdir: "files.mkdir",
      ...(source ? { import: "files.import" } : {}),
    };
    const action = String(body.action),
      name = names[action];
    if (!name) throw new WorkspaceError("Action fichier inconnue.");
    const args: Record<string, Json> = {};
    for (const key of ["path", "content", "revision", "destination"])
      if (body[key] !== undefined) {
        if (typeof body[key] !== "string")
          throw new WorkspaceError("Arguments fichier invalides.");
        args[key] = body[key];
      }
    // Owner editor contents stay in the file, not in the audit journal or model context.
    const content = args.content;
    delete args.content;
    const engine = new Engine(
      this.sessions,
      [
        ...fileTools(),
        ...(source
          ? [
              {
                name: "files.import",
                permission: "files.write" as const,
                description:
                  "Importer un fichier en flux, sans conversion de format.",
                parameters: {
                  type: "object",
                  properties: { path: { type: "string" } },
                  required: ["path"],
                },
                execute: async () => {
                  if (typeof body.path !== "string")
                    throw new WorkspaceError("Chemin requis.");
                  await new LocalFiles(directory).import(
                    body.path,
                    source,
                    typeof body.revision === "string"
                      ? body.revision
                      : undefined,
                  );
                  return JSON.stringify({ ok: true });
                },
              },
            ]
          : []),
      ].map((tool) => ({
        ...tool,
        execute: (input, context) =>
          tool.execute(
            {
              ...(input as Record<string, Json>),
              ...(content !== undefined ? { content } : {}),
            },
            context,
          ),
      })),
    );
    let executed = false;
    const journalId = `workspace-${id}`,
      lockId = randomUUID();
    let claimed = false;
    try {
      if (this.sessions.claim) {
        await this.sessions.claim(id, lockId);
        claimed = true;
      }
      const run = await engine.run({
        sessionId: journalId,
        workspace: directory,
        displayName: "Propriétaire",
        prompt: `Action du propriétaire dans l’explorateur : ${action} ${String(body.path ?? "")}`,
        maxSteps: 2,
        permissions: new Set(["files.read", "files.write"]),
        provider: {
          id: "owner:workspace",
          async generate() {
            if (!executed) {
              executed = true;
              return {
                content: "",
                toolCalls: [{ id: randomUUID(), name, arguments: args }],
              };
            }
            return {
              content:
                "Action de l’explorateur terminée. Consulter le résultat de l’outil pour son état.",
              toolCalls: [],
            };
          },
        },
      });
      const events = (await this.sessions.read(journalId)).filter(
        (event) => event.runId === run.runId,
      );
      const result = events.find(
        (event) =>
          event.type === "message" &&
          (event.data as { role?: string }).role === "tool",
      );
      if (!result)
        throw new WorkspaceError(
          "Résultat fichier absent. Vérifie l’explorateur avant de relancer.",
        );
      const data = result.data as { error: boolean; content: string };
      if (data.error) throw new WorkspaceError(data.content);
      return { ok: true };
    } finally {
      if (claimed) await this.sessions.release!(id, lockId);
    }
  }
}

export { WorkspaceError } from "../modules/tools/files/index.ts";
