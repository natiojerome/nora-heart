import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { Ajv } from "ajv";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import { Calendar } from "../src/modules/scheduling/calendar/index.ts";
import { taskTools } from "../src/modules/tools/tasks/index.ts";
import { Tasks } from "../src/app/tasks.ts";
import { Engine } from "../src/core/engine.ts";
import type { Json } from "../src/contracts/json.ts";
async function fixture() {
  const root = await mkdtemp("/tmp/heart-task-tools-"),
    file = root + "/state.sqlite";
  await migrateSqlite(file);
  const storage = await openSqliteStorage(file);
  const at = "2026-11-19T06:00:00.000Z",
    conversation = {
      id: randomUUID(),
      title: "Tasks",
      selection: {
        provider: "demo" as const,
        modelId: "demo",
        contextWindow: 32768,
        capacitySource: "configured" as const,
      },
      createdAt: at,
      updatedAt: at,
    };
  await storage.conversations.create(conversation);
  const service = new Tasks(
      storage.tasks,
      new Calendar(),
      storage.conversations,
      {
        async execute() {},
        async inspect() {
          return null;
        },
      },
      () => at,
      storage.sessions,
    ),
    tools = taskTools(service, conversation.id),
    context = {
      workspace: root,
      runId: randomUUID(),
      callId: "provider-call-1",
    };
  const call = async (
    name: string,
    args: Record<string, unknown>,
    callId = context.callId,
  ) => {
    let tool = name,
      body = args;
    if (name === "tasks.get" || name === "tasks.result") tool = "tasks.read";
    else if (name !== "tasks.list") {
      tool = "tasks.write";
      const kind =
        name === "tasks.set_active"
          ? args.active
            ? "resume"
            : "pause"
          : name.slice(6);
      body = { ...args, ...((args.changes as object) ?? {}), action: kind };
      delete body.changes;
    }
    return JSON.parse(
      await tools
        .find((item) => item.name === tool)!
        .execute(body as Json, { ...context, callId }),
    );
  };
  return {
    root,
    storage,
    service,
    tools,
    context,
    call,
    conversation,
    async close() {
      await storage.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
const draft = {
  title: "My task",
  prompt: "Produce a useful result",
  schedule: {
    kind: "once",
    at: "2026-12-01T09:00",
    timezone: "Indian/Reunion",
  },
  active: false,
};
test("task tool schemas, default conversation, stable engine-call identities and optimistic updates share the application service", async () => {
  const f = await fixture();
  try {
    for (const tool of f.tools)
      new Ajv({ strict: true }).compile(tool.parameters);
    const initial = await f.call("tasks.list", {});
    assert.equal(initial.currentConversationId, f.conversation.id);
    assert.equal(initial.observedAt, "2026-11-19T06:00:00.000Z");
    const [created, same] = await Promise.all([
      f.call("tasks.create", draft),
      f.call("tasks.create", draft),
    ]);
    assert.equal(same.task.id, created.task.id);
    assert.equal((await f.service.list()).tasks.length, 1);
    assert.equal(created.task.conversationId, f.conversation.id);
    const updated = await f.call("tasks.update", {
      id: created.task.id,
      version: 1,
      changes: { title: "Updated", notify: false },
    });
    assert.equal(updated.task.prompt, draft.prompt);
    assert.equal(updated.task.version, 2);
    await assert.rejects(
      f.call("tasks.update", {
        id: created.task.id,
        version: 1,
        changes: { title: "Stale" },
      }),
      /modifiée/,
    );
    const replay = await f.call("tasks.create", draft);
    assert.equal(replay.task.title, "Updated");
    assert.equal(replay.task.version, 2);
    const active = await f.call("tasks.set_active", {
      id: created.task.id,
      version: 2,
      active: true,
    });
    assert.equal(active.task.nextAt, "2026-12-01T05:00:00.000Z");
    const queued = await f.call(
        "tasks.run_now",
        { id: created.task.id, version: 3 },
        "run-call",
      ),
      queuedAgain = await f.call(
        "tasks.run_now",
        { id: created.task.id, version: 3 },
        "run-call",
      );
    assert.equal(queued.run.id, queuedAgain.run.id);
    assert.notEqual(queued.run.id, created.task.id);
    assert.equal(queued.queued, true);
    const raw = (await f.storage.tasks.runs(created.task.id))[0];
    await f.storage.tasks.transition(raw, {
      status: "succeeded",
      detail: "Done",
    });
    assert.equal(
      (
        await f.call(
          "tasks.run_now",
          { id: created.task.id, version: 3 },
          "run-call",
        )
      ).queued,
      false,
    );
    assert.equal(
      (await f.call("tasks.get", { id: created.task.id })).runs[0].task,
      undefined,
    );
    await assert.rejects(
      f.tools
        .find((tool) => tool.name === "tasks.write")!
        .execute({ action: "create", ...draft } as Json, { workspace: f.root }),
      /Identité/,
    );
    await assert.rejects(
      f.call(
        "tasks.create",
        { ...draft, schedule: { kind: "once", at: "2026-12-01T09:00" } },
        "missing-zone",
      ),
    );
    assert.equal((await f.service.list()).tasks.length, 1);
  } finally {
    await f.close();
  }
});
test("task result follows actual resumed-run lineage, pages final messages and refuses unrelated occurrences or cursors", async () => {
  const f = await fixture();
  try {
    const task = (await f.call("tasks.create", draft)).task,
      run = (
        await f.service.runNow(task.id, {
          version: 1,
          executionId: randomUUID(),
        })
      ).run,
      requestId = randomUUID(),
      resumed = randomUUID();
    const event = (
      runId: string,
      type: any,
      data: Json,
      id = randomUUID(),
    ) => ({ id, runId, at: "2026-11-19T06:01:00.000Z", type, data });
    await f.storage.sessions.appendBatch!(f.conversation.id, [
      event(randomUUID(), "message", {
        role: "assistant",
        content: "OTHER-CONVERSATION-WORK",
      }),
      event(run.id, "run.started", {}),
      event(run.id, "message", { role: "assistant", content: "PRE-ANSWER" }),
      event(run.id, "interaction.requested", {}, requestId),
      event(resumed, "run.started", {}),
      event(resumed, "interaction.resolved", {
        requestId,
        response: { status: "answered" },
      }),
      event(resumed, "message", {
        role: "assistant",
        content: "ACTUAL-ANSWER",
      }),
      event(resumed, "run.completed", {}),
    ]);
    await f.storage.tasks.transition(run, {
      status: "succeeded",
      detail: "Completed",
    });
    const first = await f.call("tasks.result", {
      id: task.id,
      runId: run.id,
      limit: 1,
    });
    assert.equal(first.messages[0].content, "PRE-ANSWER");
    assert(first.nextCursor);
    const second = await f.call("tasks.result", {
      id: task.id,
      runId: run.id,
      after: first.nextCursor,
      limit: 1,
    });
    assert.equal(second.messages[0].content, "ACTUAL-ANSWER");
    assert.equal(second.nextCursor, null);
    assert(!JSON.stringify(first).includes("OTHER-CONVERSATION-WORK"));
    await assert.rejects(
      f.call("tasks.get", { id: task.id, after: randomUUID() }),
      /before/,
    );
    await assert.rejects(
      f.call("tasks.result", { id: task.id, runId: run.id, before: "1" }),
      /after/,
    );

    const other = (
      await f.call("tasks.create", { ...draft, title: "Other" }, "other-task")
    ).task;
    await assert.rejects(
      f.call("tasks.result", { id: other.id, runId: run.id }),
      /introuvable/,
    );
    await assert.rejects(
      f.call("tasks.result", {
        id: task.id,
        runId: run.id,
        after: randomUUID(),
      }),
      /Curseur/,
    );
  } finally {
    await f.close();
  }
});
test("engine enforces task write permission and supplies stable call identity only to authorized tools", async () => {
  const f = await fixture();
  try {
    let step = 0;
    const engine = new Engine(f.storage.sessions, f.tools);
    const options = {
      sessionId: f.conversation.id,
      prompt: "Create a task",
      displayName: "Fixture",
      workspace: f.root,
      maxSteps: 3,
      permissions: new Set<"tasks.read">(["tasks.read"]),
      provider: {
        id: "fixture",
        async generate(request: any) {
          if (step++ === 0) {
            assert(
              !request.tools.some((tool: any) => tool.name === "tasks.write"),
            );
            return {
              content: "",
              toolCalls: [
                {
                  id: "blocked",
                  name: "tasks.write",
                  arguments: { action: "create", ...draft },
                },
              ],
            };
          }
          return { content: "No write performed", toolCalls: [] };
        },
      },
    };
    await engine.run(options);
    assert.equal((await f.service.list()).tasks.length, 0);
    assert(
      (await f.storage.sessions.read(f.conversation.id)).some(
        (event) =>
          event.type === "message" &&
          (event.data as any).role === "tool" &&
          (event.data as any).error,
      ),
    );
    step = 0;
    await engine.run({
      ...options,
      permissions: new Set<"tasks.write">(["tasks.write"]),
      provider: {
        id: "fixture",
        async generate() {
          if (step++ === 0)
            return {
              content: "",
              toolCalls: [
                {
                  id: "create-in-engine",
                  name: "tasks.write",
                  arguments: { action: "create", ...draft },
                },
              ],
            };
          return { content: "Created", toolCalls: [] };
        },
      },
    });
    assert.equal((await f.service.list()).tasks.length, 1);
  } finally {
    await f.close();
  }
});
