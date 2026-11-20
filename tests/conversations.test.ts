import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { conversationFixture } from "./conversation-fixture.ts";

test("conversations isolate histories, survive service restart and switch provider without compulsory compression", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heart-conversations-"));
  let requests = 0;
  const f = await conversationFixture(directory, selection => ({ id: `${selection.provider}:${selection.modelId}`, async generate(request) {
    requests++;
    assert(request.instructions.includes(`${selection.provider}/${selection.modelId}`), "The current selection must replace the previous brain in runtime facts");
    if (selection.provider === "openai") {
      assert(request.messages.some(message => message.content === "Décision : PostgreSQL"));
      assert(!request.messages.some(message => message.content === "Autre sujet"));
    }
    return { content: `Réponse ${selection.provider}`, toolCalls: [] };
  } }));
  try {
    const first = (await f.service.create({ title: "Même titre" })).conversation;
    const second = (await f.service.create({ title: "Même titre" })).conversation;
    assert.notEqual(first.id, second.id);
    const selection = { provider: "demo", contextWindow: 32768 };
    await f.service.send(first.id, { ...selection, prompt: "Décision : PostgreSQL" });
    await f.service.send(second.id, { ...selection, prompt: "Autre sujet" });
    const restarted = f.restart();
    await restarted.send(first.id, { provider: "openai", modelId: "fake-api", contextWindow: 8192, prompt: "Continue" });
    assert.equal(requests, 3);
    const detail = await restarted.get(first.id);
    assert.equal(detail.messageCount, 4);
    assert.equal(detail.contextUsage?.estimated, true);
    assert.deepEqual(detail.contextUsage?.model, {provider:'openai',modelId:'fake-api'});
    assert.equal(detail.contextUsage?.contextWindow, 8192);
    assert(Number(detail.contextUsage?.inputTokens)>0);
    assert.equal(detail.segments, 1);
    assert.equal(detail.events.filter(event => event.type === "message").length, 4);
    assert.equal(detail.conversation.selection?.provider, "openai");
    assert.equal((await restarted.list()).conversations.length, 2);
    await restarted.send(first.id, { provider: "chatgpt", modelId: "fake-chatgpt", contextWindow: 999999, prompt: "Catalogue" });
    const chosen = (await restarted.get(first.id)).conversation.selection;
    assert.equal(chosen?.contextWindow, 8192);
    assert.equal(chosen?.capacitySource, "catalog");
    await assert.rejects(restarted.send(first.id, { provider: "openai", modelId: "fake", prompt: "unknown size" }), /Capacité/);
  } finally { await f.storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a second send in the same conversation is rejected while other conversations can progress", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heart-concurrent-"));
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const f = await conversationFixture(directory, () => ({ id: "fake", async generate(request) {
    if (request.messages.at(-1)?.content === "Slow") { entered(); await new Promise<void>(resolve => { release = resolve; }); }
    return { content: "Done", toolCalls: [] };
  } }));
  try {
    const first = (await f.service.create({ title: "First" })).conversation.id;
    const second = (await f.service.create({ title: "Second" })).conversation.id;
    const input = { provider: "demo", contextWindow: 8192 };
    const slow = f.service.send(first, { ...input, prompt: "Slow" });
    await waiting;
    await assert.rejects(f.service.send(first, { ...input, prompt: "Concurrent" }), /travaille déjà/);
    await f.service.send(second, { ...input, prompt: "Independent" });
    release(); await slow;
  } finally { release?.(); await f.storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test('reasoning effort is validated against the selected account model and survives reopening',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'heart-effort-'));let used:string|undefined;
  const f=await conversationFixture(directory,selection=>({id:'fake',async generate(){used=selection.reasoningEffort;return {content:'ok',toolCalls:[]};}}));
  try{
    const id=(await f.service.create({title:'Effort'})).conversation.id;
    const input={provider:'chatgpt',modelId:'fake-chatgpt',contextWindow:8192,prompt:'hello'};
    await f.service.send(id,{...input,reasoningEffort:'high'});assert.equal(used,'high');
    assert.equal((await f.restart().get(id)).conversation.selection?.reasoningEffort,'high');
    await assert.rejects(f.service.send(id,{...input,reasoningEffort:'unsupported'}),/Choisir un niveau/);
    await assert.rejects(f.service.send(id,{...input,provider:'openai',reasoningEffort:'high'}),/Choisir un niveau/);
    await f.service.send(id,input);assert.equal(used,undefined);
  }finally{await f.storage.close();await rm(directory,{recursive:true,force:true});}
});

