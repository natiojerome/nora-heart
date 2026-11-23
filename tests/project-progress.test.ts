import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Engine } from "../src/core/engine.ts";
import { BoundedContext } from "../src/modules/context/bounded/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { ProjectReview } from "../src/modules/projects/review/index.ts";
import { projectProgressTools } from "../src/modules/tools/projects/index.ts";
import { projectTrackingFixture } from "./project-tracking.fixture.ts";
import { ProjectManagement } from "../src/app/project-management.ts";
import type { Tool } from "../src/contracts/tools.ts";
import type { ModelProvider, ModelResponse } from "../src/contracts/models.ts";
import type { Json } from "../src/contracts/json.ts";
const access = {
  overview: true,
  item: true,
  updateProject: true,
  createItem: true,
  updateItem: true,
};
async function fixture() {
  const directory = await mkdtemp(
      path.join(os.tmpdir(), "heart-project-writer-"),
    ),
    storage = await openJsonStorage(directory),
    remote = projectTrackingFixture();
  const tools = projectProgressTools(
    remote.repository,
    remote.project.id,
    access,
  );
  return {
    directory,
    storage,
    remote,
    tools,
    write: tools.find((t) => t.name === "projects.write")!,
    read: tools.find((t) => t.name === "projects.read")!,
    async close() {
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const common = {
  displayName: "Nora",
  contextWindow: 32768,
  reserveTokens: 4096,
  maxSteps: 10,
};

test("Heart finalizes a forgotten project update without the user asking and verifies real stored versions", async () => {
  const f = await fixture();
  try {
    const task = await new ProjectManagement(f.remote.repository).saveItem(
      f.remote.project.id,
      { kind: "task", title: "Vérifier le fichier", operationId: randomUUID() },
    );
    let worked = 0,
      primary = 0,
      decisions = 0,
      memoryChecks = 0;
    const work: Tool = {
      name: "test.work",
      description: "Vérifier le résultat",
      permission: "files.read",
      parameters: { type: "object" },
      async execute() {
        worked++;
        return "Fichier relu, résultat conforme.";
      },
    };
    const provider: ModelProvider = {
      id: "synthetic",
      async generate(r): Promise<ModelResponse> {
        if (r.tools[0]?.name === "projects.assess") {
          decisions++;
          const data = JSON.parse(r.messages[0].content);
          assert.equal(data.items[0].status, "todo");
          assert(
            data.currentTurn.some(
              (m: any) =>
                m.role === "tool" &&
                m.content === "Fichier relu, résultat conforme.",
            ),
          );
          return {
            content: "",
            toolCalls: [
              {
                id: randomUUID(),
                name: "projects.assess",
                arguments: {
                  action: "update",
                  note: "Résultat vérifié, suivi encore ancien.",
                  updates: [
                    {
                      operation: "update_item",
                      id: task.id,
                      expectedVersion: 1,
                      status: "done",
                      successCriteria: "Fichier conforme",
                      evidence: "Fichier relu et vérifié par test.work.",
                    },
                    {
                      operation: "update_project",
                      expectedVersion: 1,
                      nextAction: "Passer à la prochaine étape",
                    },
                  ],
                },
              },
            ],
          };
        }
        return primary++ === 0
          ? {
              content: "",
              toolCalls: [
                { id: randomUUID(), name: "test.work", arguments: {} },
              ],
            }
          : { content: "Le fichier est conforme.", toolCalls: [] };
      },
    };
    const memory = {
      name: "memory-test",
      failureMessage: "failed",
      async review(input: any) {
        memoryChecks++;
        return { response: input.response, audit: { status: "unchanged" } };
      },
    };
    const id = randomUUID(),
      engine = new Engine(
        f.storage.sessions,
        [...f.tools, work],
        new BoundedContext(f.storage.sessions),
        [memory, new ProjectReview(f.remote.repository, f.remote.project.id)],
      );
    await engine.run({
      ...common,
      sessionId: id,
      prompt: "Vérifie le fichier.",
      workspace: f.directory,
      permissions: new Set(["files.read", "projects.read", "projects.write"]),
      provider,
    });
    assert.equal(worked, 1);
    assert.equal(decisions, 1);
    assert.equal(memoryChecks, 1);
    assert.equal(f.remote.items.get(task.id)?.status, "done");
    assert.equal(f.remote.project.nextAction, "Passer à la prochaine étape");
    assert.equal(f.remote.project.version, 2);
    const events = await f.storage.sessions.read(id),
      audits = events
        .filter(
          (e) =>
            e.type === "run.progress" && (e.data as any).review === "projects",
        )
        .map((e) => (e.data as any).audit);
    assert.deepEqual(
      audits.map((a) => a.status),
      ["planned", "verified"],
    );
    assert.equal(audits[1].verified, 2);
    assert.equal(
      events.filter(
        (e) =>
          e.type === "tool.finished" &&
          (e.data as any).name === "projects.write",
      ).length,
      2,
    );
  } finally {
    await f.close();
  }
});

test("an informational answer produces an explicit no-change decision and no gratuitous project write", async () => {
  const f = await fixture();
  try {
    let primary = 0,
      decisions = 0;
    await new Engine(
      f.storage.sessions,
      f.tools,
      new BoundedContext(f.storage.sessions),
      new ProjectReview(f.remote.repository, f.remote.project.id),
    ).run({
      ...common,
      sessionId: randomUUID(),
      prompt: "Que signifie un objectif ?",
      workspace: f.directory,
      permissions: new Set(["projects.read", "projects.write"]),
      provider: {
        id: "synthetic",
        async generate(r): Promise<ModelResponse> {
          if (r.tools[0]?.name === "projects.assess") {
            decisions++;
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "projects.assess",
                  arguments: {
                    action: "none",
                    note: "Question informative, aucun changement de plan.",
                  },
                },
              ],
            };
          }
          primary++;
          return {
            content: "Un objectif décrit le résultat attendu.",
            toolCalls: [],
          };
        },
      },
    });
    assert.equal(primary, 1);
    assert.equal(decisions, 1);
    assert.equal(f.remote.project.version, 1);
    assert(
      !f.remote.calls.some(
        (c) =>
          c.name === "projects_update" ||
          c.name === "projects_item_update" ||
          c.name === "projects_item_create",
      ),
    );
  } finally {
    await f.close();
  }
});

