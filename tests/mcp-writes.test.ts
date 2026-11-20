import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ExternalTools } from "../src/app/external-tools.ts";
import { Engine } from "../src/core/engine.ts";
import { JsonlSessions } from "../src/modules/storage/json/index.ts";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";
import {
  mcpFixture,
  externalRepositoryFixture,
  searchDefinition,
} from "./mcp.fixture.ts";
import type { ModelRequest } from "../src/contracts/models.ts";
test("MCP writes require owner grant; current schema/permissions and connection revocation still apply", async () => {
  const f = await mcpFixture({
    tools: [{ ...searchDefinition, name: "write", readOnlyHint: false }],
  });
  const { repository } = externalRepositoryFixture();
  const manager = new ExternalTools(repository, (c) => connectMcp(c));
  try {
    const draft = {
      id: randomUUID(),
      version: 0,
      label: "Écriture",
      url: f.url,
      enabled: true,
      auth: { type: "none" },
      timeoutMs: 10000,
      toolNames: ["write"],
    };
    await assert.rejects(manager.save(draft), /lecture/);
    const saved = (await manager.save({ ...draft, allowWrites: true }))
      .connection;
    const conv = {
      id: randomUUID(),
      title: "",
      createdAt: "",
      updatedAt: "",
      selection: null,
      networkAccess: true,
    };
    const [tool] = await manager.toolsFor(conv);
    assert.equal(tool.permission, "external.write");
    await tool.execute({ query: "first" }, { workspace: "" });
    assert.equal(f.calls.length, 1);
    assert.equal(
      (await manager.toolsFor({ ...conv, networkAccess: false })).length,
      0,
    );
    await manager.save({ ...saved, enabled: false, toolNames: ["write"] });
    await assert.rejects(
      tool.execute({ query: "second" }, { workspace: "" }),
      /désactivée/,
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});
test("sensitive tool inputs/results reach only the active model turn, never journal, future context or memory review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-sensitive-"));
  const sessions = new JsonlSessions(root);
  const secret = "Synthetic-Vault-only!";
  let reviewed = false;
  let step = 0;
  const tool = {
    name: "vault",
    description: "sensitive fixture",
    parameters: { type: "object" },
    permission: "external.write" as const,
    transient: true,
    async execute() {
      return JSON.stringify({ values: { password: secret } });
    },
  };
  const engine = new Engine(sessions, [tool], undefined, {
    name: "test",
    failureMessage: "review failed",
    async review(input) {
      assert(!JSON.stringify(input.request.messages).includes(secret));
      reviewed = true;
      return { response: input.response, audit: { status: "ok" } };
    },
  });
  try {
    await engine.run({
      sessionId: "test",
      prompt: "Use the vault",
      workspace: root,
      displayName: "Test",
      permissions: new Set(["external.write"]),
      provider: {
        id: "fixture",
        async generate(request) {
          if (step++ === 0)
            return {
              content: "",
              toolCalls: [
                {
                  id: "write-1",
                  name: "vault",
                  arguments: { values: { password: secret } },
                },
              ],
            };
          assert(JSON.stringify(request.messages).includes(secret));
          return { content: "Compte utilisé.", toolCalls: [] };
        },
      },
    });
    const journal = await sessions.read("test");
    assert(!JSON.stringify(journal).includes(secret));
    assert(reviewed);
    const next = new Engine(sessions, [tool]);
    await next.run({
      sessionId: "test",
      prompt: "Continue",
      workspace: root,
      displayName: "Test",
      permissions: new Set(["external.write"]),
      provider: {
        id: "fixture-next",
        async generate(request: ModelRequest) {
          assert(!JSON.stringify(request).includes(secret));
          assert(
            JSON.stringify(request).includes("Résultat sensible non conservé"),
          );
          return { content: "Terminé", toolCalls: [] };
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
