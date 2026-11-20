import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Event } from "../src/contracts/storage.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";

test("JSON storage persists identity, journal and memories without a model or engine", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-json-"));
  try {
    const storage = await openJsonStorage(directory);
    const id = storage.instanceId;
    const event: Event = { id: randomUUID(), at: new Date().toISOString(), runId: randomUUID(),
      type: "message", data: { role: "user", content: "Hello" } };
    const memory = { id: randomUUID(), content: "Préfère les modules indépendants" };
    await storage.sessions.append("test", event);
    await storage.memories.save(memory);
    await storage.close();
    const reopened = await openJsonStorage(directory);
    try {
      assert.equal(reopened.instanceId, id);
      assert.deepEqual(await reopened.sessions.read("test"), [event]);
      assert.deepEqual(await reopened.memories.find(["MODULES"], 20), [memory]);
      assert.deepEqual(await reopened.memories.save({ ...memory, id: randomUUID() }), memory);
      await assert.rejects(reopened.sessions.read("../escape"), /invalide/);
      await writeFile(path.join(directory, "sessions", "test.jsonl"), "{damaged");
      await assert.rejects(reopened.sessions.read("test"), SyntaxError);
    } finally { await reopened.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
