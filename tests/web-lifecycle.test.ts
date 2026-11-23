import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { TestLab } from "../src/app/test-lab.ts";
import type { SqlStorageConnection } from "../src/contracts/sql-storage.ts";
async function fixture(
  action: (f: {
    root: string;
    lab: TestLab;
    file: string;
    open: () => Promise<SqlStorageConnection>;
    closed: () => number;
    storage: () => SqlStorageConnection;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-web-lifecycle-")),
    file = path.join(root, "store.sqlite");
  const lab = new TestLab({
    directory: path.join(root, "lab"),
    authDirectory: path.join(root, "auth"),
  });
  let storage!: SqlStorageConnection,
    closed = 0;
  try {
    await migrateSqlite(file);
    await lab.prepare();
    await action({
      root,
      lab,
      file,
      closed: () => closed,
      storage: () => storage,
      open: async () => {
        storage = await openSqliteStorage(file);
        const close = storage.close.bind(storage);
        storage.close = async () => {
          closed++;
          await close();
        };
        return storage;
      },
    });
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
}
test("failed web composition releases its injected storage without replacing the initialization error", async () =>
  fixture(async (f) => {
    const blocked = path.join(f.root, "blocked");
    await writeFile(blocked, "not a directory");
    await assert.rejects(
      openWebConversations(
        { driver: "sqlite", file: f.file },
        f.root,
        f.lab,
        undefined,
        path.join(blocked, "projects"),
        undefined,
        f.open,
      ),
      { code: "ENOTDIR" },
    );
    assert.equal(f.closed(), 1);
    await assert.rejects(f.storage().sessions.read("after-close"));
  }));
test("web shutdown releases SQL even if workspace cleanup fails and concurrent closes share one outcome", async () =>
  fixture(async (f) => {
    const app = await openWebConversations(
      { driver: "sqlite", file: f.file },
      f.root,
      f.lab,
      undefined,
      path.join(f.root, "projects"),
      undefined,
      f.open,
    );
    app.projectsWorkspace.close = async () => {
      throw Error("synthetic workspace cleanup failure");
    };
    const first = app.close(),
      second = app.close();
    assert.equal(first, second);
    await assert.rejects(
      first,
      (error) =>
        error instanceof AggregateError &&
        error.errors.some(
          (e) => e.message === "synthetic workspace cleanup failure",
        ),
    );
    assert.equal(f.closed(), 1);
    await assert.rejects(f.storage().sessions.read("after-close"));
    await assert.rejects(app.close(), { name: "AggregateError" });
    assert.equal(f.closed(), 1);
  }));