test("a concurrent edit is never overwritten or silently reported as saved", async () => {
  const f = await fixture();
  try {
    let primary = 0;
    const id = randomUUID();
    const result = await new Engine(
      f.storage.sessions,
      f.tools,
      new BoundedContext(f.storage.sessions),
      new ProjectReview(f.remote.repository, f.remote.project.id),
    ).run({
      ...common,
      sessionId: id,
      prompt: "Continue le projet.",
      workspace: f.directory,
      permissions: new Set(["projects.read", "projects.write"]),
      provider: {
        id: "synthetic",
        async generate(r): Promise<ModelResponse> {
          if (r.tools[0]?.name === "projects.assess") {
            f.remote.project.version = 2;
            f.remote.project.nextAction = "Changement depuis un autre fil";
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "projects.assess",
                  arguments: {
                    action: "update",
                    note: "Prochaine étape.",
                    updates: [
                      {
                        operation: "update_project",
                        expectedVersion: 1,
                        nextAction: "Étape proposée",
                      },
                    ],
                  },
                },
              ],
            };
          }
          primary++;
          return { content: "Bilan du travail.", toolCalls: [] };
        },
      },
    });
    assert.equal(primary, 2);
    assert.equal(f.remote.project.nextAction, "Changement depuis un autre fil");
    assert(result.text.includes("n’ont pas pu être confirmées"));
    assert.equal(
      f.remote.calls.filter((c) => c.name === "projects_update").length,
      1,
    );
    assert(
      (await f.storage.sessions.read(id)).some(
        (e) =>
          e.type === "run.progress" &&
          (e.data as any).audit?.status === "unconfirmed",
      ),
    );
  } finally {
    await f.close();
  }
});

