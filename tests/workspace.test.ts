import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
  link,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { LocalFiles } from "../src/modules/tools/files/index.ts";
import { conversationFixture } from "./conversation-fixture.ts";

test("workspace CRUD checks revisions, nested paths, exclusive destinations and empty directories", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heart-files-")),
    files = new LocalFiles(directory);
  try {
    await files.mkdir("notes");
    await files.create("notes/one.md", "Bonjour");
    const first = await files.read("notes/one.md");
    await files.update(first.path, "Modifié", first.revision);
    await assert.rejects(
      files.update(first.path, "Périmé", first.revision),
      /changé/,
    );
    await assert.rejects(files.remove(first.path, first.revision), /changé/);
    const updated = await files.read(first.path);
    await files.create("other.md", "Préserver");
    await assert.rejects(
      files.move(updated.path, "other.md", updated.revision),
      /existe/,
    );
    await files.move(updated.path, "notes/two.md", updated.revision);
    assert.equal((await files.read("notes/two.md")).content, "Modifié");
    const folder = (await files.list()).entries.find(
      (item) => item.name === "notes",
    )!;
    await assert.rejects(
      files.remove(folder.path, folder.revision),
      /contient/,
    );
    await files.remove("notes/two.md", updated.revision);
    const empty = (await files.list()).entries.find(
      (item) => item.name === "notes",
    )!;
    await files.remove("notes", empty.revision);
    assert.deepEqual(
      (await files.list()).entries.map((item) => item.name),
      ["other.md"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workspace refuses traversal, symlinked ancestors, hardlinks; large and binary files retain their bytes", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "heart-file-security-"),
  );
  const workspace = path.join(directory, "workspace");
  const files = new LocalFiles(workspace);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(workspace);
  try {
    await writeFile(path.join(directory, "private"), "private");
    await symlink(directory, path.join(workspace, "escape"));
    await link(path.join(directory, "private"), path.join(workspace, "hard"));
    for (const input of [
      "../private",
      "/etc/passwd",
      "escape/private",
      "a/../../private",
      "hard",
    ]) {
      await assert.rejects(files.read(input));
      await assert.rejects(files.update(input, "wrong", "x"));
      await assert.rejects(files.remove(input, "x"));
    }
    await assert.rejects(files.create("escape/new", "x"));
    await assert.rejects(files.mkdir("escape/new"));
    await assert.rejects(files.mkdir(""));
    await files.create("big", "x".repeat(1024 * 1024 + 1));
    const page = await files.read("big");
    assert.equal(page.truncated, true);
    assert.equal((await files.read("big", 1024 * 1024, 10)).content, "x");
    await writeFile(path.join(workspace, "binary"), Buffer.from([0xff, 0]));
    await assert.rejects(files.read("binary"));
    const binary = await files.info("binary");
    assert.equal(binary.text, false);
    await files.move("binary", "moved.bin", binary.revision);
    const downloaded = await files.download("moved.bin");
    const chunks = [];
    for await (const chunk of downloaded.body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from([0xff, 0]));
    await files.remove("moved.bin", binary.revision);
    const payload = Buffer.alloc(2 * 1024 * 1024 + 5, 0xaa);
    await files.import(
      "archive.zip",
      (async function* () {
        yield payload.subarray(0, 1000);
        yield payload.subarray(1000);
      })(),
    );
    assert.deepEqual(
      await readFile(path.join(workspace, "archive.zip")),
      payload,
    );
    await assert.rejects(
      files.import(
        "archive.zip",
        (async function* () {
          yield Buffer.from("replace");
        })(),
      ),
      /existe/,
    );
    await files.create("unicode.txt", "é😀".repeat(100));
    let offset = 0,
      result = "";
    do {
      const part = await files.read("unicode.txt", offset, 7);
      result += part.content;
      offset = part.nextOffset!;
    } while (offset < 600);
    assert.equal(result, "é😀".repeat(100));

    assert.equal(
      await readFile(path.join(directory, "private"), "utf8"),
      "private",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("conversation file access survives restart, filters model tools and journals owner edits without inference", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "heart-workspace-app-"),
  );
  let offered: string[] = [],
    calls = 0,
    seen = "";
  const fixture = await conversationFixture(directory, () => ({
    id: "permissions",
    async generate(request) {
      calls++;
      seen = JSON.stringify(request);
      offered = request.tools.map((tool) => tool.name);
      return { content: "OK", toolCalls: [] };
    },
  }));
  try {
    const { conversation } = await fixture.service.create({
      title: "Fichiers",
    });
    const id = conversation.id;
    await fixture.service.send(id, {
      prompt: "Bonjour",
      provider: "demo",
      contextWindow: 32768,
    });
    assert(offered.includes("files.read"));
    assert(!offered.includes("files.create"));
    await fixture.service.fileAccess(id, { access: "write" });
    await fixture.service.send(id, {
      prompt: "Bonjour",
      provider: "demo",
      contextWindow: 32768,
    });
    assert(offered.includes("files.create"));
    assert(offered.includes("files.delete"));
    await fixture.service.fileAccess(id, { access: "none" });
    assert.equal(
      (await fixture.restart().get(id)).conversation.fileAccess,
      "none",
    );
    await fixture.service.send(id, {
      prompt: "Bonjour",
      provider: "demo",
      contextWindow: 32768,
    });
    assert(!offered.some((name) => name.startsWith("files.")));
    const before = calls;
    await fixture.service.mutateWorkspace(id, {
      action: "create",
      path: "owner.txt",
      content: "Texte privé de l’explorateur",
    });
    assert.equal(calls, before);
    const response = await fixture.service.inspectWorkspace(
      id,
      "owner.txt",
      true,
    );
    assert("document" in response);
    assert.equal(response.document.content, "Texte privé de l’explorateur");
    const events = await fixture.storage.sessions.read(`workspace-${id}`);
    assert(!JSON.stringify(events).includes("Texte privé de l’explorateur"));
    assert(
      events.some(
        (event) =>
          event.type === "tool.finished" &&
          (event.data as { name: string }).name === "files.create",
      ),
    );
    await fixture.service.send(id, {
      prompt: "Bonjour",
      provider: "demo",
      contextWindow: 32768,
    });
    assert(!seen.includes("Texte privé de l’explorateur"));
    await assert.rejects(
      fixture.service.mutateWorkspace(id, {
        action: "create",
        path: "owner.txt",
        content: "Écraser",
      }),
      /existe/,
    );
    const other = (await fixture.service.create({ title: "Autre" }))
      .conversation.id;
    await assert.rejects(
      fixture.service.inspectWorkspace(other, "owner.txt", true),
      /introuvable/,
    );
  } finally {
    await fixture.storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("stream imports are atomic, preserve private bytes and listings can continue past a page", async () => {
  const directory = await mkdtemp(
      path.join(os.tmpdir(), "heart-stream-files-"),
    ),
    files = new LocalFiles(directory);
  try {
    await assert.rejects(
      files.import(
        "partial.bin",
        (async function* () {
          yield Buffer.from([1, 2]);
          throw new Error("source interrupted");
        })(),
      ),
    );
    await assert.rejects(files.info("partial.bin"));
    assert.deepEqual((await files.list()).entries, []);
    for (const name of ["a", "b", "c"]) await files.create(name, name);
    const first = await files.list("", 0, 2);
    assert.equal(first.truncated, true);
    const last = await files.list("", first.nextOffset!, 2);
    assert.equal(last.truncated, false);
    assert.equal(last.entries[0].name, "c");
    assert.equal((await files.list("", 0, 1000)).entries.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
