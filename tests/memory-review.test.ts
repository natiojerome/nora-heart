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
  assert.equal(result.verifyAfterTools, true);
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
          if (failure && primary === 2)
            return {
              content:
                draft.content +
                " La vérification de mémoire n’a pas abouti ; je ne peux pas confirmer un enregistrement.",
              toolCalls: [],
            };
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
        assert.equal(primary, 2);
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
                memoryCorrection: {
                  claim: "Les autres informations sont déjà sauvegardées.",
                  issue: correction,
                },
              },
            },
          ],
        };
      },
    },
  });
  assert.equal(
    result.response.content,
    "Les autres informations sont déjà sauvegardées.",
  );
  assert.match(result.revision!, /pas de confirmation/);
  assert.equal((result.audit as any).revisionRequested, true);
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
        return {
          content: r.instructions.includes("Reprise après contrôle")
            ? "Je ne peux pas confirmer l’enregistrement sans résultat vérifié."
            : "Tout est déjà sauvegardé.",
          toolCalls: [],
        };
      },
    },
  });
  assert.doesNotMatch(result.text, /Tout est déjà sauvegardé/);
  assert.match(result.text, /ne peux pas confirmer/);
  assert(!JSON.stringify(events).includes("Tout est déjà sauvegardé."));
  assert.equal((await f.memory.list()).length, 0);
});

test("a restricted memory review cannot publish a replacement or erase the primary tool inventory", async () => {
  const { Engine } = await import("../src/core/engine.ts");
  const { fileTools } = await import("../src/modules/tools/files/index.ts");
  const f = await fixture(),
    events: any[] = [];
  let primary = 0,
    reviews = 0;
  const store = {
    async read() {
      return [...events];
    },
    async append(_id: string, event: any) {
      events.push(event);
    },
  };
  const engine = new Engine(
    store,
    [...f.tools, ...fileTools()],
    undefined,
    f.review,
  );
  const draft = "Oui, files.list est disponible.";
  const result = await engine.run({
    sessionId: "inventory-review",
    prompt: "??? Y a pas un outil fichiers ?",
    displayName: "QA",
    workspace: ".",
    permissions: new Set(["memory.read", "memory.write", "files.read"]),
    provider: {
      id: "fault-injection",
      async generate(request) {
        if (request.tools.some((t) => t.name === "memory.assess")) {
          reviews++;
          const payload = JSON.parse(request.messages[0].content);
          assert(payload.primaryToolNames.includes("files.list"));
          assert(!request.tools.some((t) => t.name === "files.list"));
          // Even a faulty reviewer cannot substitute its prose for the primary answer.
          return {
            content: "",
            toolCalls: [
              {
                id: "assess",
                name: "memory.assess",
                arguments: {
                  decisions: [{ action: "none", evidence: "", note: "QA" }],
                  memoryCorrection: {
                    claim: draft,
                    issue: "Je ne vois aucun outil fichiers.",
                  },
                },
              },
            ],
          };
        }
        primary++;
        assert(request.tools.some((t) => t.name === "files.list"));
        assert.match(request.instructions, /Inventaire effectif/);
        if (primary === 1) return { content: draft, toolCalls: [] };
        assert.match(request.instructions, /contrôle auxiliaire memory/);
        return {
          content:
            "Oui, files.list, files.read et files.info sont disponibles.",
          toolCalls: [],
        };
      },
    },
  });
  assert.equal(reviews, 1);
  assert.equal(primary, 2);
  assert.match(result.text, /files.list, files.read/);
  const finals = events.filter(
    (e) => e.type === "message" && e.data.role === "assistant",
  );
  assert.equal(finals.length, 1);
  assert(!finals[0].data.content.includes("aucun outil"));
});

