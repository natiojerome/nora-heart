import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import {
  BoundedContext,
  estimateTokens,
} from "../src/modules/context/bounded/index.ts";
import { resolvePolicies } from "../src/app/runtime-policies.ts";
import type { Message } from "../src/contracts/messages.ts";
import type { Json } from "../src/contracts/json.ts";
import type { ModelRequest, ModelResponse } from "../src/contracts/models.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { defaultAssistant } from "../src/app/assistant.ts";

async function fixture() {
  const root = await mkdtemp("/tmp/heart-runtime-review-"),
    storage = await openJsonStorage(root);
  return {
    root,
    storage,
    async close() {
      await storage.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("compression percentage triggers work but never rejects a fitting indivisible turn", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const provider = {
        id: "fake",
        async generate() {
          calls++;
          throw Error("not needed");
        },
      },
      request: ModelRequest = {
        instructions: "Nora",
        tools: [],
        messages: [{ role: "user", content: "x".repeat(3000) }],
      },
      options = {
        sessionId: "one",
        runId: randomUUID(),
        request,
        provider,
        contextWindow: 4096,
        reserveTokens: 1024,
      },
      context = new BoundedContext(
        f.storage.sessions,
        undefined,
        undefined,
        resolvePolicies({ context: { compressionPercent: 1 } }),
      );
    const output = await context.prepare(options);
    assert.deepEqual(output, request);
    assert.equal(calls, 0);
    assert(estimateTokens(output) < 3072);
    await assert.rejects(
      context.prepare({
        ...options,
        request: {
          ...request,
          messages: [{ role: "user", content: "x".repeat(15000) }],
        },
      }),
      /Échange trop volumineux/,
    );
    assert.equal(calls, 0);
  } finally {
    await f.close();
  }
});

test("summary may stay above the trigger if it fits; oversized current turn fails before paying for a summary", async () => {
  const f = await fixture();
  try {
    const messages: Message[] = [
      { role: "user", content: "archive ".repeat(620) },
      { role: "assistant", content: "Décision", toolCalls: [] },
      { role: "user", content: "suite ".repeat(90) },
    ];
    for (const message of messages)
      await f.storage.sessions.append("history", {
        id: randomUUID(),
        runId: randomUUID(),
        at: new Date().toISOString(),
        type: "message",
        data: message as unknown as Json,
      });
    let calls = 0;
    const provider = {
        id: "fake",
        async generate() {
          calls++;
          return { content: "Résumé " + "x".repeat(2000), toolCalls: [] };
        },
      },
      request: ModelRequest = { instructions: "Nora", tools: [], messages },
      context = new BoundedContext(
        f.storage.sessions,
        undefined,
        undefined,
        resolvePolicies({ context: { compressionPercent: 30 } }),
      ),
      options = {
        sessionId: "history",
        runId: randomUUID(),
        provider,
        request,
        contextWindow: 4096,
        reserveTokens: 1024,
      };
    const output = await context.prepare(options);
    assert(estimateTokens(output) > 3072 * 0.3);
    assert(estimateTokens(output) < 3072);
    assert.equal(calls, 1);
    assert.deepEqual(output.messages, [messages.at(-1)]);
    // A later, oversized turn must not summarize the previous one pointlessly.
    await assert.rejects(
      context.prepare({
        ...options,
        request: {
          ...request,
          messages: [
            ...messages,
            { role: "assistant", content: "ok", toolCalls: [] },
            { role: "user", content: "x".repeat(15000) },
          ],
        },
      }),
      /Échange trop volumineux/,
    );
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test("memory injection counts accepted facts, skipping duplicates and facts that do not fit", async () => {
  const f = await fixture();
  try {
    const memory = {
        async remember() {
          throw Error("unused");
        },
        async search() {
          return [
            { id: "a", content: "Already present" },
            { id: "b", content: "x".repeat(300) },
            { id: "c", content: "Quartz useful fact" },
            { id: "d", content: "Other useful fact" },
          ];
        },
      },
      context = new BoundedContext(
        f.storage.sessions,
        memory,
        undefined,
        resolvePolicies({
          memory: { injectedItems: 2, injectedCharacters: 100 },
        }),
      ),
      request: ModelRequest = {
        instructions: "Nora",
        tools: [],
        messages: [
          {
            role: "user",
            content: "Already present, search for Quartz useful information",
          },
        ],
      },
      output = await context.prepare({
        sessionId: "memory",
        runId: randomUUID(),
        request,
        contextWindow: 8192,
        reserveTokens: 1024,
        provider: {
          id: "never",
          async generate() {
            throw Error("unused");
          },
        },
      });
    assert.match(output.instructions, /Quartz useful fact/);
    assert.match(output.instructions, /Other useful fact/);
    assert(!output.instructions.includes("Already present"));
    assert(!output.instructions.includes("x".repeat(300)));
  } finally {
    await f.close();
  }
});

test("one profile read per web turn atomically snapshots identity, instructions, review and limits", async () => {
  const root = await mkdtemp("/tmp/heart-profile-snapshot-"),
    file = root + "/state.sqlite",
    lab = new TestLab({
      directory: root + "/lab",
      authDirectory: root + "/auth",
    });
  await lab.prepare();
  await migrateSqlite(file);
  const app = await openWebConversations(
    { driver: "sqlite", file },
    root + "/state",
    lab,
  );
  try {
    const initial = await app.assistant.save({
      version: 0,
      settings: {
        ...defaultAssistant,
        name: "Before",
        instructionOverrides: {
          display: "DISPLAY-BEFORE",
          memoryPolicy: "MEMORY-BEFORE",
        },
      },
    });
    let reads = 0,
      changing = false,
      changed = false,
      turn = 1,
      step = 0,
      review = 0;
    const get = app.assistant.get.bind(app.assistant);
    app.assistant.get = async () => {
      if (!changing) reads++;
      return get();
    };
    lab.models = async () => {
      if (!changed) {
        changed = true;
        changing = true;
        try {
          await app.assistant.save({
            version: initial.version,
            settings: {
              ...initial.settings,
              name: "After",
              instructionOverrides: {
                display: "DISPLAY-AFTER",
                memoryPolicy: "MEMORY-AFTER",
              },
              runtimePolicies: { tools: { maxCallsPerBatch: 1 } },
            },
          });
        } finally {
          changing = false;
        }
      }
      return { models: [{ id: "fake", name: "Fake", contextWindow: 32768 }] };
    };
    lab.model = () => ({
      id: "fake",
      async generate(r): Promise<ModelResponse> {
        const before = turn === 1;
        assert(
          r.instructions.includes(before ? "MEMORY-BEFORE" : "MEMORY-AFTER"),
        );
        if (r.tools.some((t) => t.name === "memory.assess")) {
          review++;
          return {
            content: "",
            toolCalls: [
              {
                id: "assess",
                name: "memory.assess",
                arguments: {
                  decisions: [{ action: "none", evidence: "", note: "Test" }],
                },
              },
            ],
          };
        }
        assert(r.instructions.includes(before ? "Before" : "After"));
        assert(
          r.instructions.includes(before ? "DISPLAY-BEFORE" : "DISPLAY-AFTER"),
        );
        assert(r.instructions.includes(before ? "16 appels" : "1 appels"));
        if (step++ === 0)
          return {
            content: "",
            toolCalls: [
              { id: "one", name: "missing", arguments: {} },
              { id: "two", name: "missing", arguments: {} },
            ],
          };
        return { content: "Done", toolCalls: [] };
      },
    });
    const { conversation } = await app.conversations.create({
      title: "Snapshot",
    });
    reads = 0;
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Bonjour",
    });
    assert.equal(reads, 1);
    assert.equal(review, 1);
    reads = 0;
    turn = 2;
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Continue",
    });
    assert.equal(reads, 1);
    assert.equal(review, 2);
  } finally {
    await app.close();
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});
