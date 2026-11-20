import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { privateFile } from "./database.ts";
import { RecoveryError } from "../../../contracts/recovery.ts";

function controlPath(file: string): string {
  const directory = file + ".runtime";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error("Dossier de propriété SQLite non privé.");
  return path.join(directory, "maintenance.sqlite");
}
export function initializeControl(file: string): void {
  const location = controlPath(file);
  if (existsSync(location)) return;
  const control = new DatabaseSync(privateFile(location, true));
  try {
    if (control.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete")
      throw new Error("Invalid control journal mode");
    control.exec(
      "CREATE TABLE IF NOT EXISTS anchor(id INTEGER PRIMARY KEY); INSERT OR IGNORE INTO anchor VALUES(1)",
    );
  } finally {
    control.close();
  }
}
/** A real SQLite shared/exclusive OS lock, automatically released on process death. */
export function sqliteMaintenance(file: string, exclusive = true): () => void {
  const control = new DatabaseSync(privateFile(controlPath(file)), {
    timeout: 0,
  });
  try {
    control.exec(exclusive ? "BEGIN EXCLUSIVE" : "BEGIN");
    control.prepare("SELECT id FROM anchor").get();
  } catch {
    control.close();
    throw new RecoveryError(
      "Stockage SQLite occupé ou en maintenance. Réessaie après sa fermeture.",
    );
  }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    control.close();
  };
}
export function runtimeLease(file: string): { id: string; close: () => void } {
  const release = sqliteMaintenance(file, false),
    id = randomUUID();
  let lease: DatabaseSync | undefined;
  try {
    lease = new DatabaseSync(
      privateFile(path.join(file + ".runtime", id + ".sqlite"), true),
      { timeout: 0 },
    );
    lease.exec("CREATE TABLE anchor(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE");
  } catch (error) {
    lease?.close();
    release();
    throw error;
  }
  let closed = false;
  return {
    id,
    close: () => {
      if (closed) return;
      closed = true;
      lease!.close();
      release();
    },
  };
}
export function holdDeadOwner(file: string, owner: string | null): () => void {
  if (!owner || !/^[0-9a-f-]{36}$/.test(owner))
    throw new RecoveryError(
      "Ancien verrou sans propriétaire vérifiable. Intervention opérateur nécessaire.",
    );
  let lease: DatabaseSync | undefined;
  try {
    lease = new DatabaseSync(
      privateFile(path.join(file + ".runtime", owner + ".sqlite")),
      { timeout: 0 },
    );
    lease.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    lease?.close();
    throw new RecoveryError(
      "Propriétaire SQLite actif ou invérifiable. Aucun déverrouillage effectué.",
    );
  }
  return () => lease!.close();
}
