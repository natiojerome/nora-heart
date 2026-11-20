import { openPostgresStorage } from "../src/modules/storage/postgres/index.ts";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Event } from "../src/contracts/storage.ts";
import type { Json } from "../src/contracts/json.ts";
import type { ModelProvider, ModelResponse } from "../src/contracts/models.ts";
import { Engine } from "../src/core/engine.ts";
import { BoundedContext } from "../src/modules/context/bounded/index.ts";
import { StructuredMemory } from "../src/modules/memory/structured/index.ts";
import { BasicMemory } from "../src/modules/memory/basic/index.ts";
import { fileTools } from "../src/modules/tools/files/index.ts";
import { memoryTools } from "../src/modules/tools/memory/index.ts";
import { createPostgresPool, migratePostgres, postgresInstanceId, PostgresMemoryRepository, PostgresSessions, PostgresConversations, PostgresStructuredMemory, PostgresProjects } from "../src/modules/storage/postgres/index.ts";

const connection = process.env.HARNESS_TEST_DATABASE_URL;
if (!connection || !new URL(connection).pathname.endsWith("_test")) {
  throw new Error("Base jetable dédiée avec suffixe _test requise ; aucun test lancé.");
}
const pool = createPostgresPool(connection);
before(async () => { await Promise.all([migratePostgres(pool), migratePostgres(pool)]); });
after(async () => { await pool.end(); });

function event(data: Json = {}): Event {
  return { id: randomUUID(), at: new Date().toISOString(), runId: randomUUID(), type: "message", data };
}

test("migration is atomic, concurrent-safe and repeatable", async () => {
  const id = await postgresInstanceId(pool);
  await migratePostgres(pool);
  assert.equal(await postgresInstanceId(pool), id);
  const migrations = await pool.query("SELECT version FROM harness.migrations");
  assert.deepEqual(migrations.rows.sort((a,b) => a.version - b.version), [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, {version:7}, {version:8}, {version:9}, {version:10}, {version:11}, {version:12}, {version:13}, {version:14}, {version:15}]);
});

