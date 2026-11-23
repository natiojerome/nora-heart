import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { SessionStore } from "../contracts/storage.ts";
import type { ExecutionService } from "../contracts/execution.ts";
import { Workspace, WorkspaceError } from "./workspace.ts";

/** Manual owner workspace. No conversation, model selection or model permission. */
export class ProjectsWorkspace {
  private readonly files: Workspace;
  constructor(
    readonly directory: string,
    sessions: SessionStore,
    private readonly execution?: ExecutionService,
  ) {
    if (!path.isAbsolute(directory))
      throw new Error("La racine des projets doit être absolue.");
    this.files = new Workspace(sessions);
  }
  async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }
  info() {
    return { directory: this.directory, executionAvailable: !!this.execution };
  }
  inspect(input: string, read: boolean, offset?: number, count?: number) {
    return this.files.inspect(this.directory, input, read, offset, count);
  }
  document(input: string) {
    return this.files.info(this.directory, input);
  }
  download(input: string) {
    return this.files.download(this.directory, input);
  }
  mutate(body: Record<string, unknown>, source?: AsyncIterable<Uint8Array>) {
    return this.files.action("owner-projects", this.directory, body, source);
  }
  private runner() {
    if (!this.execution)
      throw new WorkspaceError("Terminal indisponible dans cet environnement.");
    return this.execution;
  }
  async commands() {
    return { commands: await this.runner().list(this.directory) };
  }
  async start(body: Record<string, unknown>) {
    if (
      typeof body.command !== "string" ||
      (body.cwd !== undefined && typeof body.cwd !== "string")
    )
      throw new WorkspaceError("Commande ou dossier invalide.");
    return {
      command: await this.runner().start(this.directory, {
        command: body.command,
        cwd: body.cwd as string | undefined,
        network: true,
      }),
    };
  }
  output(id: string, offset?: number) {
    return this.runner().read(this.directory, id, offset);
  }
  async input(id: string, body: Record<string, unknown>) {
    if (typeof body.input !== "string")
      throw new WorkspaceError("Entrée texte requise.");
    await this.runner().write(
      this.directory,
      id,
      body.input,
      body.close === true,
    );
    return { ok: true };
  }
  async stop(id: string) {
    return { command: await this.runner().stop(this.directory, id) };
  }
  async close() {
    if (this.execution)
      for (const command of await this.execution.list(this.directory))
        if (command.status === "running" && !command.independent)
          await this.execution.stop(this.directory, command.id);
  }
}
