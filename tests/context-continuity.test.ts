import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/core/engine.ts";
import {
  BoundedContext,
  estimateTokens,
} from "../src/modules/context/bounded/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { withProjectContext } from "../src/app/project-context.ts";
import { ProjectManagement } from "../src/app/project-management.ts";
import { projectTrackingFixture } from "./project-tracking.fixture.ts";
import type { Message } from "../src/contracts/messages.ts";
import type { ModelRequest, ModelProvider } from "../src/contracts/models.ts";
import type { Json } from "../src/contracts/json.ts";
import type { Tool } from "../src/contracts/tools.ts";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "heart-continuity-"));
  const storage = await openJsonStorage(directory);
  return {
    directory,
    storage,
    async close() {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function seed(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  messages: Message[],
) {
  for (const message of messages)
    await f.storage.sessions.append(id, {
      id: randomUUID(),
      runId: randomUUID(),
      at: new Date().toISOString(),
      type: "message",
      data: message as unknown as Json,
    });
}
function completeBatches(request: ModelRequest) {
  for (const m of request.messages)
    if (m.role === "assistant")
      for (const c of m.toolCalls)
        assert(
          request.messages.some(
            (result) => result.role === "tool" && result.callId === c.id,
          ),
          "No orphan tool result/call in provider requests",
        );
}
const limits = { contextWindow: 8192, reserveTokens: 1024 };

test("one long tool turn compacts complete batches, keeps the active goal and never replays effects after restart", async () => {
  const f = await fixture();
  try {
    let actions = 0,
      primary = 0,
      summaries = 0;
    const id = randomUUID(),
      goal = "Continuer le projet GOAL-271 sans rejouer les opérations.";
    const effect: Tool = {
      name: "test.work",
      description: "Travail",
      parameters: { type: "object" },
      permission: "files.write",
      async execute() {
        actions++;
        return `ACTION_${actions} accomplie. ` + "donnée ".repeat(1100);
      },
    };
    const model: ModelProvider = {
      id: "synthetic",
      async generate(request) {
        assert(
          estimateTokens(request) <=
            limits.contextWindow - limits.reserveTokens,
        );
        completeBatches(request);
        if (!request.tools.length) {
          summaries++;
          return {
            content:
              "Objectif GOAL-271. Les actions déjà accomplies ne doivent pas être rejouées. Continuer les étapes restantes.",
            toolCalls: [],
          };
        }
        primary++;
        assert(request.instructions.includes("test.work"));
        assert.equal(
          request.messages.findLast((m) => m.role === "user")?.content,
          goal,
        );
        return primary <= 7
          ? {
              content: "",
              toolCalls: [
                { id: randomUUID(), name: "test.work", arguments: {} },
              ],
            }
          : { content: "Travail vérifié.", toolCalls: [] };
      },
    };
    await new Engine(
      f.storage.sessions,
      [effect],
      new BoundedContext(f.storage.sessions),
    ).run({
      sessionId: id,
      prompt: goal,
      provider: model,
      displayName: "Nora",
      workspace: f.directory,
      permissions: new Set(["files.write"]),
      maxSteps: 12,
      ...limits,
    });
    assert.equal(actions, 7);
    assert(summaries > 0);
    const history = await f.storage.sessions.read(id);
    assert(history.some((e) => e.type === "context.checkpoint"));
    assert.equal(history.filter((e) => e.type === "tool.finished").length, 7);
    await new Engine(
      f.storage.sessions,
      [],
      new BoundedContext(f.storage.sessions),
    ).run({
      sessionId: id,
      prompt: "Quel résultat ?",
      provider: {
        id: "different-brain",
        async generate(r) {
          assert(r.instructions.includes("GOAL-271"));
          assert(r.instructions.includes("aucun"));
          return { content: "Sept actions accomplies.", toolCalls: [] };
        },
      },
      displayName: "Nora",
      workspace: f.directory,
      permissions: new Set(),
      ...limits,
    });
    assert.equal(actions, 7);
  } finally {
    await f.close();
  }
});

test("a checkpoint larger than the new model window is recondensed without losing source fragments or duplicating journal messages", async () => {
  const f = await fixture();
  try {
    const id = randomUUID(),
      messages: Message[] = [
        { role: "user", content: "Objectif de départ" },
        { role: "assistant", content: "Résultat historique", toolCalls: [] },
        { role: "user", content: "Continue" },
      ];
    await seed(f, id, messages);
    const events = await f.storage.sessions.read(id),
      previous = "CODE-EXACT-93 " + "Détails utiles à préserver. ".repeat(2000),
      segmentId = randomUUID();
    await f.storage.sessions.append(id, {
      id: randomUUID(),
      runId: randomUUID(),
      at: new Date().toISOString(),
      type: "context.checkpoint",
      data: {
        version: 1,
        segmentId,
        parentSegmentId: null,
        coveredMessages: 2,
        summary: previous,
        providerId: "large",
        sourceEventId: events[1].id,
      },
    });
    const parts: { offset: number; content: string }[] = [];
    let calls = 0;
    const options = {
      sessionId: id,
      runId: randomUUID(),
      request: {
        instructions: "Consignes courantes. Outils actuels uniquement.",
        messages,
        tools: [],
      },
      contextWindow: 4096,
      reserveTokens: 1024,
      provider: {
        id: "small",
        async generate(request: ModelRequest) {
          calls++;
          assert(estimateTokens(request) <= 3072);
          const input = JSON.parse(request.messages[0].content);
          for (const fragment of input.fragments || []) parts.push(fragment);
          return {
            content:
              "CODE-EXACT-93. Objectif et résultat historique conservés.",
            toolCalls: [],
          };
        },
      },
    };
    const context = new BoundedContext(f.storage.sessions),
      result = await context.prepare(options);
    assert(calls > 1);
    assert.equal(
      parts
        .sort((a, b) => a.offset - b.offset)
        .map((p) => p.content)
        .join(""),
      previous,
    );
    assert(result.instructions.includes("CODE-EXACT-93"));
    assert.equal(result.messages.at(-1)?.content, "Continue");
    const after = await f.storage.sessions.read(id);
    assert.equal(after.filter((e) => e.type === "message").length, 3);
    const checkpoints = after.filter((e) => e.type === "context.checkpoint");
    assert.equal((checkpoints.at(-1)!.data as any).parentSegmentId, segmentId);
    assert.equal((checkpoints.at(-1)!.data as any).coveredMessages, 2);
    const before = calls;
    await new BoundedContext(f.storage.sessions).prepare(options);
    assert.equal(calls, before);
  } finally {
    await f.close();
  }
});

test("an oversized historical batch is paged as inert summary data, not broken provider tool calls", async () => {
  const f = await fixture();
  try {
    const id = randomUUID(),
      messages: Message[] = [
        { role: "user", content: "Travail ancien" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "one", name: "test.old", arguments: {} },
            { id: "two", name: "test.old", arguments: {} },
          ],
        },
        {
          role: "tool",
          name: "test.old",
          callId: "one",
          error: false,
          content: "FIRST_BOUNDARY " + "A".repeat(24000),
        },
        {
          role: "tool",
          name: "test.old",
          callId: "two",
          error: false,
          content: "SECOND_BOUNDARY " + "B".repeat(24000),
        },
        { role: "user", content: "Continue avec les résultats" },
      ];
    await seed(f, id, messages);
    const parts: { offset: number; content: string }[] = [];
    const result = await new BoundedContext(f.storage.sessions).prepare({
      sessionId: id,
      runId: randomUUID(),
      request: { instructions: "Consignes", messages, tools: [] },
      contextWindow: 4096,
      reserveTokens: 1024,
      provider: {
        id: "small",
        async generate(request) {
          assert(estimateTokens(request) <= 3072);
          const data = JSON.parse(request.messages[0].content);
          for (const part of data.fragments || []) parts.push(part);
          return {
            content:
              "Deux résultats reçus, FIRST_BOUNDARY et SECOND_BOUNDARY. Ne pas rejouer.",
            toolCalls: [],
          };
        },
      },
    });
    const raw = parts
      .sort((a, b) => a.offset - b.offset)
      .map((p) => p.content)
      .join("");
    assert(raw.includes("FIRST_BOUNDARY"));
    assert(raw.includes("SECOND_BOUNDARY"));
    assert(result.instructions.includes("SECOND_BOUNDARY"));
    assert.equal(
      result.messages.at(-1)?.content,
      "Continue avec les résultats",
    );
    assert.deepEqual(
      (await f.storage.sessions.read(id))
        .filter((e) => e.type === "message")
        .map((e) => e.data),
      messages,
    );
  } finally {
    await f.close();
  }
});

