import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Engine } from "../src/core/engine.ts";
import { BoundedContext, estimateTokens } from "../src/modules/context/bounded/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import type { ModelProvider, ModelRequest } from "../src/contracts/models.ts";
import type { Message } from "../src/contracts/messages.ts";
import type { Json } from "../src/contracts/json.ts";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heart-context-"));
  const storage = await openJsonStorage(directory);
  return { directory, storage, close: async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); } };
}

test("large model history compacts into smaller segments; restart keeps decisions and never replays a tool", async () => {
  const f = await fixture();
  try {
    let actions = 0;
    const engine = new Engine(f.storage.sessions, [{ name: "test.effect", description: "effect", parameters: { type: "object" }, permission: "files.write",
      async execute() { actions++; return "Action accomplie une fois"; } }], new BoundedContext(f.storage.sessions));
    let step = 0;
    const large: ModelProvider = { id: "large", async generate() {
      if (step++ === 0) return { content: "", toolCalls: [{ id: randomUUID(), name: "test.effect", arguments: {} }] };
      return { content: "Décision PostgreSQL, jamais SQLite. " + "donnée ".repeat(650), toolCalls: [] };
    } };
    const options = { sessionId: "continuity", displayName: "Nora", workspace: f.directory, permissions: new Set(["files.write" as const]), contextWindow: 100000, reserveTokens: 1024 };
    for (let i = 0; i < 4; i++) await engine.run({ ...options, prompt: "Décision PostgreSQL " + "historique ".repeat(150), provider: large });
    let summaries = 0;
    const small: ModelProvider = { id: "small", async generate(request) {
      if (request.instructions.startsWith("Produis uniquement")) {
        summaries++;
        // No batch is split: an assistant tool call always retains its result.
        const data = JSON.parse(request.messages[0].content);
        const exchanges = data.exchanges as Message[];
        for (const message of exchanges) if (message.role === "assistant") for (const call of message.toolCalls) assert(exchanges.some(result => result.role === "tool" && result.callId === call.id));
        return { content: "PostgreSQL choisi, SQLite exclu. Action accomplie une fois. Suite : continuer.", toolCalls: [] };
      }
      assert.match(request.instructions, /PostgreSQL choisi/);
      assert.equal(request.messages.at(-1)?.content, "Continue");
      assert(!request.messages.some(message => message.role === "tool"));
      return { content: "Continuité confirmée", toolCalls: [] };
    } };
    const restarted = new Engine(f.storage.sessions, [], new BoundedContext(f.storage.sessions));
    await restarted.run({ ...options, contextWindow: 4096, prompt: "Continue", provider: small });
    assert(summaries > 1, "smaller window must produce bounded summary chunks");
    assert.equal(actions, 1);
    const history = await f.storage.sessions.read(options.sessionId);
    assert.equal(history.filter(event => event.type === "context.checkpoint").length, 1);
    assert(history.some(event => event.type === "message" && JSON.stringify(event.data).includes("donnée")));
    const third = new Engine(f.storage.sessions, [], new BoundedContext(f.storage.sessions));
    await third.run({ ...options, contextWindow: 4096, prompt: "Continue", provider: small });
    assert.equal((await f.storage.sessions.read(options.sessionId)).filter(event => event.type === "context.checkpoint").length, 1);
    assert.equal(actions, 1);
  } finally { await f.close(); }
});

test("failed checkpoint storage preserves history and never starts the continuation", async () => {
  const f = await fixture();
  try {
    const messages: Message[] = [{ role: "user", content: "décision ".repeat(650) }, { role: "assistant", content: "PostgreSQL", toolCalls: [] }, { role: "user", content: "continue" }];
    for (const message of messages) await f.storage.sessions.append("failed", { id: randomUUID(), runId: randomUUID(), at: new Date().toISOString(), type: "message", data: message as unknown as Json });
    const before = await f.storage.sessions.read("failed");
    let calls = 0;
    const provider: ModelProvider = { id: "summary", async generate(request) { assert(request.instructions.startsWith("Produis uniquement")); calls++; return { content: "PostgreSQL", toolCalls: [] }; } };
    const context = new BoundedContext({ read: id => f.storage.sessions.read(id), async append() { throw new Error("disk failure"); } });
    await assert.rejects(context.prepare({ sessionId: "failed", runId: randomUUID(), provider, contextWindow: 4096, reserveTokens: 1024,
      request: { instructions: "Nora", messages, tools: [] } }), /disk failure/);
    assert(calls>=1);
    assert.deepEqual(await f.storage.sessions.read("failed"), before);
  } finally { await f.close(); }
});

