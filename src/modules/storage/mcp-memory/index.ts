import type { Json } from "../../../contracts/json.ts";
import type {
  MemoryRecord,
  MemoryFilter,
  StructuredMemoryRepository,
  MemorySource,
} from "../../../contracts/structured-memory.ts";
import { ExternalCallError } from "../../../contracts/external-tools.ts";
/** Domain mapping at the storage boundary. No concrete MCP or memory module import. */
export type MemoryMcpCall = (
  name: string,
  args: Record<string, Json>,
) => Promise<Json>;
interface RemoteMemory {
  id: string;
  version: number;
  title: string;
  content: string;
  kind: string;
  scope: string;
  context?: { namespace: string; id: string };
  source?: { namespace: string; reference?: string };
  createdAt: string;
  updatedAt: string;
}
const contextNamespace = "nora-projects";
export class McpMemoryRepository implements StructuredMemoryRepository {
  readonly supportsRestore = false;
  constructor(
    private readonly call: MemoryMcpCall,
    private readonly aliases: Readonly<Record<string, string>> = {},
  ) {}
  private record(value: unknown): MemoryRecord | null {
    const r = value as RemoteMemory;
    if (
      !r ||
      typeof r.id !== "string" ||
      typeof r.content !== "string" ||
      !Number.isInteger(r.version)
    )
      throw new Error("Mémoire MCP : réponse incompatible.");
    if (
      r.scope !== "personal" &&
      (r.scope !== "project" || r.context?.namespace !== contextNamespace)
    )
      return null;
    const source: MemorySource =
      r.source?.namespace === "nora-heart.conversation" && r.source.reference
        ? { type: "conversation", conversationId: r.source.reference }
        : {
            type:
              r.source?.namespace === "nora-heart.manual" ? "manual" : "legacy",
          };
    return {
      id: r.id,
      version: r.version,
      title: r.title,
      content: r.content,
      kind: ["preference", "constraint", "decision"].includes(r.kind)
        ? (r.kind as MemoryRecord["kind"])
        : "fact",
      scope: r.scope as "personal" | "project",
      projectId: r.scope === "project" ? r.context!.id : null,
      status: "active",
      source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
  private input(record: MemoryRecord): Record<string, Json> {
    return {
      title: record.title,
      content: record.content,
      kind: record.kind,
      scope: record.scope,
      context:
        record.scope === "project"
          ? { namespace: contextNamespace, id: record.projectId! }
          : null,
      source: {
        namespace:
          record.source.type === "conversation"
            ? "nora-heart.conversation"
            : record.source.type==='legacy'?'nora-heart.legacy':"nora-heart.manual",
        ...(record.source.conversationId
          ? { reference: record.source.conversationId }
          : {}),
      },
    };
  }
  async create(record: MemoryRecord) {
    const args = this.input(record);
    if (args.context === null) delete args.context;
    const saved = this.record(
      await this.call("memory_create", { ...args, operationId: record.id }),
    );
    if (!saved) throw new Error("Mémoire MCP : portée incompatible.");
    return saved;
  }
  async get(id: string) {
    try {
      return this.record(
        await this.call("memory_get", { id: this.aliases[id] ?? id }),
      );
    } catch (error) {
      if (error instanceof ExternalCallError && error.code === "NOT_FOUND")
        return null;
      throw error;
    }
  }
  async list(filter: MemoryFilter) {
    const items: MemoryRecord[] = [];
    let cursor: string | undefined;
    const query = filter.terms
      ?.map((term) => '"' + term.replaceAll('"', "") + '"')
      .join(" OR ");
    const scopes: Record<string, Json>[] =
      filter.projectId === undefined
        ? [{}]
        : [
            { scope: "personal" },
            ...(filter.projectId
              ? [
                  {
                    scope: "project",
                    context: {
                      namespace: contextNamespace,
                      id: filter.projectId,
                    },
                  },
                ]
              : []),
          ];
    for (const scope of scopes) {
      cursor = undefined;
      let scopeCount = 0;
      const seen = new Set<string>();
      do {
        const limit =
          filter.limit > 0
            ? Math.min(100, Math.max(1, filter.limit - scopeCount))
            : 100;
        const page = (await this.call("memory_search", {
          ...scope,
          ...(query ? { query } : {}),
          ...(cursor ? { cursor } : {}),
          limit,
          includeContent: true,
        })) as unknown as { items: RemoteMemory[]; nextCursor: string | null };
        if (!Array.isArray(page.items))
          throw new Error("Mémoire MCP : page incompatible.");
        for (const value of page.items) {
          const mapped = this.record(value);
          if (mapped) {
            items.push(mapped);
            scopeCount++;
          }
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor))
          throw new Error("Mémoire MCP : pagination incohérente.");
        if (cursor) seen.add(cursor);
      } while (cursor && (filter.limit === 0 || scopeCount < filter.limit));
    }
    if (filter.terms?.length) {
      const score = (record: MemoryRecord) =>
        filter.terms!.reduce(
          (n, term) =>
            n +
            (record.title.toLocaleLowerCase().includes(term) ? 3 : 0) +
            (record.content.toLocaleLowerCase().includes(term) ? 1 : 0),
          0,
        );
      items.sort(
        (a, b) =>
          score(b) - score(a) ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          a.id.localeCompare(b.id),
      );
    }
    return items.slice(0, filter.limit || undefined);
  }
  async replace(record: MemoryRecord, expectedVersion: number) {
    if (record.status === "forgotten") {
      await this.call("memory_forget", { id: record.id, expectedVersion });
      return { ...record, status: "forgotten" as const };
    }
    const current = await this.get(record.id);
    if (!current)
      throw new Error(
        "Souvenir introuvable. L’oubli distant supprime les versions actives.",
      );
    const saved = this.record(
      await this.call("memory_update", {
        id: record.id,
        expectedVersion,
        ...this.input(record),
      }),
    );
    if (!saved) throw new Error("Mémoire MCP : portée incompatible.");
    return saved;
  }
  async revisions(id: string) {
    const items: MemoryRecord[] = [];
    let beforeVersion: number | undefined;
    const seen = new Set<number>();
    do {
      const page = (await this.call("memory_revisions", {
        id: this.aliases[id] ?? id,
        ...(beforeVersion ? { beforeVersion } : {}),
        limit: 100,
      })) as unknown as { items: RemoteMemory[]; nextCursor: string | null };
      if (!Array.isArray(page.items))
        throw new Error("Mémoire MCP : historique incompatible.");
      for (const value of page.items) {
        const mapped = this.record(value);
        if (mapped) items.push(mapped);
      }
      beforeVersion = page.nextCursor ? Number(page.nextCursor) : undefined;
      if (
        beforeVersion &&
        (!Number.isInteger(beforeVersion) || seen.has(beforeVersion))
      )
        throw new Error("Mémoire MCP : historique incohérent.");
      if (beforeVersion) seen.add(beforeVersion);
    } while (beforeVersion);
    return items;
  }
}
