/** Opt-in qualification with the explicitly chosen real ChatGPT model. Never uses owner state. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { ChatGptProvider } from "../src/modules/models/chatgpt/index.ts";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import {
  createPostgresPool,
  migratePostgres,
  openPostgresStorage,
} from "../src/modules/storage/postgres/index.ts";
import type { ModelRequest } from "../src/contracts/models.ts";
import type { Task } from "../src/contracts/tasks.ts";

async function main() {
  if (!process.argv.includes("--live")) {
    console.log(
      "No inference. Pass --live, an explicit model and private access-token file on isolated state.",
    );
    return;
  }
  const modelId = process.env.HEART_QA_MODEL;
  assert(modelId, "Explicit chosen model required");
  const tokenFile = process.env.HEART_QA_TOKEN_FILE;
  assert(tokenFile, "Private short-lived access-token file required");
  const reportFile = process.env.HEART_QA_REPORT;
  assert(
    typeof reportFile === "string" && reportFile.startsWith("/tmp/"),
    "Private report path required",
  );
  const driver = process.env.HEART_QA_DRIVER ?? "sqlite";
  assert(["sqlite", "postgres"].includes(driver));
  const root = await mkdtemp("/tmp/heart-real-tasks-"),
    file = root + "/state.sqlite";
  const report: any = {
    at: new Date().toISOString(),
    modelId,
    provider: "chatgpt-subscription",
    driver,
    status: "incomplete",
    checks: [],
    http: [],
    calls: 0,
    tools: [],
    scope:
      "Real ChatGPT model operates Heart task tools through normal chat turns on isolated state; no owner data and no API fallback.",
  };
  let summaries = 0,
    skillBodySeen = false;
  const tools = new Set<string>();
  const resultReads = new Set<string>(),
    writeActions = new Set<string>();
  let app: Awaited<ReturnType<typeof openWebConversations>> | undefined;
  const token = await readFile(tokenFile, "utf8");
  const transport: typeof fetch = async (url, init) => {
    const response = await fetch(url, init);
    report.http.push({ status: response.status });
    return response;
  };
  const catalog = await new ChatGptProvider({
    modelId: "catalog",
    accessToken: async () => token,
    fetch: transport,
  }).models();
  const entry = catalog.find((model) => model.id === modelId);
  assert(
    entry?.contextWindow,
    "Chosen exact model missing from real account catalogue",
  );
  const effort = entry.reasoningEfforts?.includes("medium")
    ? "medium"
    : entry.defaultReasoningEffort;
  report.effort = effort;
  report.nativeContext = entry.contextWindow;
  const lab = new TestLab({
    directory: root + "/lab",
    authDirectory: root + "/auth",
  });
  await lab.prepare();
  lab.models = async () => ({ models: catalog });
  lab.model = (body) => {
    assert.equal(body.provider, "chatgpt");
    assert.equal(body.modelId, modelId);
    const real = new ChatGptProvider({
      modelId,
      reasoningEffort:
        typeof body.reasoningEffort === "string"
          ? body.reasoningEffort
          : effort,
      accessToken: async () => token,
      fetch: transport,
    });
    return {
      id: real.id,
      async generate(request: ModelRequest) {
        if (!request.tools.length) summaries++;
        if (
          request.instructions.includes(
            "Relier chaque problème à un scénario observable",
          )
        )
          skillBodySeen = true;
        for (const message of request.messages) {
          if (
            message.role === "tool" &&
            message.name === "tasks.read" &&
            !message.error
          ) {
            try {
              const value = JSON.parse(message.content);
              if (Array.isArray(value.messages))
                resultReads.add(message.callId);
            } catch {}
          }
        }
        report.calls++;
        assert(
          report.calls <= 100,
          "Qualification runaway guard reached; no automatic retries",
        );
        const result = await real.generate({
          ...request,
          signal: AbortSignal.any([
            AbortSignal.timeout(150000),
            ...(request.signal ? [request.signal] : []),
          ]),
        });
        for (const tool of result.toolCalls) {
          tools.add(tool.name);
          if (tool.name === "tasks.write")
            writeActions.add(
              String((tool.arguments as Record<string, unknown>).action),
            );
        }
        return result;
      },
    };
  };
  const config =
    driver === "sqlite"
      ? { driver: "sqlite" as const, file }
      : {
          driver: "postgres" as const,
          connectionStringEnv: "HARNESS_TEST_DATABASE_URL",
        };
  if (driver === "sqlite") await migrateSqlite(file);
  else {
    assert(
      process.env.HARNESS_TEST_DATABASE_URL?.includes("heart_live_test"),
      "Dedicated disposable database required",
    );
    const pool = createPostgresPool(process.env.HARNESS_TEST_DATABASE_URL!);
    try {
      await migratePostgres(pool);
    } finally {
      await pool.end();
    }
  }
  const storage =
    driver === "sqlite"
      ? await openSqliteStorage(file)
      : await openPostgresStorage(process.env.HARNESS_TEST_DATABASE_URL!);
  try {
    app = await openWebConversations(config, root + "/state", lab);
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
            reasoningEffort: effort,
          },
          fileAccess: "write",
          networkAccess: false,
        },
      },
    });
    const create = async (title: string) =>
      (await app!.conversations.create({ title })).conversation;
    const answerText = async (id: string) => {
      const events = await storage.sessions.read(id);
      return String(
        (
          events.findLast(
            (event) =>
              event.type === "message" &&
              (event.data as any).role === "assistant" &&
              !(event.data as any).toolCalls?.length,
          )?.data as any
        )?.content ?? "",
      );
    };
    const check = (name: string) => {
      report.checks.push(name);
      console.log("PASS " + name);
    };
    const c = await create("Task management through chat"),
      marker = "CHAT-JOB-" + randomUUID();
    const send = async (id: string, prompt: string) =>
      app!.conversations.send(id, {
        provider: "chatgpt",
        modelId,
        reasoningEffort: effort,
        prompt,
      });
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await send(
      c.id,
      "Crée une tâche ponctuelle intitulée « Bilan de qualification » dans cette discussion pour demain à 09:15, fuseau Indian/Reunion. Objectif : répondre BILAN-INITIAL. Active-la et notifie-moi dans Heart, sans la lancer maintenant.",
    );
    let rows = (await app.tasks.list()).tasks;
    assert.equal(rows.length, 1);
    let planned: Task = rows[0];
    assert.equal(planned.conversationId, c.id);
    assert.equal(planned.schedule.timezone, "Indian/Reunion");
    assert.equal(planned.nextAt, tomorrow + "T05:15:00.000Z");
    assert.equal(planned.active, true);
    assert.equal((await app.tasks.get(planned.id)).runs.length, 0);
    check(
      "actual model creates a task in the current conversation at the requested local time",
    );
    await send(
      c.id,
      `Déplace cette même tâche à demain 10:30, toujours Indian/Reunion. Remplace son objectif par : crée réellement task-chat-proof.txt via files.create avec le contenu exact ${marker}, lis le fichier puis réponds avec ce marqueur. Ne crée aucune autre tâche.`,
    );
    planned = (await app.tasks.get(planned.id)).task;
    assert.equal(planned.nextAt, tomorrow + "T06:30:00.000Z");
    assert(planned.prompt.includes(marker));
    assert.equal((await app.tasks.list()).tasks.length, 1);
    check(
      "actual model updates only the existing task through optimistic versioning",
    );
    await send(
      c.id,
      "Mets cette tâche en pause avec l’action dédiée de pause/reprise.",
    );
    planned = (await app.tasks.get(planned.id)).task;
    assert.equal(planned.active, false);
    assert.equal(planned.nextAt, null);
    check("actual model pauses the task");
    await send(
      c.id,
      "Réactive maintenant son planning à la même heure prévue, sans la lancer.",
    );
    planned = (await app.tasks.get(planned.id)).task;
    assert.equal(planned.active, true);
    assert.equal(planned.nextAt, tomorrow + "T06:30:00.000Z");
    check("actual model resumes the task without changing its schedule");
    await send(
      c.id,
      "Lance maintenant une occurrence de cette tâche, en gardant son planning pour demain.",
    );
    let history = await app.tasks.get(planned.id);
    assert.equal(history.runs.length, 1);
    assert.equal(history.runs[0].status, "queued");
    assert.equal(history.task.nextAt, tomorrow + "T06:30:00.000Z");
    await assert.rejects(
      app.conversations.inspectWorkspace(c.id, "task-chat-proof.txt", true),
    );
    check(
      "run-now chat tool only queues work while its conversation turn is occupied",
    );
    await app.scheduler.tick();
    await app.scheduler.drain();
    history = await app.tasks.get(planned.id);
    assert.equal(history.runs[0].status, "succeeded");
    const proof = await app.conversations.inspectWorkspace(
      c.id,
      "task-chat-proof.txt",
      true,
    );
    assert("document" in proof);
    assert.equal(proof.document.content, marker);
    check(
      "queued occurrence uses the real model and the conversation file permissions",
    );
    await send(
      c.id,
      "Consulte le résultat réellement produit par cette occurrence avec l’outil de lecture de résultat, puis donne-moi le marqueur exact de la réponse finale.",
    );
    assert((await answerText(c.id)).includes(marker));
    assert(
      resultReads.size > 0,
      "Actual tasks.read with runId result required",
    );
    check(
      "actual model reads the canonical task result rather than inventing completion",
    );
    const form = await create("Task with missing schedule details");
    await send(
      form.id,
      "Crée une tâche récurrente nommée « Bilan du vendredi », chaque vendredi pour répondre BILAN-VENDREDI. Je préciserai l’heure et le fuseau après ta question : demande ces deux informations manquantes par deux champs texte dans un formulaire avant de créer la tâche.",
    );
    const pending = (await app.conversations.get(form.id)).interactions.find(
      (item) => item.status === "pending",
    );
    assert(pending);
    assert.equal((await app.tasks.list()).tasks.length, 1);
    const answers: Record<string, string> = {};
    for (const question of pending.request.questions) {
      assert.equal(question.type, "text");
      answers[question.id] = /fuseau|zone|timezone/i.test(
        question.label + " " + question.id,
      )
        ? "Indian/Reunion"
        : "14:20";
    }
    await app.conversations.respondInteraction(form.id, pending.id, {
      status: "answered",
      answers,
    });
    rows = (await app.tasks.list()).tasks;
    assert.equal(rows.length, 2);
    const second = rows.find((task) => task.id !== planned.id)!;
    assert.equal(second.schedule.kind, "recurring");
    assert(second.schedule.kind === "recurring");
    assert.equal(second.schedule.frequency, "weekly");
    assert.equal(second.schedule.weekday, 5);
    assert.equal(second.schedule.time, "14:20");
    assert.equal(second.schedule.timezone, "Indian/Reunion");
    check(
      "missing hour and timezone cause a real form; only the explicit answers create the recurring task",
    );
    const ordinary = await create("No implicit automation");
    await send(
      ordinary.id,
      "Explique en une phrase la différence entre tâche ponctuelle et récurrente, sans rien programmer ni modifier.",
    );
    assert.equal((await app.tasks.list()).tasks.length, 2);
    check("ordinary discussion does not create or change a schedule");
    for (const expected of [
      "tasks.list",
      "tasks.read",
      "tasks.write",
      "interactions.request_input",
    ])
      assert(tools.has(expected), "Missing actual task tool " + expected);
    report.resultReadCalls = resultReads.size;
    report.writeActions = [...writeActions];
    report.status = "passed";
    report.fixtureConversations = { operations: c.id, form: form.id };
    const uiOrigin = process.env.HEART_QA_UI_ORIGIN;
    if (uiOrigin) {
      assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(uiOrigin));
      const server = createWebServer({
        origin: uiOrigin,
        access: new WebAccess({
          secret: "isolated-live-luna-secret-at-least-32",
          password: "isolated-live-luna",
        }),
        lab,
        ...app,
      });
      await new Promise<void>((resolve) =>
        server.listen(Number(new URL(uiOrigin).port), "0.0.0.0", resolve),
      );
      const directory = reportFile.slice(0, reportFile.lastIndexOf("/"));
      await writeFile(directory + "/ui-ready.json", JSON.stringify(report), {
        mode: 0o600,
      });
      console.log("Task chat UI ready for read-only browser qualification.");
      try {
        const deadline = Date.now() + 180000;
        while (!existsSync(directory + "/ui-done")) {
          assert(Date.now() < deadline, "QA browser timed out");
          await delay(250);
        }
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : "Unknown failure";
    process.exitCode = 1;
  } finally {
    report.tools = [...tools];
    await app?.close();
    await storage.close();
    await lab.close();
    await rm(root, { recursive: true, force: true });
    await mkdir(reportFile.slice(0, reportFile.lastIndexOf("/")), {
      recursive: true,
    });
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      "Real-provider report: " + report.status + "; calls=" + report.calls,
    );
  }
}
await main();