test("upgrade from v8 preserves history and journals context usage across model changes", async () => {
  const database = "harness_context_" + randomUUID().replaceAll("-", "") + "_test";
  await pool.query(`CREATE DATABASE ${database}`);
  const url = new URL(connection!); url.pathname = "/" + database;
  const previous = createPostgresPool(url.href);
  try {
    await previous.query("CREATE SCHEMA harness; CREATE TABLE harness.migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = ["001_initial.sql", "002_conversations.sql", "003_structured_memory.sql", "004_assistant_profile.sql", "005_chat_assets.sql", "006_file_access.sql", "007_development.sql", "008_yolo.sql"];
    for (const [index, file] of files.entries()) {
      const sql = await readFile(new URL("../src/modules/storage/postgres/migrations/" + file, import.meta.url), "utf8");
      await previous.query(sql);
      await previous.query("INSERT INTO harness.migrations (version,checksum) VALUES ($1,$2)", [index + 1, createHash("sha256").update(sql).digest("hex")]);
    }
    const instance = randomUUID(), sessionId = randomUUID();
    await previous.query("INSERT INTO harness.instance (id) VALUES ($1)", [instance]);
    const sessions = new PostgresSessions(previous);
    const original = event({ role: "user", content: "Historique à conserver" });
    await previous.query("INSERT INTO harness.sessions(id,next_sequence) VALUES($1,1)",[sessionId]);
    await previous.query("INSERT INTO harness.events(id,session_id,sequence,run_id,occurred_at,type,data) VALUES($1,$2,1,$3,$4,$5,$6)",[original.id,sessionId,original.runId,original.at,original.type,JSON.stringify(original.data)]);
    const invalid=event({});
    await assert.rejects(previous.query("INSERT INTO harness.events(id,session_id,sequence,run_id,occurred_at,type,data) VALUES($1,$2,2,$3,$4,'context.usage','{}')",[invalid.id,sessionId,invalid.runId,invalid.at]), /events_type_check/);
    await Promise.all([migratePostgres(previous), migratePostgres(previous)]);
    assert.equal(await postgresInstanceId(previous), instance);
    assert.deepEqual(await sessions.read(sessionId), [original]);
    let calls = 0;
    for (const id of ["openrouter:previous", "chatgpt:gpt-6.1-sol"]) {
      const provider: ModelProvider = { id, async generate(request) {
        calls++;
        assert(request.messages.some(message => message.content === "Historique à conserver"));
        return { content: "Réponse après mesure de contexte", toolCalls: [] };
      } };
      const engine = new Engine(sessions, [], new BoundedContext(sessions));
      const result = await engine.run({ sessionId, prompt: "Continue", provider, displayName: "Test",
        workspace: os.tmpdir(), permissions: new Set(), contextWindow: 32768 });
      assert.equal(result.text, "Réponse après mesure de contexte");
    }
    const history = await sessions.read(sessionId);
    assert.deepEqual(history[0], original);
    assert.equal(calls, 2);
    assert.equal(history.filter(item => item.type === "run.failed").length, 0);
    assert.equal(history.filter(item => item.type === "run.completed").length, 2);
    assert.deepEqual(history.filter(item => item.type === "context.usage").map(item => (item.data as Record<string, Json>).provider),
      ["openrouter:previous", "chatgpt:gpt-6.1-sol"]);
  } finally {
    await previous.end();
    await pool.query(`DROP DATABASE ${database} WITH (FORCE)`);
  }
});

test("modified migration history is rejected without changing stored data", async () => {
  const original = await pool.query<{ checksum: string }>("SELECT checksum FROM harness.migrations WHERE version = 1");
  await pool.query("UPDATE harness.migrations SET checksum = 'modified' WHERE version = 1");
  try { await assert.rejects(migratePostgres(pool), /checksum/); }
  finally { await pool.query("UPDATE harness.migrations SET checksum = $1 WHERE version = 1", [original.rows[0].checksum]); }
  await migratePostgres(pool);
});

test("future schema versions are rejected", async () => {
  await pool.query("INSERT INTO harness.migrations (version, checksum) VALUES (999, 'future')");
  try {
    await assert.rejects(migratePostgres(pool), /Version de stockage inconnue/);
    await assert.rejects(postgresInstanceId(pool), /incompatible/);
  } finally { await pool.query("DELETE FROM harness.migrations WHERE version = 999"); }
});

test("event retries are idempotent and conflicting IDs are rejected", async () => {
  const sessions = new PostgresSessions(pool);
  const id = randomUUID();
  const value = event({ text: "canonique", nested: { unicode: "é" } });
  await Promise.all([sessions.append(id, value), sessions.append(id, value)]);
  assert.deepEqual(await sessions.read(id), [value]);
  await assert.rejects(sessions.append(id, { ...value, data: "changed" }), /contenu différent/);
  assert.deepEqual(await sessions.read(id), [value]);
});

test("concurrent journal writes allocate a unique contiguous order", async () => {
  const sessions = new PostgresSessions(pool);
  const id = randomUUID();
  const values = Array.from({ length: 16 }, (_, i) => event({ index: i }));
  await Promise.all(values.map(value => sessions.append(id, value)));
  const result = await pool.query<{ sequence: string }>("SELECT sequence FROM harness.events WHERE session_id = $1 ORDER BY sequence", [id]);
  assert.deepEqual(result.rows.map(row => Number(row.sequence)), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal((await sessions.read(id)).length, 16);
});

test("a failed event write rolls back session creation and sequence allocation", async () => {
  const sessions = new PostgresSessions(pool);
  const fresh = randomUUID();
  const invalid = { ...event(), type: "invalid" as Event["type"] };
  await assert.rejects(sessions.append(fresh, invalid));
  assert.equal((await pool.query("SELECT id FROM harness.sessions WHERE id = $1", [fresh])).rowCount, 0);
  const existing = randomUUID();
  await sessions.append(existing, event());
  await assert.rejects(sessions.append(existing, invalid));
  const sequence = await pool.query("SELECT next_sequence FROM harness.sessions WHERE id = $1", [existing]);
  assert.equal(Number(sequence.rows[0].next_sequence), 1);
});

test("concurrent memory writes deduplicate long UTF-8 content and search literal terms", async () => {
  const memory = new BasicMemory(new PostgresMemoryRepository(pool));
  const marker = randomUUID();
  const content = `${marker} 100% underscore_ ${"é".repeat(3000)}`;
  const values = await Promise.all(Array.from({ length: 8 }, () => memory.remember(content)));
  assert.equal(new Set(values.map(value => value.id)).size, 1);
  assert.deepEqual(await memory.search(`${marker} 100% underscore_`), [values[0]]);
  assert.deepEqual(await memory.search(`${marker} absent`), []);
});

test("engine history, memory and instance identity survive reconnection and model/name changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-pg-"));
  const firstPool = createPostgresPool(connection!);
  const sessionId = randomUUID();
  const content = `Preference ${randomUUID()}`;
  let expectedInstance: string;
  try {
    expectedInstance = await postgresInstanceId(firstPool);
    const memory = new BasicMemory(new PostgresMemoryRepository(firstPool));
    const provider: ModelProvider = { id: "first", async generate(request) {
      return request.messages.at(-1)?.role === "tool"
        ? { content: "Souvenir conservé", toolCalls: [] }
        : { content: "", toolCalls: [{ id: randomUUID(), name: "memory.remember", arguments: { content } }] };
    } };
    const engine = new Engine(new PostgresSessions(firstPool), [...fileTools(), ...memoryTools(memory)]);
    await engine.run({ sessionId, prompt: "remember", displayName: "Nora Heart", workspace: directory, provider,
      permissions: new Set(["memory.write"]) });
  } finally { await firstPool.end(); }
  const secondPool = createPostgresPool(connection!);
  try {
    const memory = new BasicMemory(new PostgresMemoryRepository(secondPool));
    assert.equal(await postgresInstanceId(secondPool), expectedInstance!);
    assert.equal((await memory.search(content)).length, 1);
    const provider: ModelProvider = { id: "second", async generate(request) {
      assert.match(request.instructions, /Autre nom/);
      assert(request.messages.some(m => m.role === "tool" && m.name === "memory.remember"));
      return { content: "Continuité PostgreSQL vérifiée", toolCalls: [] };
    } };
    const engine = new Engine(new PostgresSessions(secondPool), [...fileTools(), ...memoryTools(memory)]);
    const result = await engine.run({ sessionId, prompt: "continue", displayName: "Autre nom", workspace: directory, provider,
      permissions: new Set(["memory.read"]) });
    assert.equal(result.text, "Continuité PostgreSQL vérifiée");
  } finally { await secondPool.end(); await rm(directory, { recursive: true, force: true }); }
});

test("an interrupted PostgreSQL run never triggers automatic model/tool replay", async () => {
  const sessions = new PostgresSessions(pool);
  const sessionId = randomUUID();
  await sessions.append(sessionId, { ...event(), type: "run.started" });
  const engine = new Engine(sessions, []);
  const provider: ModelProvider = { id: "never", async generate() { throw new Error("Must not call model"); } };
  await assert.rejects(engine.run({ sessionId, prompt: "retry", displayName: "Test", workspace: os.tmpdir(), provider,
    permissions: new Set() }), /réconciliation/);
});


