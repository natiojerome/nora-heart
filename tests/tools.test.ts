import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileTools } from "../src/modules/tools/files/index.ts";
import { memoryTools } from "../src/modules/tools/memory/index.ts";

test("file tools work independently of a model, engine or storage", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "harness-tools-"));
  const tools = new Map(fileTools().map(tool => [tool.name, tool]));
  const context = { workspace };
  try {
    await tools.get("files.create")!.execute({ path: "note.txt", content: "A useful note" }, context);
    assert.equal(JSON.parse(await tools.get("files.read")!.execute({ path: "note.txt" }, context)).content, "A useful note");
    assert.deepEqual(JSON.parse(await tools.get("files.list")!.execute({}, context)).entries.map((item: {name:string}) => item.name), ["note.txt"]);
    await assert.rejects(tools.get("files.create")!.execute({ path: "note.txt", content: "replacement" }, context));
    assert.equal(JSON.parse(await tools.get("files.read")!.execute({ path: "note.txt" }, context)).content, "A useful note");
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("memory tools use an injected service without accessing a database or model", async () => {
  const calls: string[] = [];
  const tools = memoryTools({
    async remember(content) { calls.push(`remember:${content}`); return { id: "external", content }; },
    async search(query) { calls.push(`search:${query}`); return [{ id: "external", content: "Found" }]; },
  });
  const context = { workspace: "." };
  const remember = tools.find(tool => tool.name === "memory.remember")!;
  const search = tools.find(tool => tool.name === "memory.search")!;
  assert.deepEqual(JSON.parse(await remember.execute({ content: "Preference" }, context)), { id: "external", content: "Preference" });
  assert.deepEqual(JSON.parse(await search.execute({ query: "Preference" }, context)), [{ id: "external", content: "Found" }]);
  await assert.rejects(remember.execute({ content: 123 }, context), /invalide/);
  await assert.rejects(search.execute({}, context), /invalide/);
  assert.deepEqual(calls, ["remember:Preference", "search:Preference"]);
});
