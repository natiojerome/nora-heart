import { memoryConsentPolicy } from "../src/app/memory-policy.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryReview } from "../src/modules/memory/review/index.ts";
import { structuredMemoryFixture } from "./structured-memory-fixture.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import { interactionTools } from "../src/modules/tools/interactions/index.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import type { Json } from "../src/contracts/json.ts";
import type {
  ModelProvider,
  ModelResponse,
  ModelRequest,
} from "../src/contracts/models.ts";

const phrase = "Je suis né le 9 septembre 1982. Quel âge ai-je ?";
const args = {
  title: "Date de naissance",
  content: "L’utilisateur est né le 9 septembre 1982.",
  kind: "fact",
  scope: "personal",
};
const assessed = (decisions: Json): ModelResponse => ({
  content: "",
  toolCalls: [
    { id: "assess", name: "memory.assess", arguments: { decisions } },
  ],
});
const keep = {
  action: "remember",
  evidence: "Je suis né le 9 septembre 1982.",
  note: "La date reste utile au-delà du calcul d’âge.",
  arguments: args,
};
const draft = { content: "Tu as 44 ans.", toolCalls: [] };
function request(text = phrase): ModelRequest {
  return {
    instructions: "Private personality which the review does not need",
    messages: [{ role: "user", content: text }],
    tools: [],
    signal: AbortSignal.timeout(2000),
  };
}

async function fixture() {
  const { memory } = structuredMemoryFixture();
  return {
    memory,
    review: new MemoryReview(memory, null, memoryConsentPolicy),
    tools: [...structuredMemoryTools(memory, null), ...interactionTools()],
  };
}

test("review isolates direct human text from files and validates a durable fact embedded in a question", async () => {
  const f = await fixture(),
    input = request();
  input.tools = f.tools;
  input.messages = [
    ...input.messages,
    {
      role: "tool",
      callId: "read",
      name: "files.read",
      content: "PRIVATE_FILE_MUST_NOT_BE_REVIEWED",
      error: false,
    },
  ];
  const result = await f.review.review({
    request: input,
    response: draft,
    provider: {
      id: "fake",
      async generate(r) {
        assert.equal(r.tools.length, 1);
        assert.equal(r.tools[0].name, "memory.assess");
        assert(
          !JSON.stringify(r).includes("PRIVATE_FILE_MUST_NOT_BE_REVIEWED"),
        );
        assert(!r.instructions.includes("Private personality"));
        return assessed([keep]);
      },
    },
  });
  assert.equal(result.response.toolCalls[0].name, "memory.remember");
  assert.match(result.response.content, /au-delà/);
  assert.equal(
    (await f.memory.list()).length,
    0,
    "review returns effects; it never executes them",
  );
});

test("review rejects unsourced writes, unknown revisions, extra arguments and injected non-memory effects", async () => {
  const f = await fixture();
  for (const decision of [
    { ...keep, evidence: "Je suis médecin" },
    {
      ...keep,
      action: "update",
      arguments: {
        ...args,
        id: "00000000-0000-4000-8000-000000000000",
        version: 1,
      },
    },
    { ...keep, arguments: { ...args, unapproved: true } },
    { ...keep, action: "files.delete" },
    {
      ...keep,
      arguments: {
        ...args,
        scope: "project",
        projectId: "00000000-0000-4000-8000-000000000000",
      },
    },
  ]) {
    const input = request();
    input.tools = f.tools;
    await assert.rejects(
      f.review.review({
        request: input,
        response: draft,
        provider: {
          id: "fake",
          async generate() {
            return assessed([decision]);
          },
        },
      }),
    );
  }
  assert.equal((await f.memory.list()).length, 0);
});

test("review requires a structured decision, not another uncommitted promise", async () => {
  const f = await fixture(),
    input = request();
  input.tools = f.tools;
  await assert.rejects(
    f.review.review({
      request: input,
      response: draft,
      provider: {
        id: "fake",
        async generate() {
          return { content: "Je retiendrai ta date.", toolCalls: [] };
        },
      },
    }),
    /Missing memory decision/,
  );
});

