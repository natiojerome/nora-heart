import { RecoveryError } from "../../../contracts/recovery.ts";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  Event,
  SessionStore,
  StorageConnection,
} from "../../../contracts/storage.ts";
import type { Memory, MemoryRepository } from "../../../contracts/memory.ts";

export async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

export class JsonlSessions implements SessionStore {
  private queue: Promise<void> = Promise.resolve();
  private claims = new Map<string, string>();
  constructor(private readonly directory: string) {}

  private file(id: string): string {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
      throw new Error("Identifiant de session invalide.");
    return path.join(this.directory, "sessions", `${id}.jsonl`);
  }

  async read(id: string): Promise<Event[]> {
    await this.queue;
    const raw = await readOptional(this.file(id));
    if (raw === null) return [];
    // Fail explicitly on damaged/truncated logs; never silently discard history.
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
  }

  async claim(id: string, runId: string): Promise<void> {
    const operation = this.queue.then(() => {
      this.file(id);
      if (this.claims.has(id))
        throw new Error(
          "Cette session travaille déjà ou nécessite une réconciliation.",
        );
      this.claims.set(id, runId);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async release(id: string, runId: string): Promise<void> {
    const operation = this.queue.then(() => {
      if (this.claims.get(id) === runId) this.claims.delete(id);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async append(id: string, event: Event): Promise<void> {
    return this.appendBatch(id, [event]);
  }
  async appendBatch(id: string, events: Event[]): Promise<void> {
    return this.write(id, events);
  }
  async recoveryClaim(id: string): Promise<string | null> {
    await this.queue;
    return this.claims.get(id) ?? null;
  }
  async reconcile(
    id: string,
    lastEventId: string | null,
    events: Event[],
  ): Promise<void> {
    return this.write(id, events, { lastEventId });
  }
  private async write(
    id: string,
    events: Event[],
    recovery?: { lastEventId: string | null },
  ): Promise<void> {
    const operation = this.queue.then(async () => {
      const file = this.file(id),
        raw = (await readOptional(file)) ?? "";
      const history: Event[] = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (recovery) {
        if (this.claims.has(id))
          throw new RecoveryError("Cette conversation travaille déjà.");
        if ((history.at(-1)?.id ?? null) !== recovery.lastEventId)
          throw new RecoveryError(
            "Le fil a changé. Actualise avant de réconcilier.",
          );
        if (!events.length)
          throw new RecoveryError("Aucune interruption à réconcilier.");
      }
      const fenced = new Set(
        history
          .filter(
            (event) =>
              event.type === "run.failed" &&
              (event.data as { reconciled?: boolean })?.reconciled,
          )
          .map((event) => event.runId),
      );
      if (events.some((event) => fenced.has(event.runId)))
        throw new RecoveryError(
          "Ce travail a été réconcilié. Écriture tardive refusée.",
        );
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = file + "." + randomUUID() + ".tmp";
      await writeFile(
        temporary,
        raw + events.map((event) => JSON.stringify(event) + "\n").join(""),
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, file);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

// One runtime process owns a state directory. Serialize memory writes in-process.
export class JsonMemoryRepository implements MemoryRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}

  async find(terms: readonly string[], limit: number): Promise<Memory[]> {
    await this.queue;
    const raw = await readOptional(path.join(this.directory, "memory.json"));
    const memories = raw === null ? [] : (JSON.parse(raw) as Memory[]);
    return memories
      .filter((m) =>
        terms.every((t) =>
          m.content.toLocaleLowerCase().includes(t.toLocaleLowerCase()),
        ),
      )
      .slice(-limit);
  }

  async save(memory: Memory): Promise<Memory> {
    const { content } = memory;
    const operation = this.queue.then(async () => {
      const file = path.join(this.directory, "memory.json");
      const raw = await readOptional(file);
      const memories: Memory[] = raw === null ? [] : JSON.parse(raw);
      const existing = memories.find((m) => m.content === content);
      if (existing) return existing;
      await atomicJson(file, [...memories, memory]);
      return memory;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

export async function instanceId(directory: string): Promise<string> {
  const file = path.join(directory, "instance.json");
  const existing = await readOptional(file);
  if (existing !== null) return (JSON.parse(existing) as { id: string }).id;
  const id = randomUUID();
  await atomicJson(file, { id, schemaVersion: 1 });
  return id;
}

export async function openJsonStorage(
  directory: string,
): Promise<StorageConnection> {
  return {
    sessions: new JsonlSessions(directory),
    memories: new JsonMemoryRepository(directory),
    instanceId: await instanceId(directory),
    async close() {},
  };
}
