import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";
import { ExternalTools, externalToolName } from "../src/app/external-tools.ts";
import {
  mcpFixture,
  externalRepositoryFixture,
  searchDefinition,
} from "./mcp.fixture.ts";
import type { ExternalToolConnection } from "../src/contracts/external-tools.ts";
const connection = (url: string): ExternalToolConnection => ({
  id: randomUUID(),
  version: 0,
  label: "Recherche",
  url,
  enabled: true,
  auth: { type: "none" },
  timeoutMs: 10000,
  tools: [],
});

test("MCP adapter uses real Streamable HTTP discovery, strict arguments, result errors and explicit cancellation", async () => {
  let release!: () => void;
  const f = await mcpFixture({
    async call(_name, args) {
      if (args.query === "error")
        return {
          isError: true,
          content: [{ type: "text", text: "private-server-error" }],
        };
      if (args.query === "wait") await new Promise<void>((r) => (release = r));
      return { content: [{ type: "text", text: "https://example.com" }] };
    },
  });
  const session = await connectMcp(connection(f.url));
  try {
    assert.equal(session.definitions[0].name, "search");
    assert(
      (await session.call("search", { query: "MCP" })).includes(
        "https://example.com",
      ),
    );
    await assert.rejects(
      session.call("search", { query: "x", extra: true }),
      /arguments invalides/,
    );
    assert.equal(f.calls.length, 1);
    await assert.rejects(
      session.call("search", { query: "error" }),
      (error) =>
        error instanceof Error &&
        !error.message.includes("private-server-error"),
    );
    const controller = new AbortController(),
      pending = session.call("search", { query: "wait" }, controller.signal);
    while (!release) await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await assert.rejects(pending, /interrompu/);
    release();
    assert.equal(f.calls.filter((c) => c.args.query === "wait").length, 1);
  } finally {
    release?.();
    await session.close();
    await f.close();
  }
});

test("MCP credentials stay at transport boundary, are redacted from results and never follow a redirect", async () => {
  const secret = "test-only-private-header-value";
  const f = await mcpFixture({
    async call() {
      return { content: [{ type: "text", text: secret }] };
    },
  });
  const c = connection(f.url);
  c.auth = {
    type: "header_env",
    envVar: "FIXTURE_MCP_SECRET",
    headerName: "x-api-key",
  };
  const session = await connectMcp(c, { env: { FIXTURE_MCP_SECRET: secret } });
  try {
    assert(!(await session.call("search", { query: "test" })).includes(secret));
    assert(f.observations.every((o) => o.key === secret));
    await assert.rejects(
      connectMcp(c, { env: {} }),
      /variable secrète absente/,
    );
    let requests = 0;
    await assert.rejects(
      connectMcp(c, {
        env: { FIXTURE_MCP_SECRET: secret },
        fetch: async (_url, init) => {
          requests++;
          assert.equal(init?.redirect, "error");
          return new Response("", {
            status: 302,
            headers: { location: "https://example.invalid/steal" },
          });
        },
      }),
    );
    assert.equal(requests, 1);
  } finally {
    await session.close();
    await f.close();
  }
});

test("owner approvals pin schema and names; network, disabled connections, YOLO and live revocation stay distinct", async () => {
  const f = await mcpFixture(),
    { repository } = externalRepositoryFixture(),
    manager = new ExternalTools(repository, (c, signal) =>
      connectMcp(c, { signal }),
    );
  try {
    const draft = connection(f.url),
      saved = (await manager.save({ ...draft, toolNames: ["search"] }))
        .connection;
    const conv = {
      id: randomUUID(),
      title: "Thread",
      createdAt: "",
      updatedAt: "",
      selection: null,
      fileAccess: "read" as const,
      networkAccess: false,
    };
    assert.deepEqual(await manager.toolsFor(conv), []);
    const tools = await manager.toolsFor({ ...conv, networkAccess: true });
    assert.equal(tools.length, 1);
    assert.equal(tools[0].permission, "external.read");
    assert.equal(tools[0].name, externalToolName(saved.id, "search"));
    assert(tools[0].name.length <= 64);
    assert(
      (
        await tools[0].execute({ query: "actual HTTP" }, { workspace: "/tmp" })
      ).includes("https://example.com"),
    );
    assert.equal(
      (await manager.toolsFor({ ...conv, fileAccess: "yolo" })).length,
      1,
    );
    await manager.save({ ...saved, enabled: false, toolNames: ["search"] });
    await assert.rejects(
      tools[0].execute({ query: "after revoke" }, { workspace: "/tmp" }),
      /désactivée ou modifiée/,
    );
    assert.equal(f.calls.length, 1);
    assert.deepEqual(
      await manager.toolsFor({ ...conv, fileAccess: "yolo" }),
      [],
    );
    await assert.rejects(
      manager.save({ ...saved, toolNames: ["search"] }),
      /modifiée ailleurs/,
    );
  } finally {
    await f.close();
  }
});

