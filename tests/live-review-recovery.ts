/** Opt-in: real model, disposable web composition and deliberately failing auxiliary reviews. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { ChatGptProvider } from "../src/modules/models/chatgpt/index.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite, openSqliteStorage } from "../src/modules/storage/sqlite/index.ts";
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
const modelId = "gpt-6-luna";
const real = new ChatGptProvider({
  modelId,
  reasoningEffort: "medium",
  accessToken: async () => token,
});
const catalog = await real.models(),
  entry = catalog.find((m) => m.id === modelId);
assert(entry?.contextWindow);
const root = await mkdtemp(path.join(os.tmpdir(), "heart-review-recovery-")),
  file = path.join(root, "history.sqlite"),
  lab = new TestLab({
    directory: path.join(root, "lab"),
    authDirectory: path.join(root, "auth"),
  });
let mode: "invalid-quote" | "unavailable" | "real" = "invalid-quote",
  calls = 0,
  reviews = 0;
const cases: any[] = [];
await lab.prepare();
await migrateSqlite(file);
lab.capabilities = async () => entry;
lab.models = async () => ({ models: catalog });
lab.model = () => ({
  id: real.id,
  async generate(request: ModelRequest) {
    if (request.tools.some((t) => t.name === "memory.assess")) {
      reviews++;
      assert(
        JSON.parse(request.messages[0].content).primaryToolNames.includes(
          "files.read",
        ),
      );
      if (mode === "unavailable")
        throw new Error("Private provider diagnostic must never be published");
      if (mode === "invalid-quote")
        return {
          content: "",
          toolCalls: [
            {
              id: randomUUID(),
              name: "memory.assess",
              arguments: {
                decisions: [
                  { action: "none", evidence: "", note: "QA injected fault" },
                ],
                memoryCorrection: {
                  claim: "A quote absent from the draft",
                  issue: "Fault injection",
                },
              },
            },
          ],
        };
    }
    if (++calls > 14)
      throw Error("Live recovery qualification call budget exceeded");
    return real.generate(request);
  },
});
const app = await openWebConversations(
  { driver: "sqlite", file },
  path.join(root, "app"),
  lab,
);
try {
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
        fileAccess: "read",
        networkAccess: false,
      },
    },
  });
  const { conversation } = await app.conversations.create({
    title: "Review recovery QA",
  });
  const send = async (prompt: string) =>
    app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId,
      reasoningEffort: "medium",
      contextWindow: entry.contextWindow,
      prompt,
    });
  const explanation = await send(
    "Du coup description du fonctionnement ? Je parle du Harness.",
  );
  const final = (r: typeof explanation) =>
    String(
      (
        r.events.findLast(
          (e) =>
            e.type === "message" &&
            (e.data as any).role === "assistant" &&
            !(e.data as any).toolCalls?.length,
        )!.data as any
      ).content,
    );
  console.log(
    JSON.stringify({
      stage: "description",
      answer: final(explanation),
      audit: explanation.events
        .filter((e) => e.type === "run.progress")
        .map((e) => (e.data as any).audit),
    }),
  );
  assert(final(explanation).length > 200);
  assert.notEqual(
    final(explanation),
    "La vérification de mémoire n’a pas abouti ; je ne peux pas confirmer l’état actuel des souvenirs. Les actions déjà réussies ne sont pas annulées.",
  );
  assert(
    explanation.events.some(
      (e) =>
        e.type === "run.progress" &&
        (e.data as any).audit?.code === "INVALID_QUOTE",
    ),
  );
  cases.push({
    case: "exact-harness-description-with-invalid-review",
    answer: final(explanation),
    passed: true,
  });
  const marker = "proof-" + randomUUID();
  await mkdir(path.join(root, "app", "conversations", conversation.id), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "app", "conversations", conversation.id, "proof.txt"),
    marker,
  );
  mode = "unavailable";
  const read = await send(
    "Lis proof.txt avec ton outil fichiers et réponds avec son contenu.",
  );
  console.log(
    JSON.stringify({
      stage: "file",
      answer: final(read),
      audit: read.events
        .filter((e) => e.type === "run.progress")
        .map((e) => (e.data as any).audit),
    }),
  );
  assert(final(read).includes(marker));
  assert(
    read.events.some(
      (e) => e.type === "tool.started" && (e.data as any).name === "files.read",
    ),
  );
  assert(
    read.events.some(
      (e) =>
        e.type === "run.progress" &&
        (e.data as any).audit?.code === "UNAVAILABLE",
    ),
  );
  assert(!JSON.stringify(read.events).includes("Private provider diagnostic"));
  cases.push({
    case: "actual-file-read-with-unavailable-review",
    passed: true,
  });
  mode = "real";
  const inventory = await send(
    "Quels sont tes outils fichiers disponibles actuellement ? Donne leurs noms techniques.",
  );
  console.log(
    JSON.stringify({
      stage: "inventory",
      answer: final(inventory),
      audit: inventory.events
        .filter((e) => e.type === "run.progress")
        .map((e) => (e.data as any).audit),
    }),
  );
  assert(final(inventory).includes("files.read"));
  assert(final(inventory).includes("files.list"));
  cases.push({
    case: "real-review-after-recovery",
    answer: final(inventory),
    passed: true,
  });
  // Replay the last visible failure in an isolated history, then ask the same question again.
  const history=await openSqliteStorage(file);
  try{await history.sessions.append(conversation.id,{id:randomUUID(),runId:randomUUID(),at:new Date().toISOString(),type:'message',data:{role:'assistant',content:'La vérification de mémoire n’a pas abouti ; je ne peux pas confirmer l’état actuel des souvenirs. Les actions déjà réussies ne sont pas annulées.',toolCalls:[]}});}finally{await history.close();}
  mode='unavailable';const repeated=await send('Du coup description du fonctionnement ?');
  assert(final(repeated).length>200);assert.notEqual(final(repeated),'La vérification de mémoire n’a pas abouti ; je ne peux pas confirmer l’état actuel des souvenirs. Les actions déjà réussies ne sont pas annulées.');
  cases.push({case:'same-question-after-historical-review-failure',answer:final(repeated),passed:true});
  const memory = (await app.memories.list()).memories;
  assert.equal(memory.length, 0);
  const audit = repeated.events
    .filter(
      (e) => e.type === "run.progress" && (e.data as any).kind === "review",
    )
    .map((e) => (e.data as any).audit);
  const report = {
    at: new Date().toISOString(),
    modelId,
    effort: "medium",
    realModelCalls: calls,
    reviewAttempts: reviews,
    webComposition: true,
    realSqliteAndFiles: true,
    forcedFailures: ["INVALID_QUOTE", "UNAVAILABLE"],
    cases,
    audit,
    ownerBusinessWrites: 0,
    apiFallback: false,
  };
  await mkdir("docs/qualification/review-recovery", { recursive: true });
  await writeFile(
    "docs/qualification/review-recovery/live.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await app.close();
  await lab.close();
  await rm(root, { recursive: true, force: true });
}
