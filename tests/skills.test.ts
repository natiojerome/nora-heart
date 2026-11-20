import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile, readFile, symlink, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { skillsFixture } from "./skills.fixture.ts";
import { assistantFixture } from "./assistant.fixture.ts";
import { Skills, SkillRun, validateSkillOverrides } from "../src/app/skills.ts";
import { skillTools } from "../src/modules/tools/skills/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { BoundedContext } from "../src/modules/context/bounded/index.ts";
import { Engine } from "../src/core/engine.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import type { Message } from "../src/contracts/messages.ts";
import type { Json } from "../src/contracts/json.ts";
import type { ModelResponse } from "../src/contracts/models.ts";

test("portable YAML, per-entry diagnostics, stable registration IDs and fresh revisions", async () => {
  const f = await skillsFixture();
  try {
    let entries = await f.catalog.list();
    assert.equal(entries[0].description, "Examiner le code et ses bugs.");
    const revision = entries[0].revision;
    assert(
      (await f.catalog.load(f.id, revision)).resources.includes(
        "references/report.md",
      ),
    );
    await rename(f.root + "/review", f.root + "/renamed");
    f.registrations[0].path = "renamed";
    await writeFile(f.manifest, JSON.stringify(f.registrations));
    entries = await f.catalog.list();
    assert.equal(entries[0].id, f.id);
    assert.equal(entries[0].revision, revision);
    await writeFile(
      f.root + "/renamed/SKILL.md",
      (await readFile(f.root + "/renamed/SKILL.md", "utf8")).replace(
        f.instructions,
        "UPDATED-INSTRUCTIONS",
      ),
    );
    assert.notEqual((await f.catalog.list())[0].revision, revision);
    await assert.rejects(f.catalog.load(f.id, revision), /modifié/);
    await writeFile(
      f.root + "/other/SKILL.md",
      "---\nname: [unterminated\n---\nbody",
    );
    entries = await f.catalog.list();
    assert.equal(entries.length, 2);
    assert(entries[1].problem);
    assert(!entries[0].problem);
    await assert.rejects(f.catalog.load(randomUUID(), revision), /introuvable/);
  } finally {
    await f.close();
  }
});

test("skill resources retain text and binary bytes, reject traversal and escaping symlinks", async () => {
  const f = await skillsFixture();
  try {
    const r = (await f.catalog.list())[0].revision;
    await writeFile(f.root + "/review/binary.dat", Buffer.from([0, 255, 1, 2]));
    await writeFile(f.root + "/outside", "private");
    await symlink(f.root + "/outside", f.root + "/review/escape");
    assert.match(
      (await f.catalog.read(f.id, r, "references/report.md")).content,
      /REFERENCE-REPORT/,
    );
    const binary = await f.catalog.read(f.id, r, "binary.dat");
    assert.equal(binary.encoding, "base64");
    assert.deepEqual(
      Buffer.from(binary.content, "base64"),
      Buffer.from([0, 255, 1, 2]),
    );
    for (const p of [
      "../outside",
      "/etc/passwd",
      "references/../../outside",
      "..\\outside",
      "escape",
    ])
      await assert.rejects(f.catalog.read(f.id, r, p), /invalide|hors/);
  } finally {
    await f.close();
  }
});

test("owner activation merges independent edits, rejects stale conflicts and survives old profile clients", async () => {
  const f = await skillsFixture(),
    a = assistantFixture(),
    manager = new Skills(f.catalog, a);
  try {
    const initial = await manager.list();
    const first = initial.skills[0],
      second = initial.skills[1];
    assert(first.enabled);
    assert(!second.enabled);
    await manager.set({
      id: first.id,
      revision: first.revision,
      version: 0,
      baseEnabled: true,
      enabled: false,
    });
    await manager.set({
      id: second.id,
      revision: second.revision,
      version: 0,
      baseEnabled: false,
      enabled: true,
    });
    await assert.rejects(
      manager.set({
        id: first.id,
        revision: first.revision,
        version: 0,
        baseEnabled: true,
        enabled: true,
      }),
      /ailleurs/,
    );
    const profile = await a.get(),
      { skillOverrides, ...old } = profile.settings;
    await a.save({ version: profile.version, settings: old });
    assert.deepEqual((await a.get()).settings.skillOverrides, skillOverrides);
    const run = await manager.capture((await a.get()).settings.skillOverrides);
    assert.deepEqual(
      run.entries.map((s) => s.id),
      [second.id],
    );
    await assert.rejects(run.explicit("$code-review"), /désactivé/);
    for (const bad of [[], null, { x: true }, { [f.id]: "true" }])
      assert.throws(() => validateSkillOverrides(bad), /invalides/);
  } finally {
    await f.close();
  }
});

