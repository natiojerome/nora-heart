import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import { sqlStorageConformance } from "./sql-storage.conformance.ts";

sqlStorageConformance("SQLite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-sqlite-contract-")),
    file = path.join(root, "data.sqlite");
  try {
    await migrateSqlite(file);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    open: () => openSqliteStorage(file),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, writeFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  backupSqliteStorage,
  sqliteMaintenance,
} from "../src/modules/storage/sqlite/index.ts";
import { recoveryPlan, recoveryEvents } from "../src/core/recovery.ts";
import { Engine } from "../src/core/engine.ts";

test("SQLite migrations refuse future versions, changed checksums and live runtime maintenance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-sqlite-migration-")),
    file = path.join(root, "data.sqlite");
  try {
    await migrateSqlite(file);
    await migrateSqlite(file);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const live = await openSqliteStorage(file);
    try {
      await assert.rejects(migrateSqlite(file), /maintenance/);
      assert.throws(() => sqliteMaintenance(file), /maintenance/);
    } finally {
      await live.close();
    }
    const release = sqliteMaintenance(file);
    try {
      await assert.rejects(openSqliteStorage(file), /maintenance/);
    } finally {
      release();
    }
    const db = new DatabaseSync(file);
    try {
      db.prepare("UPDATE migrations SET checksum=? WHERE version=1").run(
        "invalid",
      );
      await assert.rejects(migrateSqlite(file), /checksum/);
      db.prepare("UPDATE migrations SET version=999 WHERE version=1").run();
      await assert.rejects(openSqliteStorage(file), /incompatible/);
      await assert.rejects(migrateSqlite(file), /inconnue/);
    } finally {
      db.close();
    }
    const unrelated = path.join(root, "unrelated.sqlite");
    await writeFile(unrelated, "", { mode: 0o600 });
    const other = new DatabaseSync(unrelated);
    other.exec("CREATE TABLE useful_data(id INTEGER)");
    other.close();
    await assert.rejects(migrateSqlite(unrelated), /autre base/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "SQLite actual SIGKILL, native snapshot and restored abandoned-run recovery never replay effects",
  { timeout: 20000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "heart-sqlite-crash-")),
      file = path.join(root, "data.sqlite"),
      copy = path.join(root, "restored.sqlite"),
      effect = path.join(root, "effects"),
      id = randomUUID();
    await migrateSqlite(file);
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/recovery-worker.ts"],
      {
        env: {
          ...process.env,
          HEART_TEST_SQLITE_FILE: file,
          HEART_TEST_SESSION: id,
          HEART_TEST_EFFECT_FILE: effect,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let store: Awaited<ReturnType<typeof openSqliteStorage>> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Crash fixture timed out")),
          10000,
        );
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("EFFECT_WRITTEN")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Crash fixture ended before effect"));
        });
      });
      store = await openSqliteStorage(file);
      const identity = store.instanceId,
        plan = recoveryPlan(
          await store.sessions.read(id),
          await store.sessions.recoveryClaim(id),
        );
      assert.deepEqual(
        plan.calls.map((c) => c.state),
        ["uncertain", "not-started"],
      );
      await assert.rejects(
        store.sessions.reconcile(
          id,
          plan.lastEventId,
          recoveryEvents(plan, true, ""),
        ),
        /actif/,
      );
      await assert.rejects(backupSqliteStorage(file, copy), /maintenance/);
      const ended = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await ended;
      const known = (await store.sessions.read(id)).find(
        (e) =>
          e.type === "message" &&
          (e.data as { callId?: string })?.callId === "known",
      );
      assert(known);
      await store.close();
      store = undefined;
      await backupSqliteStorage(file, copy);
      await assert.rejects(backupSqliteStorage(file, copy), /déjà présente/);
      store = await openSqliteStorage(copy);
      assert.equal(store.instanceId, identity);
      const restoredPlan = recoveryPlan(
        await store.sessions.read(id),
        await store.sessions.recoveryClaim(id),
      );
      await store.sessions.reconcile(
        id,
        restoredPlan.lastEventId,
        recoveryEvents(restoredPlan, true, "Effet constaté, aucun rejeu."),
      );
      const resumed = await new Engine(store.sessions, []).run({
        sessionId: id,
        prompt: "Continue",
        provider: {
          id: "simulated-after-restore",
          async generate() {
            return { content: "Continuité après restauration", toolCalls: [] };
          },
        },
        workspace: root,
        displayName: "Fixture",
        permissions: new Set(),
      });
      assert.equal(resumed.text, "Continuité après restauration");
      assert.deepEqual(
        (await store.sessions.read(id)).find((e) => e.id === known.id),
        known,
      );
      assert.deepEqual(
        (await readFile(effect, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).stage),
        ["known", "crash"],
      );
    } finally {
      child.kill("SIGKILL");
      await store?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "native operator scripts select SQLite and hold a maintenance lease without touching PostgreSQL",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "heart-sqlite-operator-"),
      ),
      file = path.join(root, "data.sqlite"),
      envFile = path.join(root, "web.env");
    let guard: ReturnType<typeof spawn> | undefined;
    try {
      await migrateSqlite(file);
      const first = await openSqliteStorage(file),
        identity = first.instanceId;
      await first.close();
      await writeFile(
        envFile,
        "HARNESS_STORAGE_DRIVER=sqlite\nHARNESS_SQLITE_PATH=" +
          file +
          "\nHARNESS_WEB_HOST=127.0.0.1\nPORT=4215\n",
        { mode: 0o600 },
      );
      const { execFileSync } = await import("node:child_process");
      const env = { ...process.env, HARNESS_BACKUP_ENV_FILE: envFile };
      const settings = JSON.parse(
        execFileSync(
          process.execPath,
          ["scripts/heart-backup-lock.mjs", "--web-settings"],
          { env, encoding: "utf8" },
        ),
      );
      assert.equal(settings.driver, "sqlite");
      assert.equal(settings.sqliteFile, file);
      guard = spawn(process.execPath, ["scripts/heart-backup-lock.mjs"], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Operator lease timed out")),
          5000,
        );
        guard!.stdout!.on("data", (chunk) => {
          if (String(chunk).includes("LOCKED")) {
            clearTimeout(timer);
            resolve();
          }
        });
        guard!.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Operator lease failed"));
        });
      });
      await assert.rejects(openSqliteStorage(file), /maintenance/);
      const bytes = execFileSync(process.execPath, [
        "scripts/heart-sqlite-dump.mjs",
        file,
      ]);
      assert.equal(bytes.subarray(0, 15).toString(), "SQLite format 3");
      const dumped = path.join(root, "dumped.sqlite");
      await writeFile(dumped, bytes, { mode: 0o600 });
      const db = new DatabaseSync(dumped);
      try {
        assert.equal(db.prepare("SELECT id FROM instance").get()?.id, identity);
        assert.equal(
          db.prepare("PRAGMA integrity_check").get()?.integrity_check,
          "ok",
        );
      } finally {
        db.close();
      }
      const ended = new Promise<void>((resolve) =>
        guard!.once("exit", () => resolve()),
      );
      guard.stdin!.end();
      await ended;
      const reopened = await openSqliteStorage(file);
      await reopened.close();
    } finally {
      guard?.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("v1 to v2 migration adds tasks without rewriting existing profile and conversation data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-sqlite-upgrade-")),
    file = path.join(root, "state.sqlite");
  try {
    const { readFile, chmod } = await import("node:fs/promises"),
      { createHash, randomUUID } = await import("node:crypto");
    const db = new DatabaseSync(file),
      id = randomUUID();
    const sql = await readFile(
      new URL(
        "../src/modules/storage/sqlite/migrations/001_initial.sql",
        import.meta.url,
      ),
      "utf8",
    );
    db.exec(
      "PRAGMA application_id=1212240462; CREATE TABLE migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
    );
    db.exec(sql);
    db.prepare("INSERT INTO migrations VALUES(1,?)").run(
      createHash("sha256").update(sql).digest("hex"),
    );
    db.prepare("INSERT INTO instance(singleton,id) VALUES(1,?)").run(
      randomUUID(),
    );
    db.prepare("INSERT INTO sessions(id) VALUES(?)").run(id);
    db.prepare(
      "INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)",
    ).run(
      id,
      "Ancien fil",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    db.prepare(
      "INSERT INTO assistant_profile(singleton,settings,version) VALUES(1,?,1)",
    ).run(JSON.stringify({ marker: "keep" }));
    const before = JSON.stringify(
      db.prepare("SELECT * FROM conversations").all(),
    );
    db.close();
    await chmod(file, 0o600);
    await migrateSqlite(file);
    const after = new DatabaseSync(file);
    try {
      assert.equal(
        JSON.stringify(after.prepare("SELECT * FROM conversations").all()),
        before,
      );
      assert.equal(
        (after.prepare("SELECT settings FROM assistant_profile").get() as any)
          .settings,
        JSON.stringify({ marker: "keep" }),
      );
      assert.equal(
        (after.prepare("SELECT count(*) n FROM tasks").get() as any).n,
        0,
      );
    } finally {
      after.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('v2 to v3 removes project foreign keys while preserving project, memory and child rows',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'heart-project-upgrade-')),file=path.join(root,'s.sqlite');
 const {createHash}=await import('node:crypto');
 try{
  const old=new DatabaseSync(file),project=randomUUID(),conversation=randomUUID(),memory=randomUUID();
  old.exec('PRAGMA application_id=1212240462; CREATE TABLE migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)');
  for(const [i,name] of ['001_initial.sql','002_tasks.sql'].entries()){
   const sql=await readFile(new URL('../src/modules/storage/sqlite/migrations/'+name,import.meta.url),'utf8');old.exec(sql);old.prepare('INSERT INTO migrations VALUES(?,?)').run(i+1,createHash('sha256').update(sql).digest('hex'));
  }
  old.prepare('INSERT INTO instance VALUES(1,?)').run(randomUUID());old.prepare('INSERT INTO projects VALUES(?,?)').run(project,'Legacy');old.prepare('INSERT INTO sessions(id) VALUES(?)').run(conversation);
  old.prepare('INSERT INTO conversations(id,title,created_at,updated_at,project_id) VALUES(?,?,?,?,?)').run(conversation,'Keep','2026-01-01','2026-01-01',project);
  old.prepare("INSERT INTO memories(id,title,content,content_hash,kind,scope,project_id,status,version,source,created_at,updated_at) VALUES(?,?,'Fact','hash','fact','project',?,'active',1,'{}','2026-01-01','2026-01-01')").run(memory,'Keep',project);
  old.prepare("INSERT INTO memory_revisions VALUES(?,1,'{}')").run(memory);
  old.prepare("INSERT INTO chat_attachments VALUES(?,?,?,X'00',0)").run(randomUUID(),conversation,'{}');
  const tables=['projects','conversations','memories','memory_revisions','chat_attachments'];
  const before=Object.fromEntries(tables.map(t=>[t,JSON.stringify(old.prepare('SELECT * FROM '+t).all())]));old.close();
  const {chmod}=await import('node:fs/promises');await chmod(file,0o600);await migrateSqlite(file);
  const current=new DatabaseSync(file);try{
   for(const t of tables)assert.equal(JSON.stringify(current.prepare('SELECT * FROM '+t).all()),before[t]);
   assert.deepEqual(current.prepare('PRAGMA foreign_key_check').all(),[]);
   assert(!current.prepare('PRAGMA foreign_key_list(conversations)').all().some((r:any)=>r.table==='projects'));
   assert(!current.prepare('PRAGMA foreign_key_list(memories)').all().some((r:any)=>r.table==='projects'));
  }finally{current.close()}
 }finally{await rm(root,{recursive:true,force:true})}
});
