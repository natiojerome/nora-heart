import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { StructuredMemory, memoryTerms } from "../src/modules/memory/structured/index.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import { structuredMemoryFixture } from "./structured-memory-fixture.ts";
import type { MemoryInput } from "../src/contracts/structured-memory.ts";

const input: MemoryInput = { title: "Base de données", content: "Utiliser PostgreSQL sans SQLite", kind: "decision", scope: "personal", projectId: null };

test("structured memory keeps scoped facts, provenance, revisions, optimistic edits and reversible forgetting", async () => {
  const { repository, memory } = structuredMemoryFixture();
  const projectA = randomUUID(), projectB = randomUUID(), conversationId = randomUUID();
  const scoped = new StructuredMemory(repository, { projectId: projectA, source: { type: "conversation", conversationId } });
  const other = new StructuredMemory(repository, { projectId: projectB, source: { type: "conversation", conversationId: randomUUID() } });
  const personal = await memory.rememberRecord(input);
  const local = await scoped.rememberRecord({ ...input, scope: "project", projectId: projectA });
  const privateOther = await other.rememberRecord({ ...input, scope: "project", projectId: projectB });
  assert.notEqual(personal.id, local.id);
  assert.deepEqual(local.source, { type: "conversation", conversationId });
  assert.deepEqual(new Set((await scoped.search("Quelle base PostgreSQL utiliser pour continuer ?")).map(record => record.id)), new Set([personal.id, local.id]));
  await assert.rejects(scoped.get(privateOther.id), /introuvable/);
  await assert.rejects(scoped.rememberRecord({ ...input, scope: "project", projectId: projectB }), /hors du projet/);
  assert.equal((await scoped.rememberRecord({ ...input, scope: "project", projectId: projectA })).id, local.id);
  const corrected = await scoped.update(local.id, 1, { ...input, content: "PostgreSQL 18 retenu", scope: "project", projectId: projectA });
  assert.equal(corrected.version, 2);
  await assert.rejects(scoped.update(local.id, 1, { ...input, scope: "project", projectId: projectA }), /modifié depuis/);
  const forgotten = await scoped.setStatus(local.id, 2, "forgotten");
  assert(!(await scoped.search("PostgreSQL")).some(record => record.id === local.id));
  assert.equal((await scoped.get(local.id)).status, "forgotten");
  const restored = await scoped.setStatus(local.id, 3, "active");
  assert.equal(restored.version, 4);
  assert.deepEqual((await scoped.revisions(local.id)).map(record => record.status), ["active", "active", "forgotten", "active"]);
  assert.equal(forgotten.content, corrected.content);
});

test("memory validation rejects missing scope, long fields and obvious credentials before persistence", async () => {
  const { memory } = structuredMemoryFixture();
  await assert.rejects(memory.rememberRecord({ ...input, content: "sk-" + "x".repeat(40) }), /secret/);
  await assert.rejects(memory.rememberRecord({ ...input, content: "x".repeat(4001) }), /invalide/);
  await assert.rejects(memory.rememberRecord({ ...input, title: " " }), /invalide/);
  await assert.rejects(memory.rememberRecord({ ...input, scope: "project", projectId: null }), /Portée/);
  assert.equal((await memory.list()).length, 0);
  assert.deepEqual(memoryTerms("Continue le projet avec PostgreSQL PostgreSQL"), ["postgresql"]);
});

test("structured tools use current project automatically and require a current version for correction/forgetting", async () => {
  const { repository } = structuredMemoryFixture();
  const projectId = randomUUID();
  const memory = new StructuredMemory(repository, { projectId, source: { type: "conversation", conversationId: randomUUID() } });
  const tools = structuredMemoryTools(memory, projectId);
  const invoke = async (name: string, args: Record<string, string | number>) => JSON.parse(await tools.find(tool => tool.name === name)!.execute(args, { workspace: "/unused" }));
  const created = await invoke("memory.remember", { title: "Choix", content: "PostgreSQL", kind: "decision", scope: "project" });
  assert.equal(created.projectId, projectId);
  assert.equal(created.version, 1);
  await invoke("memory.forget", { id: created.id, version: 1 });
  assert.deepEqual(await invoke("memory.search", { query: "PostgreSQL" }), []);
  await assert.rejects(invoke("memory.restore", { id: created.id, version: 1 }), /modifié depuis/);
  assert.equal((await invoke("memory.restore", { id: created.id, version: 2 })).status, "active");
});

test('an explicit empty query enumerates current active memories using the configured result budget',async()=>{
 const {memory,repository}=structuredMemoryFixture();
 await memory.rememberRecord({title:'Profession',content:'L’utilisateur est développeur.',kind:'fact',scope:'personal',projectId:null});
 await memory.rememberRecord({title:'Préférence',content:'L’utilisateur préfère le matin.',kind:'preference',scope:'personal',projectId:null});
 const result=await memory.search('');assert.equal(result.length,2);
 const limited=new StructuredMemory(repository,{projectId:null,source:{type:'manual'}},{candidates:200,results:1,terms:16});assert.equal((await limited.search('')).length,1);
});
