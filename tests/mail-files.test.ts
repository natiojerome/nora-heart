import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { HttpMailFiles } from "../src/modules/mail/http/index.ts";
import { mailFileTools } from "../src/modules/tools/mail-files/index.ts";
import { LocalFiles } from "../src/modules/tools/files/index.ts";
test("Mail attachment bridge streams workspace bytes in both directions without returning contents or credentials to the model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "heart-mail-files-")),
    data = Buffer.from([0, 255, 8, 1]),
    id = "11111111-1111-4111-8111-111111111111";
  let received = Buffer.alloc(0),
    writes = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-secret");
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      received = Buffer.concat(chunks);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id,
          name: "source.bin",
          type: "application/octet-stream",
          size: received.length,
          sha256: "test",
        }),
      );
    } else res.end(data);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + (server.address() as any).port,
    transfer = new HttpMailFiles(async (write) => {
      if (write) writes++;
      return { url: origin + "/mail", token: "synthetic-secret" };
    }),
    tools = mailFileTools(transfer, (w) => new LocalFiles(w), true);
  try {
    await writeFile(path.join(root, "source.bin"), data);
    const result = await tools[0]!.execute(
      { path: "source.bin" },
      { workspace: root },
    );
    assert.deepEqual(received, data);
    assert(!result.includes("synthetic-secret"));
    assert(!result.includes(data.toString("base64")));
    assert.equal(JSON.parse(result).id, id);
    await tools[1]!.execute(
      { id, destination: "saved.bin" },
      { workspace: root },
    );
    assert.deepEqual(await readFile(path.join(root, "saved.bin")), data);
    await assert.rejects(
      tools[1]!.execute({ id, destination: "saved.bin" }, { workspace: root }),
    );
    assert.equal(writes, 1);
    assert.deepEqual(
      mailFileTools(transfer, (w) => new LocalFiles(w), true, false).map(
        (t) => t.name,
      ),
      ["mail.save_attachment"],
    );
    assert.equal(
      mailFileTools(transfer, (w) => new LocalFiles(w), false, false).length,
      0,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
