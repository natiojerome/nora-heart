import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import type { ModelProvider } from "../src/contracts/models.ts";

for (const provider of [
  "demo",
  "openai",
  "anthropic",
  "openrouter",
  "chatgpt",
] as const) {
  test(
    "durable memory guidance and real persistence reach " +
      provider +
      " independently of file access",
    async () => {
      const root = await mkdtemp(
          path.join(os.tmpdir(), "heart-memory-guidance-"),
        ),
        file = path.join(root, "data.sqlite");
      const lab = new TestLab({
        directory: path.join(root, "lab"),
        authDirectory: path.join(root, "auth"),
      });
      await lab.prepare();
      let calls = 0;
      const fake: ModelProvider = {
        id: "simulated-" + provider,
        async generate(request) {
          calls++;
          if (request.tools.some((tool) => tool.name === "memory.assess"))
            return {
              content: "",
              toolCalls: [
                {
                  id: "assessment",
                  name: "memory.assess",
                  arguments: {
                    decisions: [
                      {
                        action: "known",
                        arguments:{id:JSON.parse(request.messages[0].content).activeMemories[0].id,version:JSON.parse(request.messages[0].content).activeMemories[0].version},
                        evidence: "Je suis dev informatique au fait",
                        note: "Profession déjà conservée.",
                      },
                    ],
                  },
                },
              ],
            };
          assert.match(request.instructions, /décide toi-même/);
          assert.match(request.instructions, /profession\/activité/);
          assert.match(request.instructions, /Respecte un refus/);
          assert.match(request.instructions, /seulement après réussite/);
          assert(request.tools.some((tool) => tool.name === "memory.remember"));
          assert(!request.tools.some((tool) => tool.name.startsWith("files.")));
          const result = request.messages.at(-1);
          if (result?.role === "tool" && result.name === "memory.remember") {
            assert.equal(result.error, false);
            return { content: "Métier enregistré durablement.", toolCalls: [] };
          }
          if (result?.role === "tool" && result.name === "memory.search")
            return {
              content: "",
              toolCalls: [
                {
                  id: "remember",
                  name: "memory.remember",
                  arguments: {
                    title: "Profession",
                    content: "L’utilisateur est développeur informatique.",
                    kind: "fact",
                    scope: "personal",
                  },
                },
              ],
            };
          return {
            content: "",
            toolCalls: [
              {
                id: "search",
                name: "memory.search",
                arguments: { query: "profession développeur informatique" },
              },
            ],
          };
        },
      };
      lab.model = () => fake;
      lab.models = async () => ({
        models: [{ id: "fake", name: "Simulated model", contextWindow: 32768 }],
      });
      lab.capabilities = async () => ({ id: "fake", contextWindow: 32768 });
      await migrateSqlite(file);
      let app = await openWebConversations(
        { driver: "sqlite", file },
        path.join(root, "state"),
        lab,
      );
      try {
        const conversation = (
          await app.conversations.create({ title: "Fait personnel" })
        ).conversation;
        await app.conversations.fileAccess(conversation.id, { access: "none" });
        const result = await app.conversations.send(conversation.id, {
          provider,
          modelId: "fake",
          contextWindow: 32768,
          prompt: "Je suis dev informatique au fait",
        });
        assert.equal(calls, provider === "demo" ? 3 : 4);
        assert(
          result.events.some(
            (event) =>
              event.type === "tool.finished" &&
              (event.data as { name?: string }).name === "memory.remember",
          ),
        );
        const saved = (await app.memories.list()).memories;
        assert.equal(saved.length, 1);
        assert.equal(saved[0].scope, "personal");
        assert.equal(saved[0].source.conversationId, conversation.id);
        await app.close();
        app = await openWebConversations(
          { driver: "sqlite", file },
          path.join(root, "state"),
          lab,
        );
        assert.equal((await app.memories.list()).memories[0].id, saved[0].id);
      } finally {
        await app.close();
        await lab.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