test("unapproved new tools and changed definitions are not silently exposed; annotations cannot grant execution", async () => {
  const f = await mcpFixture(),
    { repository } = externalRepositoryFixture(),
    manager = new ExternalTools(repository, (c) => connectMcp(c));
  try {
    const c = (
      await manager.save({ ...connection(f.url), toolNames: ["search"] })
    ).connection;
    f.tools.push({ ...searchDefinition, name: "new_tool" });
    const conv = {
      id: randomUUID(),
      title: "",
      createdAt: "",
      updatedAt: "",
      selection: null,
      networkAccess: true,
    };
    const [tool] = await manager.toolsFor(conv);
    assert.equal((await manager.toolsFor(conv)).length, 1);
    f.tools[0].inputSchema = { type: "object" };
    await assert.rejects(
      tool.execute({ query: "changed" }, { workspace: "/tmp" }),
      /échoué ou catalogue modifié/,
    );
    assert.equal(f.calls.length, 0);
    await assert.rejects(
      manager.save({ ...connection(f.url), toolNames: ["missing"] }),
      /absent du catalogue/,
    );
    f.tools[0].readOnlyHint = false;
    await assert.rejects(
      manager.save({ ...connection(f.url), toolNames: ["search"] }),
      /lecture/,
    );
    f.tools[0].readOnlyHint = true;
    const refreshed = (
      await manager.save({
        ...c,
        toolNames: ["search"],
        refreshDefinitions: true,
      })
    ).connection;
    assert.deepEqual(refreshed.tools[0].inputSchema, { type: "object" });
    assert.equal(c.tools.length, 1);
  } finally {
    await f.close();
  }
});

test("MCP settings reject inline credentials before opening a transport", async () => {
  const f = await mcpFixture(),
    { repository } = externalRepositoryFixture(),
    manager = new ExternalTools(repository, (c) => connectMcp(c));
  try {
    for (const url of [
      "https://user:password@example.com/mcp",
      "https://example.com/mcp?apiKey=secret",
      "file:///etc/passwd",
      "http://example.com/mcp",
    ])
      await assert.rejects(
        manager.discover({ ...connection(url) }),
        /configuration invalide/,
      );
    await assert.rejects(
      manager.save({
        ...connection(f.url),
        auth: { type: "none", apiKey: "secret" },
        toolNames: [],
      }),
      /configuration invalide/,
    );
    assert.equal(f.observations.length, 0);
  } finally {
    await f.close();
  }
});

test("cancelling one remote read does not close another conversation transport or replay either call", async () => {
  const releases = new Map<string, () => void>();
  const f = await mcpFixture({
    async call(_name, args) {
      await new Promise<void>((resolve) =>
        releases.set(String(args.query), resolve),
      );
      return { content: [{ type: "text", text: "Done " + args.query }] };
    },
  });
  const { repository } = externalRepositoryFixture(),
    manager = new ExternalTools(repository, (c, signal) =>
      connectMcp(c, { signal }),
    );
  try {
    await manager.save({ ...connection(f.url), toolNames: ["search"] });
    const conv = {
      id: randomUUID(),
      title: "A",
      createdAt: "",
      updatedAt: "",
      selection: null,
      networkAccess: true,
    };
    const [a] = await manager.toolsFor(conv),
      [b] = await manager.toolsFor({ ...conv, id: randomUUID() });
    const controller = new AbortController();
    const first = assert.rejects(
        a.execute(
          { query: "A" },
          { workspace: "/tmp/a", signal: controller.signal },
        ),
        /interrompu/,
      ),
      second = b.execute({ query: "B" }, { workspace: "/tmp/b" });
    while (releases.size < 2) await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await first;
    releases.get("B")!();
    assert((await second).includes("Done B"));
    assert.equal(f.calls.length, 2);
  } finally {
    for (const release of releases.values()) release();
    await f.close();
  }
});