test("conversation catalog persists selection independently of titles, and run claim is exclusive", async () => {
  const repository = new PostgresConversations(pool);
  const sessions = new PostgresSessions(pool);
  const id = randomUUID();
  const at = new Date().toISOString();
  await repository.create({ id, title: "Même titre", createdAt: at, updatedAt: at, selection: null });
  await repository.create({ id: randomUUID(), title: "Même titre", createdAt: at, updatedAt: at, selection: null });
  const selection = { provider: "demo" as const, modelId: "demo", contextWindow: 8192, capacitySource: "configured" as const };
  await repository.select(id, selection);
  assert.deepEqual((await repository.get(id))?.selection, selection);
  assert((await repository.list()).some(item => item.id === id));
  const runId = randomUUID();
  await sessions.claim(id, runId);
  await assert.rejects(new PostgresSessions(pool).claim(id, randomUUID()), /réconciliation/);
  await sessions.release(id, randomUUID());
  await assert.rejects(sessions.claim(id, randomUUID()), /réconciliation/);
  await sessions.release(id, runId);
  const next = randomUUID();
  await sessions.claim(id, next);
  await sessions.release(id, next);
  await sessions.append(id, { ...event({ summary: "point de reprise" }), type: "context.checkpoint" });
  assert.equal((await sessions.read(id)).at(-1)?.type, "context.checkpoint");
});


test("structured PostgreSQL memory scopes deduplication, records revisions and rejects lost updates", async () => {
  const projects = new PostgresProjects(pool);
  const projectId = randomUUID();
  await projects.create({ id: projectId, title: "Project A" });
  const repository = new PostgresStructuredMemory(pool);
  const scoped = new StructuredMemory(repository, { projectId, source: { type: "conversation", conversationId: randomUUID() } });
  const personal = new StructuredMemory(repository, { projectId: null, source: { type: "manual" } });
  const marker = randomUUID();
  const input = { title: "Contrainte", content: `PostgreSQL ${marker}`, kind: "constraint" as const, scope: "project" as const, projectId };
  const duplicates = await Promise.all(Array.from({ length: 6 }, () => scoped.rememberRecord(input)));
  assert.equal(new Set(duplicates.map(item => item.id)).size, 1);
  const created = duplicates[0];
  const global = await personal.rememberRecord({ ...input, scope: "personal", projectId: null });
  assert.notEqual(created.id, global.id);
  assert(!(await personal.search(marker)).some(item => item.id === created.id));
  const outcomes = await Promise.allSettled([
    scoped.update(created.id, 1, { ...input, title: "Correction A" }),
    scoped.update(created.id, 1, { ...input, title: "Correction B" }),
  ]);
  assert.equal(outcomes.filter(item => item.status === "fulfilled").length, 1);
  assert.equal((await scoped.get(created.id)).version, 2);
  await scoped.setStatus(created.id, 2, "forgotten");
  assert(!(await scoped.search(marker)).some(item => item.id === created.id));
  assert.equal((await scoped.revisions(created.id)).length, 3);
  await scoped.setStatus(created.id, 3, "active");
  assert.equal((await scoped.revisions(created.id)).length, 4);
  const legacy = new BasicMemory(new PostgresMemoryRepository(pool));
  await personal.setStatus(global.id, 1, "forgotten");
  assert.deepEqual(await legacy.search(marker), []);
  const replacement = await personal.rememberRecord({ ...input, scope: "personal", projectId: null });
  assert.notEqual(replacement.id, global.id);
  await assert.rejects(personal.setStatus(global.id, 2, "active"), /identique/);
  assert.equal((await personal.get(global.id)).status, "forgotten");
  assert.equal((await personal.get(global.id)).version, 2);
});


test("migration 003 preserves existing v2 memories and creates their first revision", async () => {
  const database = "harness_upgrade_" + randomUUID().replaceAll("-", "") + "_test";
  await pool.query(`CREATE DATABASE ${database}`);
  const url = new URL(connection!); url.pathname = "/" + database;
  const previous = createPostgresPool(url.href);
  try {
    await previous.query("CREATE SCHEMA harness; CREATE TABLE harness.migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const [index, file] of ["001_initial.sql", "002_conversations.sql"].entries()) {
      const sql = await readFile(new URL("../src/modules/storage/postgres/migrations/" + file, import.meta.url), "utf8");
      await previous.query(sql);
      await previous.query("INSERT INTO harness.migrations (version,checksum) VALUES ($1,$2)", [index + 1, createHash("sha256").update(sql).digest("hex")]);
    }
    const id = randomUUID(), instance = randomUUID();
    const content = "Contrainte ancienne : PostgreSQL uniquement";
    await previous.query("INSERT INTO harness.instance (id) VALUES ($1)", [instance]);
    await previous.query("INSERT INTO harness.memories (id,content,content_hash) VALUES ($1,$2,$3)", [id,content,createHash("sha256").update(content).digest("hex")]);
    await migratePostgres(previous);
    assert.equal(await postgresInstanceId(previous), instance);
    const memory = new StructuredMemory(new PostgresStructuredMemory(previous), { source: { type: "manual" } });
    const record = await memory.get(id);
    assert.equal(record.content, content);
    assert.equal(record.scope, "personal");
    assert.equal(record.version, 1);
    assert.equal(record.source.type, "legacy");
    assert.deepEqual(await memory.revisions(id), [record]);
    assert.equal((await memory.rememberRecord({ title: "Même contenu", content, kind: "constraint", scope: "personal", projectId: null })).id, id);
  } finally {
    await previous.end();
    await pool.query(`DROP DATABASE ${database}`);
  }
});


