import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  closeSync,
  openSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

export type Row = Record<string, unknown>;
export function privateFile(file: string, create = false): string {
  if (!path.isAbsolute(file) || file.includes("\0"))
    throw new Error("Chemin SQLite absolu requis.");
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (create) {
    try {
      closeSync(openSync(file, "wx", 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error(
      "Le fichier SQLite doit être privé, régulier et sans lien symbolique.",
    );
  return realpathSync(file);
}
export function connect(file: string, timeout = 5000): DatabaseSync {
  const db = new DatabaseSync(file, {
    timeout,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
  });
  try {
    db.exec("PRAGMA synchronous=FULL");
    // Unicode case folding is explicit; SQLite lower() is ASCII-only by default.
    db.function("heart_lower", { deterministic: true }, (value) =>
      String(value ?? "").toLowerCase(),
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function one(
  db: DatabaseSync,
  sql: string,
  ...args: SQLInputValue[]
): Row | undefined {
  return db.prepare(sql).get(...args);
}
export function all(
  db: DatabaseSync,
  sql: string,
  ...args: SQLInputValue[]
): Row[] {
  return db.prepare(sql).all(...args);
}
export function run(
  db: DatabaseSync,
  sql: string,
  ...args: SQLInputValue[]
): number {
  return Number(db.prepare(sql).run(...args).changes);
}
export function json<T>(value: unknown): T {
  return JSON.parse(String(value)) as T;
}
