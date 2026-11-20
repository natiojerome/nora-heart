import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { assistantFixture } from "./assistant.fixture.ts";
import {
  resolvePolicies,
  validatePolicyOverrides,
} from "../src/app/runtime-policies.ts";
import { Engine } from "../src/core/engine.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { BoundedContext } from "../src/modules/context/bounded/index.ts";
import {
  StructuredMemory,
  memoryTerms,
} from "../src/modules/memory/structured/index.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import { structuredMemoryFixture } from "./structured-memory-fixture.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import type { ModelRequest, ModelResponse } from "../src/contracts/models.ts";
import type { Message } from "../src/contracts/messages.ts";
import type { Json } from "../src/contracts/json.ts";

test("policy defaults are derived, strict, and store only deviations", async () => {
  const a = assistantFixture();
  const c = await a.policyCatalog();
  assert.equal(c.version, 0);
  assert.equal(c.policies.context.compressionPercent, 80);
  for (const bad of [
    null,
    [],
    { unknown: {} },
    { messages: { unknown: 3 } },
    { tools: { maxCallsPerBatch: -1 } },
    { memory: { terms: 1.5 } },
    { context: { compressionPercent: 0 } },
    { context: { compressionPercent: 101 } },
    { messages: { maxCharacters: Number.MAX_SAFE_INTEGER + 1 } },
  ])
    assert.throws(() => validatePolicyOverrides(bad), /invalides/);
  assert.deepEqual(validatePolicyOverrides(c.defaults), {});
  assert.equal(
    resolvePolicies({ messages: { maxCharacters: 0 } }).messages.maxCharacters,
    0,
  );
  const saved = await a.savePolicy({
    version: 0,
    section: "messages",
    baseValue: c.policies.messages,
    value: { maxCharacters: 0 },
  });
  assert.deepEqual(saved.profile.settings.runtimePolicies, {
    messages: { maxCharacters: 0 },
  });
  assert.equal(saved.profile.effectivePolicies?.messages.maxCharacters, 0);
});

test("targeted policies merge independent edits, reject conflicts, preserve old clients and reset just one section", async () => {
  const a = assistantFixture(),
    c = await a.policyCatalog();
  await a.savePolicy({
    version: 0,
    section: "memory",
    baseValue: c.policies.memory,
    value: { candidates: 0 },
  });
  await a.savePolicy({
    version: 0,
    section: "memory",
    baseValue: c.policies.memory,
    value: { injectedItems: 7 },
  });
  await a.patch({
    version: 2,
    base: { name: "Nora" },
    patch: { name: "Elios" },
  });
  await a.savePolicy({
    version: 0,
    section: "messages",
    baseValue: c.policies.messages,
    value: { maxCharacters: 19000 },
  });
  await assert.rejects(
    a.savePolicy({
      version: 0,
      section: "memory",
      baseValue: c.policies.memory,
      value: { candidates: 5 },
    }),
    /ailleurs/,
  );
  const profile = await a.get();
  const { runtimePolicies, ...oldClient } = profile.settings;
  await a.save({ version: profile.version, settings: oldClient });
  assert.deepEqual((await a.get()).settings.runtimePolicies, runtimePolicies);
  const current = await a.policyCatalog();
  await a.savePolicy({
    version: current.version,
    section: "memory",
    baseValue: current.policies.memory,
    value: null,
  });
  const after = await a.policyCatalog();
  assert.deepEqual(after.policies.memory, c.defaults.memory);
  assert.equal(after.policies.messages.maxCharacters, 19000);
  assert.equal(after.profile.settings.name, "Elios");
  for (const bad of [
    { section: "unknown", value: {} },
    { section: "tools", value: {} },
    { section: "tools", value: { maxCallsPerBatch: 1 }, baseValue: {} },
  ])
    await assert.rejects(
      a.savePolicy({
        version: after.version,
        baseValue: c.policies.tools,
        ...bad,
      }),
      /invalides/,
    );
});

