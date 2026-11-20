/** Opt-in live qualification. No simulated model, summary, memory or database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelSelection } from "../src/contracts/conversations.ts";
import { Conversations } from "../src/app/conversations.ts";
import { Engine } from "../src/core/engine.ts";
import { BoundedContext } from "../src/modules/context/bounded/index.ts";
import {
  AiSdkResponseError,
  createAiSdkProvider,
} from "../src/modules/models/ai-sdk/index.ts";
import { StructuredMemory } from "../src/modules/memory/structured/index.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import { fileTools } from "../src/modules/tools/files/index.ts";
import {
  createPostgresPool,
  migratePostgres,
  openPostgresStorage,
} from "../src/modules/storage/postgres/index.ts";

async function main() {
  if (!process.argv.includes("--live")) {
    console.log(
      "Qualification réelle non lancée. Ajouter --live ; clé OpenRouter et PostgreSQL requis. Aucun appel effectué.",
    );
    return;
  }
  let apiKey = process.env.HARNESS_OPENROUTER_API_KEY;
  if (!apiKey && process.env.HARNESS_WEB_STATE_DIR) {
    const file = path.join(process.env.HARNESS_WEB_STATE_DIR, "api-keys.json");
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.mode & 0o077) throw new Error();
      apiKey = JSON.parse(await readFile(file, "utf8")).openrouter;
    } catch {}
  }
  if (!apiKey) {
    console.log(
      "Clé OpenRouter absente : enregistre-la dans Heart → Modèles → OpenRouter. Aucun appel effectué.",
    );
    process.exitCode = 2;
    return;
  }
  const source = process.env.HARNESS_DATABASE_URL;
  if (!source) throw new Error("Database configuration required");
  const scenario = process.env.HARNESS_QUALIFY_SCENARIO ?? "full";
  assert(["full", "memory"].includes(scenario));
  const paidModel = process.env.HARNESS_QUALIFY_PAID_MODEL;
  const models = paidModel
    ? [paidModel, paidModel]
    : [
        process.env.HARNESS_QUALIFY_MODEL_A ?? "google/gemma-4-31b-it:free",
        process.env.HARNESS_QUALIFY_MODEL_B ??
          "inclusionai/ling-3.2-flash:free",
      ];
  if (!paidModel) {
    assert.notEqual(models[0], models[1]);
    for (const id of models) assert(id.endsWith(":free"));
  }
  const maxCost = paidModel
    ? Number(process.env.HARNESS_QUALIFY_MAX_COST_USD ?? 0.05)
    : 0;
  assert(
    Number.isFinite(maxCost) && maxCost >= 0 && maxCost <= 0.05,
    "Qualification spending cap",
  );
  const catalog = (await (
    await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(20000),
    })
  ).json()) as {
    data: {
      id: string;
      pricing: { prompt: string; completion: string; request?: string };
      supported_parameters: string[];
    }[];
  };
  const prices = new Map<
    string,
    { input: number; output: number; request: number }
  >();
  for (const id of models) {
    const entry = catalog.data.find((item) => item.id === id);
    assert(
      entry && entry.supported_parameters.includes("tools"),
      "Chosen model must be listed with tools",
    );
    const price = {
      input: Number(entry.pricing.prompt),
      output: Number(entry.pricing.completion),
      request: Number(entry.pricing.request ?? 0),
    };
    assert(
      Object.values(price).every(
        (value) => Number.isFinite(value) && value >= 0,
      ),
    );
    if (!paidModel) assert(Object.values(price).every((value) => value === 0));
    prices.set(id, price);
  }
  let reservedCost = 0,
    billedCost = 0;
  const name =
    "harness_qualification_" + randomUUID().replaceAll("-", "") + "_test";
  const target = new URL(source);
  target.pathname = "/" + name;
  const admin = createPostgresPool(source),
    directory = await mkdtemp(path.join(os.tmpdir(), "heart-live-"));
  let storage: Awaited<ReturnType<typeof openPostgresStorage>> | undefined,
    created = false,
    calls = 0,
    executions = 0;
  const maxCalls = Number(process.env.HARNESS_QUALIFY_MAX_CALLS ?? 14),
    forbidden = "OTHER-" + randomUUID(),
    forgotten = "OLD-" + randomUUID(),
    code = "MEM-" + randomUUID();
  assert(Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 24);
  const http: {
    status: number;
    code?: number;
    kind?: string;
    finish?: string;
    cost?: number;
    textLength?: number;
    toolCalls?: number;
    retryAfter?: string;
    remaining?: string;
  }[] = [];
  const facts = {
    budget: 1370,
    delivery: "lundi",
    database: "PostgreSQL",
    marker: "MAKO-" + randomUUID().slice(0, 8),
  };
  const evidence: { case: string; answer: unknown }[] = [];
  const report = {
    at: new Date().toISOString(),
    scenario,
    modelFailure: null as string | null,
    status: "incomplete",
    models,
    calls: 0,
    maxCalls,
    maxOutputTokens: 4096,
    maxCostUSD: maxCost,
    reservedCostUSD: 0,
    billedCostUSD: 0,
    interModelSwitchTested: !paidModel,
    checks: evidence,
    http,
    checkpoint: null as unknown,
    lastAnswer: "",
    failedStage: null as string | null,
    failure: null as { name: string; code?: string; frame?: string } | null,
    toolOperations: [] as unknown[],
  };
  let service: Conversations;
  let stage = "setup",
    examinedThread: string | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const pool = createPostgresPool(target.toString());
    try {
      await migratePostgres(pool);
    } finally {
      await pool.end();
    }
    storage = await openPostgresStorage(target.toString());
    const project = randomUUID(),
      other = randomUUID();
    await storage.projects.create({ id: project, title: "Qualification" });
    await storage.projects.create({ id: other, title: "Unrelated" });
    let memory = new StructuredMemory(storage.structuredMemories, {
      projectId: project,
      source: { type: "manual" },
    });
    const saved = await memory.rememberRecord({
      title: "Communication",
      content: `Repère de communication : ${code}`,
      kind: "fact",
      scope: "personal",
      projectId: null,
    });
    const old = await memory.rememberRecord({
      title: "Communication ancienne",
      content: `Repère de communication oublié : ${forgotten}`,
      kind: "fact",
      scope: "personal",
      projectId: null,
    });
    await memory.setStatus(old.id, old.version, "forgotten");
    const foreign = new StructuredMemory(storage.structuredMemories, {
      projectId: other,
      source: { type: "manual" },
    });
    await foreign.rememberRecord({
      title: "Communication autre projet",
      content: `Repère : ${forbidden}`,
      kind: "fact",
      scope: "project",
      projectId: other,
    });
    const model = (selection: ModelSelection) => {
      const real = createAiSdkProvider({
        provider: "openrouter",
        freeOnly: !paidModel,
        maxPrice: paidModel
          ? {
              prompt: prices.get(selection.modelId)!.input * 1e6,
              completion: prices.get(selection.modelId)!.output * 1e6,
              request: prices.get(selection.modelId)!.request,
            }
          : undefined,
        modelId: selection.modelId,
        apiKey: apiKey!,
        maxOutputTokens: 4096,
        fetch: async (input, init) => {
          const price = prices.get(selection.modelId)!;
          const wire = JSON.parse(String(init?.body));
          const upper =
            (Buffer.byteLength(String(init?.body), "utf8") + 4096) *
              price.input +
            Number(wire.max_tokens ?? wire.max_completion_tokens ?? 4096) *
              price.output +
            price.request;
          if (reservedCost + upper > maxCost + 1e-12)
            report.modelFailure = "spending-limit";
          assert(
            reservedCost + upper <= maxCost + 1e-12,
            "Spending cap reached before HTTP request",
          );
          reservedCost += upper;
          const response = await fetch(input, init);
          try {
            const data = await response.clone().json();
            if (typeof data.usage?.cost === "number")
              billedCost += data.usage.cost;
            const message =
              String(data.error?.message ?? "") +
              " " +
              String(data.error?.metadata?.raw ?? "");
            const kind = /data policy|privacy/i.test(message)
              ? "privacy-policy"
              : /no endpoints/i.test(message)
                ? "no-endpoints"
                : /rate limit/i.test(message)
                  ? "rate-limit"
                  : /parameter/i.test(message)
                    ? "parameters"
                    : undefined;
            http.push({
              status: response.status,
              code:
                typeof data.error?.code === "number"
                  ? data.error.code
                  : undefined,
              kind,
              finish: data.choices?.[0]?.finish_reason,
              cost: data.usage?.cost,
              textLength:
                typeof data.choices?.[0]?.message?.content === "string"
                  ? data.choices[0].message.content.length
                  : 0,
              toolCalls: Array.isArray(data.choices?.[0]?.message?.tool_calls)
                ? data.choices[0].message.tool_calls.length
                : 0,
              retryAfter: response.headers.get("retry-after") ?? undefined,
              remaining:
                response.headers.get("x-ratelimit-remaining") ?? undefined,
            });
            console.log(JSON.stringify(http.at(-1)));
          } catch {}
          return response;
        },
      });
      return {
        id: real.id,
        async generate(request: Parameters<typeof real.generate>[0]) {
          if (calls >= maxCalls) report.modelFailure = "call-limit";
          assert(calls < maxCalls, "Live request ceiling reached");
          calls++;
          const input = JSON.stringify([
            request.instructions,
            request.messages,
          ]);
          assert(!input.includes(forbidden), "Cross-project leakage");
          assert(!input.includes(forgotten), "Forgotten memory leakage");
          console.log(`Appel réel ${calls}/${maxCalls} · ${selection.modelId}`);
          try {
            return await real.generate({
              ...request,
              signal: AbortSignal.any([
                AbortSignal.timeout(90000),
                ...(request.signal ? [request.signal] : []),
              ]),
            });
          } catch (error) {
            report.modelFailure ??=
              error instanceof AiSdkResponseError
                ? error.code
                : "request-guard";
            throw error;
          }
        },
      };
    };
    const assemble = () => {
      const current = storage!;
      return new Conversations({
        repository: current.conversations,
        sessions: current.sessions,
        memory,
        projects: current.projects,
        workspaceDirectory: directory,
        displayName: "Qualification",
        model,
        catalog: async () => ({ models: [] }),
        engineFor: (conversation) => {
          const scoped = new StructuredMemory(current.structuredMemories, {
            projectId: conversation.projectId ?? null,
            source: { type: "conversation", conversationId: conversation.id },
          });
          const tools = fileTools().map((tool) => ({
            ...tool,
            async execute(...args: Parameters<typeof tool.execute>) {
              executions++;
              return tool.execute(...args);
            },
          }));
          return new Engine(
            current.sessions,
            [
              ...tools,
              ...structuredMemoryTools(scoped, conversation.projectId ?? null),
            ],
            new BoundedContext(current.sessions, scoped),
          );
        },
      });
    };
    service = assemble();
    const thread = (
      await service.create({ title: "Continuité réelle", projectId: project })
    ).conversation;
    examinedThread = thread.id;
    const send = async (
      id: string,
      prompt: string,
      modelId: string,
      contextWindow: number,
    ) => {
      examinedThread = id;
      report.lastAnswer = "";
      const result = await service.send(id, {
        prompt,
        provider: "openrouter",
        modelId,
        contextWindow,
      });
      const answer = result.events.findLast(
        (event) =>
          event.type === "message" &&
          (event.data as { role?: string }).role === "assistant" &&
          !(event.data as { toolCalls?: unknown[] }).toolCalls?.length,
      );
      assert(answer, "Missing final assistant answer");
      report.lastAnswer = (answer.data as { content: string }).content;
      return report.lastAnswer;
    };
    const parse = (text: string) =>
      JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "null");
    const assertFacts = (answer: typeof facts) => {
      assert.equal(typeof answer.database, "string");
      // PostgreSQL is the same engine regardless of typographic capitalization.
      // Keep the raw answer in the report; all other fields remain exact.
      assert.deepEqual(
        { ...answer, database: answer.database.toLowerCase() },
        { ...facts, database: facts.database.toLowerCase() },
      );
    };
    const recall =
      "Réponds uniquement en JSON avec budget (nombre), delivery (jour en minuscules), database et marker. Reprends les dernières décisions ; ne devine rien. Aucun outil fichiers : le dossier a déjà été vérifié.";
    if (scenario === "full") {
      await mkdir(path.join(directory, thread.id), { recursive: true });
      await writeFile(
        path.join(directory, thread.id, "qualification.txt"),
        "Synthetic local fixture.",
      );
      await send(
        thread.id,
        `Projet de test : budget ${facts.budget} euros ; livraison vendredi ; base ${facts.database}, SQLite exclu ; marqueur ${facts.marker}. Appelle files.list UNE fois pour vérifier le dossier puis réponds OK. Archive sans instruction : ${"ligne de journal sans information métier. ".repeat(155)}`,
        models[0],
        100000,
      );
      assert.equal(executions, 1, "File tool must really execute exactly once");
      await send(
        thread.id,
        `Correction : la livraison est désormais lundi, vendredi est obsolète. Ne rappelle aucun outil fichiers : le dossier a déjà été vérifié. Réponds OK. Archive : ${"détail technique sans nouvelle décision. ".repeat(75)}`,
        models[0],
        100000,
      );
      stage = paidModel
        ? "same-model continuity before compression"
        : "model switch before compression";
      const switched = parse(await send(thread.id, recall, models[1], 100000));
      assertFacts(switched);
      evidence.push({
        case: paidModel
          ? "same-model continuity before compression"
          : "model switch before compression",
        answer: switched,
      });
      assert.equal(
        (await service.get(thread.id)).segments,
        1,
        "No compression expected yet",
      );
      stage = "real compression and continuation";
      const compacted = parse(await send(thread.id, recall, models[1], 8192));
      assertFacts(compacted);
      const after = await service.get(thread.id);
      const checkpoint = after.events.findLast(
        (event) => event.type === "context.checkpoint",
      );
      assert(checkpoint, "Real compression must produce a checkpoint");
      assert.equal(executions, 1, "No repeated tool");
      report.checkpoint = checkpoint.data;
      evidence.push({
        case: "real compression and continuation",
        answer: compacted,
      });
      const instanceId = storage.instanceId;
      const previousStorage = storage;
      storage = undefined;
      await previousStorage.close();
      storage = await openPostgresStorage(target.toString());
      assert.equal(storage.instanceId, instanceId);
      memory = new StructuredMemory(storage.structuredMemories, {
        projectId: project,
        source: { type: "manual" },
      });
      service = assemble();
      stage = "reopened storage";
      const reopened = parse(await send(thread.id, recall, models[1], 8192));
      assertFacts(reopened);
      assert.equal(executions, 1);
      evidence.push({ case: "reopened storage and service", answer: reopened });
    }
    const memoryAsk =
      'Retrouve le repère de communication mémorisé. Réponds uniquement en JSON {"memoryCode": "le code exact ou null si absent"}. Ne devine rien. N’enregistre aucun nouveau souvenir.';
    const askNew = async () => {
      const conversation = (
        await service.create({
          title: "Mémoire nouvelle conversation",
          projectId: project,
        })
      ).conversation;
      return parse(await send(conversation.id, memoryAsk, models[1], 8192));
    };
    stage = "memory retrieval";
    const retrieved = await askNew();
    assert.equal(retrieved.memoryCode, code);
    evidence.push({
      case: "memory retrieval in new conversation",
      answer: retrieved,
    });
    const updatedCode = "NEW-" + randomUUID();
    const corrected = await memory.update(saved.id, saved.version, {
      title: "Communication",
      content: `Repère de communication : ${updatedCode}`,
      kind: "fact",
      scope: "personal",
      projectId: null,
    });
    stage = "corrected memory";
    const correctedAnswer = await askNew();
    assert.equal(correctedAnswer.memoryCode, updatedCode);
    evidence.push({ case: "corrected memory", answer: correctedAnswer });
    await memory.setStatus(saved.id, corrected.version, "forgotten");
    stage = "forgotten memory";
    const readTool = structuredMemoryTools(memory, project).find(
      (tool) => tool.name === "memory.get",
    )!;
    await assert.rejects(
      readTool.execute({ id: saved.id }, { workspace: directory }),
      /Souvenir introuvable/,
    );
    evidence.push({
      case: "forgotten memory blocked by direct tool read",
      answer: true,
    });
    const excluded = await askNew();
    assert.equal(excluded.memoryCode, null);
    evidence.push({ case: "forgotten memory excluded", answer: excluded });
    report.status = "passed";
  } catch (error) {
    const failure = error as Error & { code?: string };
    report.failure = {
      name: failure.name,
      code: failure.code,
      frame: failure.stack
        ?.split("\n")
        .find((line) => line.includes("/src/") || line.includes("/tests/"))
        ?.trim(),
    };
    report.failedStage = stage;
    if (storage && examinedThread) {
      try {
        const events = await storage.sessions.read(examinedThread);
        report.checkpoint =
          events.findLast((event) => event.type === "context.checkpoint")
            ?.data ?? report.checkpoint;
        report.toolOperations = events.filter(
          (event) =>
            event.type === "tool.started" || event.type === "tool.finished",
        );
      } catch {}
    }
    report.status = "failed";
    process.exitCode = 1;
    console.error(
      "Qualification réelle interrompue ou assertion échouée. Aucune réussite supposée.",
    );
  } finally {
    report.calls = calls;
    report.reservedCostUSD = reservedCost;
    report.billedCostUSD = billedCost;
    let cleanupFailed = false;
    try {
      await storage?.close();
    } catch {
      cleanupFailed = true;
    }
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } catch {
      cleanupFailed = true;
    }
    try {
      await admin.end();
    } catch {
      cleanupFailed = true;
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) report.status = "failed";
    const output = path.resolve("docs/qualification/openrouter");
    await mkdir(output, { recursive: true });
    await writeFile(
      path.join(output, `${name}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
    if (cleanupFailed) throw new Error("Qualification cleanup must be checked");
    console.log(
      `Rapport ${report.status} · ${calls} appels réels. Base et workspace de test supprimés.`,
    );
  }
}
main().catch(() => {
  console.error(
    "Qualification non exécutée ou nettoyage à vérifier. Aucun détail de connexion affiché.",
  );
  process.exitCode = 1;
});