test("transient arguments/results remain available to the primary model but never enter compression or its persisted checkpoint", async () => {
  const f = await fixture();
  try {
    const id = randomUUID(),
      secret = "SYNTHETIC_SECRET_DO_NOT_PERSIST_7831";
    let step = 0,
      summaries = 0,
      sawSecret = false;
    const tools: Tool[] = [
      {
        name: "test.private",
        transient: true,
        description: "Privé",
        parameters: { type: "object" },
        permission: "external.read",
        async execute() {
          return secret;
        },
      },
      {
        name: "test.work",
        description: "Travailler",
        parameters: { type: "object" },
        permission: "files.read",
        async execute() {
          return "Résultat normal " + "donnée ".repeat(1100);
        },
      },
    ];
    const provider: ModelProvider = {
      id: "synthetic",
      async generate(request) {
        if (!request.tools.length) {
          summaries++;
          assert(!JSON.stringify(request).includes(secret));
          return {
            content:
              "Travail poursuivi, résultat privé non conservé : relire sa source si nécessaire.",
            toolCalls: [],
          };
        }
        if (JSON.stringify(request.messages).includes(secret)) sawSecret = true;
        if (step++ === 0)
          return {
            content: "",
            toolCalls: [
              {
                id: randomUUID(),
                name: "test.private",
                arguments: { value: secret },
              },
            ],
          };
        if (step <= 7)
          return {
            content: "",
            toolCalls: [{ id: randomUUID(), name: "test.work", arguments: {} }],
          };
        return {
          content: "Travail terminé sans recopier le résultat privé.",
          toolCalls: [],
        };
      },
    };
    await new Engine(
      f.storage.sessions,
      tools,
      new BoundedContext(f.storage.sessions),
    ).run({
      sessionId: id,
      prompt: "Effectue le travail autorisé.",
      provider,
      displayName: "Nora",
      workspace: f.directory,
      permissions: new Set(["external.read", "files.read"]),
      maxSteps: 12,
      ...limits,
    });
    assert(sawSecret);
    assert(summaries > 0);
    assert(!JSON.stringify(await f.storage.sessions.read(id)).includes(secret));
  } finally {
    await f.close();
  }
});

