import { createWebSearch } from "../modules/search/searxng/index.ts";
import { createLocalMcpServer } from "../modules/tools/mcp-server/index.ts";
export function openSearchService(options: {
  endpoint: string;
  timeoutMs: number;
}) {
  const search = createWebSearch(options),
    mcp = createLocalMcpServer(search.tools);
  return {
    server: mcp.server,
    async close() {
      await mcp.close();
      await search.close();
    },
  };
}
