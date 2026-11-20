/** Opt-in: real ChatGPT, disposable web app and YOLO worker; no owner conversation changes. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ChatGptProvider } from "../src/modules/models/chatgpt/index.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { openHostTerminal } from "../src/app/host-terminal.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
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
lab.capabilities = async () => entry;
lab.models = async () => ({ models: catalog });
lab.model = () => ({
  id: real.id,
  async generate(request: ModelRequest) {
    if (++calls > 26) throw Error("Live execution call budget exceeded");
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
  const report = {
    at: new Date().toISOString(),
    modelId,
    effort: "medium",
    realModelCalls: calls,
    cases,
    ownerBusinessWrites: 0,
    apiFallback: false,
  };
  await mkdir("docs/qualification/execution", { recursive: true });
  await writeFile(
    "docs/qualification/execution/live.json",
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
