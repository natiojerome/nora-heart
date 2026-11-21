import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { historyTools } from "../src/modules/tools/history/index.ts";
import { BoundedContext } from "../src/modules/context/bounded/index.ts";
import { Engine } from "../src/core/engine.ts";
import { resolvePolicies } from "../src/app/runtime-policies.ts";
import type { Json } from "../src/contracts/json.ts";
import type { Message } from "../src/contracts/messages.ts";

test("history reading pages original messages in its thread, with explicit historical receipts and no cross-thread cursors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-history-tool-")),
    storage = await openJsonStorage(root);
  const append = async (id: string, data: Json) => {
    const event = {
      id: randomUUID(),
      runId: randomUUID(),
      at: new Date().toISOString(),
      type: "message" as const,
      data,
    };
    await storage.sessions.append(id, event);
    return event;
  };
  try {
    const first = await append("one", {
      role: "user",
      content: "Code du dossier : ZEPHYR-41",
    });
    await append("one", {
      role: "tool",
      name: "files.read",
      callId: "old",
      content: "Ancienne sortie technique",
      error: false,
    });
    await append("one", {
      role: "assistant",
      content: "Message final",
      toolCalls: [],
    });
    const foreign = await append("two", {
      role: "user",
      content: "PRIVATE-OTHER-THREAD",
    });
    const tool = historyTools(storage.sessions, "one")[0];
    assert.equal(tool.transient, true);
    const recent = JSON.parse(
      await tool.execute({ limit: 1 }, { workspace: root }),
    );
    assert.equal(recent.hasMore, true);
    assert.equal(recent.messages[0].content, "Message final");
    const older = JSON.parse(
      await tool.execute(
        { before: recent.before, limit: 10, query: "ZEPHYR" },
        { workspace: root },
      ),
    );
    assert.equal(older.messages[0].id, first.id);
    assert.equal(older.historical, true);
    assert.equal(older.currentStateVerified, false);
    const activeRun=randomUUID();await storage.sessions.append('one',{id:randomUUID(),runId:activeRun,at:new Date().toISOString(),type:'message',data:{role:'user',content:'Code du dossier ?'}});
    const found=JSON.parse(await tool.execute({query:'code dossier',limit:1},{workspace:root,runId:activeRun}));assert.equal(found.messages[0].id,first.id);
    const detailed = JSON.parse(
      await tool.execute(
        { limit: 10, includeTools: true },
        { workspace: root },
      ),
    );
    assert(detailed.messages.some((m: any) => m.message.role === "tool"));
    assert(!JSON.stringify(detailed).includes("PRIVATE-OTHER-THREAD"));
    await assert.rejects(
      tool.execute({ before: foreign.id }, { workspace: root }),
      /fil/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      tool.execute({}, { workspace: root, signal: controller.signal }),
    );
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("after an incomplete summary the model can recover an exact old fact without changing or replaying the history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-history-recall-")),
    storage = await openJsonStorage(root),
    id = "recover";
  const messages: Message[] = [
    {
      role: "user",
      content: "Le code convenu est ZEPHYR-41. " + "archive ".repeat(650),
    },
    { role: "assistant", content: "Compris.", toolCalls: [] },
    { role: "user", content: "Autre sujet " + "suite ".repeat(600) },
    { role: "assistant", content: "Bien.", toolCalls: [] },
  ];
  try {
    for (const data of messages)
      await storage.sessions.append(id, {
        id: randomUUID(),
        runId: randomUUID(),
        at: new Date().toISOString(),
        type: "message",
        data: data as unknown as Json,
      });
    const before = await storage.sessions.read(id);
    let summarized = 0;
    const engine = new Engine(
      storage.sessions,
      historyTools(storage.sessions, id),
      new BoundedContext(
        storage.sessions,
        undefined,
        undefined,
        resolvePolicies({ context: { recentTurns: 1 } }),
      ),
    );
    await engine.run({
      sessionId: id,
      provider: {
        id: "qa",
        async generate(request) {
          if (!request.tools.length) {
            summarized++;
            return {
              content:
                "Objectif : poursuivre ; le code exact manque dans ce résumé.",
              toolCalls: [],
            };
          }
          if (request.messages.at(-1)?.role !== "tool") {
            assert(!JSON.stringify(request.messages).includes("ZEPHYR-41"));
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "history.read",
                  arguments: { query: "code", limit: 100 },
                },
              ],
            };
          }
          assert(request.messages.at(-1)!.content.includes("ZEPHYR-41"));
          return { content: "Code retrouvé : ZEPHYR-41", toolCalls: [] };
        },
      },
      displayName: "Nora",
      workspace: root,
      prompt: "Quel était le code convenu ?",
      contextWindow: 4096,
      reserveTokens: 1024,
      permissions: new Set(["history.read"]),
    });
    assert(summarized > 0);
    const after = await storage.sessions.read(id);
    assert.deepEqual(after.slice(0, before.length), before);
    assert(
      after.some(
        (e) =>
          e.type === "message" &&
          JSON.stringify(e.data).includes("Code retrouvé"),
      ),
    );
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