test('assistant preferences persist across connections with optimistic concurrency and stable instance identity',async()=>{
 const { defaultAssistant }=await import('../src/app/assistant.ts');
 const first=await openPostgresStorage(connection!);
 const id=first.instanceId;
 try{
  assert.equal(await first.assistant.get(),null);
  const profile=await first.assistant.save({...defaultAssistant,name:'Elios',completed:true,step:5,avatarPackId:'bdcb9596-cc59-44de-ad7f-b3e783593ca4',personalityInstructions:'Privilégie les exemples concrets.\nÉvite les répétitions.',conversationDefaults:{selection:{provider:'openai',modelId:'test-default-api',contextWindow:32768,capacitySource:'configured'},fileAccess:'develop',networkAccess:true}},0);
  assert.equal(profile.version,1);
  await assert.rejects(first.assistant.save(defaultAssistant,0),/modifié ailleurs/);
  const {Assistant}=await import('../src/app/assistant.ts');const app=new Assistant(first.assistant);const baseline=await app.defaults();
  await app.patch({version:1,base:{theme:'light'},patch:{theme:'night'}});
  await app.saveDefaults({version:baseline.version,baseDefaults:baseline.defaults,defaults:{...baseline.defaults,selection:{...baseline.defaults.selection!,reasoningEffort:'high'}}});
 }finally{await first.close();}
 const second=await openPostgresStorage(connection!);
 try{assert.equal(second.instanceId,id);assert.equal((await second.assistant.get())?.settings.name,'Elios');assert.equal((await second.assistant.get())?.version,3);assert.equal((await second.assistant.get())?.settings.theme,'night');assert.equal((await second.assistant.get())?.settings.avatarPackId,'bdcb9596-cc59-44de-ad7f-b3e783593ca4');assert.equal((await second.assistant.get())?.settings.personalityInstructions,'Privilégie les exemples concrets.\nÉvite les répétitions.');assert.equal((await second.assistant.get())?.settings.conversationDefaults?.selection?.reasoningEffort,'high');assert.equal((await second.assistant.get())?.settings.conversationDefaults?.selection?.modelId,'test-default-api');assert.equal((await second.assistant.get())?.settings.conversationDefaults?.networkAccess,true);}finally{await second.close();}
});


test("chat assets persist across reopening, isolate files and claim all or none", async () => {
  const storage = await openPostgresStorage(connection!);
  try {
    const repo=storage.chatAssets, id=randomUUID(), other=randomUUID(), at=new Date().toISOString();
    await storage.conversations.create({id,title:'Fichiers',createdAt:at,updatedAt:at,selection:null});
    await storage.conversations.create({id:other,title:'Autre',createdAt:at,updatedAt:at,selection:null});
    const prompt={id:randomUUID(),title:'Résumé',description:'Test',content:'Résume.',context:'all' as const,version:1,updatedAt:at};
    await repo.savePrompt(prompt,0);
    await assert.rejects(repo.savePrompt(prompt,0),/modifié/);
    await repo.savePrompt({...prompt,version:2,content:'Nouveau contenu'},1);
    await assert.rejects(repo.deletePrompt(prompt.id,1),/modifié/);
    const bytes=Buffer.from('Pièce jointe privée é'), file={id:randomUUID(),conversationId:id,name:'note.txt',mediaType:'text/plain',size:bytes.length,createdAt:at,used:false};
    await repo.putAttachment(file,bytes);
    assert.equal(await repo.attachment(other,file.id),null);
    await assert.rejects(repo.claimAttachments(id,[file.id,randomUUID()]),/introuvable/);
    assert.equal((await repo.attachment(id,file.id))?.file.used,false);
    await repo.claimAttachments(id,[file.id]);
    await assert.rejects(repo.deleteAttachment(id,file.id),/historique/);
    const reopened=await openPostgresStorage(connection!);
    try {
      assert.equal((await reopened.chatAssets.prompts()).find(item=>item.id===prompt.id)?.version,2);
      assert.deepEqual((await reopened.chatAssets.attachment(id,file.id))?.bytes,bytes);
      assert.equal((await reopened.chatAssets.attachment(id,file.id))?.file.used,true);
    } finally {await reopened.close();}
    const pending={...file,id:randomUUID()};await repo.putAttachment(pending,bytes);await repo.deleteAttachment(id,pending.id);
    assert.equal(await repo.attachment(id,pending.id),null);
    // Keep prompt and binary file to qualify dump/restore in the outer runner.
  } finally {await storage.close();}
});


test("file access defaults to read-only, persists and cannot change during an active run",async()=>{
 const storage=await openPostgresStorage(connection!);const id=randomUUID(),at=new Date().toISOString();
 try{
  await storage.conversations.create({id,title:"Accès fichiers",createdAt:at,updatedAt:at,selection:null});
  assert.equal((await storage.conversations.get(id))?.fileAccess,"read");
  await storage.conversations.setFileAccess(id,"write");assert.equal((await storage.conversations.get(id))?.fileAccess,"write");
  const run=randomUUID();await storage.sessions.claim!(id,run);
  await assert.rejects(storage.conversations.setFileAccess(id,"none"));await storage.sessions.release!(id,run);
  await storage.conversations.setFileAccess(id,"none");
  const reopened=await openPostgresStorage(connection!);try{assert.equal((await reopened.conversations.get(id))?.fileAccess,"none");}finally{await reopened.close();}
 }finally{await storage.close();}
});

