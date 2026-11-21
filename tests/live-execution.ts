/** Opt-in: real ChatGPT, disposable web app and YOLO worker; no owner conversation changes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { ChatGptProvider } from "../src/modules/models/chatgpt/index.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { openHostTerminal } from "../src/app/host-terminal.ts";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import type { ModelRequest } from "../src/contracts/models.ts";

const token = execFileSync(
  "runuser",
  [
    "-u",
    "personal-harness",
    "--",
    process.execPath,
    "/projects/nora-heart/node_modules/tsx/dist/cli.mjs",
    "-e",
    "import {ChatGptAuth} from '/projects/nora-heart/src/modules/models/chatgpt/index.ts';new ChatGptAuth({directory:'/var/lib/personal-harness/chatgpt'}).accessToken().then(t=>process.stdout.write(t)).catch(()=>{console.error('Private authorization unavailable');process.exitCode=1});",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
).toString();
const modelId = "gpt-6-luna",
  real = new ChatGptProvider({
    modelId,
    reasoningEffort: "medium",
    accessToken: async () => token,
  });
const catalog = await real.models(),
  entry = catalog.find((m) => m.id === modelId);
assert(entry?.contextWindow);
const root = await mkdtemp(path.join(os.tmpdir(), "heart-live-execution-")),
  directory = path.join(root, "app"),
  threads = path.join(directory, "conversations"),
  socket = path.join(root, "host.sock");
await mkdir(threads, { recursive: true });
const worker = await openHostTerminal({
  socket,
  directory: path.join(root, "commands"),
  workspaceDirectory: threads,
  home: path.join(root, "home"),
});
const prior = process.env.HARNESS_HOST_SOCKET;
process.env.HARNESS_HOST_SOCKET = socket;
const file = path.join(root, "history.sqlite");
await migrateSqlite(file);
const lab = new TestLab({
  directory: path.join(root, "lab"),
  authDirectory: path.join(root, "auth"),
});
await lab.prepare();
let calls = 0;
const historyReads = new Map<string, any>();
lab.capabilities = async () =>
  process.argv.includes("--retention")
    ? { ...entry, contextWindow: 32768 }
    : entry;
lab.models = async () => ({
  models: process.argv.includes("--retention")
    ? catalog.map((model) =>
        model.id === modelId ? { ...model, contextWindow: 32768 } : model,
      )
    : catalog,
});
lab.model = () => ({
  id: real.id,
  async generate(request: ModelRequest) {
    if (process.argv.includes("--retention"))
      for (const message of request.messages) {
        if (message.role === "tool" && message.name === "history.read") {
          try {
            historyReads.set(message.callId, JSON.parse(message.content));
          } catch {}
        }
      }
    if (++calls > 40) throw Error("Live execution call budget exceeded");
    const call = calls,
      started = Date.now();
    console.log(
      JSON.stringify({
        call,
        stage: "model-start",
        review: request.tools.some((t) => t.name === "memory.assess"),
      }),
    );
    try {
      const response = await real.generate({
        ...request,
        signal: AbortSignal.any([
          AbortSignal.timeout(180_000),
          ...(request.signal ? [request.signal] : []),
        ]),
        onActivity: (phase) => {
          request.onActivity?.(phase);
          console.log(JSON.stringify({ call, phase }));
        },
      });
      for (const tool of response.toolCalls) {
        if (tool.name === "files.update" || tool.name === "files.replace") {
          const args = tool.arguments as { path: string; revision: string };
          const previous = request.messages.findLast((m) => {
            if (m.role !== "tool" || m.name !== "files.read") return false;
            try {
              return JSON.parse(m.content).path === args.path;
            } catch {
              return false;
            }
          });
          console.log(
            JSON.stringify({
              call,
              tool: tool.name,
              revision: args.revision,
              readRevision:
                previous?.role === "tool"
                  ? JSON.parse(previous.content).revision
                  : null,
            }),
          );
        }
      }
      return response;
    } finally {
      console.log(
        JSON.stringify({
          call,
          stage: "model-end",
          elapsedMs: Date.now() - started,
        }),
      );
    }
  },
});
const app = await openWebConversations(
  { driver: "sqlite", file },
  directory,
  lab,
);
const cases: unknown[] = [];
try {
  await mkdir("docs/qualification/execution", { recursive: true });
  await app.assistant.save({
    version: 0,
    settings: {
      ...defaultAssistant,
      ...(process.argv.includes("--inspection") ||
      process.argv.includes("--retention")
        ? { initiative: "proactive" as const, personality: "creative" as const }
        : {}),
      completed: true,
      step: 5,
      conversationDefaults: {
        selection: {
          provider: "chatgpt",
          modelId,
          reasoningEffort: "medium",
          contextWindow: entry.contextWindow,
          capacitySource: "catalog",
        },
        fileAccess: "develop",
        networkAccess: false,
      },
    },
  });
  const { conversation } = await app.conversations.create({
      title: "Execution QA",
    }),
    workspace = path.join(threads, conversation.id);
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "value.txt"), "before\n");
  const send = (prompt: string) =>
    app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: "medium",
      contextWindow: entry.contextWindow,
      prompt,
    });
  const qualify = async (
    result: Awaited<ReturnType<typeof send>>,
    label: string,
  ) => {
    await writeFile(
      "docs/qualification/execution/" + label + ".json",
      JSON.stringify(result.events, null, 2),
    );
    const runId = result.events.findLast(
      (e) => e.type === "run.started",
    )!.runId;
    const names = result.events
      .filter((e) => e.runId === runId && e.type === "tool.started")
      .map((e) => (e.data as any).name);
    const final = String(
      (
        result.events.findLast(
          (e) =>
            e.type === "message" &&
            (e.data as any).role === "assistant" &&
            !(e.data as any).toolCalls?.length,
        )?.data as any
      )?.content ?? "",
    );
    assert(final.length > 0);
    assert(
      !result.events.some((e) => e.type === "interaction.requested"),
      "No permission form for already authorized action",
    );
    assert(names.some((n) => n === "files.read"));
    assert(names.some((n) => n === "files.update" || n === "files.replace"));
    assert(names.includes("terminal.exec"));
    assert(
      !names.includes("terminal.read"),
      "Short verifier output must be available inline",
    );
    cases.push({ label, tools: names, answer: final });
    console.log(JSON.stringify({ label, tools: names, answer: final }));
  };
  if (process.argv.includes("--retention")) {
    await app.conversations.fileAccess(conversation.id, { access: "none" });
    const reference = "COMPTA-" + randomUUID().slice(0, 8),
      code = "DOSSIER-" + randomUUID().slice(0, 8),
      storage = await openSqliteStorage(file);
    const seed = async (count: number, first = false) => {
      for (let i = 0; i < count; i++) {
        const fact =
          first && i === 0
            ? `Référence comptable : ${reference}. Code du dossier : ${code}. Livraison le 2027-02-18 à 10:30 Indian/Reunion, montant 9876,54 EUR. Données de test fictives. `
            : "";
        for (const message of [
          {
            role: "user",
            content:
              fact +
              "Notes de discussion sans décision supplémentaire. ".repeat(260),
          },
          { role: "assistant", content: "Bien reçu.", toolCalls: [] },
        ])
          await storage.sessions.append(conversation.id, {
            id: randomUUID(),
            runId: randomUUID(),
            at: new Date().toISOString(),
            type: "message",
            data: message as any,
          });
      }
    };
    const reply = async (prompt: string, label: string) => {
      const result = await app.conversations.send(conversation.id, {
        provider: "chatgpt",
        modelId,
        reasoningEffort: "medium",
        contextWindow: 32768,
        prompt,
      });
      const runId = result.events.findLast(
          (e) => e.type === "run.started",
        )!.runId,
        events = result.events.filter((e) => e.runId === runId);
      const answer = String(
        (
          events.findLast(
            (e) =>
              e.type === "message" &&
              (e.data as any).role === "assistant" &&
              !(e.data as any).toolCalls?.length,
          )?.data as any
        )?.content ?? "",
      );
      assert(!events.some((e) => e.type === "interaction.requested"));
      assert(answer.length);
      const tools = events
        .filter((e) => e.type === "tool.started")
        .map((e) => (e.data as any).name);
      await writeFile(
        "docs/qualification/execution/" + label + ".json",
        JSON.stringify(events, null, 2),
      );
      console.log(JSON.stringify({ label, tools, answer }));
      cases.push({ label, tools, answer });
      return { answer, events, tools };
    };
    try {
      await seed(8, true);
      const first = await reply(
        "Rappelle le code du dossier, sa date de livraison et son montant. Réponds simplement ; données QA, rien à mémoriser.",
        "retention-first-compression",
      );
      assert(first.answer.includes(code));
      assert(first.answer.replace(/[^0-9]/g, "").includes("987654"));
      const checkpointCount = (
        await storage.sessions.read(conversation.id)
      ).filter((e) => e.type === "context.checkpoint").length;
      assert(checkpointCount > 0);
      await seed(6);
      const second = await reply(
        "On continue : rappelle le même code de dossier, la date et le montant convenus au début.",
        "retention-second-compression",
      );
      assert(second.answer.includes(code));
      assert(second.answer.replace(/[^0-9]/g, "").includes("987654"));
      assert(
        (await storage.sessions.read(conversation.id)).filter(
          (e) => e.type === "context.checkpoint",
        ).length > checkpointCount,
      );
      const recovered = await reply(
        "Relis les messages originaux avec history.read pour retrouver la référence comptable donnée au début. Cite sa valeur et le message source.",
        "retention-original-history",
      );
      assert(recovered.tools.includes("history.read"));
      assert(recovered.answer.includes(reference));
      assert(
        [...historyReads.values()].some((page) =>
          page.messages?.some((entry: any) =>
            JSON.stringify(entry).includes(reference),
          ),
        ),
        "The original source must actually reach the model, not just the checkpoint",
      );
      await writeFile(
        "docs/qualification/execution/retention-history-receipts.json",
        JSON.stringify([...historyReads.values()], null, 2),
      );
      await reply(
        "Prépare un message court, sympathique et professionnel pour Madame Martin, cliente fictive jamais contactée, pour confirmer la livraison. Ne l’envoie pas.",
        "friendly-external-draft",
      );
      const originals = (await storage.sessions.read(conversation.id)).filter(
        (e) => e.type === "message",
      );
      assert(originals.some((e) => JSON.stringify(e.data).includes(reference)));
    } finally {
      await storage.close();
    }
  } else if (process.argv.includes("--inspection")) {
    const sendTo = (id: string, prompt: string) =>
      app.conversations.send(id, {
        provider: "chatgpt",
        modelId,
        reasoningEffort: "medium",
        contextWindow: entry.contextWindow,
        prompt,
      });
    const details = async (
      result: Awaited<ReturnType<typeof send>>,
      label: string,
    ) => {
      const runId = result.events.findLast(
          (e) => e.type === "run.started",
        )!.runId,
        events = result.events.filter((e) => e.runId === runId);
      const answer = String(
        (
          events.findLast(
            (e) =>
              e.type === "message" &&
              (e.data as any).role === "assistant" &&
              !(e.data as any).toolCalls?.length,
          )?.data as any
        )?.content ?? "",
      );
      const names = events
        .filter((e) => e.type === "tool.started")
        .map((e) => (e.data as any).name);
      const toolMessages = events
        .filter((e) => e.type === "message" && (e.data as any).role === "tool")
        .map((e) => {
          let value;
          try {
            value = JSON.parse((e.data as any).content);
          } catch {
            value = { error: true };
          }
          return { ...value, name: (e.data as any).name };
        });
      assert(answer.length > 0);
      assert(!events.some((e) => e.type === "interaction.requested"));
      await writeFile(
        "docs/qualification/execution/" + label + ".json",
        JSON.stringify(events, null, 2),
      );
      console.log(JSON.stringify({ label, tools: names, answer }));
      return { answer, names, toolMessages };
    };
    if (!process.argv.includes("--execution-only")) {
      await app.conversations.fileAccess(conversation.id, { access: "yolo" });
      const storage = await openSqliteStorage(file);
      try {
        await storage.sessions.append(conversation.id, {
          id: randomUUID(),
          runId: randomUUID(),
          at: new Date().toISOString(),
          type: "message",
          data: {
            role: "user",
            content:
              "Avec les outils tu peux inspecter le code du Harness. Fais-le pour expliquer son fonctionnement.",
          },
        });
        await storage.sessions.append(conversation.id, {
          id: randomUUID(),
          runId: randomUUID(),
          at: new Date().toISOString(),
          type: "message",
          data: {
            role: "assistant",
            content:
              "Je ne peux pas inspecter le code du Harness avec mes outils.",
            toolCalls: [],
          },
        });
      } finally {
        await storage.close();
      }
      const inspection = await details(
        await sendTo(
          conversation.id,
          "On recommence. Donne-moi une description complète du fonctionnement de ce harness.",
        ),
        "inspection-and-confidence",
      );
      assert(
        inspection.toolMessages.some(
          (t) => t.name === "files.read" && String(t.path).includes("/src/"),
        ),
        "Use files for source inspection",
      );
      assert(
        inspection.toolMessages.some(
          (t) =>
            (t.name === "files.read" &&
              String(t.path).includes("src/core/engine.ts")) ||
            (t.name === "terminal.exec" &&
              String(t.command).includes("core/engine.ts")),
        ),
        "Inspect the actual engine implementation, not just documentation",
      );
      cases.push({
        label: "inspection-and-confidence",
        tools: inspection.names,
        answer: inspection.answer,
      });
      const runtime = await details(
        await sendTo(
          conversation.id,
          "Quels stockage des conversations, backend mémoire et cerveau sont sélectionnés pour CE fil ?",
        ),
        "runtime-facts",
      );
      assert.match(runtime.answer, /SQLite/i);
      assert(
        runtime.answer
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .includes(modelId.replace(/[^a-z0-9]/g, "")),
      );
      cases.push({
        label: "runtime-facts",
        tools: runtime.names,
        answer: runtime.answer,
      });
    }
    const diagnostic = (
      await app.conversations.create({ title: "Pagination QA" })
    ).conversation;
    await app.conversations.fileAccess(diagnostic.id, { access: "yolo" });
    const script = path.join(root, "diagnostic.mjs"),
      marker = "verdict-" + randomUUID();
    await writeFile(
      script,
      `process.stdout.write('log'.repeat(24000)+'\\nFINAL ${marker}\\n');`,
    );
    const paged = await details(
      await sendTo(
        diagnostic.id,
        `Exécute exactement la commande node ${script}, puis donne-moi le verdict final qu’elle imprime. Données QA uniquement, ne modifie pas le script.`,
      ),
      "partial-output-followed",
    );
    assert(
      paged.toolMessages.some(
        (t) => t.name === "terminal.exec" && t.more === true,
      ),
    );
    assert(paged.names.includes("terminal.read"));
    assert(paged.answer.includes(marker));
    cases.push({
      label: "partial-output-followed",
      tools: paged.names,
      answer: paged.answer,
    });
    const development = (
      await app.conversations.create({ title: "Development QA" })
    ).conversation;
    const work = path.join(threads, development.id);
    await mkdir(work, { recursive: true });
    await writeFile(
      path.join(work, "calc.mjs"),
      "export function sum(a,b){return a-b;}\n",
    );
    await writeFile(
      path.join(work, "test.mjs"),
      "import assert from 'node:assert/strict';import{sum}from'./calc.mjs';assert.equal(sum(2,3),5);assert.equal(sum(-2,3),1);console.log('tests-ok');\n",
    );
    const edited = await details(
      await sendTo(
        development.id,
        "La fonction sum de calc.mjs calcule mal. Corrige-la et vérifie avec node test.mjs. Termine le travail et donne le résultat. Ce sont des fichiers QA, rien à mémoriser.",
      ),
      "autonomous-code-fix",
    );
    assert(edited.names.includes("files.read"));
    assert(
      edited.names.some((n) => n === "files.replace" || n === "files.update"),
    );
    assert(edited.names.includes("terminal.exec"));
    assert(
      edited.toolMessages.some(
        (t) =>
          t.name === "terminal.exec" &&
          t.exitCode === 0 &&
          t.output.includes("tests-ok"),
      ),
    );
    assert.notEqual(
      await readFile(path.join(work, "calc.mjs"), "utf8"),
      "export function sum(a,b){return a-b;}\n",
    );
    cases.push({
      label: "autonomous-code-fix",
      tools: edited.names,
      answer: edited.answer,
    });
  } else {
    await qualify(
      await send(
        "Dans value.txt remplace before par protected-ok avec les outils fichiers, puis exécute une commande terminal courte pour vérifier son contenu et le code de sortie. Termine le travail et donne le résultat. Données de test uniquement, rien à mémoriser.",
      ),
      "protected-file-edit-and-command",
    );
    assert.equal(
      await readFile(path.join(workspace, "value.txt"), "utf8"),
      "protected-ok\n",
    );
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "external-before\n");
    await assert.rejects(
      app.conversations.inspectWorkspace(conversation.id, outside, true),
    );
    await app.conversations.fileAccess(conversation.id, { access: "yolo" });
    await qualify(
      await send(
        `Dans le fichier de test ${outside}, lis puis remplace external-before par yolo-ok avec tes outils fichiers. Vérifie le contenu et le code de sortie avec une commande terminal courte. Exécute maintenant et termine. N'agis que sur ce fichier de test, rien à mémoriser.`,
      ),
      "yolo-absolute-file-edit-and-command",
    );
    assert.equal(await readFile(outside, "utf8"), "yolo-ok\n");
    const inspected = await app.conversations.inspectWorkspace(
      conversation.id,
      outside,
      true,
    );
    assert("document" in inspected);
    assert.equal(inspected.document.content, "yolo-ok\n");
    await app.conversations.mutateWorkspace(conversation.id, {
      action: "update",
      path: outside,
      content: "owner-yolo-ok\n",
      revision: inspected.document.revision,
    });
    assert.equal(await readFile(outside, "utf8"), "owner-yolo-ok\n");
    cases.push({
      label: "owner-explorer-absolute-read-and-update",
      passed: true,
    });
    await app.conversations.fileAccess(conversation.id, { access: "read" });
    await assert.rejects(
      app.conversations.inspectWorkspace(conversation.id, outside, true),
    );
    await assert.rejects(
      app.conversations.startCommand(conversation.id, { command: "true" }),
    );
    cases.push({ label: "revoked-host-files-and-terminal", passed: true });
  }
  const report = {
    at: new Date().toISOString(),
    modelId,
    effort: "medium",
    realModelCalls: calls,
    ...(process.argv.includes("--retention")
      ? { qaContextWindow: 32768, actualModelContext: entry.contextWindow }
      : {}),
    cases,
    ownerBusinessWrites: 0,
    apiFallback: false,
  };
  await mkdir("docs/qualification/execution", { recursive: true });
  await writeFile(
    process.argv.includes("--retention")
      ? "docs/qualification/execution/retention.json"
      : process.argv.includes("--inspection")
        ? process.argv.includes("--execution-only")
          ? "docs/qualification/execution/inspection-execution.json"
          : "docs/qualification/execution/inspection.json"
        : "docs/qualification/execution/live.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ passed: true, realModelCalls: calls }));
} finally {
  await app.close();
  await lab.close();
  await worker.close();
  if (prior === undefined) delete process.env.HARNESS_HOST_SOCKET;
  else process.env.HARNESS_HOST_SOCKET = prior;
  await rm(root, { recursive: true, force: true });
}