test("progress tools are project-scoped and creation carries a stable operation UUID", async () => {
  const f = await fixture();
  try {
    const context = {
      workspace: f.directory,
      runId: randomUUID(),
      callId: randomUUID(),
    };
    const args = {
      operation: "create_item",
      kind: "goal",
      title: "Un objectif",
    };
    await f.write.execute(args, context);
    await f.write.execute(args, context);
    const creates = f.remote.calls.filter(
      (c) => c.name === "projects_item_create",
    );
    assert.equal(creates[0].args.operationId, creates[1].args.operationId);
    assert.match(String(creates[0].args.operationId), /^[a-f0-9-]{14}5/);
    const item = [...f.remote.items.values()][0];
    f.remote.items.set(item.id, { ...item, projectId: randomUUID() });
    await assert.rejects(
      f.read.execute({ operation: "item", id: item.id }, context),
      /hors du projet/,
    );
    await assert.rejects(
      f.write.execute(
        {
          operation: "update_item",
          id: item.id,
          expectedVersion: 1,
          status: "completed",
        },
        context,
      ),
      /hors du projet/,
    );
    assert(!f.remote.calls.some((c) => c.name === "projects_item_update"));
    const readonly = projectProgressTools(
      f.remote.repository,
      f.remote.project.id,
      { ...access, createItem: false, updateItem: false, updateProject: false },
    );
    assert.deepEqual(
      readonly.map((t) => t.name),
      ["projects.read"],
    );
    await assert.rejects(
      f.write.execute(
        {
          operation: "update_project",
          expectedVersion: 1,
          objective: "Changer la finalité",
        },
        context,
      ),
      /invalides/,
    );
  } finally {
    await f.close();
  }
});

test("project review uses private canonical evidence without leaking transient results", async () => {
  const f = await fixture();
  try {
    const secret = "SYNTHETIC_PRIVATE_RESULT_531";
    let primary = 0,
      assessed = false;
    const tool: Tool = {
      name: "test.private",
      description: "Privé",
      permission: "files.read",
      transient: true,
      parameters: { type: "object" },
      async execute() {
        return secret;
      },
    };
    await new Engine(
      f.storage.sessions,
      [...f.tools, tool],
      new BoundedContext(f.storage.sessions),
      new ProjectReview(f.remote.repository, f.remote.project.id),
    ).run({
      ...common,
      sessionId: randomUUID(),
      prompt: "Consulte la source.",
      workspace: f.directory,
      permissions: new Set(["files.read", "projects.read", "projects.write"]),
      provider: {
        id: "synthetic",
        async generate(r): Promise<ModelResponse> {
          if (r.tools[0]?.name === "projects.assess") {
            assessed = true;
            assert(!JSON.stringify(r).includes(secret));
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "projects.assess",
                  arguments: {
                    action: "none",
                    note: "Lecture sans impact opérationnel.",
                  },
                },
              ],
            };
          }
          if (primary++ === 0)
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "test.private",
                  arguments: { secret },
                },
              ],
            };
          assert(JSON.stringify(r.messages).includes(secret));
          return { content: "Source consultée.", toolCalls: [] };
        },
      },
    });
    assert(assessed);
  } finally {
    await f.close();
  }
});

test("a review cannot update another project or accept an obsolete item version", async () => {
  const f = await fixture();
  try {
    const item = await new ProjectManagement(f.remote.repository).saveItem(
      f.remote.project.id,
      { kind: "task", title: "Étape", operationId: randomUUID() },
    );
    f.remote.items.set(item.id, { ...item, projectId: randomUUID() });
    const write = f.tools.find((t) => t.name === "projects.write")!,
      request = {
        instructions: "",
        messages: [{ role: "user" as const, content: "Continue" }],
        tools: [write],
      };
    const provider: ModelProvider = {
      id: "synthetic",
      async generate(): Promise<ModelResponse> {
        return {
          content: "",
          toolCalls: [
            {
              id: randomUUID(),
              name: "projects.assess",
              arguments: {
                action: "update",
                note: "Mettre à jour.",
                updates: [
                  {
                    operation: "update_item",
                    id: item.id,
                    expectedVersion: 1,
                    status: "done",
                    evidence: "Résultat",
                    successCriteria: "Critère",
                  },
                ],
              },
            },
          ],
        };
      },
    };
    await assert.rejects(
      new ProjectReview(f.remote.repository, f.remote.project.id).review({
        provider,
        request,
        response: { content: "Bilan", toolCalls: [] },
        contextWindow: 32768,
        reserveTokens: 4096,
      }),
      { code: "INVALID_SCOPE" },
    );
    assert(!f.remote.calls.some((c) => c.name === "projects_item_update"));
  } finally {
    await f.close();
  }
});

