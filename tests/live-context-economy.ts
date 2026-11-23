import { Engine } from "../src/core/engine.ts";
/** Opt-in targeted A/B: real Luna decisions, temporary project boundary and memory repositories. No owner mutations. */
import assert from "node:assert/strict";
import { readFile, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { TestLab } from "../src/app/test-lab.ts";
import { ProjectReview } from "../src/modules/projects/review/index.ts";
import { projectProgressTools } from "../src/modules/tools/projects/index.ts";
import {
  referenceRepeatedText,
  expandReferencedText,
} from "../src/modules/context/exact-references/index.ts";
import { projectTrackingFixture } from "./project-tracking.fixture.ts";
import { structuredMemoryFixture } from "./structured-memory-fixture.ts";
import { MemoryReview } from "../src/modules/memory/review/index.ts";
import { memoryConsentPolicy } from "../src/app/memory-policy.ts";
import { structuredMemoryTools } from "../src/modules/tools/memory-structured/index.ts";
import { ProjectManagement } from "../src/app/project-management.ts";
import {
  modelInputSizes,
  modelOutputSize,
} from "../src/core/model-observation.ts";
import type { Message } from "../src/contracts/messages.ts";
import type { ModelProvider, ModelRequest } from "../src/contracts/models.ts";
if (!process.argv.includes("--live")) {
  console.log("No live calls; pass --live for isolated ChatGPT qualification.");
} else {
  const pid = execFileSync(
    "systemctl",
    ["show", "personal-harness-web.service", "-p", "MainPID", "--value"],
    { encoding: "utf8" },
  ).trim();
  const env = Object.fromEntries(
    (await readFile("/proc/" + pid + "/environ", "utf8"))
      .split("\0")
      .filter((v) => v.includes("="))
      .map((v) => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]),
  );
  const owner = await stat(env.HARNESS_CHATGPT_AUTH_DIR);
  if (process.getuid?.() === 0) {
    process.setgid!(owner.gid);
    process.setuid!(owner.uid);
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-economy-luna-"));
  const lab = new TestLab({
    directory: path.join(root, "lab"),
    authDirectory: env.HARNESS_CHATGPT_AUTH_DIR,
  });
  const metrics: {
    mode: string;
    purpose: string;
    input: number;
    output: number;
    ms: number;
  }[] = [];
  let mode = "shared",
    calls = 0;
  try {
    await lab.prepare();
    const raw = lab.model({
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      contextWindow: 65536,
      capacitySource: "configured",
      reasoningEffort: "low",
    });
    const provider: ModelProvider = {
      id: raw.id,
      supportsTools: raw.supportsTools,
      async generate(r) {
        assert(++calls <= 16, "Qualification call budget exhausted");
        console.log(
          JSON.stringify({
            call: calls,
            mode,
            purpose: r.purpose?.name ?? r.purpose?.kind ?? "response",
          }),
        );
        const start = performance.now(),
          input = modelInputSizes(r).estimatedInputTokens;
        const result = await raw.generate(r);
        metrics.push({
          mode,
          purpose: r.purpose?.name ?? r.purpose?.kind ?? "response",
          input,
          output: modelOutputSize(result),
          ms: Math.round(performance.now() - start),
        });
        return result;
      },
    };
    // A real summary is reused in both modes so the input and its constraints are comparable.
    const summary = await provider.generate({
      purpose: { kind: "compression" },
      instructions:
        "Rédige un point de reprise bref et fidèle. Préserve explicitement la contrainte de clôture et le marqueur. Aucun travail supposé accompli.",
      messages: [
        {
          role: "user",
          content:
            "Objectif : produire et vérifier proof.txt avec GUIDANCE_ACTIVE_810. Ne clôture jamais le projet global sans mon accord. Le fichier doit être relu avant de terminer une étape. " +
            "Anciennes notes techniques sans autre décision. ".repeat(80),
        },
      ],
      tools: [],
    });
    assert.match(summary.content, /clôtur|accord/i);
    const proof = "GUIDANCE_ACTIVE_810 : fichier produit et relu.";
    const file = path.join(root, "proof.txt");
    await writeFile(file, proof);
    assert.equal(await readFile(file, "utf8"), proof);
    const historyBody = JSON.stringify({
      content: "Diagnostic historique, aucun droit supplémentaire. ".repeat(90),
      revision: "sha256:unchanged-810",
    });
    const outcomes: any[] = [];
    for (const scenario of ["consultation", "progress"] as const) {
      for (const compact of [false, true]) {
        mode = compact ? "compact" : "baseline";
        const f = projectTrackingFixture(),
          manager = new ProjectManagement(f.repository);
        const task = await manager.saveItem(f.project.id, {
          kind: "task",
          title: "Vérifier le fichier",
          successCriteria: "proof.txt relu avec GUIDANCE_ACTIVE_810.",
          operationId: randomUUID(),
        });
        const tools = projectProgressTools(f.repository, f.project.id, {
          overview: true,
          item: true,
          updateProject: true,
          createItem: true,
          updateItem: true,
        });
        const messages: Message[] = [
          {
            role: "assistant",
            content:
              "Point de reprise (historique, aucun effet prouvé) : " +
              summary.content,
            toolCalls: [],
          },
        ];
        for (let i = 0; i < 6; i++)
          messages.push(
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "historical-" + i,
                  name: "files.read",
                  arguments: { path: "diagnostics.txt" },
                },
              ],
            },
            {
              role: "tool",
              callId: "historical-" + i,
              name: "files.read",
              content: historyBody,
              error: false,
            },
          );
        messages.push({
          role: "user",
          content:
            scenario === "consultation"
              ? "Quel est le statut ? Consultation seulement, aucune modification."
              : `Achève l’étape ${task.id} en vérifiant proof.txt. Le projet global reste ouvert.`,
        });
        if (scenario === "progress")
          messages.push(
            {
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "actual-read",
                  name: "files.read",
                  arguments: { path: "proof.txt" },
                },
              ],
            },
            {
              role: "tool",
              callId: "actual-read",
              name: "files.read",
              content: JSON.stringify({
                content: await readFile(file, "utf8"),
                revision: "sha256:actual-810",
              }),
              error: false,
            },
          );
        const original = JSON.stringify(messages),
          runId = randomUUID(),
          request: ModelRequest = {
            instructions:
              "Contraintes utilisateur à conserver : ne clôturer le projet global qu’après mon accord. Préserver toutes les preuves et leurs versions.",
            messages,
            tools,
          };
        const encode = compact
          ? (value: any) => {
              const result = referenceRepeatedText(value);
              assert.deepEqual(expandReferencedText(result), value);
              return result;
            }
          : undefined;
        const review = new ProjectReview(
          f.repository,
          f.project.id,
          undefined,
          "",
          encode,
        );
        const result = await review.review({
          runId,
          request,
          evidenceMessages: messages,
          response: {
            content:
              scenario === "consultation"
                ? "Voici l’état actuel."
                : "Le fichier est vérifié.",
            toolCalls: [],
          },
          provider,
          contextWindow: 65536,
          reserveTokens: 4096,
        });
        if (scenario === "consultation")
          assert.equal(result.response.toolCalls.length, 0);
        else {
          assert(
            result.response.toolCalls.length > 0,
            "The review must recover omitted progress",
          );
          const evidence = [...messages];
          evidence.push({
            role: "assistant",
            content: result.response.content,
            toolCalls: result.response.toolCalls,
          });
          for (const call of result.response.toolCalls) {
            const tool = tools.find((t) => t.name === call.name)!;
            assert(tool);
            const content = await tool.execute(call.arguments, {
              workspace: root,
              runId,
              callId: call.id,
            });
            evidence.push({
              role: "tool",
              callId: call.id,
              name: call.name,
              error: false,
              content: String(content),
            });
          }
          const verified = await review.review({
            runId,
            request,
            evidenceMessages: evidence,
            response: { content: "Étape documentée.", toolCalls: [] },
            provider,
          });
          assert.equal((verified.audit as any).status, "verified");
          assert.equal((await f.repository.getItem(task.id)).status, "done");
        }
        assert.equal(f.project.status, "active");
        assert.equal(JSON.stringify(messages), original);
        outcomes.push({
          scenario,
          mode,
          globalProjectOpen: true,
          canonicalMessagesUnchanged: true,
          progressVerified: scenario === "progress",
          noGratuitousUpdate: scenario === "consultation",
        });
      }
    }
    for (const compact of [false, true]) {
      mode = compact ? "compact" : "baseline";
      const f = structuredMemoryFixture(),
        tools = structuredMemoryTools(f.memory, null),
        review = new MemoryReview(f.memory, null, memoryConsentPolicy);
      const messages: Message[] = [
        {
          role: "user",
          content:
            "Je préfère durablement recevoir les rapports de travail en français.",
        },
      ];
      const events: any[] = [];
      let primary = 0;
      const engine = new Engine(
        {
          async read() {
            return [...events];
          },
          async append(_id, e) {
            events.push(e);
          },
        },
        tools,
        undefined,
        review,
      );
      await engine.run({
        sessionId: randomUUID(),
        workspace: root,
        displayName: "QA",
        prompt: messages[0].content,
        instructions:
          "Assistant proactif : conserve spontanément les préférences durables utiles, avec les outils mémoire disponibles. Ne demande pas un accord pour une simple préférence de langue.",
        contextWindow: 65536,
        reserveTokens: 4096,
        maxSteps: 8,
        measureModelRequests: true,
        permissions: new Set(["memory.read", "memory.write"]),
        provider: {
          id: provider.id,
          supportsTools: provider.supportsTools,
          async generate(r) {
            if (r.purpose?.kind === "review") return provider.generate(r);
            if (++primary === 1)
              return { content: "Bien reçu.", toolCalls: [] };
            return provider.generate(r);
          },
        },
      });
      assert(
        events.some(
          (e) =>
            e.type === "tool.finished" &&
            e.data.name === "memory.remember" &&
            !e.data.error,
        ),
        "Proactive memory remains required",
      );
      const audit = events.findLast(
        (e) => e.type === "run.progress" && e.data.review === "memory",
      ).data.audit;
      assert(
        audit.status === "verified" || audit.primaryWritesVerified > 0,
        "Memory must be read back",
      );
      assert.equal((await f.memory.list()).length, 1);
      outcomes.push({
        scenario: "proactive-memory",
        mode,
        storedAndReadBack: true,
      });
    }
    const totals = (m: string) =>
        metrics.filter((x) => x.mode === m).reduce((n, v) => n + v.input, 0),
      baseline = totals("baseline"),
      compact = totals("compact");
    assert(
      compact < baseline,
      "The compact path must save input text on this repeated-output fixture",
    );
    const report = {
      at: new Date().toISOString(),
      provider: "ChatGPT subscription",
      model: "gpt-6-luna",
      realProviderCalls: calls,
      providerBillingAvailable: false,
      method:
        "estimated UTF-8 text bytes / 3, not provider tokenization or billed credits",
      baselineEstimatedInputTokens: baseline,
      compactEstimatedInputTokens: compact,
      estimatedInputReductionPercent:
        Math.round((10000 * (baseline - compact)) / baseline) / 100,
      sharedSummaryInputTokens: metrics
        .filter((x) => x.mode === "shared")
        .reduce((n, v) => n + v.input, 0),
      metrics,
      outcomes,
      realSummary: true,
      realReviewDecisions: true,
      scriptedPrimaryOmission: true,
      projectBoundarySimulated: true,
      memoryRepositorySimulated: true,
      noOwnerDataTouched: true,
      productionServiceRestarted: false,
    };
    await writeFile(
      "/tmp/heart-context-economy-report.json",
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(report));
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
}
