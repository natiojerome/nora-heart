import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  ExternalToolDefinition,
  ExternalToolConnection,
  ExternalToolRepository,
} from "../src/contracts/external-tools.ts";
import type { Json } from "../src/contracts/json.ts";
export const searchDefinition: ExternalToolDefinition = {
  name: "search",
  title: "Recherche web",
  description: "Rechercher des documents publics.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", minLength: 1 } },
    required: ["query"],
    additionalProperties: false,
  },
  readOnlyHint: true,
};
export async function mcpFixture(
  options: {
    tools?: ExternalToolDefinition[];
    call?: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{
      content: ({ type: "text"; text: string } | {type:"image";mimeType:string;data:string})[];
      structuredContent?:Record<string,unknown>;
      isError?: boolean;
    }>;
    delayList?: () => Promise<void>;
  } = {},
) {
  const observations: {
      method: string;
      authorization?: string;
      key?: string;
    }[] = [],
    calls: { name: string; args: Record<string, unknown> }[] = [];
  const tools = options.tools ?? [structuredClone(searchDefinition)];
  const server = createServer((request, response) => {
    void (async () => {
      observations.push({
        method: request.method || "",
        authorization: request.headers.authorization,
        key: request.headers["x-api-key"] as string | undefined,
      });
      const mcp = new Server(
        { name: "disposable-search-fixture", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      mcp.setRequestHandler(ListToolsRequestSchema, async () => {
        await options.delayList?.();
        return {
          tools: tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { readOnlyHint: tool.readOnlyHint },
          })),
        };
      });
      mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
        const name = request.params.name,
          args = request.params.arguments ?? {};
        calls.push({ name, args });
        return options.call
          ? options.call(name, args)
          : {
              content: [
                {
                  type: "text",
                  text:
                    "Source: https://example.com/docs · " + String(args.query),
                },
              ],
            };
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      response.once("close", () => {
        void mcp.close();
      });
      await transport.handleRequest(request, response);
    })().catch(() => {
      if (!response.writableEnded) {
        response.writeHead(500);
        response.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url =
    "http://127.0.0.1:" + (server.address() as { port: number }).port + "/mcp";
  return {
    url,
    tools,
    calls,
    observations,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
export function externalRepositoryFixture() {
  const records = new Map<string, ExternalToolConnection>();
  const repository: ExternalToolRepository = {
    async list() {
      return structuredClone([...records.values()]);
    },
    async get(id) {
      return structuredClone(records.get(id) ?? null);
    },
    async save(connection, expected) {
      if ((records.get(connection.id)?.version ?? 0) !== expected)
        throw new Error(
          "MCP : connexion modifiée ailleurs. Actualise avant de réessayer.",
        );
      const next = { ...connection, version: expected + 1 };
      records.set(next.id, structuredClone(next));
      return structuredClone(next);
    },
  };
  return { repository, records };
}