test('conversation counters include full history beyond the first page',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-counters-'));
 const f=await conversationFixture(directory);
 try{
  const id=(await f.service.create({title:'Long thread'})).conversation.id;
  for(let i=0;i<503;i++)await f.storage.sessions.append(id,{id:String(i),runId:'fixture',at:new Date().toISOString(),type:'message',data:{role:'user',content:'Message '+i}});
  const value=await f.service.get(id);assert.equal(value.events.length,200);assert.equal(value.messageCount,503);assert.equal(value.contextUsage,null);
 }finally{await f.storage.close();await rm(directory,{recursive:true,force:true});}
});

test('API-provider effort is checked against that model, preserved and passed through the engine',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-api-effort-'));const used:string[]=[];
 const f=await conversationFixture(directory,selection=>({id:selection.provider+':'+selection.modelId,async generate(){used.push(selection.reasoningEffort!);return {content:'ok',toolCalls:[]};}}),undefined,undefined,undefined,undefined,async(_provider,id)=>({id,contextWindow:32768,reasoningEfforts:['low','high']}));
 try{
  const id=(await f.service.create({title:'Effort'})).conversation.id;
  for(const provider of ['openrouter','openai','anthropic']){
   await f.service.send(id,{provider,modelId:'test-model',contextWindow:8192,reasoningEffort:'high',prompt:'Continue'});
   assert.equal((await f.restart().get(id)).conversation.selection?.reasoningEffort,'high');
   await assert.rejects(f.service.send(id,{provider,modelId:'test-model',contextWindow:8192,reasoningEffort:'unsupported',prompt:'No'}),/Choisir un niveau/);
  }
  assert.deepEqual(used,['high','high','high']);
 }finally{await f.storage.close();await rm(directory,{recursive:true,force:true});}
});

test('a model override persists before any message, affects only its thread and rejects stale selection',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-model-choice-'));let calls=0;
 const f=await conversationFixture(directory,()=>({id:'not-called',async generate(){calls++;return {content:'ok',toolCalls:[]};}}));
 try{
  const first=(await f.service.create({title:'First'})).conversation.id,second=(await f.service.create({title:'Second'})).conversation.id;
  const saved=await f.service.selectModel(first,{provider:'chatgpt',modelId:'fake-chatgpt',contextWindow:8192,reasoningEffort:'high',baseSelection:null});
  assert.equal(calls,0);assert.equal(saved.busy,false);assert.equal(saved.events.length,0);
  assert.equal((await f.restart().get(first)).conversation.selection?.reasoningEffort,'high');assert.equal((await f.service.get(second)).conversation.selection,null);
  await assert.rejects(f.service.selectModel(first,{provider:'demo',contextWindow:8192,baseSelection:null}),/modifié ailleurs/);
  await assert.rejects(f.service.selectModel(first,{provider:'chatgpt',modelId:'fake-chatgpt',contextWindow:8192,reasoningEffort:'invalid'}),/Choisir un niveau/);
  assert.equal(calls,0);
 }finally{await f.storage.close();await rm(directory,{recursive:true,force:true});}
});