test("configured tool batch rejects before execution, zero allows larger batches while permissions still apply", async () => {
  const root = await mkdtemp("/tmp/heart-policy-tools-"),
    storage = await openJsonStorage(root);
  let executed = 0;
  try {
    const engine = new Engine(storage.sessions, [
      {
        name: "effect",
        description: "Effect",
        parameters: { type: "object" },
        permission: "files.write",
        async execute() {
          executed++;
          return "ok";
        },
      },
    ]);
    const provider = {
      id: "fake",
      async generate(r: ModelRequest) {
        return r.messages.at(-1)?.role === "tool"
          ? { content: "done", toolCalls: [] }
          : {
              content: "",
              toolCalls: Array.from({ length: 18 }, (_, i) => ({
                id: "c" + i,
                name: "effect",
                arguments: {},
              })),
            };
      },
    };
    const options = {
      sessionId: "reject",
      prompt: "go",
      displayName: "Nora",
      workspace: root,
      permissions: new Set(["files.write" as const]),
      provider,
    };
    await assert.rejects(
      engine.run({ ...options, maxCallsPerBatch: 2 }),
      /Lot d’outils trop grand/,
    );
    assert.equal(executed, 0);
    await engine.run({
      ...options,
      sessionId: "unlimited",
      maxCallsPerBatch: 0,
    });
    assert.equal(executed, 18);
    await engine.run({
      ...options,
      sessionId: "denied",
      maxCallsPerBatch: 30,
      permissions: new Set(),
    });
    assert.equal(executed, 18);
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("memory search limits cover candidates, ranked results and terms including unlimited", async () => {
  const f = structuredMemoryFixture();
  for (let i = 0; i < 20; i++)
    await f.memory.remember("quartz information durable numéro " + i);
  const scoped = (policy: {
    candidates: number;
    results: number;
    terms: number;
  }) =>
    new StructuredMemory(f.repository, { source: { type: "manual" } }, policy);
  assert.equal(
    (await scoped({ candidates: 2, results: 0, terms: 0 }).search("quartz"))
      .length,
    2,
  );
  assert.equal(
    (await scoped({ candidates: 0, results: 4, terms: 0 }).search("quartz"))
      .length,
    4,
  );
  assert.equal(
    (await scoped({ candidates: 0, results: 0, terms: 0 }).search("quartz"))
      .length,
    20,
  );
  const searchTool = structuredMemoryTools(
    scoped({ candidates: 0, results: 0, terms: 0 }),
    null,
  ).find((t) => t.name === "memory.search")!;
  assert.equal(
    JSON.parse(
      await searchTool.execute({ query: "quartz" }, { workspace: "/tmp" }),
    ).length,
    20,
    "tool must not silently truncate configured search results",
  );
  const words = Array.from({ length: 20 }, (_, i) => "word" + i).join(" ");
  assert.equal(memoryTerms(words).length, 16);
  assert.equal(memoryTerms(words, 0).length, 20);
  assert.equal(
    (
      await scoped({ candidates: 0, results: 0, terms: 1 }).search(
        "absent quartz",
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await scoped({ candidates: 0, results: 0, terms: 0 }).search(
        "absent quartz",
      )
    ).length,
    20,
  );
});

test("context honors injection caps and zero, compression threshold and summary-call budget without losing history", async () => {
  const root = await mkdtemp("/tmp/heart-policy-context-"),
    storage = await openJsonStorage(root);
  try {
    const memory = {
      async remember() {
        throw Error("unused");
      },
      async search() {
        return Array.from({ length: 5 }, (_, i) => ({
          id: String(i),
          content: "Quartz fact " + i,
        }));
      },
    };
    const policies = resolvePolicies({
      memory: { injectedItems: 1, injectedCharacters: 0 },
    });
    const request: ModelRequest = {
      instructions: "Nora",
      tools: [],
      messages: [{ role: "user", content: "quartz" }],
    };
    const options = {
      sessionId: "inject",
      runId: randomUUID(),
      contextWindow: 20000,
      reserveTokens: 1024,
      request,
      provider: {
        id: "fake",
        async generate() {
          throw Error("no compression");
        },
      },
    };
    assert.equal(
      (
        await new BoundedContext(
          storage.sessions,
          memory,
          undefined,
          policies,
        ).prepare(options)
      ).instructions.match(/Quartz fact/g)?.length,
      1,
    );
    policies.memory.injectedItems = 0;
    assert.equal(
      (
        await new BoundedContext(
          storage.sessions,
          memory,
          undefined,
          policies,
        ).prepare(options)
      ).instructions.match(/Quartz fact/g)?.length,
      5,
    );
    policies.memory.injectedCharacters = 2;
    assert(
      !(
        await new BoundedContext(
          storage.sessions,
          memory,
          undefined,
          policies,
        ).prepare(options)
      ).instructions.includes("Quartz fact"),
    );
    const messages: Message[] = [];
    for (let i = 0; i < 12; i++) {
      messages.push(
        { role: "user", content: "archive " + i + "x".repeat(2200) },
        { role: "assistant", content: "décision " + i, toolCalls: [] },
      );
    }
    messages.push({ role: "user", content: "Continue" });
    for (const message of messages)
      await storage.sessions.append("compress", {
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
        return { content: "Décisions conservées.", toolCalls: [] };
      },
    };
    const args = {
      ...options,
      sessionId: "compress",
      request: { ...request, messages },
      contextWindow: 4096,
      provider,
    };
    const limited = resolvePolicies({ context: { maxSummaryCalls: 1 } });
    await assert.rejects(
      new BoundedContext(
        storage.sessions,
        undefined,
        undefined,
        limited,
      ).prepare(args),
      /Compression trop longue/,
    );
    assert.equal(calls, 1);
    assert.equal(
      (await storage.sessions.read("compress")).filter(
        (e) => e.type === "context.checkpoint",
      ).length,
      0,
    );
    limited.context.maxSummaryCalls = 0;
    const continued = await new BoundedContext(
      storage.sessions,
      undefined,
      undefined,
      limited,
    ).prepare(args);
    assert.deepEqual(continued.messages, [messages.at(-1)]);
    assert(calls > 2);
    const small: Message[] = [
      { role: "user", content: "x".repeat(4500) },
      { role: "assistant", content: "oui", toolCalls: [] },
      { role: "user", content: "suite" },
    ];
    for (const message of small)
      await storage.sessions.append("threshold", {
        id: randomUUID(),
        runId: randomUUID(),
        at: new Date().toISOString(),
        type: "message",
        data: message as unknown as Json,
      });
    const high = resolvePolicies({ context: { compressionPercent: 100 } }),
      low = resolvePolicies({ context: { compressionPercent: 50 } });
    calls = 0;
    await new BoundedContext(
      storage.sessions,
      undefined,
      undefined,
      high,
    ).prepare({
      ...args,
      sessionId: "threshold",
      request: { ...request, messages: small },
    });
    assert.equal(calls, 0);
    await new BoundedContext(
      storage.sessions,
      undefined,
      undefined,
      low,
    ).prepare({
      ...args,
      sessionId: "threshold",
      request: { ...request, messages: small },
    });
    assert.equal(calls, 1);
    await assert.rejects(
      new BoundedContext(storage.sessions, undefined, undefined, high).prepare({
        ...options,
        request: {
          ...request,
          messages: [{ role: "user", content: "x".repeat(100000) }],
        },
      }),
      /Échange trop volumineux/,
    );
  } finally {
    await storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("web composition snapshots policies per turn and persists them across restart", async () => {
  const root = await mkdtemp("/tmp/heart-policy-assembly-"),
    file = root + "/state.sqlite";
  const lab = new TestLab({
    directory: root + "/lab",
    authDirectory: root + "/auth",
  });
  await lab.prepare();
  await migrateSqlite(file);
  lab.models = async () => ({
    models: [{ id: "fake", name: "Fake", contextWindow: 32768 }],
  });
  let app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/state",
      lab,
    ),
    primary = 0;
  lab.model = () => ({
    id: "fake",
    async generate(r): Promise<ModelResponse> {
      if (r.tools.some((t) => t.name === "memory.assess"))
        return {
          content: "",
          toolCalls: [
            {
              id: "assess",
              name: "memory.assess",
              arguments: {
                decisions: [{ action: "none", evidence: "", note: "test" }],
              },
            },
          ],
        };
      primary++;
      if (primary === 1) {
        assert.match(r.instructions, /16/);
        const c = await app.assistant.policyCatalog();
        await app.assistant.savePolicy({
          version: c.version,
          section: "tools",
          baseValue: c.policies.tools,
          value: { maxCallsPerBatch: 1 },
        });
        return {
          content: "",
          toolCalls: [
            { id: "one", name: "unknown", arguments: {} },
            { id: "two", name: "unknown", arguments: {} },
          ],
        };
      }
      if (primary === 3)
        return {
          content: "",
          toolCalls: [
            { id: "three", name: "unknown", arguments: {} },
            { id: "four", name: "unknown", arguments: {} },
          ],
        };
      return { content: "Bonjour.", toolCalls: [] };
    },
  });
  try {
    const { conversation } = await app.conversations.create({
      title: "Policies",
    });
    await app.conversations.fileAccess(conversation.id, { access: "none" });
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Bonjour",
    });
    assert.equal(
      primary,
      2,
      "running turn keeps batch allowance despite concurrent edit",
    );
    await assert.rejects(
      app.conversations.send(conversation.id, {
        provider: "chatgpt",
        modelId: "fake",
        prompt: "Bonjour encore",
      }),
      /Lot d’outils trop grand/,
    );
    await app.close();
    app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/state",
      lab,
    );
    assert.equal((await app.assistant.policies()).tools.maxCallsPerBatch, 1);
    const c = await app.assistant.policyCatalog();
    await app.assistant.savePolicy({
      version: c.version,
      section: "messages",
      baseValue: c.policies.messages,
      value: { maxCharacters: 5 },
    });
    await assert.rejects(
      app.conversations.send(conversation.id, {
        provider: "chatgpt",
        modelId: "fake",
        prompt: "trop long",
      }),
      /limite configurée de 5/,
    );
    assert.equal(primary, 3, "invalid prompt does not call model");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
