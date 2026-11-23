import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  referenceRepeatedText,
  expandReferencedText,
} from "../src/modules/context/exact-references/index.ts";
import { contextExperiments } from "../src/app/context-experiments.ts";
import { modelInputSizes } from "../src/core/model-observation.ts";
import { Engine } from "../src/core/engine.ts";
import { ProjectReview } from "../src/modules/projects/review/index.ts";
import { projectProgressTools } from "../src/modules/tools/projects/index.ts";
import { projectTrackingFixture } from "./project-tracking.fixture.ts";
import type { Json } from "../src/contracts/json.ts";
import type { ModelRequest, ModelResponse } from "../src/contracts/models.ts";
const block =
  "Preuve versionnée : conserver la contrainte utilisateur et le résultat exact. ".repeat(
    70,
  );

test("review text references reconstruct all data exactly, preserving order, conflicts and reserved-key literals", () => {
  const input: Json = {
    instructions: "Ne clôture pas le projet.",
    messages: [
      { role: "tool", content: block },
      { role: "tool", content: block },
      {
        role: "user",
        content: "La nouvelle contrainte remplace seulement la précédente.",
      },
    ],
    nested: [
      { $heartText: 0 },
      { $heartLiteral: { $heartText: 0 } },
      null,
      0,
      false,
    ],
    proof: block,
  };
  const before = JSON.stringify(input),
    encoded = referenceRepeatedText(input);
  assert.deepEqual(expandReferencedText(encoded), input);
  assert.equal(JSON.stringify(input), before);
  assert(JSON.stringify(encoded).length < before.length / 2);
  assert.deepEqual(referenceRepeatedText({ small: "One unique text." }), {
    small: "One unique text.",
  });
  for (let i = 0; i < 40; i++) {
    const value: Json = {
      rows: [block, { text: block, id: randomUUID(), value: i }],
      literal: { [i % 2 ? "$heartText" : "$heartLiteral"]: i },
    };
    assert.deepEqual(expandReferencedText(referenceRepeatedText(value)), value);
  }
});

test("context experiments are opt-in and reject unknown values without changing the baseline", () => {
  assert.deepEqual(contextExperiments(undefined), {});
  assert.deepEqual(
    contextExperiments({ measureRequests: true, compactProjectReview: false }),
    { measureRequests: true, compactProjectReview: false },
  );
  for (const v of [
    null,
    [],
    true,
    { compactProjectReview: "yes" },
    { disableMemoryReview: true },
  ])
    assert.throws(() => contextExperiments(v));
});

test("measurement preserves requests, outputs and tool execution; counters contain no prompts or private data", async () => {
  async function run(measure: boolean) {
    const events: any[] = [],
      seen: ModelRequest[] = [];
    let effects = 0;
    const engine = new Engine(
      {
        async read() {
          return [...events];
        },
        async append(_id, e) {
          events.push(e);
        },
      },
      [
        {
          name: "qa.effect",
          permission: "files.read",
          description: "Actual effect",
          parameters: { type: "object" },
          async execute() {
            effects++;
            return "PRIVATE_TOOL_CONTENT";
          },
        },
      ],
    );
    const result = await engine.run({
      sessionId: "qa",
      displayName: "QA",
      workspace: ".",
      prompt: "PRIVATE_USER_TEXT",
      instructions: "PRIVATE_INSTRUCTIONS",
      permissions: new Set(["files.read"]),
      measureModelRequests: measure,
      provider: {
        id: "fake",
        async generate(r): Promise<ModelResponse> {
          seen.push(r);
          return seen.length === 1
            ? {
                content: "",
                toolCalls: [{ id: "once", name: "qa.effect", arguments: {} }],
              }
            : { content: "Completed.", toolCalls: [] };
        },
      },
    });
    return {
      events,
      seen: seen.map((r) => ({
        instructions: r.instructions,
        messages: r.messages,
        tools: r.tools,
      })),
      result,
      effects,
    };
  }
  const baseline = await run(false),
    measured = await run(true);
  assert.deepEqual(measured.seen, baseline.seen);
  assert.equal(measured.result.text, baseline.result.text);
  assert.equal(measured.effects, 1);
  assert(!baseline.events.some((e) => e.data.kind === "model-usage"));
  const counters = measured.events.filter((e) => e.data.kind === "model-usage");
  assert.equal(counters.length, 2);
  assert(
    counters.every((e) => e.data.estimated && e.data.status === "completed"),
  );
  assert(!JSON.stringify(counters).includes("PRIVATE_"));
});

test("media bytes are separate from text estimates and never copied into measurement events", () => {
  const request: ModelRequest = {
    instructions: "Keep context.",
    tools: [],
    messages: [
      {
        role: "user",
        content: "Look",
        attachments: [
          {
            id: "qa",
            name: "pic.png",
            mediaType: "image/png",
            size: 123,
            data: "PRIVATE_IMAGE",
          },
        ],
      },
    ],
  };
  const sizes = modelInputSizes(request);
  assert.equal(sizes.mediaBytes, 123);
  assert(!JSON.stringify(sizes).includes("PRIVATE_IMAGE"));
});

