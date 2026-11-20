import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Calendar } from "../src/modules/scheduling/calendar/index.ts";
import { Scheduler } from "../src/modules/scheduling/runner/index.ts";
import {
  TaskBusy,
  type Task,
  type TaskRun,
  type TaskExecution,
} from "../src/contracts/tasks.ts";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import { Tasks, ConversationTaskExecution } from "../src/app/tasks.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { Engine } from "../src/core/engine.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";

async function fixture() {
  const root = await mkdtemp("/tmp/heart-tasks-"),
    file = root + "/state.sqlite";
  await migrateSqlite(file);
  const storage = await openSqliteStorage(file),
    calendar = new Calendar();
  let now = "2026-11-18T04:00:00.000Z";
  const conversation = {
    id: randomUUID(),
    title: "Task context",
    createdAt: now,
    updatedAt: now,
    selection: {
      provider: "demo" as const,
      modelId: "demo",
      contextWindow: 32768,
      capacitySource: "configured" as const,
    },
  };
  await storage.conversations.create(conversation);
  return {
    root,
    file,
    storage,
    calendar,
    conversation,
    now: () => now,
    setNow: (v: string) => {
      now = v;
    },
    async close() {
      await storage.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
function input(conversationId: string) {
  return {
    version: 0,
    title: "Rapport",
    prompt: "Prépare le rapport",
    conversationId,
    schedule: {
      kind: "recurring",
      frequency: "daily",
      time: "09:00",
      timezone: "Indian/Reunion",
    },
    missed: "catch_up",
    notify: true,
    active: true,
  };
}

test("calendar keeps local wall time, weekdays and weekly rules across zones, DST gaps and repeated hours", () => {
  const c = new Calendar();
  const daily = c.validate({
    kind: "recurring",
    frequency: "daily",
    time: "09:00",
    timezone: "Indian/Reunion",
  });
  assert.equal(
    c.next(daily, "2026-11-18T04:00:00Z"),
    "2026-11-18T05:00:00.000Z",
  );
  assert.equal(
    c.next(
      c.validate({
        kind: "recurring",
        frequency: "weekdays",
        time: "09:00",
        timezone: "UTC",
      }),
      "2026-11-20T09:00:00Z",
    ),
    "2026-11-23T09:00:00.000Z",
  );
  assert.equal(
    c.next(
      c.validate({
        kind: "recurring",
        frequency: "weekly",
        weekday: 1,
        time: "09:00",
        timezone: "UTC",
      }),
      "2026-11-18T00:00:00Z",
    ),
    "2026-11-23T09:00:00.000Z",
  );
  const paris = c.validate({
    kind: "recurring",
    frequency: "daily",
    time: "02:30",
    timezone: "Europe/Paris",
  });
  assert.equal(
    c.next(paris, "2026-03-28T03:00:00Z"),
    "2026-03-29T01:30:00.000Z",
  );
  assert.equal(
    c.next(paris, "2026-10-25T00:30:00Z"),
    "2026-10-26T01:30:00.000Z",
  );
  const once = c.validate({
    kind: "once",
    at: "2026-11-18T09:00",
    timezone: "Indian/Reunion",
  });
  assert.equal(
    c.next(once, "2026-11-18T04:00:00Z"),
    "2026-11-18T05:00:00.000Z",
  );
  assert.equal(c.next(once, "2026-11-18T06:00:00Z"), null);
  for (const bad of [
    { kind: "recurring", frequency: "daily", time: "25:00", timezone: "UTC" },
    {
      kind: "recurring",
      frequency: "weekly",
      weekday: 8,
      time: "09:00",
      timezone: "UTC",
    },
    { kind: "once", at: "2026-11-18T09:00", timezone: "invented/place" },
  ])
    assert.throws(() => c.validate(bad), /Planning invalide/);
});

test("scheduler reserves once, survives reopening, preserves manual idempotence and does not shift the schedule", async () => {
  const f = await fixture();
  const outcomes = new Map<string, TaskRun["status"]>();
  let calls = 0;
  const execution: TaskExecution = {
    async execute(r) {
      calls++;
      outcomes.set(r.id, "succeeded");
    },
    async inspect(r) {
      return outcomes.has(r.id)
        ? { status: outcomes.get(r.id)!, detail: "Done" }
        : null;
    },
  };
  const tasks = new Tasks(
      f.storage.tasks,
      f.calendar,
      f.storage.conversations,
      execution,
      f.now,
    ),
    a = new Scheduler(f.storage.tasks, f.calendar, execution, { now: f.now }),
    b = new Scheduler(f.storage.tasks, f.calendar, execution, { now: f.now });
  try {
    const { task } = await tasks.save(input(f.conversation.id));
    assert.equal(task.nextAt, "2026-11-18T05:00:00.000Z");
    const id = randomUUID();
    const first = await tasks.runNow(task.id, {
        version: task.version,
        executionId: id,
      }),
      same = await tasks.runNow(task.id, {
        version: task.version,
        executionId: id,
      });
    assert.equal(first.run.id, same.run.id);
    await Promise.all([a.tick(), b.tick()]);
    await a.drain();
    await b.drain();
    assert.equal(calls, 1);
    assert.equal((await tasks.get(task.id)).task.nextAt, task.nextAt);
    f.setNow("2026-11-18T05:00:01.000Z");
    await a.tick();
    await a.drain();
    assert.equal(calls, 2);
    assert.equal(
      (await tasks.get(task.id)).task.nextAt,
      "2026-11-19T05:00:00.000Z",
    );
    await a.tick();
    assert.equal(calls, 2);
    const other = await openSqliteStorage(f.file);
    try {
      assert.equal((await other.tasks.runs(task.id)).length, 2);
    } finally {
      await other.close();
    }
  } finally {
    await a.close();
    await b.close();
    await f.close();
  }
});

test("missed occurrence policy catches up once or skips without replaying every missed day", async () => {
  const f = await fixture();
  let calls = 0;
  const done = new Set<string>(),
    execution: TaskExecution = {
      async execute(r) {
        calls++;
        done.add(r.id);
      },
      async inspect(r) {
        return done.has(r.id) ? { status: "succeeded", detail: "Done" } : null;
      },
    };
  const manager = new Tasks(
    f.storage.tasks,
    f.calendar,
    f.storage.conversations,
    execution,
    f.now,
  );
  try {
    const a = (await manager.save(input(f.conversation.id))).task,
      b = (await manager.save({ ...input(f.conversation.id), missed: "skip" }))
        .task;
    f.setNow("2026-11-25T06:00:00.000Z");
    const scheduler = new Scheduler(f.storage.tasks, f.calendar, execution, {
      now: f.now,
      concurrency: 0,
    });
    try {
      await scheduler.tick();
      await scheduler.drain();
      assert.equal(calls, 1);
      assert.equal((await manager.get(a.id)).runs[0].status, "succeeded");
      assert.equal((await manager.get(b.id)).runs[0].status, "skipped");
      assert.equal(
        (await manager.get(a.id)).task.nextAt,
        "2026-11-26T05:00:00.000Z",
      );
    } finally {
      await scheduler.close();
    }
  } finally {
    await f.close();
  }
});

test("busy conversations wait, pause cancels queued occurrences, stale edits fail and unseen results persist", async () => {
  const f = await fixture();
  let busy = true,
    calls = 0;
  const done = new Set<string>(),
    execution: TaskExecution = {
      async execute(r) {
        if (busy) throw new TaskBusy();
        calls++;
        done.add(r.id);
      },
      async inspect(r) {
        return done.has(r.id) ? { status: "succeeded", detail: "Done" } : null;
      },
    };
  const tasks = new Tasks(
      f.storage.tasks,
      f.calendar,
      f.storage.conversations,
      execution,
      f.now,
    ),
    scheduler = new Scheduler(f.storage.tasks, f.calendar, execution, {
      now: f.now,
    });
  try {
    const { task } = await tasks.save(input(f.conversation.id));
    await tasks.runNow(task.id, { version: 1, executionId: randomUUID() });
    await scheduler.tick();
    await scheduler.drain();
    assert.equal((await tasks.get(task.id)).runs[0].status, "queued");
    assert.equal(calls, 0);
    const paused = await tasks.active(task.id, { version: 1, active: false });
    assert.equal((await tasks.get(task.id)).runs[0].status, "cancelled");
    await assert.rejects(
      tasks.active(task.id, { version: 1, active: true }),
      /modifiée/,
    );
    const id = randomUUID();
    await tasks.runNow(task.id, {
      version: paused.task.version,
      executionId: id,
    });
    busy = false;
    await scheduler.tick();
    await scheduler.drain();
    assert.equal(calls, 1);
    assert.equal((await tasks.list()).unread, 1);
    const run = (await tasks.get(task.id)).runs[0];
    await tasks.acknowledge(task.id, run.id, { status: run.status });
    assert.equal((await tasks.list()).unread, 0);
    assert.equal((await tasks.get(task.id)).task.active, false);
  } finally {
    await scheduler.close();
    await f.close();
  }
});

test("reserved work without an outcome becomes interrupted and is never automatically replayed", async () => {
  const f = await fixture();
  let calls = 0;
  const execution: TaskExecution = {
      async execute() {
        calls++;
      },
      async inspect() {
        return null;
      },
    },
    tasks = new Tasks(
      f.storage.tasks,
      f.calendar,
      f.storage.conversations,
      execution,
      f.now,
    );
  try {
    const { task } = await tasks.save(input(f.conversation.id)),
      queued = (
        await tasks.runNow(task.id, { version: 1, executionId: randomUUID() })
      ).run;
    await f.storage.tasks.claim(queued, "dead-worker", f.now());
    const scheduler = new Scheduler(f.storage.tasks, f.calendar, execution, {
      now: f.now,
    });
    try {
      await scheduler.tick();
      await scheduler.drain();
      assert.equal(calls, 0);
      assert.equal((await tasks.get(task.id)).runs[0].status, "interrupted");
      await assert.rejects(
        tasks.runNow(task.id, { version: 1, executionId: randomUUID() }),
        /déjà/,
      );
      await tasks.resolve(task.id, queued.id);
      assert.equal((await tasks.get(task.id)).runs[0].status, "cancelled");
    } finally {
      await scheduler.close();
    }
  } finally {
    await f.close();
  }
});

test("stable engine execution IDs refuse replays after both completion and interruption", async () => {
  const root = await mkdtemp("/tmp/heart-task-engine-"),
    store = await openJsonStorage(root);
  let calls = 0;
  try {
    const engine = new Engine(store.sessions, []),
      id = randomUUID(),
      options = {
        sessionId: "stable",
        runId: id,
        prompt: "go",
        displayName: "Test",
        workspace: root,
        permissions: new Set<never>(),
        provider: {
          id: "fake",
          async generate() {
            calls++;
            return { content: "done", toolCalls: [] };
          },
        },
      };
    await engine.run(options);
    await engine.run(options);
    assert.equal(calls, 1);
    const unfinished = randomUUID();
    await store.sessions.append("interrupted", {
      id: randomUUID(),
      at: new Date().toISOString(),
      runId: unfinished,
      type: "run.started",
      data: {},
    });
    await assert.rejects(
      engine.run({ ...options, sessionId: "interrupted", runId: unfinished }),
      /déjà commencée/,
    );
    assert.equal(calls, 1);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("real web orchestration links a waiting form to its eventual manual answer and completed scheduled occurrence", async () => {
  const f = await fixture(),
    lab = new TestLab({
      directory: f.root + "/lab",
      authDirectory: f.root + "/auth",
    });
  await lab.prepare();
  const app = await openWebConversations(
    { driver: "sqlite", file: f.file },
    f.root + "/state",
    lab,
  );
  const execution = new ConversationTaskExecution(
      app.conversations,
      f.storage.sessions,
    ),
    tasks = new Tasks(
      f.storage.tasks,
      f.calendar,
      f.storage.conversations,
      execution,
      f.now,
    ),
    scheduler = new Scheduler(f.storage.tasks, f.calendar, execution, {
      now: f.now,
    });
  let calls = 0;
  lab.model = () => ({
    id: "fake",
    async generate(request) {
      calls++;
      if (!request.messages.some((m) => m.role === "tool"))
        return {
          content: "",
          toolCalls: [
            {
              id: "form",
              name: "interactions.request_input",
              arguments: {
                title: "Choix",
                questions: [
                  {
                    id: "choice",
                    label: "Choisir",
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
      return { content: "Choix conservé.", toolCalls: [] };
    },
  });
  try {
    const { task } = await tasks.save(input(f.conversation.id));
    await tasks.runNow(task.id, { version: 1, executionId: randomUUID() });
    await scheduler.tick();
    await scheduler.drain();
    assert.equal((await tasks.get(task.id)).runs[0].status, "waiting");
    assert.equal(calls, 1);
    const view = await app.conversations.get(f.conversation.id),
      pending = view.interactions.find((i) => i.status === "pending")!;
    await app.conversations.respondInteraction(f.conversation.id, pending.id, {
      status: "answered",
      answers: { choice: "yes" },
    });
    await scheduler.tick();
    assert.equal((await tasks.get(task.id)).runs[0].status, "succeeded");
    assert.equal(calls, 2);
  } finally {
    await scheduler.close();
    await app.close();
    await lab.close();
    await f.close();
  }
});

test(
  "SIGKILL after a real scheduled file effect preserves the result and never replays on restart",
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    const { spawn } = await import("node:child_process");
    const { readFile } = await import("node:fs/promises");
    const manager = new Tasks(
      f.storage.tasks,
      f.calendar,
      f.storage.conversations,
      {
        async execute() {},
        async inspect() {
          return null;
        },
      },
      f.now,
    );
    let worker: ReturnType<typeof spawn> | undefined;
    let app: Awaited<ReturnType<typeof openWebConversations>> | undefined;
    let scheduler: Scheduler | undefined;
    const lab = new TestLab({
      directory: f.root + "/parent-lab",
      authDirectory: f.root + "/parent-auth",
    });
    await lab.prepare();
    let calls = 0;
    lab.model = () => ({
      id: "never",
      async generate() {
        calls++;
        throw Error("must not replay");
      },
    });
    try {
      await f.storage.conversations.setFileAccess(f.conversation.id, "write");
      const { task } = await manager.save({
        ...input(f.conversation.id),
        active: false,
      });
      await manager.runNow(task.id, { version: 1, executionId: randomUUID() });
      worker = spawn(
        process.execPath,
        ["--import", "tsx", "tests/fixtures/task-worker.ts"],
        {
          env: { ...process.env, HEART_TASK_TEST_SQLITE: f.file },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Worker timed out")),
          10000,
        );
        worker!.stdout!.on("data", (chunk) => {
          if (String(chunk).includes("EFFECT_WRITTEN")) {
            clearTimeout(timer);
            resolve();
          }
        });
        worker!.once("exit", () => {
          clearTimeout(timer);
          reject(Error("Worker exited before effect"));
        });
      });
      const ended = new Promise<void>((r) => worker!.once("exit", () => r()));
      worker.kill("SIGKILL");
      await ended;
      app = await openWebConversations(
        { driver: "sqlite", file: f.file },
        f.root + "/state",
        lab,
      );
      const execution = new ConversationTaskExecution(
        app.conversations,
        f.storage.sessions,
      );
      scheduler = new Scheduler(f.storage.tasks, f.calendar, execution, {
        now: f.now,
      });
      await scheduler.tick();
      await scheduler.drain();
      assert.equal(
        (await f.storage.tasks.runs(task.id))[0].status,
        "interrupted",
      );
      assert.equal(
        await readFile(
          f.root + "/state/conversations/" + f.conversation.id + "/effect.txt",
          "utf8",
        ),
        "once",
      );
      assert.equal(calls, 0);
    } finally {
      worker?.kill("SIGKILL");
      await scheduler?.close();
      await app?.close();
      await lab.close();
      await f.close();
    }
  },
);

test("a busy conversation does not starve later queued tasks when scheduler slots are limited", async () => {
  const f = await fixture();
  const done = new Set<string>();
  let blocked: string;
  const execution: TaskExecution = {
    async execute(run) {
      if (run.task.id === blocked) throw new TaskBusy();
      done.add(run.id);
    },
    async inspect(run) {
      return done.has(run.id) ? { status: "succeeded", detail: "Done" } : null;
    },
  };
  const manager = new Tasks(
      f.storage.tasks,
      f.calendar,
      f.storage.conversations,
      execution,
      f.now,
    ),
    scheduler = new Scheduler(f.storage.tasks, f.calendar, execution, {
      now: f.now,
      concurrency: 1,
    });
  try {
    const first = (await manager.save(input(f.conversation.id))).task,
      second = (await manager.save(input(f.conversation.id))).task;
    blocked = first.id;
    await manager.runNow(first.id, { version: 1, executionId: randomUUID() });
    await manager.runNow(second.id, { version: 1, executionId: randomUUID() });
    await scheduler.tick();
    await scheduler.drain();
    assert.equal((await manager.get(first.id)).runs[0].status, "queued");
    await scheduler.tick();
    await scheduler.drain();
    assert.equal((await manager.get(second.id)).runs[0].status, "succeeded");
    blocked = "";
    await scheduler.tick();
    await scheduler.drain();
    assert.equal((await manager.get(first.id)).runs[0].status, "succeeded");
  } finally {
    await scheduler.close();
    await f.close();
  }
});

test("acknowledging an old result uses its indexed identity and rejects results belonging to another task", async () => {
  const f = await fixture();
  const manager = new Tasks(
    f.storage.tasks,
    f.calendar,
    f.storage.conversations,
    {
      async execute() {},
      async inspect() {
        return null;
      },
    },
    f.now,
  );
  try {
    const first = (await manager.save(input(f.conversation.id))).task,
      other = (await manager.save(input(f.conversation.id))).task;
    let oldest!: TaskRun;
    for (let n = 0; n < 25; n++) {
      const run = (
        await manager.runNow(first.id, {
          version: 1,
          executionId: randomUUID(),
        })
      ).run;
      oldest ??= run;
      await f.storage.tasks.transition(run, {
        status: "succeeded",
        detail: "Done",
        finishedAt: f.now(),
      });
    }
    f.storage.tasks.runs = async () => {
      throw new Error("No history scan expected");
    };
    await assert.rejects(
      manager.acknowledge(other.id, oldest.id, { status: "succeeded" }),
      /modifié/,
    );
    assert.equal((await f.storage.tasks.getRun(oldest.id))!.seen, false);
    await manager.acknowledge(first.id, oldest.id, { status: "succeeded" });
    assert.equal((await f.storage.tasks.getRun(oldest.id))!.seen, true);
    assert.equal(await f.storage.tasks.getRun(randomUUID()), null);
  } finally {
    await f.close();
  }
});

test("task observation reads only journal deltas and reconstructs resumed forms without caching message bodies", async () => {
  const f = await fixture();
  try {
    const runId = randomUUID(),
      requestId = randomUUID(),
      resumed = randomUUID();
    for (let i = 0; i < 405; i++)
      await f.storage.sessions.append(f.conversation.id, {
        id: randomUUID(),
        runId: randomUUID(),
        at: f.now(),
        type: "message",
        data: { role: "user", content: "Synthetic older body " + i },
      });
    await f.storage.sessions.append(f.conversation.id, {
      id: randomUUID(),
      runId,
      at: f.now(),
      type: "run.started",
      data: {},
    });
    await f.storage.sessions.append(f.conversation.id, {
      id: requestId,
      runId,
      at: f.now(),
      type: "interaction.requested",
      data: {},
    });
    let delivered = 0,
      reads = 0;
    const sessions = {
      ...f.storage.sessions,
      read: async () => {
        throw new Error("Full journal read forbidden");
      },
      page: async (
        id: string,
        window: import("../src/contracts/history.ts").EventWindow,
      ) => {
        reads++;
        const page = await f.storage.sessions.page!(id, window);
        delivered += page.events.length;
        return page;
      },
    };
    const execution = new ConversationTaskExecution(
        { isBusy: () => false } as any,
        sessions,
      ),
      run = {
        id: runId,
        task: { conversationId: f.conversation.id },
      } as TaskRun;
    assert.equal((await execution.inspect(run))!.status, "waiting");
    assert.equal(delivered, 407);
    assert.equal(reads, 3);
    assert.equal((await execution.inspect(run))!.status, "waiting");
    assert.equal(delivered, 407);
    assert.equal(reads, 4);
    await f.storage.sessions.appendBatch!(f.conversation.id, [
      {
        id: randomUUID(),
        runId: resumed,
        at: f.now(),
        type: "run.started",
        data: {},
      },
      {
        id: randomUUID(),
        runId: resumed,
        at: f.now(),
        type: "interaction.resolved",
        data: { requestId, response: { status: "answered" } },
      },
    ]);
    assert.equal((await execution.inspect(run))!.status, "interrupted");
    await f.storage.sessions.append(f.conversation.id, {
      id: randomUUID(),
      runId: resumed,
      at: f.now(),
      type: "run.completed",
      data: {},
    });
    assert.equal((await execution.inspect(run))!.status, "succeeded");
    assert.equal(delivered, 410);
    execution.retain(new Set());
    assert.equal((await execution.inspect(run))!.status, "succeeded");
    assert.equal(delivered, 820);
  } finally {
    await f.close();
  }
});

test("task catalogue uses stable pages and only requests latest outcomes for the visible definitions", async () => {
  const f = await fixture();
  const manager = new Tasks(
    f.storage.tasks,
    f.calendar,
    f.storage.conversations,
    {
      async execute() {},
      async inspect() {
        return null;
      },
    },
    f.now,
  );
  try {
    for (let i = 0; i < 45; i++)
      await manager.save({ ...input(f.conversation.id), title: "Task " + i });
    const latest = f.storage.tasks.latest.bind(f.storage.tasks);
    let largest = 0;
    f.storage.tasks.latest = async (ids) => {
      largest = Math.max(largest, ids!.length);
      return latest(ids);
    };
    const first = await manager.list(),
      second = await manager.list({ after: first.nextCursor! }),
      third = await manager.list({ after: second.nextCursor! });
    assert.deepEqual(
      [first.tasks.length, second.tasks.length, third.tasks.length],
      [20, 20, 5],
    );
    assert.equal(third.nextCursor, null);
    assert.equal(largest, 20);
    assert.equal(
      new Set(
        [...first.tasks, ...second.tasks, ...third.tasks].map(
          (task) => task.id,
        ),
      ).size,
      45,
    );
    await assert.rejects(manager.list({ after: "invalid" }), /Pagination/);
  } finally {
    await f.close();
  }
});