test("memory corrections must quote the actual draft and reject legacy full-answer replacement", async () => {
  const f = await fixture(),
    input = request("Quels outils ?");
  input.tools = f.tools;
  for (const argumentsValue of [
    {
      decisions: [{ action: "none", evidence: "", note: "QA" }],
      memoryCorrection: { claim: "Fabricated quote", issue: "No proof" },
    },
    {
      decisions: [{ action: "none", evidence: "", note: "QA" }],
      correctedAnswer: "No files available",
    },
  ])
    await assert.rejects(
      f.review.review({
        request: input,
        response: draft,
        provider: {
          id: "invalid",
          async generate() {
            return {
              content: "",
              toolCalls: [
                {
                  id: "assess",
                  name: "memory.assess",
                  arguments: argumentsValue as any,
                },
              ],
            };
          },
        },
      }),
    );
});

test("an invalid auxiliary memory review cannot swallow a normal harness explanation", async () => {
  const { Engine } = await import("../src/core/engine.ts"),
    { fileTools } = await import("../src/modules/tools/files/index.ts");
  const f = await fixture(),
    events: any[] = [];
  let main = 0,
    review = 0;
  const engine = new Engine(
    {
      async read() {
        return [...events];
      },
      async append(_id: string, e: any) {
        events.push(e);
      },
    },
    [...f.tools, ...fileTools()],
    undefined,
    f.review,
  );
  const explanation =
    "Le Harness transmet le contexte au modèle, exécute les outils autorisés et conserve le journal.";
  const result = await engine.run({
    sessionId: "harness-description",
    prompt: "Du coup description du fonctionnement ?",
    displayName: "QA",
    workspace: ".",
    permissions: new Set(["files.read", "memory.read", "memory.write"]),
    provider: {
      id: "review-fault",
      async generate(request) {
        if (request.tools.some((t) => t.name === "memory.assess")) {
          review++;
          return {
            content: "",
            toolCalls: [
              {
                id: "assessment",
                name: "memory.assess",
                arguments: {
                  decisions: [{ action: "none", evidence: "", note: "QA" }],
                  memoryCorrection: {
                    claim: "A nonexistent quote with private diagnostic",
                    issue: "QA",
                  },
                },
              },
            ],
          };
        }
        main++;
        assert(request.tools.some((t) => t.name === "files.list"));
        if (main === 2) {
          assert.match(request.instructions, /Le contrôle a échoué/);
          assert.match(
            request.instructions,
            /ne doit pas empêcher la réponse normale/,
          );
        }
        return { content: explanation, toolCalls: [] };
      },
    },
  });
  assert.equal(result.text, explanation);
  assert.equal(main, 2);
  assert.equal(review, 1);
  const audit = events.find(
    (e) => e.type === "run.progress" && e.data.kind === "review",
  ).data.audit;
  assert.deepEqual(audit, {
    status: "failed",
    code: "INVALID_QUOTE",
    recovery: "primary-revision",
  });
  assert(!JSON.stringify(events).includes("private diagnostic"));
  assert.equal(
    events.filter((e) => e.type === "message" && e.data.role === "assistant")
      .length,
    1,
  );
  assert.equal((await f.memory.list()).length, 0);
});

test("recovery from an unavailable review preserves a successful memory write without replay", async () => {
  const { Engine } = await import("../src/core/engine.ts"),
    f = await fixture(),
    events: any[] = [];
  let calls = 0,
    reviews = 0;
  const engine = new Engine(
    {
      async read() {
        return [...events];
      },
      async append(_id: string, e: any) {
        events.push(e);
      },
    },
    f.tools,
    undefined,
    f.review,
  );
  const result = await engine.run({
    sessionId: "write-review-recovery",
    prompt: phrase,
    displayName: "QA",
    workspace: ".",
    permissions: new Set(["memory.read", "memory.write"]),
    provider: {
      id: "one-effect",
      async generate(request) {
        if (request.tools.some((t) => t.name === "memory.assess")) {
          reviews++;
          throw new Error("private upstream detail");
        }
        calls++;
        if (calls === 1)
          return {
            content: "",
            toolCalls: [
              { id: "save-once", name: "memory.remember", arguments: args },
            ],
          };
        const receipts = request.messages.filter(
          (m) => m.role === "tool" && m.name === "memory.remember",
        );
        assert.equal(receipts.length, 1);
        assert.equal((receipts[0] as any).error, false);
        if (calls === 3)
          assert.match(
            request.instructions,
            /Ne rejoue pas les opérations déjà réussies/,
          );
        return {
          content:
            "Le souvenir est enregistré, comme le confirme le résultat de l’outil.",
          toolCalls: [],
        };
      },
    },
  });
  assert.equal(calls, 3);
  assert.equal(reviews, 1);
  assert.equal((await f.memory.list()).length, 1);
  assert.equal(
    events.filter(
      (e) => e.type === "tool.started" && e.data.name === "memory.remember",
    ).length,
    1,
  );
  assert(!JSON.stringify(events).includes("private upstream detail"));
  assert.match(result.text, /résultat de l’outil/);
});

