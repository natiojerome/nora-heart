import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assistantFixture } from "./assistant.fixture.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import type { ModelResponse } from "../src/contracts/models.ts";
import { instructionValue } from "../src/app/instruction-defaults.ts";

test("instruction edits merge independent blocks, reject same-block conflicts, preserve old clients and reset to shipped defaults", async () => {
  const a = assistantFixture();
  const defaults = await a.instructionCatalog();
  assert.equal(defaults.blocks.length, 15);
  const first = await a.saveInstruction({
    id: "web",
    value: "Cite les pages consultées.",
    version: 0,
    baseValue: null,
  });
  const second = await a.saveInstruction({
    id: "progress",
    value: "Sois bref.",
    version: 0,
    baseValue: null,
  });
  assert.equal(second.version, 2);
  assert.equal(
    second.blocks.find((b) => b.id === "web")!.value,
    "Cite les pages consultées.",
  );
  await assert.rejects(
    a.saveInstruction({
      id: "web",
      value: "Overwrite",
      version: 0,
      baseValue: null,
    }),
    /ailleurs/,
  );
  await a.patch({
    version: 2,
    base: { name: "Nora" },
    patch: { name: "Elios" },
  });
  assert.equal(
    (await a.instructionOverrides()).web,
    "Cite les pages consultées.",
  );
  const profile = await a.get();
  const { instructionOverrides, ...oldClient } = profile.settings;
  await a.save({ version: profile.version, settings: oldClient });
  assert.equal((await a.instructionOverrides()).progress, "Sois bref.");
  const reset = await a.saveInstruction({
    id: "web",
    value: null,
    version: first.version,
    baseValue: "Cite les pages consultées.",
  });
  assert.equal(reset.blocks.find((b) => b.id === "web")!.customized, false);
  assert.equal(
    reset.blocks.find((b) => b.id === "web")!.value,
    instructionValue({}, "web"),
  );
  assert.equal((await a.instructionOverrides()).progress, "Sois bref.");
  await a.saveInstruction({
    id: "progress",
    value: "",
    version: reset.version,
    baseValue: "Sois bref.",
  });
  assert.equal((await a.instructionOverrides()).progress, "");
  for (const bad of [
    { id: "unknown", value: "hi" },
    { id: "web", value: 34 },
    { id: "web", value: "bad\0" },
  ])
    await assert.rejects(
      a.saveInstruction({ ...bad, version: 99, baseValue: null }),
      /invalides/,
    );
});

test("actual composition persists overrides and supplies the same per-run snapshot to primary and review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-instructions-")),
    file = root + "/data.sqlite";
  const lab = new TestLab({
    directory: root + "/lab",
    authDirectory: root + "/auth",
  });
  await lab.prepare();
  await migrateSqlite(file);
  lab.models = async () => ({
    models: [{ id: "fake", name: "Fake", contextWindow: 32768 }],
  });
  let primary = 0,
    review = 0;
  lab.model = () => ({
    id: "fake",
    async generate(r): Promise<ModelResponse> {
      if (r.tools.some((t) => t.name === "memory.assess")) {
        review++;
        assert(
          r.instructions.includes(
            review === 1 ? "POLICY-CUSTOM" : "POLICY-NEXT",
          ),
        );
        assert(r.instructions.includes("REVIEW-CUSTOM"));
        return {
          content: "",
          toolCalls: [
            {
              id: "assess",
              name: "memory.assess",
              arguments: {
                decisions: [
                  { action: "none", evidence: "", note: "Simple salutation." },
                ],
              },
            },
          ],
        };
      }
      primary++;
      assert(
        r.instructions.includes(
          primary === 1 ? "POLICY-CUSTOM" : "POLICY-NEXT",
        ),
      );
      if (primary === 1) {
        const catalog = await app.assistant.instructionCatalog();
        await app.assistant.saveInstruction({
          id: "memoryPolicy",
          value: "POLICY-NEXT",
          version: catalog.version,
          baseValue: "POLICY-CUSTOM",
        });
      }
      assert(r.instructions.includes("DISPLAY-CUSTOM"));
      assert(!r.instructions.includes("READ-NETWORK-WRONG"));
      return { content: "Bonjour.", toolCalls: [] };
    },
  });
  let app = await openWebConversations(
    { driver: "sqlite", file },
    root + "/state",
    lab,
  );
  try {
    for (const [id, value] of [
      ["memoryPolicy", "POLICY-CUSTOM"],
      ["memoryReview", "REVIEW-CUSTOM"],
      ["display", "DISPLAY-CUSTOM"],
    ]) {
      const c = await app.assistant.instructionCatalog();
      await app.assistant.saveInstruction({
        id,
        value,
        version: c.version,
        baseValue: null,
      });
    }
    await app.close();
    app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/state",
      lab,
    );
    assert.equal(
      (await app.assistant.instructionOverrides()).memoryPolicy,
      "POLICY-CUSTOM",
    );
    const { conversation } = await app.conversations.create({
      title: "Configured instructions",
    });
    await app.conversations.fileAccess(conversation.id, { access: "none" });
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Bonjour",
    });
    assert.equal(primary, 1);
    assert.equal(review, 1);
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Bonjour encore",
    });
    assert.equal(primary, 2);
    assert.equal(review, 2);
  } finally {
    await app.close();
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("compression consumes its supplied instruction without changing checkpoint validation", async () => {
  const { BoundedContext } =
    await import("../src/modules/context/bounded/index.ts");
  const { openJsonStorage } =
    await import("../src/modules/storage/json/index.ts");
  const { randomUUID } = await import("node:crypto");
  const root = await mkdtemp(
      path.join(os.tmpdir(), "heart-configured-compression-"),
    ),
    storage = await openJsonStorage(root);
  try {
    const messages: import("../src/contracts/messages.ts").Message[] = [
      { role: "user", content: "objectif ".repeat(740) },
      { role: "assistant", content: "Réponse historique.", toolCalls: [] },
      { role: "user", content: "Continue" },
    ];
    for (const m of messages)
      await storage.sessions.append("one", {
        id: randomUUID(),
        runId: randomUUID(),
        at: new Date().toISOString(),
        type: "message",
        data: m as unknown as import("../src/contracts/json.ts").Json,
      });
    let summaries = 0;
    const result = await new BoundedContext(
      storage.sessions,
      undefined,
      "COMPRESSION-CUSTOM",
    ).prepare({
      sessionId: "one",
      runId: randomUUID(),
      contextWindow: 4096,
      reserveTokens: 1024,
      provider: {
        id: "fake",
        async generate(r) {
          summaries++;
          assert(r.instructions.startsWith("COMPRESSION-CUSTOM\n"));
          return { content: "Objectif préservé.", toolCalls: [] };
        },
      },
      request: {
        instructions: "Instructions principales.",
        messages,
        tools: [],
      },
    });
    assert.equal(summaries, 1);
    assert(result.instructions.includes("Objectif préservé."));
    assert(
      (await storage.sessions.read("one")).some(
        (e) => e.type === "context.checkpoint",
      ),
    );
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});