test("owner file actions share the conversation claim but keep private edits out of model history",async()=>{
 const {Workspace}=await import("../src/app/workspace.ts");
 const storage=await openPostgresStorage(connection!),directory=await mkdtemp(path.join(os.tmpdir(),"heart-pg-files-"));
 const id=randomUUID(),at=new Date().toISOString();
 try{
  await storage.conversations.create({id,title:"Explorer",createdAt:at,updatedAt:at,selection:null});
  const workspace=new Workspace(storage.sessions);await workspace.action(id,directory,{action:"create",path:"note.txt",content:"owner-private"});
  assert.equal((await storage.sessions.read(id)).length,0);
  assert(!JSON.stringify(await storage.sessions.read(`workspace-${id}`)).includes("owner-private"));
  assert((await storage.sessions.read(`workspace-${id}`)).some(event=>event.type==="tool.finished"));
  const run=randomUUID();await storage.sessions.claim!(id,run);
  await assert.rejects(workspace.action(id,directory,{action:"create",path:"blocked.txt",content:"blocked"}));
  await assert.rejects(readFile(path.join(directory,"blocked.txt")));
  await storage.sessions.release!(id,run);
  await workspace.action(id,directory,{action:"create",path:"next.txt",content:"ok"});
 }finally{await storage.close();await rm(directory,{recursive:true,force:true});}
});


test("development policy persists separately from the model, rejects active-run changes and keeps current access",async()=>{
 const storage=await openPostgresStorage(connection!),id=randomUUID(),at=new Date().toISOString();
 try{await storage.conversations.create({id,title:"Development",createdAt:at,updatedAt:at,selection:null});await storage.conversations.setFileAccess(id,"develop");await storage.conversations.setExecutionPolicy(id,true,0);
 const saved=await storage.conversations.get(id);assert.equal(saved?.fileAccess,"develop");assert.equal(saved?.networkAccess,true);assert.equal(saved?.maxSteps,0);
 await storage.conversations.setFileAccess(id,"yolo");assert.equal((await storage.conversations.get(id))?.fileAccess,"yolo");
 const run=randomUUID();await storage.sessions.claim!(id,run);await assert.rejects(storage.conversations.setFileAccess(id,"read"));await assert.rejects(storage.conversations.setExecutionPolicy(id,false,12));await storage.sessions.release!(id,run);
 await storage.conversations.setExecutionPolicy(id,false,12);assert.equal((await storage.conversations.get(id))?.maxSteps,12);
 }finally{await storage.close();}
});

test('model selection uses an atomic base selection and cannot change during a claimed run',async()=>{
 const storage=await openPostgresStorage(connection!);const id=randomUUID(),at=new Date().toISOString();
 const first={provider:'openai' as const,modelId:'first-model',contextWindow:32768,capacitySource:'configured' as const};
 const second={...first,modelId:'second-model',reasoningEffort:'high'};
 try{
  await storage.conversations.create({id,title:'Model choice',createdAt:at,updatedAt:at,selection:null});
  await storage.conversations.select(id,first,null);
  await assert.rejects(storage.conversations.select(id,second,null),/modifié ailleurs/);
  const run=randomUUID();await storage.sessions.claim!(id,run);
  await assert.rejects(storage.conversations.select(id,second,first),/occupée/);await storage.sessions.release!(id,run);
  await storage.conversations.select(id,second,first);assert.equal((await storage.conversations.get(id))?.selection?.modelId,'second-model');assert.equal((await storage.sessions.read(id)).length,0);
 }finally{await storage.close();}
});

test('interactive pause releases the PostgreSQL claim and answers resume atomically once across engine instances',async()=>{
 const {interactionTools}=await import('../src/modules/tools/interactions/index.ts');
 const {interactionsFrom}=await import('../src/core/interactions.ts');
 const sessions=new PostgresSessions(pool),id=randomUUID();let calls=0,release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const provider:ModelProvider={id:'input-test',async generate(request):Promise<ModelResponse>{calls++;if(calls===1)return{content:'',toolCalls:[{id:'ask-'+id,name:'interactions.request_input',arguments:{title:'Choisir',questions:[{id:'choix',label:'Quel choix ?',type:'single',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}]}}]};entered();await held;assert(request.messages.some(m=>m.role==='tool'&&m.content.includes('"a"')));return{content:'Confirmé',toolCalls:[]};}};
 const options={sessionId:id,prompt:'Préparer',provider,displayName:'Nora',workspace:'/tmp',permissions:new Set(['user.input'] as const)};
 const paused=await new Engine(sessions,interactionTools()).run(options);assert(paused.waitingFor);assert.equal(calls,1);
 assert.equal((await pool.query('SELECT active_run FROM harness.sessions WHERE id=$1',[id])).rows[0].active_run,null);
 const previous=await sessions.read(id), sequence=(await pool.query('SELECT next_sequence FROM harness.sessions WHERE id=$1',[id])).rows[0].next_sequence;
 await assert.rejects(sessions.appendBatch(id,[{...event({requestId:paused.waitingFor,response:{status:'answered',answers:{choix:'a'}}}),type:'interaction.resolved'},{...event(),type:'invalid' as Event['type']}]));
 assert.deepEqual(await sessions.read(id),previous,'failed batch rolls back its resolution');assert.equal((await pool.query('SELECT next_sequence FROM harness.sessions WHERE id=$1',[id])).rows[0].next_sequence,sequence);
 assert.equal(interactionsFrom(previous)[0].status,'pending');
 // Simulate a process dying after the durable pause but before releasing its claim.
 await pool.query('UPDATE harness.sessions SET active_run=$2 WHERE id=$1',[id,paused.runId]);
 const resume={requestId:paused.waitingFor!,response:{status:'answered' as const,answers:{choix:'a'}}};
 const continuing=new Engine(new PostgresSessions(pool),interactionTools()).run({...options,resume});await ready;
 await assert.rejects(new Engine(new PostgresSessions(pool),interactionTools()).run({...options,resume}),/travaille déjà/);
 release();assert.equal((await continuing).text,'Confirmé');assert.equal(calls,2);
 assert((await new Engine(new PostgresSessions(pool),interactionTools()).run({...options,resume})).alreadyResolved);assert.equal(calls,2);
 const history=await sessions.read(id);assert.equal(history.filter(e=>e.type==='interaction.resolved').length,1);assert.equal(history.filter(e=>e.type==='message'&&(e.data as any).role==='user').length,1);
});

