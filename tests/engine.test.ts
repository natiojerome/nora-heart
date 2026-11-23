import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Json } from "../src/contracts/json.ts";
import type { ModelProvider, ModelRequest } from "../src/contracts/models.ts";
import { Engine } from "../src/core/engine.ts";
import type { RunOptions } from "../src/core/engine.ts";
import { instanceId, JsonlSessions, JsonMemoryRepository } from "../src/modules/storage/json/index.ts";
import { BasicMemory } from "../src/modules/memory/basic/index.ts";
import { fileTools } from "../src/modules/tools/files/index.ts";
import { memoryTools } from "../src/modules/tools/memory/index.ts";

async function fixture(action: (f: { root: string; state: string; workspace: string; store: JsonlSessions; memory: BasicMemory; engine: Engine }) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-test-"));
  const workspace = path.join(root, "workspace");
  const state = path.join(root, "state");
  await mkdir(workspace);
  const store = new JsonlSessions(state);
  const memory = new BasicMemory(new JsonMemoryRepository(state));
  try { await action({ root, state, workspace, store, memory, engine: new Engine(store, [...fileTools(), ...memoryTools(memory)]) }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function oneTool(name: string, args: Json): ModelProvider {
  return { id: "test-a", async generate(request) {
    const last = request.messages.at(-1);
    return last?.role === "tool"
      ? { content: `${last.error ? "error" : "ok"}: ${last.content}`, toolCalls: [] }
      : { content: "", toolCalls: [{ id: "call-1", name, arguments: args }] };
  } };
}

function options(workspace: string, provider: ModelProvider): RunOptions {
  return { sessionId: "session", prompt: "Travaille", displayName: "Nora Heart", workspace, provider,
    permissions: new Set(["files.read", "files.write", "memory.read", "memory.write"]) };
}

test("creates a file through the full loop and persists tool outcomes", async () => fixture(async f => {
  const result = await f.engine.run(options(f.workspace, oneTool("files.create", { path: "note.txt", content: "bonjour" })));
  assert.match(result.text, /^ok:/);
  assert.equal(await readFile(path.join(f.workspace, "note.txt"), "utf8"), "bonjour");
  const events = await new JsonlSessions(f.state).read("session");
  assert.equal(events.filter(e => e.type === "tool.started").length, 1);
  assert.equal(events.at(-1)?.type, "run.completed");
}));

test("denied tools never execute even if the model requests them", async () => fixture(async f => {
  const run = options(f.workspace, oneTool("files.create", { path: "forbidden", content: "x" }));
  run.permissions = new Set(["files.read"]);
  const result = await f.engine.run(run);
  assert.match(result.text, /permission refusée/);
  await assert.rejects(readFile(path.join(f.workspace, "forbidden")), { code: "ENOENT" });
}));

test("blocks traversal and symlinks outside the workspace", async () => fixture(async f => {
  await writeFile(path.join(f.root, "outside"), "private");
  await symlink(path.join(f.root, "outside"), path.join(f.workspace, "link"));
  for (const [session, target] of [["traversal", "../outside"], ["symlink", "link"]]) {
    const result = await f.engine.run({ ...options(f.workspace, oneTool("files.read", { path: target })), sessionId: session });
    assert.match(result.text, /^error:/);
    assert.doesNotMatch(result.text, /private/);
  }
}));

test("create never overwrites an existing file", async () => fixture(async f => {
  await writeFile(path.join(f.workspace, "existing"), "original");
  const result = await f.engine.run(options(f.workspace, oneTool("files.create", { path: "existing", content: "replacement" })));
  assert.match(result.text, /^error:/);
  assert.equal(await readFile(path.join(f.workspace, "existing"), "utf8"), "original");
}));

test("switching providers, engine instances and display name preserves history and memory", async () => fixture(async f => {
  await f.engine.run(options(f.workspace, oneTool("memory.remember", { content: "Jérôme préfère le français." })));
  const originalId = await instanceId(f.state);
  const provider: ModelProvider = { id: "test-b", async generate(request: ModelRequest) {
    assert.match(request.instructions, /Renamed Assistant/);
    assert(request.messages.some(m => m.role === "tool" && m.name === "memory.remember"));
    return { content: "Continuité vérifiée", toolCalls: [] };
  } };
  const memory = new BasicMemory(new JsonMemoryRepository(f.state));
  const engine = new Engine(new JsonlSessions(f.state), [...fileTools(), ...memoryTools(memory)]);
  const result = await engine.run({ ...options(f.workspace, provider), displayName: "Renamed Assistant" });
  assert.equal(result.text, "Continuité vérifiée");
  assert.equal((await memory.search("français")).length, 1);
  assert.equal(await instanceId(f.state), originalId);
}));

test("stops endless model turns at the configured budget", async () => fixture(async f => {
  let calls = 0;
  const provider: ModelProvider = { id: "loop", async generate() {
    return { content: "", toolCalls: [{ id: `step-${++calls}`, name: "files.list", arguments: {} }] };
  } };
  await assert.rejects(f.engine.run({ ...options(f.workspace, provider), maxSteps: 2 }), /Budget de 2/);
  assert.equal(calls, 2);
  assert.equal((await f.store.read("session")).at(-1)?.type, "run.failed");
}));

test("interrupted runs are not automatically replayed", async () => fixture(async f => {
  await f.store.append("session", { id: "event", at: new Date().toISOString(), runId: "interrupted", type: "run.started", data: {} });
  let invoked = false;
  const provider: ModelProvider = { id: "never", async generate() { invoked = true; return { content: "", toolCalls: [] }; } };
  await assert.rejects(f.engine.run(options(f.workspace, provider)), /réconciliation/);
  assert.equal(invoked, false);
}));

test("pre-cancelled runs make no model request", async () => fixture(async f => {
  let invoked = false;
  const provider: ModelProvider = { id: "never", async generate() { invoked = true; return { content: "", toolCalls: [] }; } };
  await assert.rejects(f.engine.run({ ...options(f.workspace, provider), signal: AbortSignal.abort() }));
  assert.equal(invoked, false);
  assert.deepEqual(await f.store.read("session"), []);
}));

test('current tool inventory replaces stale history and is journaled after permission filtering',async()=>fixture(async f=>{
  await f.engine.run(options(f.workspace,{id:'old-answer',async generate(){return {content:'Ancienne liste erronée : exécution parallèle, limite 1 Mio.',toolCalls:[]};}}));
  let names:string[]=[];
  await f.engine.run({...options(f.workspace,{id:'current',async generate(request){
    names=request.tools.map(tool=>tool.name);
    assert(names.includes('files.list'));assert(!names.includes('files.create'));
    assert.match(request.instructions,/remplace toute ancienne liste/);
    assert.match(request.instructions,/exécute les appels séquentiellement/);
    assert(request.instructions.includes(names.join(', ')));
    return {content:'Fichiers en lecture seule.',toolCalls:[]};
  }}),permissions:new Set(['files.read'])});
  const start=(await f.store.read('session')).findLast(event=>event.type==='run.started')!;
  assert.deepEqual((start.data as {tools:string[]}).tools,names);
}));

test('a model without tool calling receives an empty inventory and cannot execute an invented call',async()=>fixture(async f=>{
  let turns=0;
  await f.engine.run(options(f.workspace,{id:'text-only',supportsTools:false,async generate(request){
    assert.deepEqual(request.tools,[]);assert.match(request.instructions,/aucun/);assert.match(request.instructions,/sans prise en charge/);
    if(turns++===0)return {content:'',toolCalls:[{id:'invented',name:'files.create',arguments:{path:'forbidden.txt',content:'no'}}]};
    const last=request.messages.at(-1);assert(last?.role==='tool'&&last.error);return {content:'No tool access.',toolCalls:[]};
  }}));
  await assert.rejects(readFile(path.join(f.workspace,'forbidden.txt')));
  assert.deepEqual(((await f.store.read('session')).find(event=>event.type==='run.started')!.data as {tools:string[]}).tools,[]);
}));

test('display titles stay in UI journal without duplicating the model tool inventory',async()=>fixture(async f=>{
 const engine=new Engine(f.store,fileTools().map(tool=>({...tool,title:"Libellé de présentation "+tool.name})));
 await engine.run({...options(f.workspace,{id:"labels",async generate(request){
  assert(!request.instructions.includes("Libellé de présentation"));
  assert(request.instructions.includes(request.tools.map(tool=>tool.name).join(", ")));
  return{content:"Prêt",toolCalls:[]};
 }}),permissions:new Set(["files.read"])});
 const start=(await f.store.read("session")).find(event=>event.type==='run.started')!;
 assert.equal((start.data as any).toolTitles['files.list'],'Libellé de présentation files.list');
}));
