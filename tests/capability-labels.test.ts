import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  connectionDisplayName,
  toolDisplayName,
  presentTools,
} from "../src/app/capability-labels.ts";
import { ExternalTools } from "../src/app/external-tools.ts";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";
import {
  mcpFixture,
  externalRepositoryFixture,
  searchDefinition,
} from "./mcp.fixture.ts";
import { interactionTools } from "../src/modules/tools/interactions/index.ts";
test("presentation preserves tool identities, executable callbacks, explicit titles and custom connection names", () => {
  assert.equal(
    connectionDisplayName({ label: "Nora MCPs · Mémoire partagée" }),
    "Mémoire",
  );
  assert.equal(connectionDisplayName({ label: "Services · mail" }), "Mail");
  assert.equal(
    connectionDisplayName({ label: "Mon service personnel" }),
    "Mon service personnel",
  );
  assert.equal(toolDisplayName({ name: "mail_send" }), "Envoyer un message");
  assert.equal(
    toolDisplayName({ name: "mail_send", title: "Custom provider title" }),
    "Custom provider title",
  );
  assert.equal(toolDisplayName({ name: "unknown_action" }), "unknown_action");
  const tools = interactionTools(),
    presented = presentTools(tools);
  assert.equal(presented[0].name, tools[0].name);
  assert.equal(presented[0].execute, tools[0].execute);
  assert.equal(presented[0].resolveInput, tools[0].resolveInput);
  assert.equal(presented[0].permission, tools[0].permission);
  assert(presented[0].title);
  assert(!tools[0].title);
});
test("MCP view labels never alter approved snapshots or bypass catalogue and write checks", async () => {
  const fixture = await mcpFixture({
      tools: [{ ...searchDefinition, name: "memory_search", title: undefined }],
    }),
    { repository } = externalRepositoryFixture(),
    manager = new ExternalTools(repository, (c) => connectMcp(c));
  try {
    const c = (
      await manager.save({
        id: randomUUID(),
        version: 0,
        label: "Nora MCPs · Mémoire partagée",
        url: fixture.url,
        auth: { type: "none" },
        enabled: true,
        timeoutMs: 10000,
        toolNames: ["memory_search"],
      })
    ).connection;
    const original = structuredClone(await repository.get(c.id));
    const view = (await manager.list()).connections[0];
    assert.equal(view.displayName, "Mémoire");
    assert.equal(view.icon, "memories");
    assert.equal(view.tools[0].displayName, "Rechercher des souvenirs");
    assert.equal(view.tools[0].name, "memory_search");
    assert.equal(view.label, original!.label);
    const discovered = await manager.discover({ ...c });
    assert.equal(discovered.tools[0].displayName, "Rechercher des souvenirs");
    assert.deepEqual(await repository.get(c.id), original);
    const [tool] = await manager.toolsFor({
      id: randomUUID(),
      title: "",
      createdAt: "",
      updatedAt: "",
      selection: null,
      networkAccess: true,
    });
    assert.equal(tool.title, "Mémoire · Rechercher des souvenirs");
    await tool.execute({ query: "hello" }, { workspace: "/tmp" });
    assert.equal(fixture.calls.length, 1);
    fixture.tools[0].readOnlyHint = false;
    await assert.rejects(
      tool.execute({ query: "changed" }, { workspace: "/tmp" }),
    );
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(await repository.get(c.id), original);
  } finally {
    await fixture.close();
  }
});