test('interactive answer atomically supersedes old dependent actions before new inference and preserves prior effects',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'heart-replan-sql-'));try{
 const {interactionTools}=await import('../src/modules/tools/interactions/index.ts');
 const id='choice-'+randomUUID(),sessions=new PostgresSessions(pool),effects:string[]=[];let calls=0;
 const tool:import('../src/contracts/tools.ts').Tool={name:'apply',description:'apply',permission:'files.write',parameters:{type:'object'},async execute(args){effects.push((args as {choice:string}).choice);return 'done';}};
 const provider:ModelProvider={id:'choice-fixture',async generate(request):Promise<ModelResponse>{calls++;
  if(calls===1)return{content:'',toolCalls:[{id:'before-'+id,name:'apply',arguments:{choice:'before'}},{id:'ask-'+id,name:'interactions.request_input',arguments:{title:'Choisir',questions:[{id:'choice',label:'A ou B ?',type:'single',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}]}},{id:'stale-'+id,name:'apply',arguments:{choice:'a'}}]};
  if(calls===2){assert.deepEqual(effects,['before']);assert(request.messages.some(m=>m.role==='tool'&&m.callId==='ask-'+id&&m.content.includes('"b"')));assert(request.messages.some(m=>m.role==='tool'&&m.callId==='stale-'+id&&m.error));return{content:'',toolCalls:[{id:'fresh-'+id,name:'apply',arguments:{choice:'b'}}]};}
  assert.deepEqual(effects,['before','b']);return{content:'B appliqué',toolCalls:[]};}};
 const options={sessionId:id,workspace,displayName:'Test',prompt:'Choisir',provider,permissions:new Set(['user.input','files.write'] as const)};
 const first=await new Engine(sessions,[tool,...interactionTools()]).run(options);const resume={requestId:first.waitingFor!,response:{status:'answered' as const,answers:{choice:'b'}}};
 const engine=new Engine(new PostgresSessions(pool),[tool,...interactionTools()]);assert.equal((await engine.run({...options,resume})).text,'B appliqué');assert.deepEqual(effects,['before','b']);assert((await engine.run({...options,resume})).alreadyResolved);assert.equal(calls,3);
 const events=await sessions.read(id);assert(events.some(e=>e.type==='tool.finished'&&(e.data as any).callId==='stale-'+id&&(e.data as any).skipped===true));assert.equal(events.filter(e=>e.type==='interaction.resolved').length,1);
 }finally{await rm(workspace,{recursive:true,force:true});}
});


test('work projection persists terminal states and public progress independently of LLM messages',async()=>{
 const repository=new PostgresConversations(pool),sessions=new PostgresSessions(pool),id=randomUUID(),at=new Date().toISOString(),runId=randomUUID();
 await repository.create({id,title:'Work projection',createdAt:at,updatedAt:at,selection:null});
 const state=async()=>(await repository.list()).find(c=>c.id===id)?.work?.status;
 assert.equal(await state(),'idle');await sessions.claim(id,runId);assert.equal(await state(),'interrupted');
 await sessions.append(id,{id:randomUUID(),runId,at,type:'run.started',data:{}});
 await sessions.append(id,{id:randomUUID(),runId,at,type:'run.progress',data:{kind:'commentary',text:'Je vérifie le document.'}});
 await sessions.append(id,{id:randomUUID(),runId,at,type:'interaction.requested',data:{}});await sessions.release(id,runId);assert.equal(await state(),'waiting');
 await sessions.append(id,{id:randomUUID(),runId,at,type:'run.completed',data:{}});assert.equal(await state(),'completed');
 await sessions.append(id,{id:randomUUID(),runId,at,type:'run.failed',data:{cancelled:true}});assert.equal(await state(),'cancelled');
 await sessions.append(id,{id:randomUUID(),runId,at,type:'run.failed',data:{error:'fixture'}});assert.equal(await state(),'failed');
 const journal=await sessions.read(id);assert.equal(journal.filter(e=>e.type==='run.progress').length,1);assert.equal(journal.filter(e=>e.type==='message').length,0);
});


