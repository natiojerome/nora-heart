import {SqliteTasks} from "./tasks.ts";
import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { closeSync, openSync, rmSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SqlStorageConnection } from "../../../contracts/sql-storage.ts";
import {
  connect,
  privateFile,
  one,
  all,
  run,
  transaction,
} from "./database.ts";
import {
  initializeControl,
  runtimeLease,
  sqliteMaintenance,
} from "./leases.ts";
import { sqliteSessions } from "./sessions.ts";
import * as repositories from "./repositories.ts";

const applicationId = 0x4841524e;
const migrationFiles = ["001_initial.sql","002_tasks.sql","003_remote_projects.sql"];
function compatible(db: DatabaseSync): void {
  const migrations = all(db, "SELECT version FROM migrations ORDER BY version");
  if (
    migrations.length !== migrationFiles.length ||
    migrations.some((row, index) => row.version !== index + 1) ||
    one(db, "PRAGMA application_id")?.application_id !== applicationId
  )
    throw new Error("Schéma SQLite incompatible : vérifier les migrations.");
}
export async function migrateSqlite(file: string): Promise<void> {
  const target = privateFile(file, true);
  initializeControl(target);
  const release = sqliteMaintenance(target);
  let db: DatabaseSync | undefined;
  try {
    db = connect(target);
    const tables = all(
      db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    if (
      tables.length &&
      (!tables.some((row) => row.name === "migrations") ||
        one(db, "PRAGMA application_id")?.application_id !== applicationId)
    )
      throw new Error(
        "Ce fichier SQLite contient une autre base. Migration refusée.",
      );
    const migrations = await Promise.all(
      migrationFiles.map(async (name, index) => {
        const sql = await readFile(
          new URL("./migrations/" + name, import.meta.url),
          "utf8",
        );
        return {
          version: index + 1,
          sql,
          checksum: createHash("sha256").update(sql).digest("hex"),
        };
      }),
    );
    // WAL is used only for the data file. Control/owner files keep rollback-mode OS locks.
    db.exec("PRAGMA journal_mode=WAL");
    // SQLite documented table-rebuild procedure, inside the existing maintenance lock.
    db.exec("PRAGMA foreign_keys=OFF");
    const connection = db;
    transaction(connection, () => {
      const db = connection;
      db.exec(
        "CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
      );
      const applied = all(
        db,
        "SELECT version,checksum FROM migrations ORDER BY version",
      );
      if (
        applied.some(
          (row, index) =>
            row.version !== index + 1 ||
            Number(row.version) > migrations.length,
        )
      )
        throw new Error(
          "Version de stockage inconnue : utiliser un runtime compatible.",
        );
      for (const migration of migrations) {
        const previous = applied.find(
          (row) => row.version === migration.version,
        );
        if (previous) {
          if (previous.checksum !== migration.checksum)
            throw new Error(
              "Migration appliquée modifiée : checksum incompatible.",
            );
          continue;
        }
        db.exec(migration.sql);
        if (migration.version === 1)
          run(
            db,
            "INSERT INTO instance(singleton,id) VALUES(1,?)",
            randomUUID(),
          );
        run(
          db,
          "INSERT INTO migrations(version,checksum) VALUES(?,?)",
          migration.version,
          migration.checksum,
        );
      }
      if (all(db,"PRAGMA foreign_key_check").length) throw new Error("Migration : références SQLite invalides.");
      db.exec("PRAGMA application_id=" + applicationId);
    });
  } finally {
    db?.close();
    release();
  }
}
export async function openSqliteStorage(
  file: string,
): Promise<SqlStorageConnection> {
  const target = privateFile(file),
    runtime = runtimeLease(target);
  let db: DatabaseSync | undefined;
  try {
    db = connect(target);
    compatible(db);
    const instanceId = String(
      one(db, "SELECT id FROM instance WHERE singleton=1")?.id ?? "",
    );
    if (!instanceId) throw new Error("Instance SQLite non initialisée.");
    const structured = repositories.structuredMemories(db);
    let closed = false;
    const assertOpen = () => {
      if (closed) throw new Error("Stockage SQLite fermé.");
    };
    return {
      instanceId,
      sessions: sqliteSessions(db, target, runtime.id, assertOpen),
      structuredMemories: structured,
      memories: repositories.memories(db, structured),
      conversations: repositories.conversations(db),
      tasks:new SqliteTasks(db,target),
      projects: repositories.projects(db),
      assistant: repositories.assistant(db),
      externalTools: repositories.externalTools(db),
      chatAssets: repositories.chatAssets(db),
      async close() {
        if (closed) return;
        closed = true;
        try {
          db!.close();
        } finally {
          runtime.close();
        }
      },
    };
  } catch (error) {
    db?.close();
    runtime.close();
    throw error;
  }
}

/** Database + recovery metadata snapshot. Refuses all live Heart runtimes. */
export async function backupSqliteStorage(
  file: string,
  destination: string,
): Promise<void> {
  const target = privateFile(file),
    output = path.resolve(destination);
  if (existsSync(output) || existsSync(output + ".runtime"))
    throw new Error("Destination de sauvegarde déjà présente.");
  const release = sqliteMaintenance(target);
  let source: DatabaseSync | undefined,
    created = false,
    runtimeCreated = false;
  try {
    source = new DatabaseSync(target, { readOnly: true });
    compatible(source);
    // Exclusive creation before SQLite's native backup API opens its destination.
    closeSync(openSync(output, "wx", 0o600));
    created = true;
    mkdirSync(output + ".runtime", { mode: 0o700 });
    runtimeCreated = true;
    await backup(source, output);
    initializeControl(output);
    for (const row of all(
      source,
      "SELECT DISTINCT runtime_owner FROM sessions WHERE active_run IS NOT NULL AND runtime_owner IS NOT NULL",
    )) {
      const owner = String(row.runtime_owner);
      if (!/^[0-9a-f-]{36}$/.test(owner))
        throw new Error("Propriété SQLite invalide.");
      const lease = new DatabaseSync(
        privateFile(path.join(output + ".runtime", owner + ".sqlite"), true),
      );
      try {
        lease.exec("CREATE TABLE anchor(id INTEGER PRIMARY KEY)");
      } finally {
        lease.close();
      }
    }
  } catch (error) {
    if (created) {
      rmSync(output, { force: true });
      if (runtimeCreated)
        rmSync(output + ".runtime", { recursive: true, force: true });
    }
    throw error;
  } finally {
    source?.close();
    release();
  }
}
export { sqliteMaintenance } from "./leases.ts";
