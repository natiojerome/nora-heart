import { request } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import type {
  WorkspaceFiles,
  WorkspaceEntry,
  WorkspaceDocument,
} from "../../../contracts/files.ts";
import { WorkspaceError } from "../../../contracts/files.ts";

/** Root filesystem access through the existing private, explicitly selected YOLO worker. */
export class HostFiles implements WorkspaceFiles {
  constructor(
    private readonly socket: string,
    private readonly workspace: string,
    private readonly signal?: AbortSignal,
  ) {}
  private async response(
    route: string,
    args: unknown[],
    source?: AsyncIterable<Uint8Array>,
  ): Promise<IncomingMessage> {
    this.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const metadata = { workspace: this.workspace, args };
      const req = request(
        {
          socketPath: this.socket,
          path: route,
          method: "POST",
          signal: this.signal,
          headers: source
            ? {
                "x-heart-files-request": Buffer.from(
                  JSON.stringify(metadata),
                ).toString("base64url"),
              }
            : { "content-type": "application/json" },
        },
        async (res) => {
          try {
            if (res.statusCode === 200) {
              resolve(res);
              return;
            }
            // Worker errors are safe domain messages, never arbitrary filesystem/provider diagnostics.
            const chunks: Buffer[] = [];
            for await (const chunk of res) chunks.push(chunk);
            let message = "Fichiers YOLO indisponibles. Aucun repli local.";
            try {
              const value = JSON.parse(Buffer.concat(chunks).toString());
              if (typeof value.error === "string") message = value.error;
            } catch {}
            reject(new WorkspaceError(message));
            req.destroy(new WorkspaceError(message));
          } catch {
            reject(new WorkspaceError("Réponse fichiers YOLO interrompue."));
          }
        },
      );
      req.on("error", () =>
        reject(
          new WorkspaceError(
            "Connexion aux fichiers YOLO interrompue. Aucun repli local.",
          ),
        ),
      );
      void (async () => {
        try {
          if (source)
            await pipeline(Readable.from(source), req, { signal: this.signal });
          else req.end(JSON.stringify(metadata));
        } catch {
          req.destroy();
          reject(new WorkspaceError("Transfert fichier YOLO interrompu."));
        }
      })();
    });
  }
  private async call<T>(operation: string, args: unknown[]): Promise<T> {
    const res = await this.response("/files", [operation, ...args]),
      chunks: Buffer[] = [];
    for await (const chunk of res) chunks.push(chunk);
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new WorkspaceError("Réponse fichiers YOLO invalide.");
    }
  }
  list(input = "", offset?: number, count?: number) {
    return this.call<{
      entries: WorkspaceEntry[];
      truncated: boolean;
      nextOffset?: number;
    }>("list", [input, offset, count]);
  }
  info(input: string) {
    return this.call<WorkspaceEntry & { text: boolean }>("info", [input]);
  }
  read(input: string, offset?: number, length?: number) {
    return this.call<WorkspaceDocument>("read", [input, offset, length]);
  }
  create(input: string, content: string) {
    return this.call<void>("create", [input, content]);
  }
  update(input: string, content: string, revision: string) {
    return this.call<void>("update", [input, content, revision]);
  }
  replace(input: string, before: string, after: string, revision: string) {
    return this.call<void>("replace", [input, before, after, revision]);
  }
  move(input: string, destination: string, revision: string) {
    return this.call<void>("move", [input, destination, revision]);
  }
  remove(input: string, revision: string) {
    return this.call<void>("remove", [input, revision]);
  }
  mkdir(input: string) {
    return this.call<void>("mkdir", [input]);
  }
  async download(input: string) {
    const res = await this.response("/files/download", [input]);
    let entry: WorkspaceEntry;
    try {
      entry = JSON.parse(
        Buffer.from(
          String(res.headers["x-heart-file-entry"]),
          "base64url",
        ).toString(),
      );
    } catch {
      res.destroy();
      throw new WorkspaceError("Métadonnées fichiers YOLO invalides.");
    }
    return { entry, body: res as AsyncIterable<Uint8Array> };
  }
  async import(
    input: string,
    body: AsyncIterable<Uint8Array>,
    revision?: string,
  ) {
    const res = await this.response("/files/import", [input, revision], body);
    for await (const _ of res) {
    }
  }
}