test("short corrections are searched first; memory failures are explicit and do not masquerade as an empty store", async () => {
  const f = await fixture();
  try {
    let query = "";
    const messages: Message[] = [
      { role: "user", content: "Développons une architecture PostgreSQL" },
      { role: "assistant", content: "Compris", toolCalls: [] },
      { role: "user", content: "Irène" },
    ];
    const options = {
      sessionId: randomUUID(),
      runId: randomUUID(),
      request: {
        instructions: "Consignes",
        messages,
        tools: [
          {
            name: "memory.search",
            description: "Chercher",
            parameters: { type: "object" },
          },
        ],
      },
      provider: {
        id: "unused",
        async generate() {
          throw Error("No compression expected");
        },
      },
      ...limits,
    };
    const memory = {
      async remember() {
        throw Error("unused");
      },
      async search(value: string) {
        query = value;
        throw Error("Synthetic outage");
      },
    };
    const result = await new BoundedContext(f.storage.sessions, memory).prepare(
      options,
    );
    assert(query.startsWith("Irène"));
    assert(result.instructions.includes("Mémoire active indisponible"));
    assert(!result.instructions.includes("aucun souvenir pertinent"));
  } finally {
    await f.close();
  }
});

test("fresh versions remain identifiable even when a memory fact already appears in a summary or a message", async () => {
  const f = await fixture();
  try {
    const id = randomUUID(),
      content = "Profession : développeur informatique.";
    const result = await new BoundedContext(f.storage.sessions, {
      async remember() {
        throw Error("unused");
      },
      async search() {
        return [{ id, version: 3, title: "Profession", content }];
      },
    }).prepare({
      sessionId: randomUUID(),
      runId: randomUUID(),
      request: {
        instructions: "Consignes",
        messages: [
          { role: "assistant", content, toolCalls: [] },
          { role: "user", content: "Continue" },
        ],
        tools: [],
      },
      provider: {
        id: "unused",
        async generate() {
          throw Error("No compression");
        },
      },
      ...limits,
    });
    assert(result.instructions.includes(`[${id} v3]`));
    assert(result.instructions.includes("version active relue"));
    assert(!result.instructions.includes(content));
  } finally {
    await f.close();
  }
});