test("catalogue is compact, explicit selection is checked, and skill metadata grants no execution permissions", async () => {
  const f = await skillsFixture(),
    storage = await openJsonStorage(f.root + "/events");
  try {
    const run = await new Skills(f.catalog, assistantFixture()).capture();
    assert(!run.instructions().includes(f.instructions));
    assert.match(run.instructions(), /skills.load/);
    const tools = skillTools(run, run.entries);
    assert.deepEqual(
      tools.map((t) => t.permission),
      ["skills.read", "skills.read"],
    );
    assert.deepEqual(skillTools(run, []), []);
    await assert.rejects(run.load(f.other, "anything"), /désactivé/);
    await run.explicit("$HOME et $PATH restent du texte ordinaire.");
    await run.explicit("$code-review");
    const engine = new Engine(
      storage.sessions,
      tools,
      run.context(new BoundedContext(storage.sessions)),
    );
    let calls = 0;
    await engine.run({
      sessionId: "restricted",
      prompt: "$code-review",
      displayName: "Test",
      workspace: f.root,
      permissions: new Set(["skills.read"]),
      contextWindow: 32768,
      provider: {
        id: "fake",
        async generate(request) {
          calls++;
          assert(request.instructions.includes(f.instructions));
          assert(
            !request.tools.some(
              (t) => t.name === "terminal.start" || t.name === "files.create",
            ),
          );
          return { content: "Done", toolCalls: [] };
        },
      },
    });
    assert.equal(calls, 1);
  } finally {
    await storage.close();
    await f.close();
  }
});

test("activated guidance is deduplicated, protected across real checkpoint/restart and removed when disabled", async () => {
  const f = await skillsFixture(),
    storage = await openJsonStorage(f.root + "/events");
  try {
    const entries = await f.catalog.list(),
      document = await f.catalog.load(f.id, entries[0].revision),
      messages: Message[] = [
        { role: "user", content: "Review this change" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "load", name: "skills.load", arguments: { id: f.id } },
          ],
        },
        {
          role: "tool",
          callId: "load",
          name: "skills.load",
          content: JSON.stringify(document),
          error: false,
        },
        {
          role: "assistant",
          content: "Earlier response " + "archive ".repeat(700),
          toolCalls: [],
        },
        { role: "user", content: "Continue" },
      ];
    for (const message of messages)
      await storage.sessions.append("compact", {
        id: randomUUID(),
        runId: randomUUID(),
        at: new Date().toISOString(),
        type: "message",
        data: message as unknown as Json,
      });
    let summaries = 0;
    const options = {
      sessionId: "compact",
      runId: randomUUID(),
      contextWindow: 4096,
      reserveTokens: 1024,
      request: { instructions: "Nora", messages, tools: [] },
      provider: {
        id: "fake",
        async generate() {
          summaries++;
          return { content: "Revue en cours, continuer.", toolCalls: [] };
        },
      },
    };
    const run = new SkillRun(f.catalog, [entries[0]]),
      prepared = await run
        .context(new BoundedContext(storage.sessions))
        .prepare(options);
    assert(summaries > 0);
    assert(prepared.instructions.includes(f.instructions));
    assert.equal(prepared.instructions.split(f.instructions).length - 1, 1);
    assert(!JSON.stringify(prepared.messages).includes(f.instructions));
    const restarted = await new SkillRun(f.catalog, [entries[0]])
      .context(new BoundedContext(storage.sessions))
      .prepare(options);
    assert(restarted.instructions.includes(f.instructions));
    const disabled = await new SkillRun(f.catalog, [])
      .context(new BoundedContext(storage.sessions))
      .prepare({ ...options, contextWindow: 32768 });
    assert(!JSON.stringify(disabled).includes(f.instructions));
    const original = await storage.sessions.read("compact");
    assert(
      JSON.stringify(original).includes(f.instructions),
      "canonical journal remains unchanged",
    );
  } finally {
    await storage.close();
    await f.close();
  }
});