test("a real work failure becomes a stored blocker and next action instead of a fabricated completion", async () => {
  const f = await fixture();
  try {
    let main = 0,
      attempts = 0;
    const work: Tool = {
      name: "test.work",
      description: "Travail",
      permission: "files.read",
      parameters: { type: "object" },
      async execute() {
        attempts++;
        throw Error("Service indisponible");
      },
    };
    await new Engine(
      f.storage.sessions,
      [...f.tools, work],
      new BoundedContext(f.storage.sessions),
      new ProjectReview(f.remote.repository, f.remote.project.id),
    ).run({
      ...common,
      sessionId: randomUUID(),
      prompt: "Accomplis le travail.",
      workspace: f.directory,
      permissions: new Set(["files.read", "projects.read", "projects.write"]),
      provider: {
        id: "synthetic",
        async generate(r): Promise<ModelResponse> {
          if (r.tools[0]?.name === "projects.assess") {
            const data = JSON.parse(r.messages[0].content);
            assert(
              data.currentTurn.some((m: any) => m.role === "tool" && m.error),
            );
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "projects.assess",
                  arguments: {
                    action: "update",
                    note: "Blocage établi par l’échec réel.",
                    updates: [
                      {
                        operation: "create_item",
                        kind: "blocker",
                        title: "Service indisponible",
                        details: "Le travail a échoué sans résultat.",
                      },
                      {
                        operation: "update_project",
                        expectedVersion: 1,
                        status: "blocked",
                        nextAction: "Rétablir le service puis reprendre",
                      },
                    ],
                  },
                },
              ],
            };
          }
          return main++ === 0
            ? {
                content: "",
                toolCalls: [
                  { id: randomUUID(), name: "test.work", arguments: {} },
                ],
              }
            : { content: "Le service est indisponible.", toolCalls: [] };
        },
      },
    });
    assert.equal(attempts, 1);
    assert.equal(f.remote.project.status, "blocked");
    const blocker = [...f.remote.items.values()][0];
    assert.equal(blocker.kind, "blocker");
    assert.equal(blocker.status, "open");
    assert.equal(
      f.remote.project.nextAction,
      "Rétablir le service puis reprendre",
    );
  } finally {
    await f.close();
  }
});

test("missing project detail is inspected before an automatic update, without replaying work", async () => {
  const f = await fixture();
  try {
    const task = await new ProjectManagement(f.remote.repository).saveItem(
      f.remote.project.id,
      { kind: "task", title: "Étape", operationId: randomUUID() },
    );
    let decisions = 0;
    const id = randomUUID();
    await new Engine(
      f.storage.sessions,
      f.tools,
      new BoundedContext(f.storage.sessions),
      new ProjectReview(f.remote.repository, f.remote.project.id),
    ).run({
      ...common,
      sessionId: id,
      prompt: "Étape vérifiée, poursuis.",
      workspace: f.directory,
      permissions: new Set(["projects.read", "projects.write"]),
      provider: {
        id: "synthetic",
        async generate(r): Promise<ModelResponse> {
          if (r.tools[0]?.name === "projects.assess") {
            decisions++;
            const data = JSON.parse(r.messages[0].content);
            if (decisions === 1)
              return {
                content: "",
                toolCalls: [
                  {
                    id: randomUUID(),
                    name: "projects.assess",
                    arguments: {
                      action: "inspect",
                      note: "Relire le détail utile.",
                      requests: [{ operation: "item", id: task.id }],
                    },
                  },
                ],
              };
            assert(
              data.currentTurn.some(
                (m: any) => m.role === "tool" && m.name === "projects.read",
              ),
            );
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "projects.assess",
                  arguments: {
                    action: "update",
                    note: "Résultat confirmé.",
                    updates: [
                      {
                        operation: "update_item",
                        id: task.id,
                        expectedVersion: 1,
                        status: "done",
                        successCriteria: "Étape vérifiée",
                        evidence: "Vérification déclarée par la personne.",
                      },
                    ],
                  },
                },
              ],
            };
          }
          return { content: "Bilan.", toolCalls: [] };
        },
      },
    });
    assert.equal(decisions, 2);
    assert.equal(f.remote.items.get(task.id)?.status, "done");
    assert(
      (await f.storage.sessions.read(id)).some(
        (e) =>
          e.type === "run.progress" &&
          (e.data as any).audit?.status === "verified",
      ),
    );
  } finally {
    await f.close();
  }
});