test("project state is reread after each tool effect and remains current across a mid-turn checkpoint", async () => {
  const f = await fixture(),
    tracking = projectTrackingFixture(),
    manager = new ProjectManagement(tracking.repository, tracking.repository);
  try {
    const item = await manager.saveItem(tracking.project.id, {
      kind: "task",
      title: "Étape réelle",
      operationId: randomUUID(),
    });
    let step = 0,
      summaries = 0;
    const tool: Tool = {
      name: "test.advance",
      description: "Documenter une étape puis poursuivre",
      permission: "external.write",
      parameters: { type: "object" },
      async execute() {
        if (step === 1) {
          await manager.saveItem(tracking.project.id, {
            id: item.id,
            kind: "task",
            title: item.title,
            status: "done",
            version: 1,
            successCriteria: "Résultat obtenu",
            evidence: "Résultat vérifié par le test",
          });
          tracking.project.nextAction = "Suite ACTUELLE";
        }
        return "Résultat de travail " + "texte ".repeat(1100);
      },
    };
    const provider: ModelProvider = {
      id: "synthetic",
      async generate(request) {
        if (!request.tools.length) {
          summaries++;
          return {
            content:
              "Ancien plan historique. Poursuivre sans rejouer les effets.",
            toolCalls: [],
          };
        }
        if (step > 0) {
          assert(request.instructions.includes("Suite ACTUELLE"));
          const line = request.instructions
            .split("\n")
            .find((l) => l.startsWith("État du projet lu"))!;
          assert(line.includes('"status":"done","count":1,"documented":1'));
        }
        return step++ < 6
          ? {
              content: "",
              toolCalls: [
                { id: randomUUID(), name: "test.advance", arguments: {} },
              ],
            }
          : { content: "Étape documentée, suite connue.", toolCalls: [] };
      },
    };
    await new Engine(
      f.storage.sessions,
      [tool],
      withProjectContext(
        new BoundedContext(f.storage.sessions),
        tracking.repository,
        tracking.project.id,
        "Suivi : état courant avant résumés.",
      ),
    ).run({
      sessionId: randomUUID(),
      prompt: "Avance et documente le résultat.",
      provider,
      displayName: "Nora",
      workspace: f.directory,
      permissions: new Set(["external.write"]),
      maxSteps: 10,
      ...limits,
    });
    assert(summaries > 0);
    assert.equal(tracking.items.get(item.id)?.status, "done");
    assert(
      tracking.calls.filter((c) => c.name === "projects_overview").length >= 7,
    );
  } finally {
    await f.close();
  }
});

