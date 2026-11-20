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
      "Real model, full Heart application and isolated synthetic conversations, files and memories. No owner state, no API fallback.",
  };
  let summaries = 0,
    skillBodySeen = false;
  const tools = new Set<string>();
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
        for (const tool of result.toolCalls) tools.add(tool.name);
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
    const task = async (
      conversationId: string,
      prompt: string,
      active = false,
      at = new Date(Date.now() + 60000).toISOString(),
    ) =>
      (
        await app!.tasks.save({
          version: 0,
          title: "Live qualification",
          prompt,
          conversationId,
          schedule: { kind: "once", at, timezone: "Indian/Reunion" },
          active,
          missed: "catch_up",
          notify: true,
        })
      ).task;
    const run = async (t: Task) => {
      const executionId = randomUUID();
      await app!.tasks.runNow(t.id, { version: t.version, executionId });
      await app!.scheduler.tick();
      await app!.scheduler.drain();
      return (await app!.tasks.get(t.id)).runs[0];
    };
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
    const c = await create("Files and schedule"),
      marker = "LIVE-" + randomUUID();
    const t = await task(
      c.id,
      `Crée réellement preuve.txt avec exactement ${marker} via files.create, puis lis-le avec files.read. Ne mémorise rien de cette vérification. Termine avec le marqueur.`,
    );
    const outcome = await run(t);
    assert.equal(outcome.status, "succeeded");
    const document = await app.conversations.inspectWorkspace(
      c.id,
      "preuve.txt",
      true,
    );
    assert.equal((document as any).document.content, marker);
    const count = report.calls;
    await app.tasks.runNow(t.id, {
      version: t.version,
      executionId: outcome.id,
    });
    await app.scheduler.tick();
    await app.scheduler.drain();
    assert.equal(report.calls, count);
    await app.tasks.acknowledge(t.id, outcome.id, { status: "succeeded" });
    check(
      "scheduled tool effect, file read, stable occurrence UUID and notification acknowledgement",
    );
    await app.conversations.send(c.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt: `Lis preuve.txt puis remplace exactement son contenu par ${marker}-UPDATED avec files.update et la révision actuelle. Ne mémorise rien.`,
    });
    assert.equal(
      (
        (await app.conversations.inspectWorkspace(
          c.id,
          "preuve.txt",
          true,
        )) as any
      ).document.content,
      marker + "-UPDATED",
    );
    check("real file revision update");
    const m = await create("Memory"),
      memoryMarker = "ORCHID-" + randomUUID();
    await app.conversations.send(m.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt: `Retiens ma préférence durable : je préfère appeler mes environnements de développement ${memoryMarker}. Enregistre cette préférence avec memory.remember, portée personal.`,
    });
    const memory = (await app.memories.list()).memories.find(
      (row) => row.status === "active" && row.content.includes(memoryMarker),
    );
    assert(memory);
    check("real structured memory creation");
    await app.conversations.send(m.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt: `Correction : remplace ma préférence ${memoryMarker} par ${memoryMarker}-CORRIGE. Modifie le souvenir existant avec memory.update après lecture de sa version, sans créer de doublon.`,
    });
    assert.equal(
      (await app.memories.get(memory!.id)).memory.content.includes(
        memoryMarker + "-CORRIGE",
      ),
      true,
    );
    check("real memory correction and versioned update");
    const next = await create("Memory recall");
    const recalled = await app.conversations.send(next.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt:
        "Quel nom je préfère pour mes environnements de développement ? Retrouve le souvenir et cite le nom exact.",
    });
    assert((await answerText(next.id)).includes(memoryMarker + "-CORRIGE"));
    check("real memory recall in another conversation");
    await app.conversations.send(next.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt: `Oublie ma préférence ${memoryMarker} concernant mes environnements de développement. Utilise memory.forget sur le souvenir existant, sans en créer un autre.`,
    });
    assert.equal(
      (await app.memories.get(memory.id)).memory.status,
      "forgotten",
    );
    check("real explicit memory forgetting");
    const form = await create("Human interaction"),
      formTask = await task(
        form.id,
        "Avant toute réponse finale, utilise interactions.request_input pour me demander la couleur du rapport. Question single id couleur, choix rouge et bleu avec les mêmes identifiants. Attends ma réponse. Ensuite réponds exactement : Couleur retenue : BLEU si je choisis bleu. Ne crée aucun souvenir.",
      );
    const waiting = await run(formTask);
    assert.equal(waiting.status, "waiting");
    const pending = (await app.conversations.get(form.id)).interactions.find(
      (row) => row.status === "pending",
    );
    assert(pending);
    await app.conversations.respondInteraction(form.id, pending.id, {
      status: "answered",
      answers: { couleur: "bleu" },
    });
    await app.scheduler.tick();
    assert.equal(
      (await app.tasks.get(formTask.id)).runs[0].status,
      "succeeded",
    );
    assert(
      (await answerText(form.id)).includes("BLEU"),
      "Final assistant reply must reflect the actual form answer",
    );
    check("real form tool, pending task and manual-answer continuation");
    const scheduled = await create("Actual due time"),
      scheduledTask = await task(
        scheduled.id,
        "Réponds exactement ECHEANCE-OK. Aucun outil ni mémoire.",
        true,
        new Date(Date.now() + 2000).toISOString(),
      );
    await delay(
      Math.max(0, new Date(scheduledTask.nextAt!).getTime() - Date.now() + 100),
    );
    await app.scheduler.tick();
    await app.scheduler.drain();
    assert.equal(
      (await app.tasks.get(scheduledTask.id)).runs[0].status,
      "succeeded",
    );
    check("actual wall-clock schedule through real provider");
    const paused = await task(
      scheduled.id,
      "Cette tâche doit rester en pause : ne jamais exécuter.",
      false,
    );
    const beforePause = report.calls;
    await app.scheduler.tick();
    await app.scheduler.drain();
    assert.equal(report.calls, beforePause);
    check("paused task makes no provider call");
    const parallelA = await create("Parallel A"),
      parallelB = await create("Parallel B");
    const results = await Promise.all([
      app.conversations.send(parallelA.id, {
        provider: "chatgpt",
        modelId,
        reasoningEffort: effort,
        prompt: "Réponds exactement PARALLELE-A. Aucun outil ni mémoire.",
      }),
      app.conversations.send(parallelB.id, {
        provider: "chatgpt",
        modelId,
        reasoningEffort: effort,
        prompt: "Réponds exactement PARALLELE-B. Aucun outil ni mémoire.",
      }),
    ]);
    assert((await answerText(parallelA.id)).includes("PARALLELE-A"));
    assert((await answerText(parallelB.id)).includes("PARALLELE-B"));
    check("two actual simultaneous conversations");
    const compression = await create("Actual compression"),
      code = "CONTEXTE-" + randomUUID();
    await app.conversations.send(compression.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt: `Le code actif de cette conversation est ${code}. Répète-le et conserve-le pour la suite du fil sans outil mémoire.`,
    });
    const profile = await app.assistant.get();
    await app.assistant.save({
      version: profile.version,
      settings: {
        ...profile.settings,
        runtimePolicies: {
          ...profile.settings.runtimePolicies,
          context: { compressionPercent: 1 },
        },
      },
    });
    await storage.sessions.appendBatch!(
      compression.id,
      Array.from({ length: 12 }, () => ({
        id: randomUUID(),
        runId: "synthetic-load",
        at: new Date().toISOString(),
        type: "message" as const,
        data: {
          role: "user",
          content:
            "Archive de charge technique sans décision nouvelle. ".repeat(300),
        },
      })),
    );
    const beforeSummary = summaries;
    await app.conversations.send(compression.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt:
        "Quel est le code actif exact conservé au début de ce fil ? Réponds avec le code. Aucun outil mémoire.",
    });
    assert((await answerText(compression.id)).includes(code));
    assert(
      (await storage.sessions.read(compression.id)).some(
        (event) => event.type === "context.checkpoint",
      ),
    );
    assert(summaries > beforeSummary, "Actual provider summary call required");
    const compressedProfile = await app.assistant.get();
    await app.assistant.save({
      version: compressedProfile.version,
      settings: {
        ...compressedProfile.settings,
        runtimePolicies: profile.settings.runtimePolicies,
      },
    });
    report.compression = {
      actualSummaryCalls: summaries - beforeSummary,
      qualificationThresholdPercent: 1,
      syntheticArchiveMessages: 12,
    };
    check(
      "actual provider-generated compression and retained conversation fact",
    );
    const review = await create("Portable skill");
    await app.conversations.send(review.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt:
        "$code-review Revois uniquement ce petit fragment fourni : function first(items) { return items[0].name; }. Signale un cas de plantage reproductible. Ne change aucun fichier et ne crée aucun souvenir.",
    });
    assert(skillBodySeen, "Full skill instructions must reach real provider");
    check("portable skill instructions in actual provider request");
    await app.close();
    app = await openWebConversations(config, root + "/state", lab);
    const beforeRestart = report.calls;
    await app.scheduler.tick();
    await app.scheduler.drain();
    assert.equal(report.calls, beforeRestart);
    assert.equal((await app.tasks.get(t.id)).runs[0].seen, true);
    assert.equal(
      (
        (await app.conversations.inspectWorkspace(
          c.id,
          "preuve.txt",
          true,
        )) as any
      ).document.content,
      marker + "-UPDATED",
    );
    check("reopen persistence, completed runs not replayed and file preserved");
    await app.conversations.send(c.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: effort,
      prompt:
        "Lis les informations de preuve.txt, puis supprime ce fichier avec files.delete et la bonne révision. Ne mémorise rien.",
    });
    await assert.rejects(
      app.conversations.inspectWorkspace(c.id, "preuve.txt", true),
    );
    check("real file deletion with revision");
    for (const expected of [
      "files.create",
      "files.read",
      "files.update",
      "files.delete",
      "memory.remember",
      "memory.update",
      "memory.forget",
      "interactions.request_input",
    ])
      assert(tools.has(expected), "Missing actual tool " + expected);
    report.status = "passed";
    report.fixtureConversations = {
      files: c.id,
      memory: next.id,
      form: form.id,
      compression: compression.id,
      skill: review.id,
    };
    const uiOrigin = process.env.HEART_QA_UI_ORIGIN;
    if (uiOrigin) {
      assert(
        /^http:\/\/127\.0\.0\.1:\d+$/.test(uiOrigin),
        "Loopback QA origin required",
      );
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
      console.log(
        "Real-provider UI ready for read-only browser qualification.",
      );
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