test("model change below threshold preserves full messages without summarization; memory is deduplicated", async () => {
  const f = await fixture();
  try {
    const request: ModelRequest = { instructions: "Nora", messages: [{ role: "user", content: "Architecture PostgreSQL et modularité : continuer" }, { role: "assistant", content: 'Préférence PostgreSQL avec "exceptions"', toolCalls: [] }], tools: [] };
    const context = new BoundedContext(f.storage.sessions, { async remember() { throw new Error("never"); }, async search() { return [{ id: "one", content: 'Préférence PostgreSQL avec "exceptions"' }]; } });
    let measured=0;
    const output = await context.prepare({ onPrepared:async usage=>{measured=usage.inputTokens;assert.equal(usage.estimated,true);}, sessionId: "short", runId: randomUUID(), contextWindow: 8192, reserveTokens: 1024, request,
      provider: { id: "changed", async generate() { throw new Error("must not summarize"); } } });
    assert.deepEqual(output, request);
    assert.equal(measured,estimateTokens(output));
    assert.equal((await f.storage.sessions.read("short")).length, 0);
  } finally { await f.close(); }
});

test('summary size follows the target window instead of the old fixed character cap, with owner limits still enforced',async()=>{
 const f=await fixture();
 try{
  const messages:Message[]=[{role:'user',content:'archive '.repeat(5500)},{role:'assistant',content:'Décision conservée.',toolCalls:[]},{role:'user',content:'autre '.repeat(7000)},{role:'assistant',content:'Suite.',toolCalls:[]},{role:'user',content:'Continue'}];
  for(const data of messages)await f.storage.sessions.append('long-summary',{id:randomUUID(),runId:randomUUID(),at:new Date().toISOString(),type:'message',data:data as unknown as Json});
  const summary='Détail utile. '.repeat(550)+'CODE-EXACT-71';
  const options={sessionId:'long-summary',runId:randomUUID(),contextWindow:32768,reserveTokens:1024,request:{instructions:'Nora',messages,tools:[]},provider:{id:'qa',async generate(request:ModelRequest){assert.match(request.instructions,/Budget du point/);assert(!request.instructions.includes('2500'));return {content:summary,toolCalls:[]};}}};
  const {resolvePolicies}=await import('../src/app/runtime-policies.ts');
  const result=await new BoundedContext(f.storage.sessions,undefined,undefined,resolvePolicies({context:{recentTurns:1}})).prepare(options);
  assert(result.instructions.includes(summary));assert(summary.length>6000);
  const before=await f.storage.sessions.read('long-summary');
  // A fresh session with the same source checks configured caps without changing the previous checkpoint.
  for(const event of before.filter(e=>e.type==='message'))await f.storage.sessions.append('owner-cap',{...event,id:randomUUID()});
  await assert.rejects(new BoundedContext(f.storage.sessions,undefined,undefined,resolvePolicies({context:{recentTurns:1,maxSummaryCharacters:1000}})).prepare({...options,sessionId:'owner-cap'}),/Compression invalide/);
  assert(!(await f.storage.sessions.read('owner-cap')).some(e=>e.type==='context.checkpoint'));
 }finally{await f.close();}
});

test('compression retains recent full turns and adapts memory details to the actual model budget',async()=>{
 const f=await fixture();
 try{
  const messages:Message[]=[];for(let i=0;i<6;i++)messages.push({role:'user',content:'Ancien objectif '+i+' x'.repeat(2500)},{role:'assistant',content:'décision '+i,toolCalls:[]});
  const recent:Message[]=[{role:'user',content:'Livraison mardi, montant 72 €.'},{role:'assistant',content:'Compris.',toolCalls:[]},{role:'user',content:'Et ne pas déplacer le dossier /tmp/important.'},{role:'assistant',content:'Contrainte comprise.',toolCalls:[]},{role:'user',content:'Continue'}];messages.push(...recent);
  for(const data of messages)await f.storage.sessions.append('recent',{id:randomUUID(),runId:randomUUID(),at:new Date().toISOString(),type:'message',data:data as unknown as Json});
  const result=await new BoundedContext(f.storage.sessions).prepare({sessionId:'recent',runId:randomUUID(),contextWindow:8192,reserveTokens:1024,request:{instructions:'Nora',messages,tools:[]},provider:{id:'qa',async generate(){return {content:'Ancien objectif et décisions conservés.',toolCalls:[]};}}});
  assert.deepEqual(result.messages.slice(-recent.length),recent);assert(result.messages.length>1);
  const request:ModelRequest={instructions:'Nora',messages:[{role:'user',content:'Une contrainte utile pour ce dossier'}],tools:[{name:'memory.get',description:'get',parameters:{type:'object'}}]};
  const large={id:randomUUID(),version:1,title:'Contrainte longue à relire',content:'contrainte '.repeat(4000)};
  const context=new BoundedContext(f.storage.sessions,{async remember(){throw Error('unused');},async search(){return [large];}});
  const memory=await context.prepare({sessionId:'memory-budget',runId:randomUUID(),contextWindow:4096,reserveTokens:1024,request,provider:{id:'qa',async generate(){throw Error('No compression needed');}}});
  assert(memory.instructions.includes(large.id));assert(memory.instructions.includes('memory.get'));assert(!memory.instructions.includes(large.content));assert(estimateTokens(memory)<=3072);
 }finally{await f.close();}
});
