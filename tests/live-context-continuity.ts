/** Opt-in: real ChatGPT + isolated Memory/Projects MCPs. No owner business data. */
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  stat,
  mkdtemp,
  mkdir,
  rm,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import {
  migrateSqlite,
  openSqliteStorage,
} from "../src/modules/storage/sqlite/index.ts";
import { ExternalTools, externalToolName } from "../src/app/external-tools.ts";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { instructionValue } from "../src/app/instruction-defaults.ts";
import { estimateTokens } from "../src/modules/context/bounded/index.ts";
import type { ModelRequest } from "../src/contracts/models.ts";
import type { Json } from "../src/contracts/json.ts";

if (!process.argv.includes("--live"))
  console.log(
    "No live call. Requires private HEART_CONTEXT_QA_FIXTURE, PROJECTS and MEMORY endpoints.",
  );
else {
  const privateFile = process.env.HEART_CONTEXT_QA_FIXTURE!;
  assert(privateFile?.startsWith("/tmp/heart-context-qa-"));
  assert.equal((await stat(privateFile)).mode & 0o077, 0);
  const fixture = JSON.parse(await readFile(privateFile, "utf8"));
  assert(/^qa_projects_[a-f0-9]{12}$/.test(fixture.database));
  const projectsUrl = process.env.HEART_CONTEXT_QA_PROJECTS_URL!,
    memoryUrl = process.env.HEART_CONTEXT_QA_MEMORY_URL!;
  for (const value of [projectsUrl, memoryUrl]) {
    const url = new URL(value);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.protocol, "http:");
  }
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
  const owner = await stat(env.HARNESS_CHATGPT_AUTH_DIR!);
  if (process.getuid?.() === 0) {
    process.setgid!(owner.gid);
    process.setuid!(owner.uid);
  }
  for (const key of Object.keys(process.env))
    if (key.startsWith("HARNESS_")) delete process.env[key];
  process.env.HEART_CONTEXT_QA_PROJECTS_TOKEN = fixture.tokens.a;
  process.env.HEART_CONTEXT_QA_MEMORY_TOKEN = fixture.tokens.memory;
  const directory = await mkdtemp(
      path.join(os.tmpdir(), "heart-context-luna-"),
    ),
    file = path.join(directory, "state.sqlite");
  const lab = new TestLab({
    directory: path.join(directory, "lab"),
    authDirectory: env.HARNESS_CHATGPT_AUTH_DIR!,
  });
  await lab.prepare();
  await migrateSqlite(file);
  const store = await openSqliteStorage(file),
    manager = new ExternalTools(store.externalTools, (c) => connectMcp(c));
  for (const [label, url, envVar, binding] of [
    [
      "Projets QA",
      projectsUrl,
      "HEART_CONTEXT_QA_PROJECTS_TOKEN",
      "HARNESS_PROJECTS_MCP_CONNECTION_ID",
    ],
    [
      "Mémoire QA",
      memoryUrl,
      "HEART_CONTEXT_QA_MEMORY_TOKEN",
      "HARNESS_MEMORY_MCP_CONNECTION_ID",
    ],
  ]) {
    const draft = {
      id: randomUUID(),
      version: 0,
      label,
      url,
      auth: { type: "bearer_env", envVar },
      enabled: true,
      allowWrites: true,
      timeoutMs: 30000,
    };
    const discovery = await manager.discover(draft);
    await manager.save({
      ...draft,
      toolNames: discovery.tools.map((t) => t.name),
      refreshDefinitions: true,
    });
    process.env[binding] = draft.id;
  }
  await store.close();
  const skillId = randomUUID(),
    skillRoot = path.join(directory, "skills");
  await mkdir(skillRoot);
  await mkdir(path.join(skillRoot, "qa"));
  const guidance =
    "GUIDANCE_ACTIVE_731 : pour la preuve demandée, inclure ce marqueur dans le fichier de résultat. Vérifier sa lecture avant de documenter une étape. Ne pas inventer de stockage mémoire.";
  await writeFile(
    path.join(skillRoot, "qa/SKILL.md"),
    "---\nname: qa-continuity\ndescription: Vérification synthétique de continuité et de fichier.\n---\n" +
      guidance,
  );
  const manifest = path.join(skillRoot, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify([{ id: skillId, path: "qa", defaultEnabled: true }]),
  );
  const budget = 32768,
    nativeCapabilities = lab.capabilities.bind(lab),
    nativeModel = lab.model.bind(lab);
  let calls = 0,
    summaries = 0,
    reviews = 0,
    projectReviews = 0,
    primary = 0,
    phase = 0,
    progressOmissionInjected = false,
    memoryOmissionPhases = new Set<number>(),
    guardTaskId = "",
    activeFactSeen = false;
  const nativeModels = lab.models.bind(lab);
  lab.models = async (provider) => {
    if (provider !== "chatgpt") return nativeModels(provider);
    const catalog = await nativeModels("chatgpt");
    return {
      models: catalog.models.map((model) => {
        if (model.id !== "gpt-6-luna") return model;
        assert(model.contextWindow && model.contextWindow >= budget);
        return { ...model, contextWindow: budget };
      }),
    };
  };
  lab.capabilities = async (provider, id) => {
    const native = await nativeCapabilities(provider, id);
    assert(native.contextWindow && native.contextWindow >= budget);
    return { ...native, contextWindow: budget };
  };
  lab.model = (selection) => {
    const model = nativeModel(selection);
    return {
      id: model.id,
      supportsTools: model.supportsTools,
      async generate(request) {
        const current = request.messages.slice(
          request.messages.findLastIndex((m) => m.role === "user") + 1,
        );
        const assessor = request.tools.some((t) =>
          ["memory.assess", "projects.assess"].includes(t.name),
        );
        if (
          phase === 3 &&
          !assessor &&
          !progressOmissionInjected &&
          current.some(
            (m) =>
              m.role === "tool" &&
              !m.error &&
              m.name === "files.read" &&
              m.content.includes("GUIDANCE_ACTIVE_731"),
          )
        ) {
          progressOmissionInjected = true;
          return { content: "Le fichier a été relu.", toolCalls: [] };
        }
        if (
          phase >= 4 &&
          phase <= 6 &&
          request.tools.length > 0 &&
          !assessor &&
          !memoryOmissionPhases.has(phase)
        ) {
          memoryOmissionPhases.add(phase);
          return { content: "Bien reçu.", toolCalls: [] };
        }
        try {
          if (++calls > 48)
            throw Error("Explicit live qualification budget exhausted");
          assert(estimateTokens(request) <= budget - 4096);
          if (!request.tools.length) summaries++;
          else if (request.tools.some((t) => t.name === "projects.assess"))
            projectReviews++;
          else if (request.tools.some((t) => t.name === "memory.assess"))
            reviews++;
          else {
            primary++;
            const stateLine = request.instructions
              .split("\n")
              .find((line) => line.startsWith("État du projet lu"));
            assert(stateLine);
            const state = JSON.parse(
              stateLine.slice(stateLine.indexOf(" : ") + 3),
            );
            assert(
              request.tools.some((tool) => tool.name === state.overviewTool),
            );
            const inventory = request.instructions
              .split("\n")
              .find((l) => l.startsWith("Inventaire effectif"))!;
            const names = inventory
              .match(/\) : (.*)\. Schémas joints/u)?.[1]
              .split(", ");
            assert.deepEqual(
              names,
              request.tools.map((t) => t.name),
            );
            assert.equal(request.instructions.split(guidance).length - 1, 1);
            if (phase === 0) {
              if (request.instructions.includes("REF_ACTIVE_731"))
                activeFactSeen = true;
            }
            if (phase === 1) {
              assert(request.instructions.includes("CONFIG_REPRISE_732"));
              assert(request.instructions.includes("ÉTAPE_SUIVANTE_732"));
              assert(
                !request.tools.some(
                  (t) => t.name === "files.create" || t.name === "files.update",
                ),
              );
            }
            if (phase === 2)
              assert(
                !request.instructions
                  .slice(request.instructions.indexOf("Souvenirs actifs"))
                  .includes("REF_AFTER_RESTART_732"),
              );
          }
        } catch (error) {
          console.error(
            JSON.stringify({
              qualificationAssertion:
                error instanceof Error
                  ? error.message.slice(0, 300)
                  : "unknown",
              phase,
              calls,
              summaries,
              primary,
              tokens: estimateTokens(request),
            }),
          );
          throw error;
        }
        console.log(
          JSON.stringify({
            qualificationCall: calls,
            kind: !request.tools.length
              ? "summary"
              : request.tools.some((t) => t.name === "memory.assess")
                ? "review"
                : request.tools.some((t) => t.name === "projects.assess")
                  ? "project-review"
                  : "primary",
            phase,
            estimatedTokens: estimateTokens(request),
          }),
        );
        return model.generate(request);
      },
    };
  };
  let app: Awaited<ReturnType<typeof openWebConversations>> | undefined;
  try {
    app = await openWebConversations(
      { driver: "sqlite", file },
      path.join(directory, "state"),
      lab,
      manifest,
    );
    await app.assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const project = (
      await app.projectManagement!.create({
        title: "Continuité QA",
        objective:
          "Produire et vérifier une preuve à partir des sources actives, puis documenter une étape.",
        successCriteria: "Fichier relu avec les valeurs courantes.",
        operationId: randomUUID(),
      })
    ).project;
    const task = await app.projectManagement!.saveItem(project.id, {
      kind: "task",
      title: "Produire et vérifier la preuve",
      successCriteria: "Fichier avec profil courant et marqueur du skill",
      operationId: randomUUID(),
    });
    const input = {
      title: "Métier et référence QA",
      content:
        "Le profil QA exerce le métier d’archiviste QA. Référence de contrôle : REF_OLD_731.",
      kind: "fact",
      scope: "personal",
      projectId: null,
    };
    const memory = (await app.memories.create(input)).memory;
    const active = (
      await app.memories.update(memory.id, {
        ...input,
        version: memory.version,
        content:
          "Le profil QA exerce le métier de cartographe QA. Référence de contrôle : REF_ACTIVE_731.",
      })
    ).memory;
    const conversation = (
      await app.conversations.create({
        title: "Continuité réelle QA",
        projectId: project.id,
      })
    ).conversation;
    await app.conversations.fileAccess(conversation.id, { access: "write" });
    await app.conversations.executionPolicy(conversation.id, {
      network: true,
      maxSteps: 0,
    });
    const seedStore = await openSqliteStorage(file);
    try {
      for (let i = 0; i < 8; i++)
        for (const message of [
          {
            role: "user",
            content:
              (i === 0 ? "$qa-continuity Archives synthétiques. " : "") +
              "Exercice historique sans effet réel. ".repeat(180),
          },
          {
            role: "assistant",
            content:
              (i === 0
                ? "Ancien état déclaré : projet terminé ; cet historique ne prouve pas l’état distant actuel. "
                : "") +
              "Notes répétitives de qualification à condenser. ".repeat(150),
            toolCalls: [],
          },
        ])
          await seedStore.sessions.append(conversation.id, {
            id: randomUUID(),
            runId: randomUUID(),
            at: new Date().toISOString(),
            type: "message",
            data: message as unknown as Json,
          });
    } finally {
      await seedStore.close();
    }
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      reasoningEffort: "medium",
      prompt: `$qa-continuity Mon métier et ma référence QA doivent provenir de la mémoire active. Reprends le projet courant et l’étape ${task.id}. Écris proof.txt avec ce métier, cette référence et le marqueur demandé par le skill, puis relis le fichier. Ne termine pas le projet global. L’historique est synthétique : il n’atteste pas du stockage courant.`,
    });
    assert(activeFactSeen);
    assert(summaries > 0);
    const after = await app.conversations.get(conversation.id);
    assert(after.events.some((e) => e.type === "context.checkpoint"));
    const proof = await readFile(
      path.join(directory, "state/conversations", conversation.id, "proof.txt"),
      "utf8",
    );
    assert(proof.includes("REF_ACTIVE_731"));
    assert(proof.includes("GUIDANCE_ACTIVE_731"));
    assert(!proof.includes("REF_OLD_731"));
    const plan = await app.projectManagement!.get(project.id);
    assert.equal(plan.items.find((i) => i.id === task.id)?.status, "done");
    assert(plan.items.find((i) => i.id === task.id)?.evidence);
    assert.notEqual(plan.project.status, "completed");
    assert(
      after.events.some(
        (e) =>
          e.type === "run.progress" &&
          (e.data as any).review === "projects" &&
          ["verified", "unchanged"].includes((e.data as any).audit?.status),
      ),
    );
    assert(
      after.events.some(
        (e) =>
          e.type === "tool.finished" &&
          [
            "projects.write",
            externalToolName(
              process.env.HARNESS_PROJECTS_MCP_CONNECTION_ID!,
              "projects_item_update",
            ),
            externalToolName(
              process.env.HARNESS_PROJECTS_MCP_CONNECTION_ID!,
              "projects_update",
            ),
          ].includes((e.data as any).name) &&
          !(e.data as any).error,
      ),
    );
    await app.close();
    app = undefined;
    phase = 1;
    app = await openWebConversations(
      { driver: "sqlite", file },
      path.join(directory, "state"),
      lab,
      manifest,
    );
    const profile = await app.assistant.get();
    await app.assistant.saveInstruction({
      id: "work",
      value: instructionValue({}, "work") + "\nCONFIG_REPRISE_732",
      version: profile.version,
      baseValue: null,
    });
    const updated = (
      await app.memories.update(active.id, {
        ...input,
        version: active.version,
        content:
          "Le profil QA exerce le métier de graphiste QA. Référence de contrôle : REF_AFTER_RESTART_732.",
      })
    ).memory;
    const currentPlan = await app.projectManagement!.get(project.id);
    await app.projectManagement!.update(project.id, {
      version: currentPlan.project.version,
      nextAction: "ÉTAPE_SUIVANTE_732",
    });
    await app.conversations.fileAccess(conversation.id, { access: "read" });
    await app.conversations.executionPolicy(conversation.id, {
      network: false,
      maxSteps: 0,
    });
    const follow = await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      reasoningEffort: "low",
      prompt:
        "Relis les sources actives. Quel métier et quelle référence QA sont actuellement stockés, et quelle est la prochaine action du projet ? Réponds brièvement avec les valeurs exactes. N’écris aucun fichier ni souvenir.",
    });
    const answer = follow.events
      .filter(
        (e) => e.type === "message" && (e.data as any).role === "assistant",
      )
      .at(-1)!.data as any;
    assert(answer.content.includes("REF_AFTER_RESTART_732"));
    assert(answer.content.includes("ÉTAPE_SUIVANTE_732"));
    await app.memories.status(updated.id, {
      version: updated.version,
      status: "forgotten",
    });
    phase = 2;
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      reasoningEffort: "low",
      prompt:
        "Vérifie si mon métier et ma référence QA sont encore dans la mémoire active. Distingue-la de ce que tu sais de notre historique. Ne recrée rien.",
    });
    const remaining = (await app.memories.list()).memories;
    assert(!remaining.some((m) => m.id === updated.id));
    const guardTask = await app.projectManagement!.saveItem(project.id, {
      kind: "task",
      title: "Contrôle supplémentaire du fichier",
      successCriteria: "Le fichier existant est relu.",
      operationId: randomUUID(),
    });
    guardTaskId = guardTask.id;
    phase = 3;
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      reasoningEffort: "low",
      prompt: `$qa-continuity Lis de nouveau proof.txt pour vérifier son contenu. Cela correspond à l’étape ${guardTaskId}. Ne modifie pas le fichier et ne clôture pas le projet global.`,
    });
    assert(progressOmissionInjected, "The primary omission must be injected");
    const afterGuard = await app.projectManagement!.get(project.id);
    assert.equal(
      afterGuard.items.find((i) => i.id === guardTaskId)?.status,
      "done",
    );
    // Fault injection: omit the primary memory action, while Luna reviews and MCP effects stay real.
    phase = 4;
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      reasoningEffort: "low",
      prompt:
        "Ma préférence durable pour la qualification QA : je préfère les comptes rendus au format QA_MEMORY_734. Cette préférence est utile pour mes prochains échanges.",
    });
    const remembered = (await app.memories.list()).memories.filter((m) =>
      m.content.includes("QA_MEMORY_734"),
    );
    assert.equal(
      remembered.length,
      1,
      "The real review must recover the omitted save",
    );
    phase = 5;
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      reasoningEffort: "low",
      prompt:
        "Correction : pour les comptes rendus de qualification QA, je préfère maintenant le format QA_MEMORY_735 à la place de QA_MEMORY_734.",
    });
    const corrected = (await app.memories.list()).memories.filter((m) =>
      m.content.includes("QA_MEMORY_735"),
    );
    assert.equal(corrected.length, 1);
    assert.equal(
      corrected[0].id,
      remembered[0].id,
      "Correction updates the same durable memory",
    );
    assert(corrected[0].version > remembered[0].version);
    phase = 6;
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "gpt-6-luna",
      reasoningEffort: "low",
      prompt:
        "Oublie ma préférence de format de compte rendu QA_MEMORY_735, ainsi que son ancienne valeur QA_MEMORY_734. Je demande sa suppression de la mémoire durable.",
    });
    assert(
      !(await app.memories.list()).memories.some(
        (m) => m.id === remembered[0].id,
      ),
    );
    assert.equal(memoryOmissionPhases.size, 3);
    const final = await app.conversations.get(conversation.id);
    assert(
      final.events.some(
        (e) =>
          e.type === "run.progress" &&
          (e.data as any).review === "projects" &&
          (e.data as any).audit?.status === "verified",
      ),
    );

    const failures = final.events.filter(
      (e) => e.type === "tool.finished" && (e.data as any).error,
    );
    if (failures.length)
      console.log(
        JSON.stringify({
          recoveredToolErrors: failures.map((e) => ({
            name: (e.data as any).name,
            reason: (
              final.events.find(
                (m) =>
                  m.type === "message" &&
                  (m.data as any).role === "tool" &&
                  (m.data as any).callId === (e.data as any).callId,
              )?.data as any
            )?.content,
          })),
        }),
      );
    const unexpectedFailures = failures.filter((e) => {
      const result = final.events.find(
        (m) =>
          m.type === "message" &&
          (m.data as any).role === "tool" &&
          (m.data as any).callId === (e.data as any).callId,
      )?.data as any;
      return (
        (e.data as any).name !== "memory.get" ||
        result?.content !== "Souvenir introuvable."
      );
    });
    assert.equal(unexpectedFailures.length, 0, "Unexpected tool failure");
    assert(!final.events.some((e) => e.type === "run.failed"));
    assert(final.events.filter((e) => e.type === "run.completed").length >= 3);
    const report = {
      at: new Date().toISOString(),
      provider: "ChatGPT subscription",
      model: "gpt-6-luna",
      nativeCapacityUnchanged: true,
      testInputWindow: budget,
      providerCalls: calls,
      summaryCalls: summaries,
      reviewCalls: reviews,
      projectReviewCalls: projectReviews,
      projectUpdatesWithoutExplicitRequest: true,
      internalProjectToolsWithoutExecutionNetwork: true,
      primaryCalls: primary,
      checkpointPersisted: true,
      canonicalHistoryPreserved: true,
      activeMemoryCorrectedAndForgotten: true,
      projectTaskDocumented: true,
      projectNotPrematurelyClosed: true,
      skillReinjectedAfterRestart: true,
      instructionsUpdatedAfterRestart: true,
      readOnlyInventoryAfterRestart: true,
      toolErrors: failures.length,
      expectedMissingMemoryReads: failures.length - unexpectedFailures.length,
      unexpectedToolErrors: unexpectedFailures.length,
      finalOutcomeVerified: true,
      primaryProgressOmissionInjected: progressOmissionInjected,
      realProjectReviewRecoveredOmission: true,
      realMemoryMcp: true,
      primaryMemoryOmissionsInjected: memoryOmissionPhases.size,
      realMemoryReviewRecoveredCreateUpdateForget: true,
      memoryWriteReadbackVerified:
        final.events.filter(
          (e) =>
            e.type === "run.progress" &&
            (e.data as any).review === "memory" &&
            (e.data as any).audit?.status === "verified",
        ).length >= 3,
      realProjectsMcp: true,
      syntheticDatabase: true,
      noOwnerDataTouched: true,
    };
    await writeFile(
      "/tmp/heart-context-luna-report.json",
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(report));
  } finally {
    await app?.close();
    await lab.close();
    await rm(directory, { recursive: true, force: true });
    delete process.env.HEART_CONTEXT_QA_PROJECTS_TOKEN;
    delete process.env.HEART_CONTEXT_QA_MEMORY_TOKEN;
  }
}
