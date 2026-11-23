import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer as reserve } from "node:net";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";

test(
  "real web composition with SQLite persists chat, owner file journal and memory across server restart",
  { timeout: 40000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "heart-sqlite-web-")),
      file = path.join(root, "heart.sqlite"),
      directory = path.join(root, "state");
    const lab = new TestLab({
      directory: path.join(root, "lab"),
      authDirectory: path.join(root, "auth"),
    });
    await lab.prepare();
    await migrateSqlite(file);
    let persistent = await openWebConversations(
      { driver: "sqlite", file },
      directory,
      lab,
    );
    const settings = {
      ...defaultAssistant,
      completed: true,
      step: 5,
      conversationDefaults: {
        selection: {
          provider: "demo" as const,
          modelId: "demo",
          // Persistence fixture uses the full tool catalogue; small-context limits have dedicated tests.
          contextWindow: 32768,
          capacitySource: "configured" as const,
        },
        fileAccess: "write" as const,
        networkAccess: false,
      },
    };
    await persistent.assistant.save({ version: 0, settings });
    const conversation = (
      await persistent.conversations.create({
        title: "SQLite dans le navigateur",
      })
    ).conversation;
    await persistent.conversations.mutateWorkspace(conversation.id, {
      action: "create",
      path: "work.txt",
      content: "Un fichier de travail persistant",
    });
    const reservation = reserve();
    await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const origin = "http://127.0.0.1:" + port;
    const access = () =>
      new WebAccess({
        secret: "sqlite-browser-fixture-at-least-32-characters",
        password: "fake-password",
      });
    let server = createWebServer({
      origin,
      access: access(),
      lab,
      ...persistent,
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        origin + "/?conversation=" + conversation.id + "#conversations",
      );
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.fill("#conversation-prompt", "Liste les fichiers");
      await page.click("#conversation-submit");
      await page.waitForFunction(() =>
        document
          .getElementById("conversation-history")
          ?.textContent?.includes("Résultat de files.list"),
      );
      assert.match(
        (await page.locator("#conversation-history").textContent()) ?? "",
        /work.txt/,
      );
      const created = await page.evaluate(async () => {
        return (window as any).api("/api/memories", {
          method: "POST",
          body: JSON.stringify({
            title: "Préférence persistante",
            content: "Réponses courtes pour ce test",
            kind: "preference",
            scope: "personal",
            projectId: null,
          }),
        });
      });
      assert.equal(created.memory.version, 1);
      const before = (await persistent.conversations.get(conversation.id))
        .events;
      assert(before.some((e) => e.type === "run.completed"));
      assert.equal(
        (await persistent.conversations.get(conversation.id)).recovery
          .workspace,
        null,
      );
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await persistent.close();
      persistent = await openWebConversations(
        { driver: "sqlite", file },
        directory,
        lab,
      );
      server = createWebServer({
        origin,
        access: access(),
        lab,
        ...persistent,
      });
      await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
      await page.reload();
      await page
        .waitForFunction(() =>
          document
            .getElementById("conversation-history")
            ?.textContent?.includes("Résultat de files.list"),
        )
        .catch(async (error) => {
          console.error(
            JSON.stringify({
              errors,
              body: (await page.textContent("body"))?.slice(-4500),
              events: (
                await persistent.conversations.get(conversation.id)
              ).events.slice(-4),
            }),
          );
          throw error;
        });
      assert.deepEqual(
        (await persistent.conversations.get(conversation.id)).events,
        before,
      );
      const memory = await persistent.memories.get(created.memory.id);
      assert.equal(memory.memory.content, "Réponses courtes pour ce test");
      assert.equal(
        (
          await persistent.conversations.infoWorkspace(
            conversation.id,
            "work.txt",
          )
        ).document?.name,
        "work.txt",
      );
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      assert.deepEqual(errors, []);
      const output = path.resolve("docs/qualification/sql-storage");
      await mkdir(output, { recursive: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(output, "sqlite-chat-mobile.png"),
      });
      await writeFile(
        path.join(output, "browser.json"),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            backend: "SQLite",
            composition:
              "Actual web assembly and native storage; deterministic demo model, no external provider",
            serverRestart: true,
            ownerFilePersisted: true,
            conversationEventsIdentical: true,
            memoryPersisted: true,
            viewports: [320, 390, 820, 1440],
            jsErrors: errors,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await persistent.close();
      await lab.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