test('MCP connection metadata and approved schemas persist with optimistic edits, without storing secret values',async()=>{
 const {PostgresExternalTools}=await import('../src/modules/storage/postgres/index.ts');const repository=new PostgresExternalTools(pool);const id=randomUUID();
 const saved=await repository.save({id,version:0,label:'Search provider',url:'https://example.com/mcp',enabled:false,auth:{type:'header_env',envVar:'TEST_SEARCH_KEY',headerName:'x-api-key'},timeoutMs:60000,tools:[{name:'search',description:'Public search',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']},readOnlyHint:true}]},0);
 assert.equal(saved.version,1);assert.deepEqual(await repository.get(id),saved);assert((await repository.list()).some(c=>c.id===id));
 const second=await openPostgresStorage(connection!);try{assert.deepEqual(await second.externalTools.get(id),saved);}finally{await second.close();}
 const updated=await repository.save({...saved,enabled:true},1);assert.equal(updated.version,2);await assert.rejects(repository.save({...saved,label:'Stale'},1),/modifiée ailleurs/);assert.equal((await repository.get(id))?.label,'Search provider');
 const raw=JSON.stringify((await pool.query('SELECT config FROM harness.external_tools WHERE id=$1',[id])).rows[0].config);assert(raw.includes('TEST_SEARCH_KEY'));assert(!raw.includes('Bearer '));
});

test('runtime lease blocks live recovery, dead owner repair is atomic and fences late writes',async()=>{
 const {recoveryPlan,recoveryEvents}=await import('../src/core/recovery.ts');
 const runtime=await PostgresSessions.open(pool),id='recover-'+randomUUID(),runId=randomUUID();
 const e:Event={id:randomUUID(),at:new Date().toISOString(),runId,type:'run.started',data:{}};
 try{
  await runtime.sessions.claim(id,runId);await runtime.sessions.append(id,e);
  const other=new PostgresSessions(pool),plan=recoveryPlan(await other.read(id)),repair=recoveryEvents(plan,false,'');
  await assert.rejects(other.reconcile(id,e.id,repair),/encore actif/);
  await runtime.close();
  await assert.rejects(other.reconcile(id,randomUUID(),repair),/changé/);
  await other.reconcile(id,e.id,repair);
  assert.deepEqual(recoveryPlan(await other.read(id)).runs,[]);
  await assert.rejects(other.append(id,{...e,id:randomUUID(),type:'run.progress'}),/tardive/);
  await assert.rejects(other.reconcile(id,e.id,repair),/changé/);
  const next=randomUUID();await other.claim(id,next);await other.release(id,next);
 }finally{await runtime.close();}
});

test('SIGKILL during an effect preserves known output and recovery never executes the batch again',async()=>{
 const {spawn}=await import('node:child_process');
 const {recoveryPlan,recoveryEvents}=await import('../src/core/recovery.ts');
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-crash-')),id='kill-'+randomUUID(),file=path.join(directory,'effects');
 const worker=spawn(process.execPath,['--import','tsx','tests/fixtures/recovery-worker.ts'],{env:{...process.env,HEART_TEST_SESSION:id,HEART_TEST_EFFECT_FILE:file},stdio:['ignore','pipe','pipe']});
 let runtime:Awaited<ReturnType<typeof PostgresSessions.open>>|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Crash fixture timed out')),15000);
   worker.stdout.on('data',chunk=>{if(String(chunk).includes('EFFECT_WRITTEN')){clearTimeout(timer);resolve();}});
   worker.on('exit',()=>{clearTimeout(timer);reject(new Error('Crash fixture exited before effect'));});
  });
  const ended=new Promise<void>(resolve=>worker.once('exit',()=>resolve()));worker.kill('SIGKILL');await ended;
  runtime=await PostgresSessions.open(pool);
  const before=await runtime.sessions.read(id),plan=recoveryPlan(before);
  assert.deepEqual(plan.calls.map(c=>c.state),['uncertain','not-started']);
  const known=before.find(e=>e.type==='message'&&(e.data as {callId?:string}).callId==='known');assert.ok(known);
  await runtime.sessions.reconcile!(id,plan.lastEventId,recoveryEvents(plan,true,'Effet local présent, sans rejeu.'));
  const provider:ModelProvider={id:'after-crash',async generate(){return{content:'Continuité conservée',toolCalls:[]};}};
  const resumed=await new Engine(runtime.sessions,[]).run({sessionId:id,prompt:'Continue',provider,displayName:'Fixture',workspace:directory,permissions:new Set()});
  assert.equal(resumed.text,'Continuité conservée');
  assert.deepEqual((await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line).stage),['known','crash']);
  assert.deepEqual((await runtime.sessions.read(id)).find(e=>e.id===known.id),known);
 }finally{worker.kill('SIGKILL');await runtime?.close();await rm(directory,{recursive:true,force:true});}
});