test("known facts do not produce a duplicate and updates keep the actual revision", async () => {
  const f = await fixture();
  const record = await f.memory.rememberRecord({
    ...args,
    kind: "fact",
    scope: "personal",
    projectId: null,
  });
  const input = request();
  input.tools = f.tools;
  const duplicate = await f.review.review({
    request: input,
    response: draft,
    provider: {
      id: "fake",
      async generate() {
        return assessed([keep]);
      },
    },
  });
  assert.equal(duplicate.response.toolCalls.length, 0);
  const update = {
    ...keep,
    action: "update",
    arguments: {
      ...args,
      id: record.id,
      version: record.version,
      content: "L’utilisateur est né le 10 septembre 1982.",
    },
    evidence: "Je suis né le 10 septembre 1982.",
  };
  const changed = await f.review.review({
    request: {
      ...input,
      messages: [{ role: "user", content: update.evidence }],
    },
    response: draft,
    provider: {
      id: "fake",
      async generate() {
        return assessed([update]);
      },
    },
  });
  assert.equal(changed.response.toolCalls[0].name, "memory.update");
  assert.equal((changed.response.toolCalls[0].arguments as any).version, 1);
});

test("sensitive or ambiguous facts request consent before any write", async () => {
  const f = await fixture(),
    input = request("Je suis suivi pour un problème de santé.");
  input.tools = f.tools;
  const result = await f.review.review({
    request: input,
    response: draft,
    provider: {
      id: "fake",
      async generate() {
        return assessed([
          {
            action: "confirm",
            evidence: "Je suis suivi pour un problème de santé.",
            note: "Souhaites-tu conserver cette information de santé ?",
          },
        ]);
      },
    },
  });
  assert.equal(result.response.toolCalls.length, 1);
  assert.equal(result.response.toolCalls[0].name, "interactions.request_input");
  assert.equal((await f.memory.list()).length, 0);
});

test("unsupported tools and oversized review inputs do not trigger a hidden provider request", async () => {
  const f = await fixture();
  let calls = 0;
  const provider: ModelProvider = {
    id: "fake",
    async generate() {
      calls++;
      return assessed([
        { action: "none", evidence: "", note: "Rien de durable." },
      ]);
    },
  };
  const noTools = await f.review.review({
    request: request(),
    response: draft,
    provider,
  });
  assert.deepEqual(noTools.response, draft);
  assert.equal(calls, 0);
  const input = request("x".repeat(8000));
  input.tools = f.tools;
  await assert.rejects(
    f.review.review({
      request: input,
      response: draft,
      provider,
      contextWindow: 2048,
      reserveTokens: 512,
    }),
    /too large/,
  );
  assert.equal(calls, 0);
});

