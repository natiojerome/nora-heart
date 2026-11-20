import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { Engine } from "../src/core/engine.ts";
import { AiSdkProvider } from "../src/modules/models/ai-sdk/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { fileTools } from "../src/modules/tools/files/index.ts";

// Real adapter + engine + file tool, simulated provider, temporary data only.
const directory = await mkdtemp(path.join(os.tmpdir(), "harness-sdk-demo-"));
const storage = await openJsonStorage(path.join(directory, "state"));
const workspace = path.join(directory, "workspace");
await mkdir(workspace);
await writeFile(path.join(workspace, "hello.txt"), "Nora Heart");
const model = new MockLanguageModelV4({ modelId: "offline-demo", doGenerate: async options => {
  const result = options.prompt.at(-1);
  const output = result?.role === "tool" ? result.content.find(part => part.type === "tool-result")?.output : undefined;
  const content = result?.role === "tool"
    ? [{ type: "text" as const, text: `Fichiers trouvés : ${output?.type === "text" ? output.value : "aucun"}` }]
    : [{ type: "tool-call" as const, toolCallId: "demo-call", toolName: options.tools![0].name, input: "{}" }];
  return { content, finishReason: { unified: result?.role === "tool" ? "stop" : "tool-calls", raw: undefined },
    usage: { inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: undefined } }, warnings: [] };
} });
try {
  const engine = new Engine(storage.sessions, fileTools().filter(tool => tool.name === "files.list"));
  const result = await engine.run({ sessionId: "demo", prompt: "Liste mes fichiers", provider: new AiSdkProvider(model),
    displayName: "Nora Heart", workspace, permissions: new Set(["files.read"]) });
  console.log("AI SDK simulé, aucun appel réseau ni coût LLM.");
  console.log(result.text);
  console.log(`${model.doGenerateCalls.length} requêtes, outil exécuté et journalisé par le moteur.`);
} finally { await storage.close(); await rm(directory, { recursive: true, force: true }); }
