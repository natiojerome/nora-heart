/** Real-provider effect followed by actual SIGKILL. Opt-in, isolated SQLite only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { ChatGptProvider } from "../src/modules/models/chatgpt/index.ts";

async function worker(root: string) {
  const modelId = process.env.HEART_QA_MODEL!;
  assert(modelId);
  const token = await readFile(process.env.HEART_QA_TOKEN_FILE!, "utf8");
  const real = new ChatGptProvider({
    modelId,
    reasoningEffort: "medium",
    accessToken: async () => token,
  });
  const entry = (await real.models()).find((model) => model.id === modelId);
  assert(entry?.contextWindow);
  let calls = 0;
  const marker = "LUNA-CRASH-" + randomUUID();
  let taskId = "",
    conversationId = "";
  const lab = new TestLab({
    directory: root + "/lab",
    authDirectory: root + "/auth",
  });
  await lab.prepare();
  lab.models = async () => ({ models: [entry] });
  lab.model = () => ({
    id: real.id,
    async generate(request) {
      if (
        request.messages.some(
          (message) =>
            message.role === "tool" &&
            message.name === "files.create" &&
            !message.error,
        )
      ) {
        await writeFile(
          root + "/ready.json",
          JSON.stringify({ modelId, calls, taskId, conversationId, marker }),
        );
        await new Promise(() => {
          setInterval(() => {}, 1000);
        });
      }
      calls++;
      assert(calls <= 10, "Crash qualification runaway guard");
      return real.generate({ ...request, signal: AbortSignal.timeout(150000) });
    },
  });
  await migrateSqlite(root + "/state.sqlite");
  const app = await openWebConversations(
    { driver: "sqlite", file: root + "/state.sqlite" },
    root + "/state",
    lab,
  );
  await app.assistant.save({
    version: 0,
    settings: {
      ...defaultAssistant,
      completed: true,
      step: 5,
      conversationDefaults: {
        selection: {
          provider: "chatgpt",
          modelId,
          contextWindow: entry.contextWindow,
          capacitySource: "catalog",
          reasoningEffort: "medium",
        },
        fileAccess: "write",
        networkAccess: false,
      },
    },
  });
  conversationId = (
    await app.conversations.create({ title: "Actual interrupted effect" })
  ).conversation.id;
  const task = (
    await app.tasks.save({
      version: 0,
      title: "Crash qualification",
      prompt: `Crée réellement crash-proof.txt via files.create avec le contenu exact ${marker}. Aucun souvenir.`,
      conversationId,
      schedule: {
        kind: "once",
        at: new Date(Date.now() + 60000).toISOString(),
        timezone: "Indian/Reunion",
      },
      active: false,
      notify: true,
      missed: "catch_up",
    })
  ).task;
  taskId = task.id;
  await app.tasks.runNow(taskId, {
    version: task.version,
    executionId: randomUUID(),
  });
  await app.scheduler.tick();
  await app.scheduler.drain();
  throw new Error("Fault injection point was not reached");
}
async function main() {
  if (!process.argv.includes("--live")) {
    console.log(
      "No live call. Explicit model/token/report required with --live.",
    );
    return;
  }
  if (process.argv.includes("--worker"))
    return worker(process.env.HEART_QA_ROOT!);
  const root = await mkdtemp("/tmp/heart-luna-crash-");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      new URL(import.meta.url).pathname,
      "--live",
      "--worker",
    ],
    {
      env: { ...process.env, HEART_QA_ROOT: root },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  const exited = once(child, "exit");
  let exitCode: number | null = null;
  child.on("exit", (code) => (exitCode = code));
  let app: Awaited<ReturnType<typeof openWebConversations>> | undefined,
    lab: TestLab | undefined;
  const report: any = {
    at: new Date().toISOString(),
    status: "incomplete",
    provider: "chatgpt-subscription",
    modelId: process.env.HEART_QA_MODEL,
    scope:
      "Actual provider-generated files.create followed by SIGKILL before final response; isolated state only",
  };
  try {
    const deadline = Date.now() + 180000;
    while (!existsSync(root + "/ready.json")) {
      assert(Date.now() < deadline, "Real crash effect timed out");
      assert(exitCode === null, "Worker exited before effect checkpoint");
      await delay(100);
    }
    const state = JSON.parse(await readFile(root + "/ready.json", "utf8"));
    child.kill("SIGKILL");
    const [, signal] = await exited;
    assert.equal(signal, "SIGKILL");
    lab = new TestLab({
      directory: root + "/lab",
      authDirectory: root + "/auth",
    });
    await lab.prepare();
    let newCalls = 0;
    lab.model = () => {
      newCalls++;
      throw new Error("No model call allowed during recovery");
    };
    app = await openWebConversations(
      { driver: "sqlite", file: root + "/state.sqlite" },
      root + "/state",
      lab,
    );
    await app.scheduler.tick();
    await app.scheduler.drain();
    assert.equal(
      (await app.tasks.get(state.taskId)).runs[0].status,
      "interrupted",
    );
    const document = await app.conversations.inspectWorkspace(
      state.conversationId,
      "crash-proof.txt",
      true,
    );
    assert("document" in document);
    assert.equal(document.document.content, state.marker);
    await app.scheduler.tick();
    assert.equal(newCalls, 0);
    Object.assign(report, {
      status: "passed",
      actualProviderCalls: state.calls,
      actualSignal: "SIGKILL",
      fileEffectPreserved: true,
      occurrenceStatus: "interrupted",
      newCallsAfterRestart: 0,
      toolsReplayed: 0,
    });
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : "Unknown";
    process.exitCode = 1;
  } finally {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGKILL");
      await exited;
    }
    await app?.close();
    await lab?.close();
    await rm(root, { recursive: true, force: true });
    const reportFile = process.env.HEART_QA_REPORT;
    assert(typeof reportFile === "string" && reportFile.startsWith("/tmp/"));
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log("Actual-provider crash qualification: " + report.status);
  }
}
await main();
