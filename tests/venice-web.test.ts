import assert from "node:assert/strict";
import { test } from "node:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAiSdkProvider, veniceWebConnected, veniceWebModels } from "../src/modules/models/ai-sdk/index.ts";
import { ModelToolCallError } from "../src/contracts/models.ts";
import { Engine } from "../src/core/engine.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";

const completion = (message: any) => Response.json({ id: "fixture", object: "chat.completion", created: 1,
  model: "web-fixture", choices: [{ index: 0, message, finish_reason: message.tool_calls?.length ? "tool_calls" : "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });

test("Venice web reads only the loopback bridge and rejects paid catalogue entries", async () => {
  const models = await veniceWebModels(async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:3456/v1/models");
    assert.equal(init?.redirect, "error");
    assert(!new Headers(init?.headers).has("authorization"));
    return Response.json({ data: [
      { id: "web", name: "Web", contextWindow: 524288, usesCredits: false },
      { id: "paid", contextWindow: 524288, usesCredits: true },
      { id: "unknown-price", contextWindow: 524288 },
    ] });
  });
  assert.deepEqual(models.map(m => m.id), ["web"]);
  assert.equal(models[0].toolCalling, "emulated");
  assert.equal(await veniceWebConnected(async () => Response.json({ ok: false })), false);
  assert.equal(await veniceWebConnected(async () => { throw new Error("private"); }), false);
});

test("Venice web preserves argument validation and never falls back after a refusal", async () => {
  let calls = 0;
  const provider = (fetch: typeof globalThis.fetch) => createAiSdkProvider({ provider: "venice-web",
    modelId: "web-fixture", apiKey: "unused", fetch });
  const request = { instructions: "test", messages: [{ role: "user" as const, content: "read" }], tools: [
    { name: "files.read", description: "Read", parameters: { type: "object", properties: { file: { type: "string" } },
      required: ["file"], additionalProperties: false } },
  ] };
  await assert.rejects(provider(async (url, init) => {
    calls++; assert.equal(String(url), "http://127.0.0.1:3456/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "web-fixture");
    return completion({ role: "assistant", content: null, tool_calls: [{ id: "1", type: "function",
      function: { name: body.tools[0].function.name, arguments: JSON.stringify({ file: 42 }) } }] });
  }).generate(request), ModelToolCallError);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(provider(async () => { calls++; return Response.json({ error: { message: "private refusal" } }, { status: 403 }); })
    .generate(request), (error: any) => error.code === "authentication" && !error.message.includes("private"));
  assert.equal(calls, 1);
});

const emulator = pathToFileURL(path.resolve(".tools/venice-web/upstream/src/lib/emulate.mjs")).href;
const installed = await access(new URL(emulator)).then(() => true, () => false);
test("installed Venice emulator round-trips JSON tool calls through Heart; only the engine executes", { skip: !installed }, async () => {
  const { parseToolReply, toVeniceRequest } = await import(emulator);
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-web-emulated-"));
  const storage = await openJsonStorage(root);
  let calls = 0, executed = 0;
  const provider = createAiSdkProvider({ provider: "venice-web", modelId: "deepseek-v4-1-flash-free", apiKey: "unused",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)); calls++;
      const mapping = toVeniceRequest(body);
      assert(mapping.emulatedTools);
      assert.deepEqual(mapping.request.clientTools, []);
      let raw;
      if (calls === 1) {
        assert.equal(executed, 0);
        raw = JSON.stringify({ content: "", status: "continue", tool_calls: [
          { name: body.tools[0].function.name, arguments: { query: "code" } },
        ] });
      } else {
        assert.equal(executed, 1);
        assert.equal(body.messages.at(-1).role, "tool");
        assert.equal(body.messages.at(-1).content, "CODE-123");
        raw = JSON.stringify({ content: "CODE-123", status: "done", tool_calls: [] });
      }
      const parsed = parseToolReply(raw);
      return completion({ role: "assistant", content: parsed.content || null, tool_calls: parsed.tool_calls });
    } });
  try {
    const engine = new Engine(storage.sessions, [{ name: "history.read", description: "Read code", permission: "history.read",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      async execute(input) { assert.deepEqual(input, { query: "code" }); executed++; return "CODE-123"; } }]);
    const result = await engine.run({ provider, sessionId: "fixture", prompt: "Read the code", displayName: "Nora",
      workspace: root, permissions: new Set(["history.read"]) });
    assert.equal(result.text, "CODE-123"); assert.equal(calls, 2); assert.equal(executed, 1);
  } finally { await storage.close(); await rm(root, { recursive: true, force: true }); }
});
