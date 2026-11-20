import { createServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Ajv } from "ajv";
import type { Tool } from "../../../contracts/tools.ts";
import type { Json } from "../../../contracts/json.ts";
/** Small stateless MCP surface for injected tools; it constructs no concrete tool module. */
export function createLocalMcpServer(tools: Tool[]) {
  if (tools.some((tool) => tool.permission !== "external.read"))
    throw new Error(
      "Ce serveur MCP expose uniquement des outils de lecture externes.",
    );
  const validators = new Map(
    tools.map((tool) => [
      tool.name,
      new Ajv({ strict: false, logger: false }).compile(tool.parameters),
    ]),
  );
  const protocols = new Set<Server>();
  const server = createServer((request, response) => {
    void (async () => {
      const address = server.address(),
        port = typeof address === "object" && address ? address.port : 0;
      const allowedHost = "127.0.0.1:" + port;
      if (
        request.headers.host !== allowedHost ||
        (request.headers.origin &&
          request.headers.origin !== "http://" + allowedHost)
      ) {
        response.writeHead(403);
        response.end();
        return;
      }
      if (request.url === "/health" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end('{"status":"ready"}');
        return;
      }
      if (request.url !== "/mcp") {
        response.writeHead(404);
        response.end();
        return;
      }
      const protocol = new Server(
        { name: "heart-local-search", version: "0.1.0" },
        { capabilities: { tools: {} } },
      );
      protocols.add(protocol);
      protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.parameters,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: true,
          },
        })),
      }));
      protocol.setRequestHandler(CallToolRequestSchema, async (call) => {
        const tool = tools.find((tool) => tool.name === call.params.name),
          args = call.params.arguments ?? {};
        if (!tool || !validators.get(tool.name)?.(args))
          return {
            isError: true,
            content: [
              { type: "text", text: "Outil inconnu ou arguments invalides." },
            ],
          };
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        response.once("close", disconnected);
        try {
          return {
            content: [
              {
                type: "text",
                text: await tool.execute(args as Json, {
                  workspace: "",
                  signal: controller.signal,
                }),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error instanceof Error &&
                  /^(Recherche locale|Réponse de recherche|Lecture refusée|Ce format|Aucun texte|Adresse de page|La lecture web|Boucle de redirection)/.test(
                    error.message,
                  )
                    ? error.message
                    : "Recherche ou lecture indisponible. Aucun repli payant.",
              },
            ],
          };
        } finally {
          response.removeListener("close", disconnected);
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await protocol.connect(transport);
      response.once("close", () => {
        protocols.delete(protocol);
        void protocol.close();
      });
      await transport.handleRequest(request, response);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  return {
    server,
    async close() {
      server.closeAllConnections();
      await Promise.all([...protocols].map((protocol) => protocol.close()));
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
