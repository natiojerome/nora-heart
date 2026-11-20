import { ExternalCallError } from "../contracts/external-tools.ts";
import type { Json } from "../contracts/json.ts";
import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  ConnectExternalTools,
  ExternalToolConnection,
  ExternalToolDefinition,
  ExternalToolRepository,
  ExternalToolSession,
} from "../contracts/external-tools.ts";
import type { Conversation } from "../contracts/conversations.ts";
import type { Tool } from "../contracts/tools.ts";

export class ExternalToolError extends Error {}
const invalid = () =>
  new ExternalToolError(
    "MCP : configuration invalide. Utilise une URL HTTPS et une référence de secret.",
  );
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const localSearchPreset = {
  id: "8d59e10c-dc22-4b15-b17a-ce2b5be10d8d",
  version: 0,
  label: "Recherche web locale",
  url: "http://127.0.0.1:4217/mcp",
  auth: { type: "none" } as const,
  enabled: false,
  timeoutMs: 60000,
  tools: [],
};
function config(body: Record<string, unknown>): ExternalToolConnection {
  if (
    (body.id !== undefined && !uuid(body.id)) ||
    !Number.isSafeInteger(body.version) ||
    Number(body.version) < 0 ||
    typeof body.label !== "string" ||
    !body.label.trim() ||
    typeof body.url !== "string" ||
    typeof body.enabled !== "boolean" ||
    (body.allowWrites !== undefined && typeof body.allowWrites !== "boolean") ||
    (body.transient !== undefined && typeof body.transient !== "boolean") ||
    !Number.isSafeInteger(body.timeoutMs) ||
    Number(body.timeoutMs) < 1 ||
    Number(body.timeoutMs) > 2147483647
  )
    throw invalid();
  let url: URL;
  try {
    url = new URL(body.url);
  } catch {
    throw invalid();
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) =>
      /key|token|secret|password|authorization|credential/i.test(key),
    )
  )
    throw invalid();
  const auth = body.auth as ExternalToolConnection["auth"];
  if (
    !auth ||
    !["none", "bearer_env", "header_env"].includes(auth.type) ||
    Object.keys(auth).some(
      (key) =>
        !(
          auth.type === "none"
            ? ["type"]
            : auth.type === "bearer_env"
              ? ["type", "envVar"]
              : ["type", "envVar", "headerName"]
        ).includes(key),
    )
  )
    throw invalid();
  if (
    auth.type !== "none" &&
    (!/^[A-Z_][A-Z0-9_]*$/.test(auth.envVar) || typeof auth.envVar !== "string")
  )
    throw invalid();
  if (
    auth.type === "header_env" &&
    (typeof auth.headerName !== "string" ||
      !/^[A-Za-z0-9-]+$/.test(auth.headerName) ||
      [
        "host",
        "cookie",
        "content-length",
        "mcp-session-id",
        "mcp-protocol-version",
      ].includes(auth.headerName.toLowerCase()))
  )
    throw invalid();
  return {
    id: typeof body.id === "string" ? body.id : randomUUID(),
    version: Number(body.version),
    label: body.label.trim(),
    url: url.toString(),
    auth: structuredClone(auth),
    enabled: body.enabled,
    timeoutMs: Number(body.timeoutMs),
    ...(body.allowWrites === true ? { allowWrites: true } : {}),
    ...(body.transient === true ? { transient: true } : {}),
    tools: [],
  };
}
function sameEndpoint(a: ExternalToolConnection, b: ExternalToolConnection) {
  return (
    a.url === b.url &&
    isDeepStrictEqual(a.auth, b.auth) &&
    a.timeoutMs === b.timeoutMs
  );
}
export function externalToolName(id: string, name: string) {
  return (
    "mcp_" +
    id.replaceAll("-", "") +
    "_" +
    createHash("sha256").update(name).digest("hex").slice(0, 16)
  );
}