test("baseline and compact project reviews carry exactly the same constraints, evidence and history", async () => {
  const f = projectTrackingFixture();
  const tools = projectProgressTools(f.repository, f.project.id, {
    overview: true,
    item: true,
    updateProject: true,
    createItem: true,
    updateItem: true,
  });
  const requests: ModelRequest[] = [];
  const request: ModelRequest = {
    instructions: "Ne clôture jamais sans mon accord.",
    messages: [
      { role: "user", content: "Ancienne contrainte : garde les artefacts." },
      {
        role: "tool",
        callId: "old1",
        name: "files.read",
        content: block,
        error: false,
      },
      {
        role: "tool",
        callId: "old2",
        name: "files.read",
        content: block,
        error: false,
      },
      { role: "user", content: "Quel est le statut ?" },
    ],
    tools,
  };
  const provider = {
    id: "fake",
    async generate(r: ModelRequest) {
      requests.push(r);
      return {
        content: "",
        toolCalls: [
          {
            id: randomUUID(),
            name: "projects.assess",
            arguments: { action: "none", note: "Consultation seule." },
          },
        ],
      };
    },
  };
  for (const encode of [undefined, referenceRepeatedText])
    await new ProjectReview(
      f.repository,
      f.project.id,
      undefined,
      "",
      encode,
    ).review({
      runId: randomUUID(),
      request,
      response: { content: "État actuel.", toolCalls: [] },
      provider,
    });
  const plain = JSON.parse(requests[0].messages[0].content),
    compact = JSON.parse(requests[1].messages[0].content);
  // overview timestamps may differ; they are not included in this assessment payload.
  assert.deepEqual(expandReferencedText(compact), plain);
  assert.equal(requests[0].instructions, requests[1].instructions);
  assert.equal(requests[0].tools[0].name, "projects.assess");
  assert(JSON.stringify(compact).length < JSON.stringify(plain).length);
});

test("web opt-ins survive an interaction resume and a later ordinary message returns to baseline", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path");
  const { TestLab } = await import("../src/app/test-lab.ts"),
    { migrateSqlite } = await import("../src/modules/storage/sqlite/index.ts"),
    { openWebConversations } = await import("../src/app/web-conversations.ts");
  const root = await mkdtemp(path.join(tmpdir(), "heart-economy-settings-")),
    file = path.join(root, "state.sqlite"),
    lab = new TestLab({
      directory: path.join(root, "lab"),
      authDirectory: path.join(root, "auth"),
    });
  await lab.prepare();
  await migrateSqlite(file);
  lab.models = async () => ({
    models: [{ id: "fake", name: "QA", contextWindow: 32768 }],
  });
  lab.capabilities = async () => ({ id: "fake", contextWindow: 32768 });
  lab.model = () => ({
    id: "fake",
    async generate(r): Promise<ModelResponse> {
      if (r.purpose?.kind === "review")
        return {
          content: "",
          toolCalls: [
            {
              id: randomUUID(),
              name: "memory.assess",
              arguments: {
                decisions: [
                  { action: "none", evidence: "", note: "Aucun nouveau fait." },
                ],
              },
            },
          ],
        };
      if (
        r.messages.at(-1)?.role === "user" &&
        r.messages.at(-1)?.content === "Pose une question."
      )
        return {
          content: "",
          toolCalls: [
            {
              id: randomUUID(),
              name: "interactions.request_input",
              arguments: {
                title: "QA",
                questions: [
                  {
                    id: "qa",
                    label: "Continuer ?",
                    type: "single",
                    options: [
                      { id: "yes", label: "Oui" },
                      { id: "no", label: "Non" },
                    ],
                  },
                ],
              },
            },
          ],
        };
      return { content: "Terminé.", toolCalls: [] };
    },
  });
  const app = await openWebConversations(
    { driver: "sqlite", file },
    path.join(root, "app"),
    lab,
  );
  try {
    const { conversation } = await app.conversations.create({ title: "QA" });
    const pending = await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Pose une question.",
      contextExperiments: { measureRequests: true, compactProjectReview: true },
    });
    assert(pending.contextExperimentsSupported);
    assert.equal(pending.interactions.length, 1);
    const resumed = await app.conversations.respondInteraction(
      conversation.id,
      pending.interactions[0].id,
      { status: "answered", answers: { qa: "yes" } },
    );
    const resumeStart = resumed.events.findLast(
      (e) => e.type === "run.started",
    )!;
    assert.equal(
      (resumeStart.data as any).contextExperiments.measureRequests,
      true,
    );
    assert(
      resumed.events.some(
        (e) =>
          e.runId === resumeStart.runId &&
          e.type === "run.progress" &&
          (e.data as any).kind === "model-usage",
      ),
    );
    const ordinary = await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Merci.",
    });
    const next = ordinary.events.findLast((e) => e.type === "run.started")!;
    assert.equal((next.data as any).contextExperiments, undefined);
    assert(
      !ordinary.events.some(
        (e) =>
          e.runId === next.runId &&
          e.type === "run.progress" &&
          (e.data as any).kind === "model-usage",
      ),
    );
  } finally {
    await app.close();
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});
