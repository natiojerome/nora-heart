import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "../src/core/engine.ts";
import { ChatGptProvider } from "../src/modules/models/chatgpt/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { fileTools } from "../src/modules/tools/files/index.ts";

const directory = await mkdtemp(path.join(os.tmpdir(), "harness-chatgpt-demo-"));
const storage = await openJsonStorage(path.join(directory, "state"));
const workspace = path.join(directory, "workspace");
let requests = 0;
const model = new ChatGptProvider({ modelId: "offline-demo", accessToken: async () => "fake-offline-token", fetch: async (_url, init) => {
  requests++;
  const body = JSON.parse(String(init!.body));
  const result = body.input.find((item: { type: string }) => item.type === "function_call_output");
  const output = result
    ? [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: `Fichiers trouvés : ${result.output}` }] }]
    : [{ type: "function_call", call_id: "demo-call", namespace: "harness", name: body.tools[0].tools[0].name, arguments: "{}" }];
  return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output } })}\n\n`,
    { headers: { "content-type": "text/event-stream" } });
} });
try {
  await mkdir(workspace);
  await writeFile(path.join(workspace, "hello.txt"), "Nora Heart");
  const engine = new Engine(storage.sessions, fileTools().filter(tool => tool.name === "files.list"));
  const result = await engine.run({ sessionId: "demo", prompt: "Liste mes fichiers", provider: model,
    displayName: "Nora Heart", workspace, permissions: new Set(["files.read"]) });
  assert.match(result.text, /hello.txt/);
  assert.equal(requests, 2);
  assert.equal((await storage.sessions.read("demo")).filter(event => event.type === "tool.finished").length, 1);
  console.log("ChatGPT simulé : aucun compte connecté, aucun réseau ni coût LLM.");
  console.log(result.text);
  console.log("2 requêtes, 1 outil exécuté et journalisé par le moteur.");
} finally { await storage.close(); await rm(directory, { recursive: true, force: true }); }
