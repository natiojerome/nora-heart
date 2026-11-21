import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BoundedContext } from "../src/modules/context/bounded/index.ts";
import { StructuredMemory } from "../src/modules/memory/structured/index.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { structuredMemoryFixture } from "./structured-memory-fixture.ts";
import type { ModelRequest } from "../src/contracts/models.ts";

test("active context exposes whole short facts and scoped long references, then refreshes after correction/forgetting", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heart-context-memory-"));
  const storage = await openJsonStorage(directory);
  try {
    const { memory, repository } = structuredMemoryFixture();
    const projectId = randomUUID();
    const scoped = new StructuredMemory(repository, { projectId, source: { type: "conversation", conversationId: randomUUID() } });
    const personal = await memory.rememberRecord({ title: "PostgreSQL", content: "PostgreSQL version 17", kind: "preference", scope: "personal", projectId: null });
    const long = await scoped.rememberRecord({ title: "Exceptions PostgreSQL", content: "PostgreSQL " + "règle ".repeat(500) + "Exception finale à conserver intégralement.", kind: "constraint", scope: "project", projectId });
    await memory.rememberRecord({ title: "PostgreSQL secret projet B", content: "PostgreSQL autre projet non accessible", kind: "fact", scope: "project", projectId: randomUUID() });
    const tools = structuredMemoryTools(scoped, projectId);
    const request: ModelRequest = { instructions: "Nora", messages: [{ role: "user", content: "Préparons une architecture PostgreSQL pour ce projet." }, { role: "assistant", content: "D’accord", toolCalls: [] }, { role: "user", content: "Continue" }], tools };
    const context = new BoundedContext(storage.sessions, scoped);
    const options = { sessionId: "memory", runId: randomUUID(), contextWindow: 100000, reserveTokens: 4096, request,
      provider: { id: "never", async generate() { throw new Error("No summary expected"); } } };
    const first = await context.prepare(options);
    assert.match(first.instructions, /PostgreSQL version 17/);
    assert(first.instructions.includes(`[${long.id} v1]`));
    assert(first.instructions.includes("Exception finale"), "large windows retain the full useful fact by default");
    assert(!first.instructions.includes("autre projet"));
    const detail = JSON.parse(await tools.find(tool => tool.name === "memory.get")!.execute({ id: long.id }, { workspace: directory }));
    assert(detail.content.endsWith("Exception finale à conserver intégralement."));
    await memory.update(personal.id, 1, { title: "PostgreSQL", content: "PostgreSQL version 18", kind: "preference", scope: "personal", projectId: null });
    await scoped.setStatus(long.id, 1, "forgotten");
    await assert.rejects(tools.find(tool => tool.name === "memory.get")!.execute({ id: long.id }, { workspace: directory }), /Souvenir introuvable/);
    assert.equal((await scoped.get(long.id)).status, "forgotten", "Administrative reads remain available for restoration");
    const next = await context.prepare(options);
    assert.match(next.instructions, /PostgreSQL version 18/);
    assert(!next.instructions.includes("PostgreSQL version 17"));
    assert(!next.instructions.includes(long.id));
  } finally { await storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('an empty active lookup explicitly distinguishes conversation history from current stored memories',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-memory-empty-'));const storage=await openJsonStorage(dir);try{
 const {memory}=structuredMemoryFixture();const context=new BoundedContext(storage.sessions,memory);const r=await context.prepare({sessionId:'empty',runId:randomUUID(),provider:{id:'never',async generate(){throw Error('No compression expected')}},request:{instructions:'Assistant',messages:[{role:'assistant',content:'Ton métier a déjà été sauvegardé.',toolCalls:[]},{role:'user',content:'Dis-moi ce que tu sais à mon sujet.'}],tools:structuredMemoryTools(memory,null)},contextWindow:100000,reserveTokens:4096});assert.match(r.instructions,/aucun souvenir pertinent/);assert.match(r.instructions,/anciens reçus/);assert.match(r.instructions,/ne signifie pas.*base.*vide/);
 }finally{await storage.close();await rm(dir,{recursive:true,force:true})}
});

test('historical memory receipts lose active status and content in model context while current receipts and journal stay intact',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-receipt-proof-'));const storage=await openJsonStorage(dir);try{
 const {memory}=structuredMemoryFixture();const old={role:'tool' as const,name:'memory.remember',callId:'old',content:JSON.stringify({id:randomUUID(),title:'Ancien fait',content:'OLD_ACTIVE_CONTENT',status:'active',version:1}),error:false};
 const current={...old,callId:'new',content:JSON.stringify({id:randomUUID(),title:'Fait courant',content:'NEW_CURRENT_CONTENT',status:'active',version:1})};
 const request:ModelRequest={instructions:'Test',messages:[{role:'user',content:'Ancien tour'},old,{role:'user',content:'Nouveau tour de conversation'},current],tools:structuredMemoryTools(memory,null)};
 const context=new BoundedContext(storage.sessions,memory);const r=await context.prepare({sessionId:'proof',runId:randomUUID(),provider:{id:'no-summary',async generate(){throw Error('No summary')}},request,contextWindow:100000,reserveTokens:4096});
 const projected=JSON.parse(r.messages[1].content);assert.equal(projected.historical,true);assert.equal(projected.currentStateVerified,false);assert(!r.messages[1].content.includes('OLD_ACTIVE_CONTENT'));assert.equal(r.messages[3].content,current.content);assert(old.content.includes('OLD_ACTIVE_CONTENT'));assert(request.messages[1].content.includes('"status":"active"'));
 }finally{await storage.close();await rm(dir,{recursive:true,force:true})}
});