test("web engine loads a skill, reads its reference and a workspace file with ordinary read-only rights; activation persists", async () => {
  const f = await skillsFixture(),
    file = f.root + "/state.sqlite",
    lab = new TestLab({
      directory: f.root + "/lab",
      authDirectory: f.root + "/auth",
    });
  await lab.prepare();
  await migrateSqlite(file);
  let app = await openWebConversations(
      { driver: "sqlite", file },
      f.root + "/state",
      lab,
      f.manifest,
    ),
    step = 0;
  lab.models = async () => ({
    models: [{ id: "fake", name: "Fake", contextWindow: 32768 }],
  });
  lab.model = () => ({
    id: "fake",
    async generate(request): Promise<ModelResponse> {
      if (request.tools.some((t) => t.name === "memory.assess"))
        return {
          content: "",
          toolCalls: [
            {
              id: "assess",
              name: "memory.assess",
              arguments: {
                decisions: [
                  {
                    action: "none",
                    evidence: "",
                    note: "Revue de code, pas de fait personnel.",
                  },
                ],
              },
            },
          ],
        };
      assert(
        !request.tools.some(
          (t) => t.name === "files.create" || t.name === "terminal.start",
        ),
      );
      if (step === 0) {
        assert(!request.instructions.includes(f.instructions));
        step++;
        return {
          content: "",
          toolCalls: [
            { id: "load", name: "skills.load", arguments: { id: f.id } },
          ],
        };
      }
      assert(request.instructions.includes(f.instructions));
      if (step === 1) {
        step++;
        return {
          content: "",
          toolCalls: [
            {
              id: "reference",
              name: "skills.read",
              arguments: { id: f.id, path: "references/report.md" },
            },
          ],
        };
      }
      if (step === 2) {
        assert(JSON.stringify(request.messages).includes("REFERENCE-REPORT"));
        step++;
        return {
          content: "",
          toolCalls: [
            { id: "source", name: "files.read", arguments: { path: "app.ts" } },
          ],
        };
      }
      assert(JSON.stringify(request.messages).includes("return total / count"));
      step++;
      return {
        content:
          "Défaut confirmé dans app.ts : count=0 produit une valeur non finie.",
        toolCalls: [],
      };
    },
  });
  try {
    const { conversation } = await app.conversations.create({
      title: "Skill workflow",
    });
    await app.conversations.mutateWorkspace(conversation.id, {
      action: "create",
      path: "app.ts",
      content: "export function avg(total,count){return total / count;}",
    });
    await app.conversations.send(conversation.id, {
      provider: "chatgpt",
      modelId: "fake",
      prompt: "Fais une revue de app.ts",
    });
    assert.equal(step, 4);
    const list = await app.skills.list(),
      skill = list.skills[0];
    await app.skills.set({
      id: f.id,
      revision: skill.revision,
      version: list.version,
      baseEnabled: true,
      enabled: false,
    });
    await app.close();
    app = await openWebConversations(
      { driver: "sqlite", file },
      f.root + "/state",
      lab,
      f.manifest,
    );
    assert.equal((await app.skills.list()).skills[0].enabled, false);
    await assert.rejects(
      app.conversations.send(conversation.id, {
        provider: "chatgpt",
        modelId: "fake",
        prompt: "$code-review continue",
      }),
      /désactivé/,
    );
  } finally {
    await app.close();
    await lab.close();
    await f.close();
  }
});

test("explicit skill survives a checkpoint and fresh run even with a model that cannot call tools", async () => {
  const f = await skillsFixture(),
    storage = await openJsonStorage(f.root + "/explicit-events");
  try {
    const entries = [(await f.catalog.list())[0]],
      messages: Message[] = [
        { role: "user", content: "$code-review inspect code" },
        { role: "assistant", content: "archive ".repeat(700), toolCalls: [] },
        { role: "user", content: "Continue" },
      ];
    for (const message of messages)
      await storage.sessions.append("explicit", {
        id: randomUUID(),
        runId: randomUUID(),
        at: new Date().toISOString(),
        type: "message",
        data: message as unknown as Json,
      });
    const options = {
      sessionId: "explicit",
      runId: randomUUID(),
      request: { instructions: "Nora", messages, tools: [] },
      contextWindow: 4096,
      reserveTokens: 1024,
      provider: {
        id: "no-tools",
        supportsTools: false,
        async generate() {
          return { content: "Revue en cours.", toolCalls: [] };
        },
      },
    };
    const first = await new SkillRun(f.catalog, entries)
      .context(new BoundedContext(storage.sessions))
      .prepare(options);
    assert(first.instructions.includes(f.instructions));
    const restarted = await new SkillRun(f.catalog, entries)
      .context(new BoundedContext(storage.sessions))
      .prepare(options);
    assert(restarted.instructions.includes(f.instructions));
    assert.equal(restarted.instructions.split(f.instructions).length - 1, 1);
  } finally {
    await storage.close();
    await f.close();
  }
});
