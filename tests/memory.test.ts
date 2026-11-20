import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { MemoryRepository, MemoryService } from "../src/contracts/memory.ts";
import type { ModelProvider } from "../src/contracts/models.ts";
import type { Event, SessionStore } from "../src/contracts/storage.ts";
import { Engine } from "../src/core/engine.ts";
import { BasicMemory } from "../src/modules/memory/basic/index.ts";
import { memoryTools } from "../src/modules/tools/memory/index.ts";

test("basic memory enforces its policy before invoking a storage repository", async () => {
  let writes = 0;
  const repository: MemoryRepository = {
    async save(memory) { writes++; return memory; },
    async find() { return []; },
  };
  const memory = new BasicMemory(repository);
  await assert.rejects(memory.remember("   "), /vide/);
  await assert.rejects(memory.remember("x".repeat(4001)), /trop long/);
  assert.equal(writes, 0);
  const saved = await memory.remember("A useful preference");
  assert.match(saved.id, /^[a-f0-9-]{36}$/);
  assert.equal(saved.content, "A useful preference");
  assert.equal(writes, 1);
});

test("a replacement memory service works with the unchanged engine and memory tools", async () => {
  const events: Event[] = [];
  const sessions: SessionStore = {
    async read() { return [...events]; },
    async append(_id, event) { events.push(event); },
  };
  const replacement: MemoryService = {
    async remember(content) { return { id: "remote-memory", content }; },
    async search(query) { return [{ id: "remote-memory", content: `External recall for ${query}` }]; },
  };
  const model: ModelProvider = { id: "simulated", async generate(request) {
    const last = request.messages.at(-1);
    return last?.role === "tool"
      ? { content: last.content, toolCalls: [] }
      : { content: "", toolCalls: [{ id: randomUUID(), name: "memory.search", arguments: { query: "preferences" } }] };
  } };
  const engine = new Engine(sessions, memoryTools(replacement));
  const result = await engine.run({ sessionId: "test", prompt: "Recall", provider: model,
    displayName: "Assistant", workspace: ".", permissions: new Set(["memory.read"]) });
  assert.match(result.text, /External recall for preferences/);
});
