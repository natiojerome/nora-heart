import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createAiSdkProvider } from "../src/modules/models/ai-sdk/index.ts";
import { Engine } from "../src/core/engine.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";

if (!process.argv.includes("--live")) throw new Error("Add --live to use the Venice web session.");
const root = await mkdtemp(path.join(os.tmpdir(), "heart-venice-web-"));
const storage = await openJsonStorage(path.join(root, "state"));
const nonce = randomUUID();
await writeFile(path.join(root, "source.txt"), nonce);
let calls = 0, reads = 0, writes = 0;
const provider = createAiSdkProvider({ provider: "venice-web", modelId: "deepseek-v4-1-flash-uncensored",
  apiKey: "local-bridge", fetch: async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:3456/v1/chat/completions");
    if (++calls > 4) throw new Error("Qualification request budget reached");
    return fetch(url, { ...init, signal: AbortSignal.timeout(180000) });
  } });
try {
  const engine = new Engine(storage.sessions, [
    { name: "fixture.read", description: "Read the secret code from the isolated fixture file.", permission: "history.read",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() { reads++; return readFile(path.join(root, "source.txt"), "utf8"); } },
    { name: "fixture.write", description: "Write the code from the read tool to the isolated result file.", permission: "history.read",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
      async execute(input: any) { writes++; await writeFile(path.join(root, "result.txt"), input.code); return "saved"; } },
  ]);
  const result = await engine.run({ provider, sessionId: "qa", displayName: "Nora", workspace: root,
    prompt: "Utilise fixture.read pour lire le code secret, puis fixture.write pour le recopier exactement. Termine par le code et une courte confirmation. Ne devine pas le code.",
    permissions: new Set(["history.read"]), maxSteps: 4 });
  assert.equal(await readFile(path.join(root, "result.txt"), "utf8"), nonce);
  assert(result.text.includes(nonce));
  assert.equal(reads, 1); assert.equal(writes, 1);
  const evidence = { at: new Date().toISOString(), provider: provider.id, calls, reads, writes,
    realModel: true, isolatedFileRoundTrip: true, exactCodeConfirmed: true, apiKeyUsed: false };
  await mkdir("docs/qualification/venice-web", { recursive: true });
  await writeFile("docs/qualification/venice-web/live.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally { await storage.close(); await rm(root, { recursive: true, force: true }); }