test("revoked MCP source disappears from the next inventory and cannot execute the rest of its pending batch", async () => {
  const { ToolUnavailableError } = await import("../src/contracts/tools.ts");
  const f = await fixture();
  try {
    let attempts = 0,
      forbidden = 0,
      local = 0,
      step = 0;
    const tools: Tool[] = [
      {
        name: "remote.one",
        description: "Premier outil",
        parameters: { type: "object" },
        permission: "external.write",
        async execute() {
          attempts++;
          throw new ToolUnavailableError(["remote.one", "remote.two"]);
        },
      },
      {
        name: "remote.two",
        description: "Second outil",
        parameters: { type: "object" },
        permission: "external.write",
        async execute() {
          forbidden++;
          return "Must not run";
        },
      },
      {
        name: "local.safe",
        description: "Outil restant",
        parameters: { type: "object" },
        permission: "files.read",
        async execute() {
          local++;
          return "Lecture accomplie";
        },
      },
    ];
    await new Engine(
      f.storage.sessions,
      tools,
      new BoundedContext(f.storage.sessions),
    ).run({
      sessionId: randomUUID(),
      displayName: "Nora",
      workspace: f.directory,
      prompt: "Poursuis avec les outils autorisés.",
      permissions: new Set(["external.write", "files.read"]),
      maxSteps: 5,
      ...limits,
      provider: {
        id: "synthetic",
        async generate(r) {
          const inventory = r.instructions
            .split("\n")
            .find((l) => l.startsWith("Inventaire effectif"))!;
          if (step++ === 0) {
            assert(inventory.includes("remote.two"));
            return {
              content: "",
              toolCalls: [
                { id: randomUUID(), name: "remote.one", arguments: {} },
                { id: randomUUID(), name: "remote.two", arguments: {} },
              ],
            };
          }
          assert(!inventory.includes("remote."));
          assert.deepEqual(
            r.tools.map((t) => t.name),
            ["local.safe"],
          );
          return step === 2
            ? {
                content: "",
                toolCalls: [
                  { id: randomUUID(), name: "local.safe", arguments: {} },
                ],
              }
            : {
                content:
                  "Lecture accomplie ; les outils distants ont été retirés.",
                toolCalls: [],
              };
        },
      },
    });
    assert.equal(attempts, 1);
    assert.equal(forbidden, 0);
    assert.equal(local, 1);
  } finally {
    await f.close();
  }
});

