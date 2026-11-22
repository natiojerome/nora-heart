import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ExternalCallError,
  type ExternalErrorCode,
} from "../../../contracts/external-tools.ts";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import type {
  ExternalToolConnection,
  ExternalToolDefinition,
  ExternalToolSession,
} from "../../../contracts/external-tools.ts";
import type { Json } from "../../../contracts/json.ts";

export class McpToolError extends Error {}
function failed(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) throw new McpToolError("MCP : appel interrompu.");
  const code = (error as { code?: unknown })?.code;
  if (code === 429)
    throw new McpToolError(
      "MCP : limite fournisseur atteinte. Aucun repli automatique.",
    );
  if (code === 401 || code === 403)
    throw new McpToolError(
      "MCP : authentification refusée. Vérifie la connexion.",
    );
  if (error instanceof McpToolError || error instanceof ExternalCallError)
    throw error;
  throw new McpToolError(
    "MCP : serveur indisponible ou réponse incompatible. Aucun appel rejoué.",
  );
}
/** A transport is an adapter detail. No process spawning, OAuth or legacy SSE fallback. */
export async function connectMcp(
  connection: ExternalToolConnection,
  options: {
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<ExternalToolSession> {
  const env = options.env ?? process.env,
    headers: Record<string, string> = {};
  let secret = "";
  if (connection.auth.type !== "none") {
    secret = env[connection.auth.envVar] ?? "";
    if (!secret.trim())
      throw new McpToolError("MCP : variable secrète absente du serveur.");
    if (connection.auth.type === "bearer_env")
      headers.Authorization = "Bearer " + secret;
    else headers[connection.auth.headerName] = secret;
  }
  let changed = false,
    closed = false;
  const client = new Client(
    { name: "heart-mcp-client", version: "0.1.0" },
    { capabilities: {} },
  );
  client.onerror = () => {}; // Remote bodies and headers never enter server logs.
  client.onclose = () => {
    closed = true;
  };
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changed = true;
  });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers, redirect: "error" },
    fetch: async (input, init) => {
      const response = await (options.fetch ?? fetch)(input, {
        ...init,
        redirect: "error",
      });
      return response;
    },
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  try {
    await client.connect(transport, {
      signal: options.signal,
      timeout: connection.timeoutMs,
    });
    const definitions: ExternalToolDefinition[] = [],
      cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, {
        signal: options.signal,
        timeout: connection.timeoutMs,
      });
      for (const tool of page.tools) {
        if (definitions.some((item) => item.name === tool.name))
          throw new McpToolError("MCP : catalogue invalide.");
        definitions.push({
          name: tool.name,
          ...(tool.title ? { title: tool.title } : {}),
          description: tool.description ?? "",
          inputSchema: tool.inputSchema as Record<string, Json>,
          ...(typeof tool.annotations?.readOnlyHint === "boolean"
            ? { readOnlyHint: tool.annotations.readOnlyHint }
            : {}),
        });
      }
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor))
        throw new McpToolError("MCP : pagination du catalogue incohérente.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const validators = new Map(
      definitions.map((tool) => {
        const schema = tool.inputSchema;
        if (schema.$async === true)
          throw new McpToolError("MCP : catalogue invalide.");
        const validator = (
          typeof schema.$schema === "string" &&
          schema.$schema.includes("draft-07")
            ? new Ajv({ strict: false, allErrors: false, logger: false })
            : new Ajv2020({ strict: false, allErrors: false, logger: false })
        ).compile(schema);
        return [tool.name, validator] as const;
      }),
    );
    const callWithMedia: NonNullable<
      ExternalToolSession["callWithMedia"]
    > = async (name, args, signal) => {
      if (closed)
        throw new McpToolError(
          "MCP : connexion fermée. Reconnecte le serveur.",
        );
      if (changed)
        throw new McpToolError(
          "MCP : catalogue modifié. Actualise et approuve les outils.",
        );
      const validate = validators.get(name);
      if (!validate || !validate(args))
        throw new McpToolError("MCP : arguments invalides.");
      signal?.throwIfAborted();
      try {
        const result = await client.callTool(
          { name, arguments: args as Record<string, unknown> },
          undefined,
          { signal, timeout: connection.timeoutMs },
        );
        if (result.isError) {
          const structured = result.structuredContent as
            { error?: { code?: unknown } } | undefined;
          const code = structured?.error?.code;
          if (
            typeof code === "string" &&
            [
              "INVALID",
              "NOT_FOUND",
              "CONFLICT",
              "GONE",
              "UNAVAILABLE",
            ].includes(code)
          )
            throw new ExternalCallError(code as ExternalErrorCode);
          throw new McpToolError(
            "MCP : le serveur a refusé cet appel. Aucun appel rejoué.",
          );
        }
        // Avoid sending both the text fallback and identical structured data to the model.
        const blocks: Record<string, unknown>[] = Array.isArray(result.content)
          ? result.content.filter(
              (p: unknown): p is Record<string, unknown> =>
                !!p && typeof p === "object",
            )
          : [];
        const images = blocks.flatMap((part) =>
          part.type === "image" &&
          typeof part.data === "string" &&
          typeof part.mimeType === "string"
            ? [{ mediaType: part.mimeType, data: part.data }]
            : [],
        );
        let text = JSON.stringify(
          result.structuredContent ?? {
            content: blocks.filter((part) => part.type !== "image"),
          },
        );
        if (secret) text = text.split(secret).join("[secret masqué]");
        return { text, ...(images.length ? { images } : {}) };
      } catch (error) {
        failed(error, signal);
      }
    };
    return {
      definitions,
      callWithMedia,
      async call(name, args, signal) {
        return (await callWithMedia(name, args, signal)).text;
      },
      async close() {
        await client.close();
      },
    };
  } catch (error) {
    await client.close().catch(() => {});
    failed(error, options.signal);
  }
}