test('empty abandoned claims reconcile once while legacy ownerless claims fail closed',async()=>{
 const {recoveryPlan,recoveryEvents}=await import('../src/core/recovery.ts');
 const runtime=await PostgresSessions.open(pool),id='empty-'+randomUUID(),runId=randomUUID();
 await runtime.sessions.claim(id,runId);await runtime.close();
 const sessions=new PostgresSessions(pool),plan=recoveryPlan([],await sessions.recoveryClaim(id));
 assert.deepEqual(plan.runs,[runId]);
 const results=await Promise.allSettled([sessions.reconcile(id,null,recoveryEvents(plan,true,'')),sessions.reconcile(id,null,recoveryEvents(plan,true,''))]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(await sessions.recoveryClaim(id),null);
 const legacy='legacy-'+randomUUID();await sessions.claim(legacy,randomUUID());
 await assert.rejects(sessions.reconcile(legacy,null,recoveryEvents(recoveryPlan([],await sessions.recoveryClaim(legacy)),true,'')),/sans propriétaire/);
 assert.equal((await sessions.read(legacy)).length,0);
 await pool.query('UPDATE harness.sessions SET active_run=NULL WHERE id=$1',[legacy]);
});

test('exclusive backup maintenance defers for live runtimes and blocks startup and migrations',async()=>{
 const runtime=await PostgresSessions.open(pool),guard=await pool.connect();
 try{
  assert.equal((await guard.query('SELECT pg_try_advisory_lock(170210,2) AS ok')).rows[0].ok,false);
  await runtime.close();
  assert.equal((await guard.query('SELECT pg_try_advisory_lock(170210,2) AS ok')).rows[0].ok,true);
  await assert.rejects(PostgresSessions.open(pool),/maintenance/);
  await assert.rejects(migratePostgres(pool),/maintenance/);
 }finally{await runtime.close();await guard.query('SELECT pg_advisory_unlock(170210,2)');guard.release();}
 const restarted=await PostgresSessions.open(pool);await restarted.close();
});

// Identical behavioural suite used by SQLite; no PostgreSQL types in its assertions.
import {sqlStorageConformance} from './sql-storage.conformance.ts';
sqlStorageConformance('PostgreSQL',async()=>({open:()=>openPostgresStorage(connection!),cleanup:async()=>{}}));

test('v13 to v14 task migration preserves the previous twelve operational tables',async()=>{
 const database='tasks_upgrade_'+randomUUID().replaceAll('-','')+'_test';await pool.query(`CREATE DATABASE ${database}`);const url=new URL(connection!);url.pathname='/'+database;const old=createPostgresPool(url.href);
 try{
  await old.query('CREATE SCHEMA harness; CREATE TABLE harness.migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const {readdir}=await import('node:fs/promises');const folder=new URL('../src/modules/storage/postgres/migrations/',import.meta.url),files=(await readdir(folder)).filter(f=>/^0(?:0[1-9]|1[0-3])_/.test(f)).sort();assert.equal(files.length,13);
  for(const [i,file] of files.entries()){const sql=await readFile(new URL(file,folder),'utf8');await old.query(sql);await old.query('INSERT INTO harness.migrations(version,checksum) VALUES($1,$2)',[i+1,createHash('sha256').update(sql).digest('hex')]);}
  const instance=randomUUID(),session=randomUUID();await old.query('INSERT INTO harness.instance(id) VALUES($1)',[instance]);await old.query('INSERT INTO harness.sessions(id) VALUES($1)',[session]);await old.query('INSERT INTO harness.conversations(id,title,created_at,updated_at) VALUES($1,$2,now(),now())',[session,'Conserver ce fil']);await old.query('INSERT INTO harness.assistant_profile(instance_id,settings,version) VALUES($1,$2,1)',[instance,{name:'Old profile',settingsMarker:'preserve'}]);
  const tables=['instance','sessions','events','memories','memory_revisions','conversations','projects','assistant_profile','quick_prompts','chat_attachments','external_tools','reconciled_runs'];
  const snapshot=async()=>{const out:Record<string,string>={};for(const table of tables)out[table]=(await old.query(`SELECT md5(COALESCE(jsonb_agg(j ORDER BY j::text)::text,'[]')) digest FROM(SELECT to_jsonb(t) j FROM harness.${table} t)s`)).rows[0].digest;return out;};
  const before=await snapshot();await migratePostgres(old);assert.deepEqual(await snapshot(),before);assert.equal(Number((await old.query('SELECT count(*) n FROM harness.tasks')).rows[0].n),0);assert.equal(Number((await old.query('SELECT count(*) n FROM harness.task_runs')).rows[0].n),0);
 }finally{await old.end();await pool.query(`DROP DATABASE ${database} WITH(FORCE)`);}
});

test('v14 to v15 preserves all operational rows and accepts remote project references',async()=>{
 const database='projects_upgrade_'+randomUUID().replaceAll('-','')+'_test';await pool.query(`CREATE DATABASE ${database}`);const url=new URL(connection!);url.pathname='/'+database;const old=createPostgresPool(url.href);
 try{
  await old.query('CREATE SCHEMA harness; CREATE TABLE harness.migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  const {readdir}=await import('node:fs/promises');const folder=new URL('../src/modules/storage/postgres/migrations/',import.meta.url),files=(await readdir(folder)).filter(f=>/^0(?:0[1-9]|1[0-4])_/.test(f)).sort();assert.equal(files.length,14);
  for(const [i,file] of files.entries()){const sql=await readFile(new URL(file,folder),'utf8');await old.query(sql);await old.query('INSERT INTO harness.migrations(version,checksum) VALUES($1,$2)',[i+1,createHash('sha256').update(sql).digest('hex')]);}
  const instance=randomUUID(),id=randomUUID(),project=randomUUID();await old.query('INSERT INTO harness.instance(id) VALUES($1)',[instance]);await old.query('INSERT INTO harness.projects(id,title) VALUES($1,$2)',[project,'Legacy']);await old.query('INSERT INTO harness.sessions(id) VALUES($1)',[id]);await old.query('INSERT INTO harness.conversations(id,title,created_at,updated_at,project_id) VALUES($1,$2,now(),now(),$3)',[id,'Keep',project]);
  const tables=['instance','sessions','events','memories','memory_revisions','conversations','projects','assistant_profile','quick_prompts','chat_attachments','external_tools','reconciled_runs','tasks','task_runs'];
  const snapshot=async()=>{const out:Record<string,string>={};for(const table of tables)out[table]=(await old.query(`SELECT md5(COALESCE(jsonb_agg(j ORDER BY j::text)::text,'[]')) digest FROM(SELECT to_jsonb(t) j FROM harness.${table} t)s`)).rows[0].digest;return out;};
  const before=await snapshot();await migratePostgres(old);assert.deepEqual(await snapshot(),before);
  const remote=randomUUID();await old.query('UPDATE harness.conversations SET project_id=$1 WHERE id=$2',[remote,id]);assert.equal((await old.query('SELECT count(*) n FROM harness.projects WHERE id=$1',[remote])).rows[0].n,'0');
 }finally{await old.end();await pool.query(`DROP DATABASE ${database} WITH(FORCE)`)}
});
