import { openSearchService } from "../app/search.ts";
const port = Number(process.env.HARNESS_SEARCH_PORT ?? 4217),
  timeoutMs = Number(process.env.HARNESS_SEARCH_TIMEOUT_MS ?? 60000);
if (
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  !Number.isSafeInteger(timeoutMs) ||
  timeoutMs < 1 ||
  timeoutMs > 2147483647
)
  throw new Error("Configuration de recherche locale invalide.");
const app = openSearchService({
  endpoint: process.env.HARNESS_SEARCH_ENGINE_URL ?? "http://127.0.0.1:4216",
  timeoutMs,
});
app.server.listen(port, "127.0.0.1", () =>
  console.log("Recherche locale MCP prête."),
);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    if (!stopping) {
      stopping = true;
      void app.close();
    }
  });
