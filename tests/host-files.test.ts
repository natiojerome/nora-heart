import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { openHostTerminal } from "../src/app/host-terminal.ts";
import { HostFiles } from "../src/modules/tools/host-files/index.ts";

test("host file transport streams binary data, rejects invalid scopes and aborts uploads atomically", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-file-transport-")),
    threads = path.join(root, "threads"),
    workspace = path.join(threads, randomUUID()),
    socket = path.join(root, "host.sock");
  await mkdir(workspace, { recursive: true });
  const worker = await openHostTerminal({
    socket,
    directory: path.join(root, "commands"),
    workspaceDirectory: threads,
    home: path.join(root, "home"),
  });
  try {
    const files = new HostFiles(socket, workspace),
      target = path.join(root, "binary.dat"),
      bytes = Buffer.alloc(256 * 1024, 0xab);
    await files.import(
      target,
      (async function* () {
        for (let i = 0; i < bytes.length; i += 4096)
          yield bytes.subarray(i, i + 4096);
      })(),
    );
    const result = await files.download(target),
      chunks: Uint8Array[] = [];
    for await (const chunk of result.body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    const revision = (await files.info(target)).revision;
    const controller = new AbortController();
    await assert.rejects(
      new HostFiles(socket, workspace, controller.signal).import(
        target,
        (async function* () {
          yield Buffer.from("partial");
          await delay(20);
          controller.abort();
          yield Buffer.from("never-published");
        })(),
        revision,
      ),
    );
    for (
      let i = 0;
      i < 100 && (await readdir(root)).some((n) => n.startsWith(".heart-"));
      i++
    )
      await delay(10);
    assert.deepEqual(await readFile(target), bytes);
    assert(!(await readdir(root)).some((n) => n.startsWith(".heart-")));
    await assert.rejects(new HostFiles(socket, root).read(target), /refusée/);
    await assert.rejects(
      new HostFiles(path.join(root, "absent.sock"), workspace).read(target),
      /Aucun repli/,
    );
    await writeFile(target, "changed");
    await assert.rejects(files.update(target, "stale", revision), /changé/);
    assert.equal(await readFile(target, "utf8"), "changed");
  } finally {
    await worker.close();
    await rm(root, { recursive: true, force: true });
  }
});
