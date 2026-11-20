/** Opt-in coding qualification: real selected LLM, real files, isolated commands and tests. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Engine } from "../src/core/engine.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { fileTools } from "../src/modules/tools/files/index.ts";
import {
  BubblewrapExecution,
  terminalTools,
} from "../src/modules/tools/terminal/index.ts";
import { createAiSdkProvider } from "../src/modules/models/ai-sdk/index.ts";

async function main() {
  if (!process.argv.includes("--live")) {
    console.log(
      "No inference. Add --live with a private OpenRouter key for real qualification.",
    );
    return;
  }
  const apiKey = process.env.HARNESS_OPENROUTER_API_KEY;
  assert(apiKey, "Private key required");
  const modelId = "deepseek/deepseek-v4-flash-0731",
    catalog = (await (
      await fetch("https://openrouter.ai/api/v1/models")
    ).json()) as {
      data: {
        id: string;
        pricing: { prompt: string; completion: string; request?: string };
      }[];
    };
  const entry = catalog.data.find((item) => item.id === modelId);
  assert(entry);
  const price = {
    input: Number(entry.pricing.prompt),
    output: Number(entry.pricing.completion),
    request: Number(entry.pricing.request ?? 0),
  };
  assert(
    Object.values(price).every((value) => Number.isFinite(value) && value >= 0),
  );
  const budget = Number(process.env.HARNESS_QUALIFY_MAX_COST_USD ?? 0.02);
  assert(budget > 0 && budget <= 0.05);
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-live-code-")),
    workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const execution = new BubblewrapExecution(path.join(root, "commands"), {
      nodeBinary: process.execPath,
    }),
    storage = await openJsonStorage(path.join(root, "storage"));
  const report = {
    at: new Date().toISOString(),
    modelId,
    status: "failed",
    calls: 0,
    maxCalls: 24,
    budgetUSD: budget,
    reservedUSD: 0,
    billedUSD: 0,
    http: [] as { status: number; cost?: number }[],
    baselineCode: null as number | null,
    verificationCode: null as number | null,
    testsUnchanged: false,
    commands: [] as {
      command: string;
      exitCode: number | null;
      status: string;
    }[],
    answer: "",
    error: null as string | null,
  };
  async function command(text: string) {
    const started = await execution.start(workspace, {
      command: text,
      network: false,
    });
    for (let count = 0; count < 1000; count++) {
      const result = await execution.read(workspace, started.id, 0, 1048576);
      if (result.command.status !== "running") return result;
      await delay(20);
    }
    await execution.stop(workspace, started.id);
    throw new Error("Qualification verification took too long");
  }
  try {
    const tests = `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {add} from './add.mjs'; test('positive',()=>assert.equal(add(7,3),10)); test('negative',()=>assert.equal(add(2,-5),-3)); test('zero',()=>assert.equal(add(0,4),4));\n`;
    await writeFile(
      path.join(workspace, "add.mjs"),
      "export const add = (a, b) => a - b;\n",
    );
    await writeFile(path.join(workspace, "add.test.mjs"), tests);
    assert.equal(
      (
        await command(
          "git init -q; git add add.mjs add.test.mjs; git -c user.name=Heart -c user.email=heart@example.invalid commit -qm baseline",
        )
      ).command.exitCode,
      0,
    );
    report.baselineCode = (
      await command("node --test add.test.mjs")
    ).command.exitCode;
    assert.notEqual(report.baselineCode, 0);
    const real = createAiSdkProvider({
      provider: "openrouter",
      modelId,
      apiKey,
      maxOutputTokens: 4096,
      maxPrice: {
        prompt: price.input * 1e6,
        completion: price.output * 1e6,
        request: price.request,
      },
      fetch: async (input, init) => {
        const body = String(init?.body),
          data = JSON.parse(body),
          upper =
            (Buffer.byteLength(body) + 4096) * price.input +
            Number(data.max_tokens ?? 4096) * price.output +
            price.request;
        assert(
          report.reservedUSD + upper <= budget,
          "Spending ceiling reached",
        );
        report.reservedUSD += upper;
        const response = await fetch(input, init);
        const parsed = await response.clone().json();
        if (typeof parsed.usage?.cost === "number")
          report.billedUSD += parsed.usage.cost;
        report.http.push({ status: response.status, cost: parsed.usage?.cost });
        console.log(`HTTP ${response.status}; call ${report.calls}`);
        return response;
      },
    });
    const provider = {
      id: real.id,
      async generate(request: Parameters<typeof real.generate>[0]) {
        assert(report.calls < report.maxCalls, "Qualification call limit");
        report.calls++;
        return real.generate({
          ...request,
          signal: AbortSignal.timeout(90000),
        });
      },
    };
    const engine = new Engine(storage.sessions, [
      ...fileTools(),
      ...terminalTools(execution, false),
    ]);
    const result = await engine.run({
      sessionId: randomUUID(),
      workspace,
      displayName: "Heart",
      provider,
      maxSteps: 24,
      permissions: new Set(["files.read", "files.write", "process.execute"]),
      instructions:
        "Tu es un agent de développement. Inspecte les fichiers, corrige le défaut, exécute les tests et vérifie le résultat. terminal.exec lance une commande asynchrone ; terminal.read permet de suivre la sortie et le code de sortie. Ne confonds pas running et succès. Ne modifie pas les tests. Le réseau est désactivé.",
      prompt:
        "Le module add.mjs est incorrect. Corrige-le, conserve les tests add.test.mjs à l’identique, lance node --test add.test.mjs, puis inspecte git diff. Termine avec un bilan factuel.",
    });
    report.answer = result.text;
    report.testsUnchanged =
      (await readFile(path.join(workspace, "add.test.mjs"), "utf8")) === tests;
    assert(report.testsUnchanged);
    report.verificationCode = (
      await command("node --test add.test.mjs")
    ).command.exitCode;
    assert.equal(report.verificationCode, 0);
    const commands = await execution.list(workspace);
    report.commands = commands.map(({ command, exitCode, status }) => ({
      command,
      exitCode,
      status,
    }));
    assert(
      commands.some((item) => item.command.includes("git diff")),
      "Model must actually inspect its diff",
    );
    report.status = "passed";
  } catch (error) {
    report.error =
      error instanceof assert.AssertionError
        ? "assertion"
        : (error as Error).name;
    process.exitCode = 1;
  } finally {
    for (const current of await execution.list(workspace))
      if (current.status === "running")
        await execution.stop(workspace, current.id);
    await storage.close();
    await rm(root, { recursive: true, force: true });
    const output = path.resolve("docs/qualification/development");
    await mkdir(output, { recursive: true });
    const file = path.join(output, randomUUID() + ".json");
    await writeFile(file, JSON.stringify(report, null, 2) + "\n");
    console.log(
      `Coding qualification ${report.status}: ${report.calls} real calls; declared cost ${report.billedUSD} USD.`,
    );
  }
}
main().catch(() => {
  console.error("Qualification setup failed; private configuration withheld.");
  process.exitCode = 1;
});
