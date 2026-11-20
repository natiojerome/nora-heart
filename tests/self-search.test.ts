import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import {
  createWebSearch,
  isPublicAddress,
  publicPageUrl,
} from "../src/modules/search/searxng/index.ts";
import { openSearchService } from "../src/app/search.ts";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";

test("self-hosted search forwards pagination and engine choices, returns every result and upstream incidents without a quota", async () => {
  let queried: URL | undefined;
  const results = Array.from({ length: 143 }, (_, i) => ({
    title: "Document " + i,
    url: "https://example.com/" + i,
    content: "Résumé " + i,
    engines: ["brave"],
  }));
  const app = createWebSearch({
    endpoint: "http://127.0.0.1:4216",
    timeoutMs: 60000,
    fetchBackend: async (input) => {
      queried = new URL(String(input));
      return Response.json({
        results,
        unresponsive_engines: [["duckduckgo", "CAPTCHA"]],
      });
    },
  });
  try {
    const result = JSON.parse(
      await app.tools[0].execute(
        { query: "documents", page: 4, engines: ["brave"], language: "fr" },
        { workspace: "" },
      ),
    );
    assert.equal(result.results.length, 143);
    assert.equal(result.results.at(-1).title, "Document 142");
    assert.equal(result.page, 4);
    assert.deepEqual(result.engineIssues, [["duckduckgo", "CAPTCHA"]]);
    assert.equal(queried?.searchParams.get("pageno"), "4");
    assert.equal(queried?.searchParams.get("engines"), "brave");
    assert.equal(queried?.searchParams.get("language"), "fr");
    assert(!queried?.searchParams.has("num_results"));
  } finally {
    await app.close();
  }
});

test("page reading preserves long content and links, strips executable markup and truncates only on explicit request", async () => {
  const long = "Contenu utile. ".repeat(5000);
  const app = createWebSearch({
    endpoint: "http://127.0.0.1:4216",
    timeoutMs: 60000,
    fetchPage: async () =>
      new Response(
        `<html><head><title>Page utile</title></head><body><nav>Menu</nav><main><p>${long}</p><a href="/source">Source</a><script>secretScript()</script></main></body></html>`,
        { headers: { "content-type": "text/html" } },
      ),
  });
  try {
    const read = app.tools[1];
    const full = JSON.parse(
      await read.execute(
        { url: "https://example.com/page" },
        { workspace: "" },
      ),
    );
    assert.equal(full.truncated, false);
    assert(full.content.length > 60000);
    assert(full.content.includes("[Source](https://example.com/source)"));
    assert(!full.content.includes("secretScript"));
    assert(!full.content.includes("Menu"));
    const limited = JSON.parse(
      await read.execute(
        { url: "https://example.com/page", max_characters: 101 },
        { workspace: "" },
      ),
    );
    assert.equal(limited.content.length, 101);
    assert.equal(limited.truncated, true);
    assert.equal(limited.totalCharacters, full.totalCharacters);
  } finally {
    await app.close();
  }
});

test("public reader rejects private addresses, credential URLs and redirect loops or redirects to private resources", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "224.0.0.1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert(isPublicAddress("1.1.1.1"));
  assert(isPublicAddress("2606:4700:4700::1111"));
  for (const url of [
    "http://2130706433",
    "http://[::1]",
    "http://localhost",
    "http://test.localhost",
    "https://user:pass@example.com",
    "file:///etc/passwd",
  ])
    assert.throws(() => publicPageUrl(url));
  let target = "http://127.0.0.1/internal";
  const app = createWebSearch({
    endpoint: "http://127.0.0.1:4216",
    timeoutMs: 60000,
    fetchPage: async () =>
      new Response(null, { status: 302, headers: { location: target } }),
  });
  try {
    await assert.rejects(
      app.tools[1].execute(
        { url: "https://example.com/page" },
        { workspace: "" },
      ),
      /pages publiques/,
    );
    target = "https://example.com/page";
    await assert.rejects(
      app.tools[1].execute(
        { url: "https://example.com/page" },
        { workspace: "" },
      ),
      /Boucle/,
    );
  } finally {
    await app.close();
  }
});

test("local search service exposes standard MCP tools over real HTTP without touching any owner state", async () => {
  const upstream = createServer((request, response) => {
    assert(request.url?.startsWith("/search?"));
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        results: [
          {
            title: "MCP",
            url: "https://modelcontextprotocol.io",
            content: "Documentation",
            engines: ["test"],
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const app = openSearchService({
    endpoint:
      "http://127.0.0.1:" + (upstream.address() as { port: number }).port,
    timeoutMs: 10000,
  });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  const url =
    "http://127.0.0.1:" + (app.server.address() as { port: number }).port;
  const client = await connectMcp({
    id: "8d59e10c-dc22-4b15-b17a-ce2b5be10d8d",
    version: 0,
    label: "Local search",
    url: url + "/mcp",
    enabled: true,
    auth: { type: "none" },
    timeoutMs: 10000,
    tools: [],
  });
  try {
    assert.deepEqual(
      client.definitions.map((t) => t.name),
      ["web_search", "web_fetch"],
    );
    const result = JSON.parse(
      await client.call("web_search", { query: "MCP" }),
    );
    assert(
      JSON.parse(result.content[0].text).results[0].url ===
        "https://modelcontextprotocol.io",
    );
    const forbidden = await fetch(url + "/mcp", {
      method: "POST",
      headers: { origin: "https://untrusted.invalid" },
      body: "{}",
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await fetch(url + "/health")).status, 200);
  } finally {
    await client.close();
    await app.close();
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});