export class ExternalTools {
  private readonly health = new Map<
    string,
    { status: "connected" | "unavailable"; message?: string }
  >();
  constructor(
    private readonly repository: ExternalToolRepository,
    private readonly connect: ConnectExternalTools,
  ) {}
  async list() {
    return {
      connections: (await this.repository.list()).map((connection) => ({
        ...connection,
        health: this.health.get(connection.id) ?? {
          status: connection.enabled ? "unchecked" : "disabled",
        },
      })),
      preset: localSearchPreset,
    };
  }
  async discover(body: Record<string, unknown>) {
    const connection = config(body);
    let session: ExternalToolSession | undefined;
    try {
      session = await this.connect(connection);
      this.health.set(connection.id, { status: "connected" });
      return { tools: session.definitions };
    } catch {
      this.health.set(connection.id, { status: "unavailable" });
      throw new ExternalToolError(
        "MCP : connexion impossible. Vérifie le serveur, le délai et l’authentification.",
      );
    } finally {
      await session?.close().catch(() => {});
    }
  }
  async save(body: Record<string, unknown>) {
    const connection = config(body),
      previous = await this.repository.get(connection.id);
    if ((previous?.version ?? 0) !== connection.version)
      throw new ExternalToolError(
        "MCP : connexion modifiée ailleurs. Actualise avant de réessayer.",
      );
    if (
      !Array.isArray(body.toolNames) ||
      body.toolNames.some((name) => typeof name !== "string") ||
      new Set(body.toolNames).size !== body.toolNames.length
    )
      throw invalid();
    const names = body.toolNames as string[];
    const reusable =
      body.refreshDefinitions !== true &&
      previous &&
      sameEndpoint(previous, connection) &&
      names.every((name) => previous.tools.some((tool) => tool.name === name));
    const definitions = reusable
      ? previous.tools
      : names.length
        ? (await this.discover(body)).tools
        : [];
    const tools = names.map((name) =>
      definitions.find((tool) => tool.name === name),
    );
    if (tools.some((tool) => !tool))
      throw new ExternalToolError(
        "MCP : outil absent du catalogue. Actualise avant de réessayer.",
      );
    if (
      !connection.allowWrites &&
      tools.some((tool) => tool?.readOnlyHint === false)
    )
      throw new ExternalToolError(
        "MCP : autorise explicitement les écritures pour sélectionner ces outils. Le mode lecture seul est conservé.",
      );
    if (connection.enabled && !tools.length)
      throw new ExternalToolError("MCP : sélectionne au moins un outil.");
    const saved = await this.repository.save(
      { ...connection, tools: tools as ExternalToolDefinition[] },
      connection.version,
    );
    this.health.delete(saved.id);
    return { connection: saved };
  }
  async callApproved(
    connectionId: string,
    name: string,
    args: Json,
    signal?: AbortSignal,
  ): Promise<Json> {
    const connection = await this.repository.get(connectionId);
    if (!connection?.enabled)
      throw new ExternalToolError("MCP : connexion désactivée ou absente.");
    const definition = connection.tools.find((item) => item.name === name);
    if (
      !definition ||
      (definition.readOnlyHint === false && !connection.allowWrites)
    )
      throw new ExternalToolError("MCP : outil non approuvé.");
    return JSON.parse(
      await this.toolFor(connection, definition).execute(args, {
        workspace: "",
        signal,
      }),
    ) as Json;
  }
  async toolsFor(
    conversation: Conversation,
    excludedConnections: readonly string[] = [],
  ): Promise<Tool[]> {
    if (!conversation.networkAccess && conversation.fileAccess !== "yolo")
      return [];
    const connections = (await this.repository.list()).filter(
      (connection) =>
        connection.enabled && !excludedConnections.includes(connection.id),
    );
    return connections.flatMap((connection) =>
      connection.tools
        .filter(
          (definition) =>
            definition.readOnlyHint !== false ||
            connection.allowWrites === true,
        )
        .map((definition) => this.toolFor(connection, definition)),
    );
  }
  private toolFor(
    connection: ExternalToolConnection,
    definition: ExternalToolDefinition,
  ): Tool {
    return {
      name: externalToolName(connection.id, definition.name),
      title: connection.label + " · " + (definition.title || definition.name),
      description: `${connection.label} — ${definition.name}. Outil distant ${definition.readOnlyHint === false ? "d’écriture" : "de lecture"} approuvé.${connection.transient ? " Arguments et résultats sensibles disponibles pour ce tour seulement ; ne les recopie pas dans le chat ou la mémoire." : ""} ${definition.description}`,
      parameters: definition.inputSchema,
      permission:
        definition.readOnlyHint === false
          ? ("external.write" as const)
          : ("external.read" as const),
      ...(connection.transient ? { transient: true } : {}),
      execute: async (args, context) => {
        const live = await this.repository.get(connection.id);
        if (
          !live?.enabled ||
          live.version !== connection.version ||
          !live.tools.some((tool) => isDeepStrictEqual(tool, definition))
        )
          throw new ExternalToolError(
            "MCP : connexion désactivée ou modifiée. Relance avec les droits actuels.",
          );
        let session: ExternalToolSession | undefined;
        try {
          session = await this.connect(connection, context.signal);
          const actual = session.definitions.find(
            (tool) => tool.name === definition.name,
          );
          if (!actual || !isDeepStrictEqual(actual, definition))
            throw new ExternalToolError(
              "MCP : catalogue modifié. Actualise et approuve les outils.",
            );
          const result = await session.call(
            definition.name,
            args,
            context.signal,
          );
          this.health.set(connection.id, { status: "connected" });
          return result;
        } catch (error) {
          if (error instanceof ExternalCallError) throw error;
          this.health.set(connection.id, { status: "unavailable" });
          if (context.signal?.aborted)
            throw new ExternalToolError("MCP : appel interrompu.");
          throw new ExternalToolError(
            "MCP : appel échoué ou catalogue modifié. Vérifie la connexion dans Capacités. Aucun appel rejoué.",
          );
        } finally {
          await session?.close().catch(() => {});
        }
      },
    };
  }
}