for (const action of ["remember", "update", "forget"] as const)
  test(
    "memory " +
      action +
      " is read back after review effects, with one assessment and no replay",
    async () => {
      const f = await fixture();
      const existing =
        action === "remember"
          ? null
          : await f.memory.rememberRecord({
              ...args,
              kind: "fact",
              scope: "personal",
              projectId: null,
            });
      const source =
        action === "forget" ? "Oublie ma date de naissance." : phrase;
      const proposed =
        action === "forget"
          ? { id: existing!.id, version: existing!.version }
          : {
              ...args,
              ...(existing
                ? {
                    id: existing.id,
                    version: existing.version,
                    content: "Date confirmée : 9 septembre 1982.",
                  }
                : {}),
            };
      let inferences = 0,
        reads = 0;
      const review = new MemoryReview(
        {
          ...f.memory,
          search: (q) => f.memory.search(q),
          get: async (id) => {
            reads++;
            return f.memory.get(id);
          },
        },
        null,
        memoryConsentPolicy,
      );
      const input = {
        request: { ...request(source), tools: f.tools },
        response: draft,
        runId: "run-" + action,
        provider: {
          id: "fake",
          async generate() {
            inferences++;
            return assessed([
              {
                action,
                evidence: source,
                note: "Fait déclaré ou oubli explicitement demandé.",
                arguments: proposed,
              },
            ]);
          },
        },
      };
      const decision = await review.review(input);
      assert.equal(decision.verifyAfterTools, true);
      const call = decision.response.toolCalls[0];
      const stored = await f.tools
        .find((t) => t.name === call.name)!
        .execute(call.arguments, { workspace: "." });
      const beforeReads = reads;
      const verified = await review.review({
        ...input,
        evidenceMessages: [
          ...input.request.messages,
          { role: "assistant", content: "", toolCalls: [call] },
          {
            role: "tool",
            name: call.name,
            callId: call.id,
            error: false,
            content: String(stored),
          },
        ],
        response: { content: "Résultat confirmé.", toolCalls: [] },
      });
      assert.equal((verified.audit as any).status, "verified");
      assert.equal((verified.audit as any).verified, 1);
      assert.equal(reads, beforeReads + 1);
      assert.equal(
        inferences,
        1,
        "verification uses storage, not another inference",
      );
      assert.equal(verified.response.toolCalls.length, 0, "no replay");
    },
  );

test("memory review verifies primary writes and their final revision instead of the first receipt", async () => {
  const f = await fixture();
  const first = await f.memory.rememberRecord({
    ...args,
    kind: "fact",
    scope: "personal",
    projectId: null,
  });
  const replacement = {
    ...args,
    id: first.id,
    version: first.version,
    title: "Date précisée",
    content: "Date confirmée : 9 septembre 1982.",
  };
  const last = await f.memory.update(first.id, first.version, {
    ...replacement,
    kind: "fact",
    scope: "personal",
    projectId: null,
  });
  const writes = [
    { id: "first", name: "memory.remember", arguments: args },
    { id: "last", name: "memory.update", arguments: replacement },
  ];
  const input = {
    ...request(),
    tools: f.tools,
    messages: [
      ...request().messages,
      { role: "assistant" as const, content: "", toolCalls: writes },
      ...[first, last].map((r, i) => ({
        role: "tool" as const,
        name: writes[i].name,
        callId: writes[i].id,
        error: false,
        content: JSON.stringify(r),
      })),
    ],
  };
  let assessments = 0;
  const result = await f.review.review({
    runId: "primary",
    request: input,
    response: draft,
    provider: {
      id: "fake",
      async generate() {
        assessments++;
        return assessed([
          { action: "none", evidence: "", note: "Déjà mis à jour." },
        ]);
      },
    },
  });
  assert.equal((result.audit as any).primaryWritesVerified, 2);
  assert.equal(result.response.toolCalls.length, 0);
  assert.equal(assessments, 1);
});

