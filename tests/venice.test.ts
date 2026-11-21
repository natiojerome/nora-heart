import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAiSdkProvider,
  veniceModels,
} from "../src/modules/models/ai-sdk/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { Engine } from "../src/core/engine.ts";
import type { ModelRequest } from "../src/contracts/models.ts";
import { TestLab } from "../src/app/test-lab.ts";

const request: ModelRequest = {
  instructions: "Heart instructions",
  messages: [{ role: "user", content: "Bonjour" }],
  tools: [],
};
const completion = (message: unknown, finish = "stop") =>
  Response.json({
    id: "qa",
    object: "chat.completion",
    created: 1,
    model: "venice-qa",
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

test("Venice public catalogue maps actual capabilities, context and per-million prices without guessing effort", async () => {
  const item = {
    type: "text",
    id: "model-a",
    context_length: 100000,
    model_spec: {
      name: "Model A",
      availableContextTokens: 65536,
      capabilities: {
        supportsFunctionCalling: true,
        supportsVision: true,
        supportsReasoningEffort: true,
        reasoningEffortOptions: ["none", "high", "max", "high"],
        defaultReasoningEffort: "high",
      },
      pricing: { input: { usd: 1.4 }, output: { usd: 4.4 } },
    },
  };
  const result = await veniceModels(async (url, init) => {
    assert.equal(String(url), "https://api.venice.ai/api/v1/models?type=text");
    assert.equal(init?.redirect, "error");
    assert(!new Headers(init?.headers).has("authorization"));
    return Response.json({
      data: [
        item,
        item,
        {
          ...item,
          id: "no-tools",
          model_spec: {
            ...item.model_spec,
            capabilities: { supportsReasoning: true },
            pricing: { input: { usd: -1 }, output: { usd: "4" } },
          },
        },
        {
          ...item,
          id: "offline",
          model_spec: { ...item.model_spec, offline: true },
        },
        { ...item, id: "image", type: "image" },
        {
          ...item,
          id: "invalid",
          context_length: null,
          model_spec: { ...item.model_spec, availableContextTokens: null },
        },
      ],
    });
  });
  assert.equal(result.length, 2);
  const model = result.find((m) => m.id === "model-a")!;
  assert.equal(model.contextWindow, 65536);
  assert.equal(model.supportsTools, true);
  assert.equal(model.vision, true);
  assert.deepEqual(model.pricing, { input: 1.4, output: 4.4, request: null });
  assert.deepEqual(model.reasoningEfforts, ["none", "high", "max"]);
  assert.equal(model.defaultReasoningEffort, "high");
  const unsupported = result.find((m) => m.id === "no-tools")!;
  assert.equal(unsupported.supportsTools, false);
  assert.deepEqual(unsupported.reasoningEfforts, []);
  assert.deepEqual(unsupported.pricing, {
    input: null,
    output: null,
    request: null,
  });
  await assert.rejects(
    veniceModels(async () =>
      Response.json({ error: "private diagnostic" }, { status: 503 }),
    ),
    /Catalogue Venice AI indisponible/,
  );
});

test("Venice uses the chosen model and effort, neutral tool round trips and Heart-owned execution", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-venice-")),
    storage = await openJsonStorage(root);
  let calls = 0,
    executed = 0;
  const model = createAiSdkProvider({
    provider: "venice",
    modelId: "venice-qa",
    apiKey: "fake-private-venice-key",
    reasoningEffort: "high",
    fetch: async (url, init) => {
      calls++;
      assert.equal(
        String(url),
        "https://api.venice.ai/api/v1/chat/completions",
      );
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fake-private-venice-key",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "venice-qa");
      assert.equal(body.reasoning_effort, "high");
      assert.equal(body.store, false);
      assert.deepEqual(body.fallbacks, []);
      assert.equal(body.venice_parameters.include_venice_system_prompt, false);
      assert.equal(body.venice_parameters.enable_web_search, "off");
      assert.equal(body.venice_parameters.enable_x_search, false);
      assert.equal(body.venice_parameters.enable_web_scraping, false);
      assert(!("max_tokens" in body));
      assert(!("max_completion_tokens" in body));
      if (calls === 1) {
        assert.equal(executed, 0);
        assert.match(body.tools[0].function.description, /history.read/);
        return completion(
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tool-1",
                type: "function",
                function: {
                  name: body.tools[0].function.name,
                  arguments: JSON.stringify({ query: "code" }),
                },
              },
            ],
          },
          "tool_calls",
        );
      }
      assert.equal(executed, 1);
      assert.equal(body.messages.at(-1).role, "tool");
      assert.equal(body.messages.at(-1).tool_call_id, "tool-1");
      assert.equal(body.messages.at(-1).content, "CODE-123");
      return completion({
        role: "assistant",
        content: "Code retrouvé : CODE-123",
      });
    },
  });
  try {
    const engine = new Engine(storage.sessions, [
      {
        name: "history.read",
        description: "Lire",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        permission: "history.read",
        async execute(input) {
          executed++;
          assert.deepEqual(input, { query: "code" });
          return "CODE-123";
        },
      },
    ]);
    const result = await engine.run({
      provider: model,
      sessionId: "qa",
      prompt: "Retrouve le code",
      displayName: "Nora",
      workspace: root,
      permissions: new Set(["history.read"]),
    });
    assert.equal(result.text, "Code retrouvé : CODE-123");
    assert.equal(calls, 2);
    assert.equal(executed, 1);
    assert.equal(model.id, "ai-sdk:venice:venice-qa");
    assert(
      !JSON.stringify(await storage.sessions.read("qa")).includes(
        "fake-private-venice-key",
      ),
    );
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Venice unsupported tools and default effort are respected; failures never retry or expose secrets", async () => {
  let body: any,
    calls = 0;
  const model = createAiSdkProvider({
    provider: "venice",
    modelId: "plain",
    apiKey: "fake-secret",
    supportsTools: false,
    fetch: async (_url, init) => {
      calls++;
      body = JSON.parse(String(init?.body));
      return completion({ role: "assistant", content: "Bonjour" });
    },
  });
  const tools = [
    { name: "files.read", description: "Read", parameters: { type: "object" } },
  ];
  assert.equal(model.supportsTools, false);
  assert.equal(
    (await model.generate({ ...request, tools })).content,
    "Bonjour",
  );
  assert.equal(calls, 1);
  assert(!body.tools?.length);
  assert(!("reasoning_effort" in body));
  for (const [status, code] of [
    [401, "authentication"],
    [402, "credits"],
    [429, "rate-limit"],
    [503, "provider-unavailable"],
  ] as const) {
    calls = 0;
    const failed = createAiSdkProvider({
      provider: "venice",
      modelId: "plain",
      apiKey: "fake-secret",
      fetch: async () => {
        calls++;
        return Response.json(
          { error: "fake-secret request private" },
          { status },
        );
      },
    });
    await assert.rejects(
      failed.generate(request),
      (error: any) =>
        error.code === code && !error.message.includes("fake-secret"),
    );
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  controller.abort();
  calls = 0;
  await assert.rejects(
    model.generate({ ...request, signal: controller.signal }),
  );
  assert.equal(calls, 0);
});

test("Venice capabilities use a current cached catalogue, refresh explicitly and reject absent models", async () => {
  const lab = new TestLab({ directory: "/unused", authDirectory: "/unused" });
  let calls = 0;
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        data: [
          {
            type: "text",
            id: "venice-qa",
            context_length: 32768,
            model_spec: {
              name: "QA",
              capabilities: {
                supportsFunctionCalling: true,
                supportsReasoningEffort: true,
                reasoningEffortOptions: ["high"],
              },
            },
          },
        ],
      });
    };
    await lab.models("venice");
    assert.deepEqual(
      (await lab.capabilities("venice", "venice-qa")).reasoningEfforts,
      ["high"],
    );
    assert.equal(calls, 1);
    await assert.rejects(
      lab.capabilities("venice", "absent"),
      /absent du catalogue/,
    );
    await lab.models("venice");
    assert.equal(calls, 2);
    assert.equal(
      (await lab.usage("venice", "venice-qa")).status,
      "unconfigured",
    );
    assert.throws(
      () => lab.model({ provider: "venice", modelId: "venice-qa" }),
      /Configurer d’abord/,
    );
  } finally {
    globalThis.fetch = original;
    await lab.close();
  }
});