test("project assessment receives earlier user constraints, not only the latest status question", async () => {
  const f = await fixture();
  try {
    const messages = [
      { role: "user" as const, content: "Ne clôture pas le projet global." },
      { role: "assistant" as const, content: "Compris.", toolCalls: [] },
      { role: "user" as const, content: "Quel est son état ?" },
    ];
    let checked = false;
    await new ProjectReview(f.remote.repository, f.remote.project.id).review({
      request: {
        instructions: "Instructions actives",
        messages,
        tools: f.tools,
      },
      response: { content: "État actuel.", toolCalls: [] },
      provider: {
        id: "synthetic",
        async generate(r) {
          checked = true;
          assert(
            JSON.stringify(r).includes("Ne clôture pas le projet global."),
          );
          return {
            content: "",
            toolCalls: [
              {
                id: randomUUID(),
                name: "projects.assess",
                arguments: {
                  action: "none",
                  note: "Question de consultation ; pas de changement.",
                },
              },
            ],
          };
        },
      },
    });
    assert(checked);
    assert.equal(f.remote.project.version, 1);
  } finally {
    await f.close();
  }
});

test("memory writes finish before project assessment and each review keeps its own verification lifecycle", async () => {
  const f = await fixture();
  try {
    let saved = 0,
      memoryChecks = 0,
      assessed = 0;
    const memoryTool: Tool = {
      name: "memory.remember",
      description: "Mémoriser",
      permission: "memory.write",
      parameters: { type: "object" },
      async execute() {
        saved++;
        return "Souvenir réellement enregistré.";
      },
    };
    const memory = {
      name: "memory-test",
      failureMessage: "failed",
      async review() {
        memoryChecks++;
        return {
          response: {
            content: "Je mémorise.",
            toolCalls: [
              { id: randomUUID(), name: "memory.remember", arguments: {} },
            ],
          },
          audit: { status: "planned" },
        };
      },
    };
    await new Engine(
      f.storage.sessions,
      [...f.tools, memoryTool],
      new BoundedContext(f.storage.sessions),
      [memory, new ProjectReview(f.remote.repository, f.remote.project.id)],
    ).run({
      ...common,
      sessionId: randomUUID(),
      prompt: "Profession durable.",
      workspace: f.directory,
      permissions: new Set(["memory.write", "projects.read", "projects.write"]),
      provider: {
        id: "synthetic",
        async generate(r) {
          if (r.tools[0]?.name === "projects.assess") {
            assessed++;
            assert.equal(saved, 1);
            assert(
              JSON.stringify(r).includes("Souvenir réellement enregistré."),
            );
            return {
              content: "",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "projects.assess",
                  arguments: {
                    action: "none",
                    note: "Fait personnel, aucun effet sur le projet.",
                  },
                },
              ],
            };
          }
          return { content: "Réponse.", toolCalls: [] };
        },
      },
    });
    assert.equal(memoryChecks, 1);
    assert.equal(saved, 1);
    assert.equal(assessed, 1);
    assert.equal(f.remote.project.version, 1);
  } finally {
    await f.close();
  }
});