test("a failed readback or concurrent memory edit cannot become a saved confirmation", async () => {
  for (const failure of ["outage", "concurrent", "write-error"] as const) {
    const f = await fixture();
    let broken = false;
    const review = new MemoryReview(
      {
        search: (q) => f.memory.search(q),
        get: (id) => {
          if (broken) throw Error("Private outage");
          return f.memory.get(id);
        },
      },
      null,
      memoryConsentPolicy,
    );
    const input = {
      runId: failure,
      request: { ...request(), tools: f.tools },
      response: draft,
      provider: {
        id: "fake",
        async generate() {
          return assessed([keep]);
        },
      },
    };
    const decision = await review.review(input),
      call = decision.response.toolCalls[0];
    let receipt = "failed";
    if (failure !== "write-error") {
      receipt = String(
        await f.tools
          .find((t) => t.name === call.name)!
          .execute(call.arguments, { workspace: "." }),
      );
      const saved = JSON.parse(receipt);
      if (failure === "concurrent")
        await f.memory.update(saved.id, saved.version, {
          ...saved,
          content: "Correction concurrente à préserver.",
        });
      else broken = true;
    }
    const result = await review.review({
      ...input,
      response: { content: "Tout est sauvegardé.", toolCalls: [] },
      evidenceMessages: [
        ...input.request.messages,
        { role: "assistant", content: "", toolCalls: [call] },
        {
          role: "tool",
          callId: call.id,
          name: call.name,
          error: failure === "write-error",
          content: receipt,
        },
      ],
    });
    assert.equal((result.audit as any).status, "unconfirmed");
    assert.match(result.revision!, /N’annonce pas/);
    assert(!JSON.stringify(result).includes("Private outage"));
    assert.equal(result.response.toolCalls.length, 0);
    if (failure === "concurrent")
      assert.equal(
        (await f.memory.list())[0].content,
        "Correction concurrente à préserver.",
      );
  }
});

test("a hard deletion is confirmed by typed absence, never by a transport failure", async () => {
  const { MemoryNotFoundError } =
    await import("../src/contracts/structured-memory.ts");
  const f = await fixture(),
    record = await f.memory.rememberRecord({
      ...args,
      kind: "fact",
      scope: "personal",
      projectId: null,
    });
  const call = {
    id: "forgot",
    name: "memory.forget",
    arguments: { id: record.id, version: record.version },
  };
  const messages = [
    { role: "user" as const, content: "Oublie ma date de naissance." },
    { role: "assistant" as const, content: "", toolCalls: [call] },
    {
      role: "tool" as const,
      name: call.name,
      callId: call.id,
      error: false,
      content: JSON.stringify({
        ...record,
        status: "forgotten",
        version: record.version + 1,
      }),
    },
  ];
  for (const absent of [true, false]) {
    let assessments = 0;
    const review = new MemoryReview(
      {
        search: async () => [],
        get: async () => {
          throw absent
            ? new MemoryNotFoundError()
            : Error("Timeout transport privé");
        },
      },
      null,
      memoryConsentPolicy,
    );
    const result = await review.review({
      request: { ...request(), messages, tools: f.tools },
      response: draft,
      provider: {
        id: "fake",
        async generate() {
          assessments++;
          return assessed([
            { action: "none", evidence: "", note: "Oubli déjà effectué." },
          ]);
        },
      },
    });
    assert.equal(assessments, absent ? 1 : 0);
    assert.equal(
      (result.audit as any).status,
      absent ? "decided" : "unconfirmed",
    );
  }
});

