import type { Json } from "../src/contracts/json.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  ProjectManagement,
  ProjectManagementError,
} from "../src/app/project-management.ts";
import { projectTrackingFixture } from "./project-tracking.fixture.ts";
import { McpProjectsRepository } from "../src/modules/storage/mcp-projects/index.ts";

test("project tracking maps native MCP fields, real counts and pagination independently from memory", async () => {
  const f = projectTrackingFixture(),
    app = new ProjectManagement(f.repository, f.repository),
    id = f.project.id;
  assert.equal((await app.list()).projects[0].objective, f.project.objective);
  const goal = await app.saveItem(id, {
    kind: "goal",
    title: "Version utilisable",
    status: "active",
    operationId: randomUUID(),
  });
  const task = await app.saveItem(id, {
    kind: "task",
    title: "Tester le parcours",
    parentId: goal.id,
    status: "todo",
    operationId: randomUUID(),
  });
  assert.equal(task.parentId, goal.id);
  const [first, parallel] = await Promise.all([
    f.repository.overview(id, undefined, 1),
    f.repository.overview(id, undefined, 1),
  ]);
  assert.equal(f.calls.filter((c) => c.name === "projects_overview").length, 2);
  parallel.project.title = "Only a local mutation";
  assert.notEqual(first.project.title, parallel.project.title);
  assert.equal(first.items.length, 1);
  assert(first.nextCursor);
  assert.equal(
    first.statistics.reduce((n, s) => n + s.count, 0),
    2,
  );
  const second = await app.get(id, first.nextCursor!);
  assert.equal(second.items[0].id, task.id);
  await assert.rejects(
    app.saveItem(id, {
      id: goal.id,
      kind: "goal",
      title: goal.title,
      status: "completed",
      version: 1,
      evidence: "Test",
      successCriteria: "Parcours réussi",
    }),
    { code: "INVALID" },
  );
  await app.saveItem(id, {
    id: task.id,
    kind: "task",
    title: task.title,
    status: "done",
    version: 1,
    evidence: "Parcours réussi",
    successCriteria: "Boutons utilisables",
  });
  await app.saveItem(id, {
    id: goal.id,
    kind: "goal",
    title: goal.title,
    status: "completed",
    version: 1,
    evidence: "Parcours réussi",
    successCriteria: "Parcours réussi",
  });
  const overview = await app.get(id);
  assert.equal(
    overview.statistics.find((s) => s.kind === "goal")?.documented,
    1,
  );
  const updated = await app.update(id, {
    version: 1,
    title: "Nouveau nom",
    status: "completed",
    evidence: "Tests exécutés",
    successCriteria: "Parcours réussi",
  });
  assert.equal(updated.title, "Nouveau nom");
  assert.equal(f.calls.at(-1)?.name, "projects_update");
  assert.equal(f.calls.at(-1)?.args.name, "Nouveau nom");
});

test("project edits preserve conflicts, reject wrong-project items and malformed inputs without writing", async () => {
  const f = projectTrackingFixture(),
    app = new ProjectManagement(f.repository, f.repository),
    id = f.project.id;
  const item = await app.saveItem(id, {
    kind: "task",
    title: "Étape",
    operationId: randomUUID(),
  });
  for (const change of [
    { kind: "goal", title: "Bad", id: item.id, version: 1 },
    {
      kind: "task",
      title: "Bad",
      id: item.id,
      version: 1,
      projectId: randomUUID(),
    },
  ]) {
    const before = f.calls.filter((c) => c.name.endsWith("update")).length;
    await assert.rejects(
      app.saveItem("projectId" in change ? change.projectId! : id, change),
      ProjectManagementError,
    );
    assert.equal(
      f.calls.filter((c) => c.name.endsWith("update")).length,
      before,
    );
  }
  for (const body of [
    { kind: "task", title: "", operationId: randomUUID() },
    {
      kind: "task",
      title: "Test",
      status: "completed",
      operationId: randomUUID(),
    },
    { kind: "task", title: "Test", parentId: "Bad", operationId: randomUUID() },
  ])
    await assert.rejects(app.saveItem(id, body), ProjectManagementError);
  f.conflict();
  await assert.rejects(
    app.saveItem(id, {
      kind: "task",
      id: item.id,
      title: "Nouveau",
      version: 1,
    }),
    { code: "CONFLICT" },
  );
  assert.equal(f.items.get(item.id)?.title, "Étape");
  f.offline(true);
  await assert.rejects(app.get(id), { code: "UNAVAILABLE" });
  assert.equal(f.project.title, "Projet de démonstration");
});