test("interactive pause after compaction resumes once with the same user goal and current inventory", async () => {
  const { interactionTools } =
    await import("../src/modules/tools/interactions/index.ts");
  const f = await fixture();
  try {
    const id = randomUUID();
    let work = 0,
      step = 0;
    const workTool: Tool = {
      name: "test.work",
      description: "Travail",
      parameters: { type: "object" },
      permission: "files.read",
      async execute() {
        work++;
        return "Résultat de travail " + "texte ".repeat(1100);
      },
    };
    const options = {
      sessionId: id,
      prompt: "Avance vers GOAL-INTERACTION puis demande le choix manquant.",
      displayName: "Nora",
      workspace: f.directory,
      permissions: new Set(["files.read" as const, "user.input" as const]),
      maxSteps: 12,
      ...limits,
    };
    const provider: ModelProvider = {
      id: "synthetic",
      async generate(r) {
        if (!r.tools.length)
          return {
            content:
              "Objectif GOAL-INTERACTION. Opérations accomplies, choix encore attendu.",
            toolCalls: [],
          };
        if (step++ < 6)
          return {
            content: "",
            toolCalls: [{ id: randomUUID(), name: "test.work", arguments: {} }],
          };
        return {
          content: "",
          toolCalls: [
            {
              id: randomUUID(),
              name: "interactions.request_input",
              arguments: {
                title: "Choix nécessaire",
                questions: [
                  {
                    id: "choice",
                    label: "Quelle option ?",
                    type: "single",
                    options: [
                      { id: "one", label: "Un" },
                      { id: "two", label: "Deux" },
                    ],
                  },
                ],
              },
            },
          ],
        };
      },
    };
    const first = await new Engine(
      f.storage.sessions,
      [workTool, ...interactionTools()],
      new BoundedContext(f.storage.sessions),
    ).run({ ...options, provider });
    assert(first.waitingFor);
    assert.equal(work, 6);
    assert(
      (await f.storage.sessions.read(id)).some(
        (e) => e.type === "context.checkpoint",
      ),
    );
    let continuations = 0;
    const resume = {
      requestId: first.waitingFor,
      response: { status: "answered" as const, answers: { choice: "one" } },
    };
    const continuation: ModelProvider = {
      id: "other-brain",
      async generate(r) {
        if (!r.tools.length)
          return {
            content:
              "GOAL-INTERACTION, six opérations accomplies. Choix one reçu.",
            toolCalls: [],
          };
        continuations++;
        assert(
          r.messages.some(
            (m) => m.role === "user" && m.content.includes("GOAL-INTERACTION"),
          ),
        );
        assert(
          r.messages.some(
            (m) =>
              m.role === "tool" &&
              m.name === "interactions.request_input" &&
              m.content.includes("one"),
          ),
        );
        return {
          content: "Choix reçu, six opérations conservées.",
          toolCalls: [],
        };
      },
    };
    const engine = new Engine(
      f.storage.sessions,
      [workTool, ...interactionTools()],
      new BoundedContext(f.storage.sessions),
    );
    await engine.run({
      ...options,
      prompt: "",
      resume,
      provider: continuation,
    });
    await engine.run({
      ...options,
      prompt: "",
      resume,
      provider: continuation,
    });
    assert.equal(work, 6);
    assert.equal(continuations, 1);
  } finally {
    await f.close();
  }
});

test("a checkpoint inside an unresolved batch is rejected before inference and current lookup diagnostics contain no memory content", async () => {
  const f = await fixture();
  try {
    const id = randomUUID(),
      messages: Message[] = [
        { role: "user", content: "Objectif" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call", name: "test.work", arguments: {} }],
        },
        {
          role: "tool",
          callId: "call",
          name: "test.work",
          content: "Résultat",
          error: false,
        },
        { role: "user", content: "Continue" },
      ];
    await seed(f, id, messages);
    const events = await f.storage.sessions.read(id);
    await f.storage.sessions.append(id, {
      id: randomUUID(),
      runId: randomUUID(),
      at: new Date().toISOString(),
      type: "context.checkpoint",
      data: {
        version: 1,
        segmentId: randomUUID(),
        parentSegmentId: null,
        coveredMessages: 2,
        summary: "Résumé invalide",
        providerId: "synthetic",
        sourceEventId: events[1].id,
      },
    });
    let calls = 0;
    await assert.rejects(
      new BoundedContext(f.storage.sessions).prepare({
        sessionId: id,
        runId: randomUUID(),
        request: { instructions: "Consignes", messages, tools: [] },
        provider: {
          id: "synthetic",
          async generate() {
            calls++;
            return { content: "Never", toolCalls: [] };
          },
        },
        ...limits,
      }),
      /milieu d’un lot/,
    );
    assert.equal(calls, 0);
    let diagnostic: unknown;
    await new BoundedContext(f.storage.sessions, {
      async remember() {
        throw Error("unused");
      },
      async search() {
        throw Error("unavailable");
      },
    }).prepare({
      sessionId: randomUUID(),
      runId: randomUUID(),
      request: {
        instructions: "Consignes",
        messages: [{ role: "user", content: "Recherche un souvenir" }],
        tools: [],
      },
      provider: {
        id: "synthetic",
        async generate() {
          throw Error("unused");
        },
      },
      onPrepared: async (value) => {
        diagnostic = value;
      },
      ...limits,
    });
    assert.deepEqual((diagnostic as any).memoryLookup, {
      status: "unavailable",
      matches: 0,
    });
    assert.equal((diagnostic as any).coveredMessages, 0);
  } finally {
    await f.close();
  }
});