test("canonical current-turn memory receipts survive compaction without importing unrelated file payloads", async () => {
  const f = await fixture(),
    saved = await f.memory.rememberRecord({
      ...args,
      kind: "fact",
      scope: "personal",
      projectId: null,
    });
  const input = {
    ...request(),
    tools: f.tools,
    messages: [{ role: "user" as const, content: phrase }],
  };
  const result = await f.review.review({
    request: input,
    response: draft,
    evidenceMessages: [
      ...input.messages,
      {
        role: "tool",
        name: "memory.remember",
        callId: "already",
        error: false,
        content: JSON.stringify(saved),
      },
      {
        role: "tool",
        name: "files.read",
        callId: "file",
        error: false,
        content: "PRIVATE_UNRELATED_BODY",
      },
    ],
    provider: {
      id: "fake",
      async generate(r) {
        const data = JSON.parse(r.messages[0].content);
        assert.equal(data.currentTurnResults.length, 1);
        assert(!JSON.stringify(r).includes("PRIVATE_UNRELATED_BODY"));
        return assessed([
          {
            action: "known",
            evidence: args.content,
            note: "Déjà conservé.",
            arguments: { id: saved.id, version: saved.version },
          },
        ]);
      },
    },
  });
  assert.equal(result.response.toolCalls.length, 0);
});

test("project memories use the bound project ID rather than requiring a nonexistent tool argument", async () => {
  const { memory } = structuredMemoryFixture(),
    projectId = "00000000-0000-4000-8000-000000000031";
  const review = new MemoryReview(memory, projectId, memoryConsentPolicy),
    tools = structuredMemoryTools(memory, projectId);
  const input = {
    request: {
      ...request("Pour ce projet, nous choisissons PostgreSQL."),
      tools,
    },
    response: draft,
    provider: {
      id: "fake",
      async generate() {
        return assessed([
          {
            ...keep,
            evidence: "Pour ce projet, nous choisissons PostgreSQL.",
            arguments: {
              title: "Base choisie",
              content: "PostgreSQL est retenu pour ce projet.",
              kind: "decision",
              scope: "project",
            },
          },
        ]);
      },
    },
  };
  const result = await review.review(input);
  const call = result.response.toolCalls[0],
    stored = await tools
      .find((t) => t.name === call.name)!
      .execute(call.arguments, { workspace: "." });
  assert.equal(JSON.parse(String(stored)).projectId, projectId);
});

test("a failed assessment still verifies memory written during primary recovery without a second assessment", async () => {
  const { Engine } = await import("../src/core/engine.ts"),
    f = await fixture(),
    events: any[] = [];
  let assessments = 0,
    primary = 0;
  const engine = new Engine(
    {
      async read() {
        return [...events];
      },
      async append(_id, e) {
        events.push(e);
      },
    },
    f.tools,
    undefined,
    f.review,
  );
  const result = await engine.run({
    sessionId: "recovery-readback",
    prompt: phrase,
    workspace: ".",
    displayName: "QA",
    permissions: new Set(["memory.read", "memory.write"]),
    provider: {
      id: "fake",
      async generate(r): Promise<ModelResponse> {
        if (r.tools.some((t) => t.name === "memory.assess")) {
          assessments++;
          throw Error("Private assessment outage");
        }
        primary++;
        if (primary === 2) {
          assert.match(r.instructions, /Le contrôle a échoué/);
          return {
            content: "",
            toolCalls: [
              {
                id: "recovery-write",
                name: "memory.remember",
                arguments: args,
              },
            ],
          };
        }
        return {
          content: primary === 1 ? "Tu as 44 ans." : "La date est enregistrée.",
          toolCalls: [],
        };
      },
    },
  });
  const audits = events
    .filter((e) => e.type === "run.progress" && e.data.review === "memory")
    .map((e) => e.data.audit);
  assert.equal(audits[0].status, "failed");
  assert.equal(audits.at(-1).status, "verified");
  assert.equal(audits.at(-1).writes, 1);
  assert.equal(assessments, 1);
  assert.equal((await f.memory.list()).length, 1);
  assert.match(result.text, /enregistrée/);
  assert(!JSON.stringify(events).includes("Private assessment outage"));
});
