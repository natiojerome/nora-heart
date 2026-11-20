import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { McpMemoryRepository } from "../src/modules/storage/mcp-memory/index.ts";
import { StructuredMemory } from "../src/modules/memory/structured/index.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import { ExternalCallError } from "../src/contracts/external-tools.ts";
import type { Json } from "../src/contracts/json.ts";
test("MCP memory maps scope/source/versions, propagates failures and never resurrects a forgotten remote entry", async () => {
  const data = new Map<string, any>();
  const history = new Map<string, any[]>();
  const calls: { name: string; args: Record<string, Json> }[] = [];
  const repo = new McpMemoryRepository(async (name, args) => {
    calls.push({ name, args });
    const id = String(args.id);
    if (name === "memory_create") {
      const r = {
        ...args,
        id: randomUUID(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      data.set(r.id, r);
      history.set(r.id, [r]);
      return r;
    }
    if (name === "memory_search") {
      return {
        items: [...data.values()]
          .filter((r) => !args.scope || r.scope === args.scope)
          .filter(
            (r) => !args.context || r.context?.id === (args.context as any).id,
          ),
        nextCursor: null,
      };
    }
    const current = data.get(id);
    if (!current) throw new ExternalCallError("NOT_FOUND");
    if (name === "memory_get") return current;
    if (name === "memory_revisions")
      return { items: history.get(id)!.toReversed(), nextCursor: null };
    if (args.expectedVersion !== current.version)
      throw new ExternalCallError("CONFLICT");
    if (name === "memory_forget") {
      data.delete(id);
      history.delete(id);
      return { id, forgotten: true };
    }
    if (name === "memory_update") {
      const next = { ...current, ...args, version: current.version + 1 };
      data.set(id, next);
      history.get(id)!.push(next);
      return next;
    }
    throw Error("Unexpected call");
  });
  const projectId = randomUUID();
  const memory = new StructuredMemory(repo, {
    projectId,
    source: { type: "conversation", conversationId: "conversation-1" },
  });
  const record = await memory.rememberRecord({
    title: "Travail",
    content: "Profession : développeur informatique",
    kind: "fact",
    scope: "project",
    projectId,
  });
  assert.notEqual(record.id, calls[0].args.operationId);
  assert.equal(record.projectId, projectId);
  assert.equal(record.source.conversationId, "conversation-1");
  assert.equal(data.get(record.id).context.namespace, "nora-projects");
  const oldId=randomUUID();
  const aliased=new McpMemoryRepository(async(name,args)=>{if(name==='memory_get')return data.get(String(args.id));if(name==='memory_revisions')return {items:history.get(String(args.id)),nextCursor:null};throw Error('Unexpected alias call')},{[oldId]:record.id});
  assert.equal((await aliased.get(oldId))?.id,record.id);
  assert.equal((await aliased.revisions(oldId)).length,1);
  const revised = await memory.update(record.id, 1, {
    ...record,
    title: "Mon métier",
  });
  assert.equal(revised.version, 2);
  await assert.rejects(memory.update(record.id, 1, record), {
    code: "CONFLICT",
  });
  assert.equal((await memory.revisions(record.id)).length, 2);
  assert.equal((await memory.search("développeur")).length, 1);
  assert(
    !structuredMemoryTools(memory, projectId).some(
      (tool) => tool.name === "memory.restore",
    ),
  );
  await memory.setStatus(record.id, 2, "forgotten");
  await assert.rejects(memory.get(record.id), /introuvable/);
  await assert.rejects(memory.setStatus(record.id, 3, "active"), /restaurer/);
  assert.equal((await memory.list(true)).length, 0);
});