test("remote project tracking validates returned item/status and counter shapes", async () => {
  const invalid = new McpProjectsRepository(async () => ({ id: randomUUID() }));
  await assert.rejects(invalid.getItem(randomUUID()), /élément incompatible/);
  const f = projectTrackingFixture(),
    overview = await f.repository.overview(f.project.id);
  const { title, ...project } = overview.project;
  for (const extra of [
    { statistics: [{ kind: "task", status: "done", count: 1, documented: 2 }] },
    { items: [{ id: "bad" }] },
    { asOf: null },
  ]) {
    const r = new McpProjectsRepository(
      async () =>
        ({
          ...overview,
          project: { ...project, name: title },
          ...extra,
        }) as never,
    );
    await assert.rejects(r.overview(f.project.id), /incompatible/);
  }
});

test("each project turn receives a fresh compact overview and a failure never masquerades as read progress", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises"),
    { tmpdir } = await import("node:os"),
    path = await import("node:path");
  const { conversationFixture } = await import("./conversation-fixture.ts");
  const root = await mkdtemp(path.join(tmpdir(), "heart-project-context-")),
    f = projectTrackingFixture(),
    prompts: string[] = [];
  await new ProjectManagement(f.repository, f.repository).saveItem(
    f.project.id,
    {
      kind: "goal",
      title: "Detailed objective not injected",
      details: "Large details not injected",
      operationId: randomUUID(),
    },
  );
  const conversations = await conversationFixture(
    root,
    () => ({
      id: "synthetic",
      async generate(request) {
        prompts.push(request.instructions);
        return { content: "Travail réalisé", toolCalls: [] };
      },
    }),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    f.repository,
    f.repository,
  );
  try {
    const id = (
      await conversations.service.create({
        title: "Suivi",
        projectId: f.project.id,
      })
    ).conversation.id;
    await conversations.service.send(id, {
      provider: "demo",
      prompt: "Continue",
      contextWindow: 32768,
    });
    f.project.nextAction = "New remote next action";
    await conversations.service.send(id, {
      provider: "demo",
      prompt: "Continue",
      contextWindow: 32768,
    });
    f.offline(true);
    await conversations.service.send(id, {
      provider: "demo",
      prompt: "Continue",
      contextWindow: 32768,
    });
    assert(prompts[0].includes(f.project.objective!));
    assert(prompts[0].includes("outils Projets"));
    assert(!prompts[0].includes("Detailed objective not injected"));
    assert(!prompts[0].includes("Large details not injected"));
    assert(prompts[1].includes("New remote next action"));
    assert(prompts[2].includes("Suivi MCP du projet indisponible"));
    assert(!prompts[2].includes("New remote next action"));
    assert(
      f.calls
        .filter((c) => c.name === "projects_overview")
        .every((c) => c.args.limit === 1),
    );
  } finally {
    await conversations.storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a project read after an acknowledged write never joins an older in-flight snapshot", async () => {
  const id = randomUUID();
  let version = 1,
    nextAction = "Ancienne étape",
    calls = 0,
    release!: () => void;
  const repository = new McpProjectsRepository(
    async (name, args): Promise<Json> => {
      if (name === "projects_update") {
        version++;
        nextAction = String(args.nextAction);
        return { id, name: "Projet", version, status: "active", nextAction };
      }
      const project = {
        id,
        name: "Projet",
        version,
        status: "active",
        nextAction,
      };
      if (++calls === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return {
        project,
        items: [],
        statistics: [],
        nextCursor: null,
        asOf: new Date().toISOString(),
      };
    },
  );
  const old = repository.overview(id);
  try {
    await repository.update(id, 1, { nextAction: "Étape ACTUELLE" });
    const fresh = repository.overview(id);
    assert.equal(calls, 2);
    assert.equal((await fresh).project.nextAction, "Étape ACTUELLE");
  } finally {
    release();
    await old;
  }
  assert.equal((await old).project.nextAction, "Ancienne étape");
});