for (const failure of [false, true])
  test(
    "actual web composition reviews an overlooked fact and persists only confirmed effects" +
      (failure ? " (review unavailable)" : ""),
    async () => {
      const root = await mkdtemp(
          path.join(os.tmpdir(), "heart-memory-review-"),
        ),
        file = path.join(root, "state.sqlite");
      const lab = new TestLab({
        directory: path.join(root, "lab"),
        authDirectory: path.join(root, "auth"),
      });
      await lab.prepare();
      await migrateSqlite(file);
      let primary = 0,
        reviews = 0;
      lab.model = () => ({
        id: "simulated-chatgpt",
        async generate(r): Promise<ModelResponse> {
          if (r.tools.some((t) => t.name === "memory.assess")) {
            reviews++;
            if (failure)
              throw new Error(
                "Private provider diagnostic must not enter journal",
              );
            return assessed([keep]);
          }
          primary++;
          const last = r.messages.at(-1);
          if (last?.role === "tool") {
            assert.equal(last.name, "memory.remember");
            assert.equal(last.error, false);
            return {
              content: "Tu as 44 ans. Ta date de naissance est enregistrée.",
              toolCalls: [],
            };
          }
          return draft;
        },
      });
      lab.capabilities = async () => ({ id: "fake", contextWindow: 32768 });
      lab.models = async () => ({
        models: [{ id: "fake", name: "Simulation", contextWindow: 32768 }],
      });
      let app = await openWebConversations(
        { driver: "sqlite", file },
        path.join(root, "app"),
        lab,
      );
      try {
        const { conversation } = await app.conversations.create({
          title: "Une question avec une information durable",
        });
        await app.conversations.fileAccess(conversation.id, { access: "none" });
        const result = await app.conversations.send(conversation.id, {
          provider: "chatgpt",
          modelId: "fake",
          contextWindow: 32768,
          prompt: phrase,
        });
        assert.equal(reviews, 1);
        assert.equal(primary, failure ? 1 : 2);
        const events = result.events;
        assert.equal(
          events.filter(
            (e) =>
              e.type === "message" &&
              (e.data as any).role === "assistant" &&
              !(e.data as any).toolCalls?.length,
          ).length,
          1,
          "no premature final answer",
        );
        const audit = events.find(
          (e) => e.type === "run.progress" && (e.data as any).kind === "review",
        );
        assert(audit);
        assert(!JSON.stringify(events).includes("Private provider diagnostic"));
        assert.equal(
          (await app.memories.list()).memories.length,
          failure ? 0 : 1,
        );
        const final = events.findLast(
          (e) => e.type === "message" && (e.data as any).role === "assistant",
        );
        assert.match(
          (final!.data as any).content,
          failure ? /vérification de mémoire n’a pas abouti/ : /enregistrée/,
        );
        if (!failure) {
          await app.close();
          app = await openWebConversations(
            { driver: "sqlite", file },
            path.join(root, "app"),
            lab,
          );
          assert.equal(
            (await app.memories.list()).memories[0].content,
            args.content,
          );
        }
      } finally {
        await app.close();
        await lab.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

for (const consent of ["allow", "decline"] as const)
  test(
    "review consent " +
      consent +
      " resumes through the human answer without a repeated question",
    async () => {
      const root = await mkdtemp(
          path.join(os.tmpdir(), "heart-review-consent-"),
        ),
        file = path.join(root, "state.sqlite");
      const lab = new TestLab({
        directory: path.join(root, "lab"),
        authDirectory: path.join(root, "auth"),
      });
      await lab.prepare();
      await migrateSqlite(file);
      lab.models = async () => ({
        models: [{ id: "fake", name: "Simulation", contextWindow: 32768 }],
      });
      let reviews = 0;
      const text = "Je suis suivi pour un problème de santé.";
      lab.model = () => ({
        id: "fake",
        async generate(r): Promise<ModelResponse> {
          if (r.tools.some((t) => t.name === "memory.assess")) {
            reviews++;
            const data = JSON.parse(r.messages[0].content);
            const answered = data.currentTurnResults.find(
              (item: any) => item.name === "interactions.request_input",
            );
            if (!answered)
              return assessed([
                {
                  action: "confirm",
                  evidence: text,
                  note: "Souhaites-tu conserver cette information de santé ?",
                },
              ]);
            const answer = JSON.parse(answered.content);
            if (answer.answers.memory_consent === "decline")
              return assessed([
                {
                  action: "none",
                  evidence: "",
                  note: "La personne refuse de mémoriser.",
                },
              ]);
            return assessed([
              {
                action: "remember",
                evidence: text,
                note: "Accord reçu.",
                arguments: {
                  title: "Contexte personnel",
                  content: "La personne est suivie pour un problème de santé.",
                  kind: "fact",
                  scope: "personal",
                },
              },
            ]);
          }
          const last = r.messages.at(-1);
          return {
            content:
              last?.role === "tool" && last.name === "memory.remember"
                ? "Information sauvegardée avec ton accord."
                : "Bien reçu.",
            toolCalls: [],
          };
        },
      });
      const app = await openWebConversations(
        { driver: "sqlite", file },
        path.join(root, "app"),
        lab,
      );
      try {
        const { conversation } = await app.conversations.create({
          title: "Accord mémoire",
        });
        const pending = await app.conversations.send(conversation.id, {
          provider: "chatgpt",
          modelId: "fake",
          prompt: text,
        });
        assert.equal(pending.interactions.length, 1);
        assert.equal((await app.memories.list()).memories.length, 0);
        const resolved = await app.conversations.respondInteraction(
          conversation.id,
          pending.interactions[0].id,
          { status: "answered", answers: { memory_consent: consent } },
        );
        assert.equal(
          resolved.interactions.filter((item) => item.status === "pending")
            .length,
          0,
        );
        assert.equal(resolved.interactions.length, 1);
        assert.equal(reviews, 2);
        assert.equal(
          (await app.memories.list()).memories.length,
          consent === "allow" ? 1 : 0,
        );
      } finally {
        await app.close();
        await lab.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

test("review corrects unsupported saved claims instead of treating old conversation receipts as active memory", async () => {
  const f = await fixture();
  const input = request(
    "Tu penses que ces informations valent la peine d’être sauvegardées ?",
  );
  input.tools = f.tools;
  input.messages = [
    {
      role: "assistant",
      content: "Je connais ton métier dans cette conversation.",
      toolCalls: [],
    },
    ...input.messages,
  ];
  const correction =
    "Ces informations sont présentes dans la conversation, mais je n’ai pas de confirmation qu’elles soient enregistrées dans la mémoire active.";
  const result = await f.review.review({
    request: input,
    response: {
      content: "Les autres informations sont déjà sauvegardées.",
      toolCalls: [],
    },
    provider: {
      id: "fake",
      async generate(r) {
        assert.match(r.instructions, /Contrôle également les affirmations/);
        const payload = JSON.parse(r.messages[0].content);
        assert.deepEqual(payload.activeMemories, []);
        return {
          content: "",
          toolCalls: [
            {
              id: "assess",
              name: "memory.assess",
              arguments: {
                decisions: [
                  {
                    action: "none",
                    evidence: "",
                    note: "Pas de preuve de sauvegarde actuelle.",
                  },
                ],
                correctedAnswer: correction,
              },
            },
          ],
        };
      },
    },
  });
  assert.equal(result.response.content, correction);
  assert.equal((result.audit as any).answerCorrected, true);
  assert.equal((await f.memory.list()).length, 0);
});

test("a known-memory confirmation requires a current active ID and exact version, not an old receipt", async () => {
  const f = await fixture();
  const record = await f.memory.rememberRecord({
    ...args,
    kind: "fact",
    scope: "personal",
    projectId: null,
  });
  const input = request("Est-ce bien sauvegardé ?");
  input.tools = f.tools;
  const provider = {
    id: "known",
    async generate() {
      return assessed([
        {
          action: "known",
          evidence: "Je suis né le 9 septembre 1982.",
          note: "Référence vérifiée.",
          arguments: { id: record.id, version: record.version },
        },
      ]);
    },
  };
  const success = await f.review.review({
    request: input,
    response: draft,
    provider,
  });
  assert.deepEqual((success.audit as any).verifiedMemories, [
    { id: record.id, version: 1 },
  ]);
  await f.memory.update(record.id, 1, {
    ...args,
    kind: "fact",
    scope: "personal",
    projectId: null,
    title: "Date confirmée",
  });
  await assert.rejects(
    f.review.review({
      request: input,
      response: { content: "C’est déjà enregistré.", toolCalls: [] },
      provider,
    }),
    /current active revision/,
  );
  await f.memory.setStatus(record.id, 2, "forgotten");
  await assert.rejects(
    f.review.review({ request: input, response: draft, provider }),
    /current active revision/,
  );
});

test("failed memory verification cannot publish the unchecked answer as a confirmation", async () => {
  const { Engine } = await import("../src/core/engine.ts");
  const f = await fixture();
  const events: any[] = [];
  const sessions = {
    async read() {
      return [...events];
    },
    async append(_id: string, e: any) {
      events.push(e);
    },
  };
  const engine = new Engine(sessions, f.tools, undefined, f.review);
  const result = await engine.run({
    sessionId: "guard",
    prompt: phrase,
    workspace: ".",
    displayName: "Test",
    permissions: new Set(["memory.read", "memory.write"]),
    provider: {
      id: "guard",
      async generate(r) {
        if (r.tools.some((t) => t.name === "memory.assess"))
          return assessed([
            {
              action: "known",
              evidence: "Je suis né le 9 septembre 1982.",
              note: "Fausse preuve ancienne.",
              arguments: {
                id: "00000000-0000-4000-8000-000000000000",
                version: 1,
              },
            },
          ]);
        return { content: "Tout est déjà sauvegardé.", toolCalls: [] };
      },
    },
  });
  assert.doesNotMatch(result.text, /Tout est déjà sauvegardé/);
  assert.match(result.text, /ne peux pas confirmer/);
  assert(!JSON.stringify(events).includes("Tout est déjà sauvegardé."));
  assert.equal((await f.memory.list()).length, 0);
});
