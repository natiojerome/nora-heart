/** Opt-in real ChatGPT/OpenRouter continuity. Isolated data; never an owner chat replay. */
import assert from "node:assert/strict";
import { createParser } from "eventsource-parser";
import { setTimeout as delay } from "node:timers/promises";
import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  stat,
  lstat,
} from "node:fs/promises";
import { parseEnv } from "node:util";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import {
  ChatGptAuth,
  ChatGptProvider,
} from "../src/modules/models/chatgpt/index.ts";
import { createAiSdkProvider } from "../src/modules/models/ai-sdk/index.ts";
import { estimateTokens } from "../src/modules/context/bounded/index.ts";
import type { ModelProvider, ModelRequest } from "../src/contracts/models.ts";
import type { Event } from "../src/contracts/storage.ts";

async function main() {
  if (!process.argv.includes("--live")) {
    console.log(
      "No live call. Add --live with the private Heart environment and a qualification ledger.",
    );
    return;
  }
  const env = parseEnv(
    await readFile(
      process.env.HARNESS_WEB_ENV_FILE ?? "/etc/personal-harness/web.env",
      "utf8",
    ),
  );
  const keyFile = env.HARNESS_WEB_STATE_DIR + "/api-keys.json";
  const keyStat = await lstat(keyFile);
  assert(
    keyStat.isFile() && !(keyStat.mode & 0o077),
    "Private key file required",
  );
  const key = JSON.parse(await readFile(keyFile, "utf8")).openrouter;
  assert(typeof key === "string" && key.length > 8, "OpenRouter key required");
  const owner = await stat(env.HARNESS_CHATGPT_AUTH_DIR!);
  if (process.getuid?.() === 0) {
    process.setgid!(owner.gid);
    process.setuid!(owner.uid);
  }
  const chatId = process.env.HARNESS_QUALIFY_CHATGPT_MODEL ?? "gpt-6.2-sol",
    routerId =
      process.env.HARNESS_QUALIFY_ROUTER_MODEL ??
      "deepseek/deepseek-v4-flash-0731";
  const ledgerFile = process.env.HARNESS_QUALIFY_LEDGER;
  assert(
    typeof ledgerFile === "string" &&
      ledgerFile.startsWith("/tmp/heart-continuity-"),
    "Explicit private qualification ledger required",
  );
  let ledger = { calls: 0, reservedUSD: 0, billedUSD: 0 };
  try {
    const saved = await lstat(ledgerFile);
    assert(
      saved.isFile() &&
        !(saved.mode & 0o077) &&
        saved.uid === process.getuid?.(),
    );
    ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  assert(
    Number.isInteger(ledger.calls) &&
      ledger.calls >= 0 &&
      Number.isFinite(ledger.reservedUSD) &&
      ledger.reservedUSD >= 0,
  );
  const maxCalls = 52,
    maxUSD = 0.05,
    maxOutputTokens = 4096,
    budget = 32768;
  const auth = new ChatGptAuth({ directory: env.HARNESS_CHATGPT_AUTH_DIR! });
  const chatModels = await new ChatGptProvider({
    modelId: "catalog",
    accessToken: (signal) => auth.accessToken(signal),
  }).models();
  const chatEntry = chatModels.find((m) => m.id === chatId);
  assert(chatEntry?.contextWindow);
  const catalogResponse = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(20000),
  });
  assert(catalogResponse.ok);
  const catalog = await catalogResponse.json(),
    router = catalog.data.find((m: any) => m.id === routerId);
  assert(router?.supported_parameters?.includes("tools"));
  const price = {
    prompt: Number(router.pricing.prompt),
    completion: Number(router.pricing.completion),
    request: Number(router.pricing.request ?? 0),
  };
  assert(Object.values(price).every((p) => Number.isFinite(p) && p >= 0));
  assert(router.context_length >= 100000);
  const root = await mkdtemp("/tmp/heart-continuity-data-"),
    file = root + "/state.sqlite",
    reportFile = "/tmp/heart-continuity-proof-" + randomUUID() + ".json";
  const report: any = {
    at: new Date().toISOString(),
    status: "incomplete",
    scope:
      "Real providers and full web assembly, memory review, tools, attachment hydration and SQLite; synthetic facts only, no owner conversation/memory/database writes",
    models: {
      chatgpt: { id: chatId, nativeContext: chatEntry.contextWindow },
      openrouter: {
        id: routerId,
        nativeContext: router.context_length,
        qualificationBudget: budget,
      },
    },
    limits: { maxCalls, maxUSD, maxOutputTokens },
    http: [],
    checks: [],
    archivePadding: { synthetic: true, providerGenerated: false },
    checkpoint: null,
  };
  let rateLimitRetries = 0;
  let stage = "setup",
    kind = "main",
    lastRequest: ModelRequest | undefined,
    forbidNewMemory: string[] = [];
  const forbidden = "FOREIGN-" + randomUUID(),
    old = "SUPPORT-" + randomUUID(),
    replacement = "UPDATED-" + randomUUID(),
    attachmentCode = "ATTACH-" + randomUUID(),
    marker = "WORK-" + randomUUID();
  const initialCalls = ledger.calls,
    initialReserved = ledger.reservedUSD;
  const traces: Promise<void>[] = [];
  function inspectStream(response: Response, row: any) {
    const reader = response.body?.getReader();
    if (!reader) return Promise.resolve();
    row.stream = { events: [], items: [] };
    const decoder = new TextDecoder();
    const shape = (item: any) => ({
      type: item.type,
      status: item.status,
      role: item.role,
      namespace: item.namespace,
      name: item.type === "function_call" ? item.name : undefined,
      parts: Array.isArray(item.content)
        ? item.content.map((part: any) => part.type)
        : undefined,
      argumentsJson:
        item.type === "function_call"
          ? (() => {
              try {
                JSON.parse(item.arguments);
                return true;
              } catch {
                return false;
              }
            })()
          : undefined,
    });
    let done = false,
      bytes = 0;
    const parser = createParser({
      onEvent(event) {
        if (event.data === "[DONE]") return;
        try {
          const value = JSON.parse(event.data);
          if (!row.stream.events.includes(value.type))
            row.stream.events.push(value.type);
          if (value.type === "response.output_item.done")
            row.stream.items.push(shape(value.item));
          if (
            [
              "response.completed",
              "response.failed",
              "response.incomplete",
              "error",
            ].includes(value.type)
          ) {
            row.stream.terminal = value.type;
            row.stream.status = value.response?.status;
            row.stream.code = value.response?.error?.code ?? value.code;
            row.stream.incompleteReason =
              value.response?.incomplete_details?.reason;
            row.stream.output = value.response?.output?.map(shape);
            done = true;
          }
        } catch {
          row.stream.parseError = true;
        }
      },
    });
    return (async () => {
      try {
        while (!done) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 8 * 1024 * 1024) break;
          parser.feed(decoder.decode(chunk.value, { stream: true }));
        }
      } catch {
        row.stream.readError = true;
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    })();
  }
  const transport =
    (provider: string): typeof fetch =>
    async (input, init) => {
      const wire = JSON.parse(String(init?.body));
      assert.equal(String(init?.method ?? "GET").toUpperCase(), "POST");
      assert.equal(
        wire.model,
        provider === "chatgpt" ? chatId : routerId,
        "No model fallback",
      );
      assert(ledger.calls < maxCalls, "Qualification call ceiling reached");
      let reserved = 0;
      if (provider === "openrouter") {
        const output = Number(wire.max_tokens ?? wire.max_completion_tokens);
        assert(
          Number.isInteger(output) && output > 0 && output <= maxOutputTokens,
        );
        reserved =
          (Buffer.byteLength(String(init?.body), "utf8") + 4096) *
            price.prompt +
          output * price.completion +
          price.request;
        assert(
          ledger.reservedUSD + reserved <= maxUSD + 1e-12,
          "Qualification spending ceiling reached before HTTP",
        );
      }
      ledger.calls++;
      ledger.reservedUSD += reserved;
      await writeFile(ledgerFile, JSON.stringify(ledger), { mode: 0o600 });
      const row: any = { provider, kind, modelId: wire.model };
      report.http.push(row);
      console.log(
        JSON.stringify({ stage, call: ledger.calls, provider, kind }),
      );
      const response = await fetch(input, init);
      row.status = response.status;
      if (provider === "chatgpt")
        traces.push(inspectStream(response.clone(), row));
      if (provider === "openrouter") {
        try {
          const data = await response.clone().json();
          row.retryAfter = response.headers.get("retry-after");
          if (data.error) row.errorCode = data.error.code;
          if (typeof data.usage?.cost === "number") {
            row.costUSD = data.usage.cost;
            ledger.billedUSD += row.costUSD;
            await writeFile(ledgerFile, JSON.stringify(ledger), {
              mode: 0o600,
            });
          }
        } catch {}
      }
      return response;
    };
  const lab = new TestLab({
    directory: root + "/lab",
    authDirectory: env.HARNESS_CHATGPT_AUTH_DIR!,
    displayName: "Qualification",
  });
  await lab.prepare();
  const originalModels = lab.models.bind(lab);
  lab.models = async (provider) =>
    provider === "chatgpt" ? { models: chatModels } : originalModels(provider);
  const controller = AbortSignal.timeout(15 * 60 * 1000);
  lab.model = (body) => {
    assert(
      ["chatgpt", "openrouter"].includes(String(body.provider)),
      "Only the two configured real providers",
    );
    const provider = String(body.provider);
    assert.equal(
      body.modelId,
      provider === "chatgpt" ? chatId : routerId,
      "Actual selected model required",
    );
    const real: ModelProvider =
      provider === "chatgpt"
        ? new ChatGptProvider({
            modelId: chatId,
            reasoningEffort: "low",
            accessToken: (signal) => auth.accessToken(signal),
            fetch: transport(provider),
          })
        : createAiSdkProvider({
            provider: "openrouter",
            modelId: routerId,
            apiKey: key,
            maxOutputTokens,
            maxPrice: {
              prompt: price.prompt * 1e6,
              completion: price.completion * 1e6,
              request: price.request,
            },
            fetch: transport(provider),
          });
    return {
      id: real.id,
      supportsTools: real.supportsTools,
      async generate(request) {
        kind = request.tools.some((tool) => tool.name === "memory.assess")
          ? "memory-review"
          : request.tools.length
            ? "main"
            : "summary";
        const content = JSON.stringify([
          request.instructions,
          request.messages,
        ]);
        assert(
          !content.includes(forbidden),
          "No cross-project memory exposure",
        );
        for (const value of forbidNewMemory)
          assert(
            !content.includes(value),
            "Forgotten value absent from fresh-thread provider input",
          );
        if (kind === "main") lastRequest = request;
        const attempt = () =>
          real.generate({
            ...request,
            signal: AbortSignal.any([
              controller,
              AbortSignal.timeout(180000),
              ...(request.signal ? [request.signal] : []),
            ]),
          });
        try {
          return await attempt();
        } catch (error) {
          const last = report.http.at(-1),
            retry = Number(last?.retryAfter ?? 20);
          if (
            provider !== "openrouter" ||
            (error as any)?.code !== "rate-limit" ||
            rateLimitRetries >= 1 ||
            ledger.calls >= maxCalls ||
            !Number.isFinite(retry) ||
            retry > 60
          )
            throw error;
          const seconds = Math.max(20, retry);
          rateLimitRetries++;
          report.rateLimitRetry = {
            provider,
            seconds,
            sameModel: true,
            sameRequest: true,
            noToolExecutionFromRejectedResponse: true,
          };
          console.log(
            JSON.stringify({
              stage,
              pauseSeconds: seconds,
              reason: "one-bounded-rate-limit-retry",
            }),
          );
          await delay(seconds * 1000, undefined, { signal: controller });
          return attempt();
        }
      },
    };
  };
  await migrateSqlite(file);
  const storage = await openSqliteStorage(file);
  let app = await openWebConversations(
    { driver: "sqlite", file },
    root + "/state",
    lab, undefined, undefined, storage.projects,
  );
  let id = "";
  const hash = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  const parse = (value: string) =>
    JSON.parse(value.match(/\{[\s\S]*\}/)?.[0] ?? "null");
  const records = () => storage.sessions.read(id);
  const writes = async () =>
    (await records()).filter(
      (e) =>
        e.type === "tool.started" &&
        /^files\.(create|update|replace|move|delete|mkdir)$/.test(
          (e.data as any).name,
        ),
    ).length;
  const final = async (
    thread: string,
    prompt: string,
    provider: "chatgpt" | "openrouter",
    contextWindow: number,
    attachmentIds?: string[],
  ) => {
    const result = await app.conversations.send(
      thread,
      {
        provider,
        modelId: provider === "chatgpt" ? chatId : routerId,
        contextWindow,
        prompt,
        ...(attachmentIds ? { attachmentIds } : {}),
      },
      controller,
    );
    assert(!result.pendingInput, "No unexpected human input");
    const events = await storage.sessions.read(thread);
    const last = events.findLast(
      (e) =>
        e.type === "message" &&
        (e.data as any).role === "assistant" &&
        !(e.data as any).toolCalls?.length,
    );
    const failure = events.findLast((e) => e.type === "run.failed");
    if (failure && (!last || events.indexOf(failure) > events.indexOf(last)))
      throw Error("Provider run failed: " + JSON.stringify(failure.data));
    assert(last, "Completed real answer required");
    const text = (last.data as { content: string }).content;
    const review = events.findLast(
      (e) =>
        e.runId === last.runId &&
        e.type === "run.progress" &&
        (e.data as any).kind === "review",
    );
    (report.answers ??= []).push({
      stage,
      text,
      review: (review?.data as any)?.audit ?? null,
    });
    assert.equal(
      (review?.data as any)?.audit?.status,
      "decided",
      "Memory review must complete; a warning is not silently accepted",
    );
    return text;
  };
  const recall =
    "Réponds uniquement en JSON sans texte autour : budget (nombre), delivery (jour en minuscules), database, marker, attachment (repère de la pièce jointe), support (repère de suivi mémorisé courant). Reprends nos dernières décisions et versions actives. Aucun outil d’écriture, ne recrée pas le fichier.";
  const checkFacts = (text: string, support: string) => {
    const data = parse(text);
    assert.equal(data.budget, 1370);
    assert.equal(data.delivery, "lundi");
    assert.equal(String(data.database).toLowerCase(), "postgresql");
    assert.equal(data.marker, marker);
    assert.equal(data.attachment, attachmentCode);
    assert.equal(data.support, support);
    return data;
  };
  try {
    const project = (
      await app.memories.createProject({ title: "Continuité réelle" })
    ).project;
    const other = (await app.memories.createProject({ title: "Autre projet" }))
      .project;
    await app.memories.create({
      title: "Repère du support",
      content: "Repère du support : " + forbidden,
      kind: "fact",
      scope: "project",
      projectId: other.id,
    });
    id = (
      await app.conversations.create({
        title: "Deux cerveaux réels",
        projectId: project.id,
      })
    ).conversation.id;
    await app.conversations.fileAccess(id, { access: "write" });
    const attachment = await app.conversations.upload(id, {
      name: "brief.txt",
      mediaType: "text/plain",
      data: Buffer.from(
        "Pièce jointe de qualification. Repère du document : " + attachmentCode,
      ).toString("base64"),
    });
    stage = "chatgpt-tools-and-memory";
    await final(
      id,
      `Nous travaillons sur un scénario isolé. Décisions du projet : budget 1370 euros, livraison vendredi, base PostgreSQL (SQLite exclu), marqueur ${marker}. Crée UNE fois preuve.txt avec le contenu exact « Projet ${marker} confirmé ». Puis mémorise explicitement le fait personnel « Repère du support : ${old} » (titre Repère du support). Consulte la pièce jointe et accuse réception avec son repère. Ne conserve en mémoire durable QUE le repère personnel demandé ; les décisions du scénario restent dans le fil. Tu peux regrouper les appels indépendants. Ne lance aucune autre écriture fichier.`,
      "chatgpt",
      chatEntry.contextWindow,
      [attachment.id],
    );
    assert.equal(await writes(), 1);
    let memory = (await app.memories.list()).memories.find(
      (m) => m.status === "active" && m.content.includes(old),
    );
    assert(memory, "Memory really written by the real model/tool");
    const workspace = root + "/state/conversations/" + id,
      firstFile = await readFile(workspace + "/preuve.txt"),
      fileDigest = hash(firstFile);
    assert(firstFile.toString("utf8").includes(marker));
    report.checks.push({
      case: stage,
      status: "passed",
      fileWrites: 1,
      memoryId: memory.id,
      attachmentId: attachment.id,
    });
    stage = "chatgpt-decision-correction";
    await final(
      id,
      "Correction définitive du planning : la livraison est lundi, vendredi est obsolète. Budget, base, repères et fichier inchangés. Ne réécris pas preuve.txt. Cette correction appartient seulement au fil, ne la mémorise pas en mémoire durable. Réponds simplement OK.",
      "chatgpt",
      chatEntry.contextWindow,
    );
    stage = "switch-without-forced-compression";
    const checkpointsBefore = (await records()).filter(
      (e) => e.type === "context.checkpoint",
    ).length;
    await app.conversations.selectModel(id, {
      provider: "openrouter",
      modelId: routerId,
      contextWindow: 100000,
    });
    assert.equal(
      (await records()).filter((e) => e.type === "context.checkpoint").length,
      checkpointsBefore,
    );
    const beforeCompression = checkFacts(
      await final(id, recall, "openrouter", 100000),
      old,
    );
    assert.equal(
      (await records()).filter((e) => e.type === "context.checkpoint").length,
      checkpointsBefore,
    );
    report.checks.push({
      case: stage,
      status: "passed",
      answer: beforeCompression,
    });
    stage = "actual-smaller-budget-compression";
    assert(lastRequest);
    const target = Math.floor((budget - 4096) * 0.8) + 3500;
    const needed = Math.max(
      1,
      Math.ceil(((target - estimateTokens(lastRequest)) * 3) / 6500),
    );
    const padding: Event[] = Array.from({ length: needed }, () => ({
      id: randomUUID(),
      runId: "synthetic-padding",
      at: new Date().toISOString(),
      type: "message",
      data: {
        role: "user",
        content:
          "ARCHIVE DE CHARGE SYNTHÉTIQUE, sans fait métier ni instruction. " +
          "Journal technique archivé sans décision nouvelle. ".repeat(130),
      },
    }));
    await storage.sessions.appendBatch(id, padding);
    report.archivePadding.messages = padding.length;
    await app.conversations.selectModel(id, {
      provider: "openrouter",
      modelId: routerId,
      contextWindow: budget,
    });
    const answer = checkFacts(
      await final(id, recall, "openrouter", budget),
      old,
    );
    const checkpoint = (await records()).findLast(
      (e) => e.type === "context.checkpoint",
    );
    assert(checkpoint, "Real checkpoint required");
    const checkpointData = checkpoint.data as any;
    assert(checkpointData.providerId.includes(routerId));
    assert(checkpointData.coveredMessages > 0);
    assert(
      report.http.some(
        (item: any) => item.kind === "summary" && item.status === 200,
      ),
    );
    report.checkpoint = { ...checkpointData };
    report.checks.push({ case: stage, status: "passed", answer });
    stage = "cold-reopen";
    await app.close();
    app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/state",
      lab, undefined, undefined, storage.projects,
    );
    const restored = await app.conversations.get(id);
    assert.equal(restored.conversation.selection?.provider, "openrouter");
    assert.equal(restored.conversation.selection?.modelId, routerId);
    assert.equal(restored.segments, checkpointsBefore + 2);
    const source = await storage.chatAssets.attachment(id, attachment.id);
    assert(source && source.file.used);
    assert.equal(
      hash(source.bytes),
      hash(
        Buffer.from(
          "Pièce jointe de qualification. Repère du document : " +
            attachmentCode,
        ),
      ),
    );
    assert.equal(hash(await readFile(workspace + "/preuve.txt")), fileDigest);
    assert.equal(await writes(), 1);
    report.checks.push({
      case: stage,
      status: "passed",
      sameConversationId: true,
      attachmentBytesPreserved: true,
      fileHashPreserved: true,
      noToolReplay: true,
      semanticRecallCheckedInNextCase: true,
    });
    stage = "memory-correction-over-stale-summary";
    memory = (await app.memories.get(memory!.id)).memory;
    const updated = (
      await app.memories.update(memory.id, {
        version: memory.version,
        title: "Repère du support",
        content: "Repère du support : " + replacement,
        kind: "fact",
        scope: "personal",
      })
    ).memory;
    assert(updated.version > memory.version);
    checkFacts(await final(id, recall, "openrouter", budget), replacement);
    report.checks.push({
      case: stage,
      status: "passed",
      version: updated.version,
    });
    stage = "forgotten-memory-in-new-thread";
    await app.memories.status(updated.id, {
      version: updated.version,
      status: "forgotten",
    });
    assert.equal(
      (await app.memories.get(updated.id)).memory.status,
      "forgotten",
    );
    forbidNewMemory = [old, replacement];
    const fresh = (
      await app.conversations.create({
        title: "Après oubli",
        projectId: project.id,
      })
    ).conversation.id;
    const forgottenAnswer = parse(
      await final(
        fresh,
        'Quel est mon repère du support ? Consulte la mémoire active si nécessaire, ne devine pas. Réponds seulement en JSON {"support":null} si aucun repère actif n’est disponible, sinon sa valeur.',
        "openrouter",
        budget,
      ),
    );
    assert.equal(forgottenAnswer.support, null);
    report.checks.push({
      case: stage,
      status: "passed",
      answer: forgottenAnswer,
      freshThreadInputContainsForgottenValues: false,
      oldHistoryAndCheckpointPreserved: true,
    });
    assert.equal(
      await writes(),
      1,
      "No mutating file tool replay after the complete scenario",
    );
    assert.equal(hash(await readFile(workspace + "/preuve.txt")), fileDigest);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.failedStage = stage;
    report.failure = {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown",
      code: (error as any)?.code,
    };
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(traces);
    if (id) {
      report.finalFileWrites = await writes();
      report.events = (await records()).length;
      report.checkpoint ??=
        (await records()).findLast((e) => e.type === "context.checkpoint")
          ?.data ?? null;
      report.toolOperations = (await records())
        .filter((e) => e.type === "tool.started" || e.type === "tool.finished")
        .map((e) => ({
          type: e.type,
          name: (e.data as any).name,
          error: (e.data as any).error,
        }));
    }
    report.totalLedger = { ...ledger, maxCalls, maxUSD };
    report.thisRun = {
      calls: ledger.calls - initialCalls,
      reservedUSD: ledger.reservedUSD - initialReserved,
    };
    await app.close();
    await storage.close();
    await lab.close();
    if (
      report.status === "passed" ||
      !process.argv.includes("--keep-on-failure")
    ) {
      await rm(root, { recursive: true, force: true });
      report.temporaryDataRemoved = true;
    } else {
      report.temporaryDataRemoved = false;
      report.privateRecovery = {
        root,
        conversationId: id,
        old,
        replacement,
        marker,
        attachmentCode,
        forbidden,
      };
    }
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        status: report.status,
        reportFile,
        calls: report.thisRun.calls,
        reservedUSD: report.thisRun.reservedUSD,
        billedUSD: ledger.billedUSD,
        failedStage: report.failedStage,
      }),
    );
  }
}
await main();
