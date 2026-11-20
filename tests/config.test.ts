import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadConfig, postgresConnection, projectsRootDirectory } from "../src/app/config.ts";
import { compose } from "../src/app/compose.ts";

test("configuration uses a credential reference, never an inline URL or implicit fallback", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-config-"));
  const file = path.join(directory, "config.json");
  const base = { displayName: "Renamed", workspaceDirectory: "files", maxSteps: 8 };
  try {
    await writeFile(file, JSON.stringify({ ...base, storage: { driver: "postgres", connectionStringEnv: "HARNESS_MISSING_CONFIG_TEST_URL" } }));
    const config = await loadConfig(file);
    assert.equal(config.workspace, path.join(directory, "files"));
    assert.throws(() => postgresConnection(config.storage), /manquante/);
    await writeFile(file, JSON.stringify(base));
    await assert.rejects(loadConfig(file), /storage manquante/);
    await writeFile(file, JSON.stringify({ ...base, storage: { driver: "postgres", connectionStringEnv: "postgres://inline" } }));
    await assert.rejects(loadConfig(file), /variable de connexion/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unknown module selections are rejected before opening the configured storage", async () => {
  await assert.rejects(compose({
    displayName: "Test", workspace: ".", maxSteps: 8,
    modules: { memory: "unregistered", model: "demo" },
    storage: { driver: "postgres", connectionStringEnv: "HARNESS_MISSING_CONFIG_TEST_URL" },
  }), /Module mémoire inconnu/);
});

test("AI SDK configuration requires explicit provider, credential reference and output limit", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-model-config-"));
  const file = path.join(directory, "config.json");
  const base = { displayName: "Test", workspaceDirectory: "workspace", modules: { memory: "basic", model: "ai-sdk" },
    storage: { driver: "json", directory: "state" } };
  const model = { provider: "openai", modelId: "chosen-model", apiKeyEnv: "HARNESS_MISSING_MODEL_TEST_KEY", maxOutputTokens: 256 };
  try {
    for (const provider of ["openai", "anthropic"]) {
      await writeFile(file, JSON.stringify({ ...base, model: { ...model, provider } }));
      const config = await loadConfig(file);
      await assert.rejects(compose(config), /Variable HARNESS_MISSING_MODEL_TEST_KEY manquante/);
      assert.deepEqual(await readdir(directory), ["config.json"]);
    }
    for (const invalid of [undefined, { ...model, provider: "gateway" }, { ...model, maxOutputTokens: 0 },
      { ...model, apiKeyEnv: "raw-secret-value" }, { ...model, apiKey: "inline-secret" }]) {
      await writeFile(file, JSON.stringify({ ...base, model: invalid }));
      await assert.rejects(loadConfig(file), /Configuration modèle AI SDK invalide/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ChatGPT selection is explicit and cannot alter or fall back to the API-key configuration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-chatgpt-config-"));
  const file = path.join(directory, "config.json");
  const base = { displayName: "Test", workspaceDirectory: "workspace", modules: { memory: "basic", model: "chatgpt" },
    storage: { driver: "json", directory: "state" } };
  const chatgpt = { modelId: "test-model", profile: "default", credentialsDirectoryEnv: "HARNESS_MISSING_CHATGPT_TEST_DIR", timeoutMs: 1000 };
  try {
    await writeFile(file, JSON.stringify({ ...base, chatgpt }));
    const config = await loadConfig(file);
    await assert.rejects(compose(config), /HARNESS_MISSING_CHATGPT_TEST_DIR/);
    assert.deepEqual(await readdir(directory), ["config.json"]);
    for (const invalid of [undefined, { ...chatgpt, profile: "../escape" }, { ...chatgpt, timeoutMs: 0 },
      { ...chatgpt, credentialsDirectoryEnv: "inline/path" }]) {
      await writeFile(file, JSON.stringify({ ...base, chatgpt: invalid }));
      await assert.rejects(loadConfig(file), /Configuration ChatGPT invalide/);
    }
    await writeFile(file, JSON.stringify({ ...base, chatgpt, model: { provider: "openai", apiKeyEnv: "UNUSED", modelId: "unused", maxOutputTokens: 128 } }));
    await assert.rejects(loadConfig(file), /Options modèle réservées au module ai-sdk/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the existing API-key configuration still composes OpenAI and Anthropic without any ChatGPT connection", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-api-regression-"));
  const variable = "HARNESS_FAKE_API_REGRESSION_KEY";
  const previous = process.env[variable];
  process.env[variable] = "fake-test-key";
  try {
    for (const provider of ["openai", "anthropic"]) {
      const file = path.join(directory, "config.json");
      await writeFile(file, JSON.stringify({ displayName: "Nora", workspaceDirectory: "workspace", modules: { memory: "basic", model: "ai-sdk" },
        model: { provider, modelId: "test-model", apiKeyEnv: variable, maxOutputTokens: 128 },
        storage: { driver: "json", directory: "state" } }));
      const app = await compose(await loadConfig(file));
      try { assert.match(app.model.id, /^ai-sdk:/); assert.match(app.model.id, /test-model$/); }
      finally { await app.close(); }
    }
  } finally {
    if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("structured memory refuses an unsupported demo repository before creating files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heart-structured-config-"));
  try {
    await assert.rejects(compose({ displayName: "Nora", workspace: path.join(directory,"workspace"), maxSteps: 8,
      modules: { memory: "structured", model: "demo" }, storage: { driver: "json", directory: path.join(directory,"state") } }), /ne fournit pas de mémoire structurée/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SQLite selection is explicit, resolves paths and never changes the PostgreSQL environment',async()=>{
 const {migrateStorage,backupSqlite}=await import('../src/app/compose.ts');
 const {webStorageConfig}=await import('../src/app/config.ts');
 const root=await mkdtemp(path.join(os.tmpdir(),'heart-sqlite-config-')),file=path.join(root,'config.json');
 try{
  await writeFile(file,JSON.stringify({displayName:'SQLite demo',workspaceDirectory:'workspace',storage:{driver:'sqlite',file:'data.sqlite'},modules:{memory:'structured',model:'demo'}}));
  const config=await loadConfig(file);assert.deepEqual(config.storage,{driver:'sqlite',file:path.join(root,'data.sqlite')});
  await assert.rejects(compose(config));await migrateStorage(config);
  const first=await compose(config);const identity=first.instanceId;await first.close();
  const renamed=await compose({...config,displayName:'Renamed assistant'});assert.equal(renamed.instanceId,identity);await renamed.close();
  await backupSqlite(config,path.join(root,'copy.sqlite'));
  const copied=await compose({...config,storage:{driver:'sqlite',file:path.join(root,'copy.sqlite')}});assert.equal(copied.instanceId,identity);await copied.close();
  assert.equal(webStorageConfig({HARNESS_DATABASE_URL:'synthetic-value'})?.driver,'postgres');
  assert.deepEqual(webStorageConfig({HARNESS_STORAGE_DRIVER:'sqlite',HARNESS_SQLITE_PATH:'/private/test.sqlite',HARNESS_DATABASE_URL:'synthetic-value'}),{driver:'sqlite',file:'/private/test.sqlite'});
  assert.throws(()=>webStorageConfig({HARNESS_SQLITE_PATH:'/private/test.sqlite'}),/explicitement/);
  assert.throws(()=>webStorageConfig({HARNESS_STORAGE_DRIVER:'sqlite',HARNESS_SQLITE_PATH:'relative.sqlite'}),/invalide/);
  assert.throws(()=>webStorageConfig({HARNESS_STORAGE_DRIVER:'unknown'}),/invalide/);
 }finally{await rm(root,{recursive:true,force:true});}
});


test("projects root follows the installation, accepts an absolute override and rejects cwd-relative configuration", () => {
  assert.equal(projectsRootDirectory({},"/opt/renamed-heart"),"/opt/renamed-heart/projects");
  assert.equal(projectsRootDirectory({HARNESS_PROJECTS_ROOT:"/srv/my projects"},"/opt/heart"),"/srv/my projects");
  for(const value of ["", " ","./projects", "../outside"])assert.throws(()=>projectsRootDirectory({HARNESS_PROJECTS_ROOT:value},"/opt/heart"),/absolu/);
});