test('concurrent work exposes public progress, rejects duplicate sends and cancellation stays scoped',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-work-'));
 const releases=new Map<string,()=>void>();let late:((value:import('../src/contracts/models.ts').ModelProgress)=>void)|undefined;
 const f=await conversationFixture(directory,()=>({id:'fixture',async generate(request){
  const prompt=request.messages.at(-1)?.content||'';
  if(prompt==='A'||prompt==='B'){
   request.onProgress?.({kind:'commentary',text:'Je vérifie '+prompt});late=request.onProgress;
   await new Promise<void>((resolve,reject)=>{releases.set(prompt,resolve);request.signal?.addEventListener('abort',()=>reject(request.signal?.reason),{once:true});});
  }
  assert(!request.messages.some(m=>m.content==='Je vérifie A'||m.content==='Je vérifie B'));
  return{content:'Terminé '+prompt,toolCalls:[]};
 }}));
 try{
  const a=(await f.service.create({title:'A'})).conversation.id,b=(await f.service.create({title:'B'})).conversation.id;
  const selection={provider:'demo',contextWindow:8192};
  const first=f.service.send(a,{...selection,prompt:'A'}),second=f.service.send(b,{...selection,prompt:'B'});
  while(releases.size<2)await new Promise(r=>setTimeout(r,5));
  // The provider callback precedes the durable progress append; await the public state.
  let states=(await f.service.work()).conversations;
  const deadline=Date.now()+2000;
  while(states.some(c=>c.work?.status==='running'&&!c.work.commentary)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,5));states=(await f.service.work()).conversations;}
  assert.equal(states.filter(c=>c.work?.status==='running').length,2);
  assert.equal(states.find(c=>c.id===a)?.work?.commentary,'Je vérifie A');
  await assert.rejects(f.service.send(a,{...selection,prompt:'Duplicate'}),/travaille déjà/);
  await f.service.cancel(a);await first;assert.equal((await f.service.get(b)).busy,true);
  releases.get('B')!();await second;
  assert.equal((await f.service.get(a)).work.status,'cancelled');assert.equal((await f.service.get(b)).work.status,'completed');
  late?.({kind:'commentary',text:'Late callback'});
  const history=(await f.service.get(b)).events;
  assert(history.some(e=>e.type==='run.progress'));assert(!history.some(e=>e.type==='run.progress'&&(e.data as any).text==='Late callback'));
 }finally{for(const release of releases.values())release();await f.service.shutdown();await f.storage.close();await rm(directory,{recursive:true,force:true});}
});

test('owner file audit is recovered separately and never injected into model history',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-owner-recovery-'));
 let modelCalls=0;const f=await conversationFixture(directory,()=>({id:'fake',async generate(){modelCalls++;return{content:'ok',toolCalls:[]};}}));
 try{
  const id=(await f.service.create({title:'Owner audit'})).conversation.id,runId='owner-interrupted';
  const append=async(type:import('../src/contracts/storage.ts').Event['type'],data:any)=>f.storage.sessions.append('workspace-'+id,{id:crypto.randomUUID(),at:new Date().toISOString(),runId,type,data});
  await append('run.started',{});await append('message',{role:'assistant',content:'Private owner audit',toolCalls:[{id:'owner-call',name:'files.create',arguments:{path:'owner.txt'}}]});await append('tool.started',{callId:'owner-call',name:'files.create'});
  const before=await f.service.get(id);assert.equal(before.recovery.workspace?.calls[0].state,'uncertain');
  await f.service.reconcile(id,{lastEventId:null,workspaceLastEventId:before.recovery.workspace!.lastEventId,acknowledged:true,note:'Action vérifiée.'});
  assert.equal(modelCalls,0);assert.equal((await f.service.get(id)).events.length,0);assert.equal((await f.service.get(id)).recovery.workspace,null);
  await f.service.mutateWorkspace(id,{action:'create',path:'after.txt',content:'new owner edit'});
  assert.equal((await f.service.infoWorkspace(id,'after.txt')).document?.name,'after.txt');assert.equal(modelCalls,0);
 }finally{await f.storage.close();await rm(directory,{recursive:true,force:true});}
});
