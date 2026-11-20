import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createServer as reserve } from "node:net";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";

test(
  "chat task tools show compact verifiable receipts linked to the shared task editor on mobile and desktop",
  { timeout: 45000 },
  async () => {
    const root = await mkdtemp("/tmp/heart-task-ui-"),
      file = root + "/state.sqlite",
      lab = new TestLab({
        directory: root + "/lab",
        authDirectory: root + "/auth",
      });
    await lab.prepare();
    await migrateSqlite(file);
    let calls = 0;
    lab.model = () => ({
      id: "fixture",
      async generate(request) {
        const step = calls++;
        assert(request.tools.some((tool) => tool.name === "tasks.write"));
        if (step === 0)
          return {
            content: "",
            toolCalls: [{ id: "list", name: "tasks.list", arguments: {} }],
          };
        if (step === 1)
          return {
            content: "",
            toolCalls: [
              {
                id: "create",
                name: "tasks.write",
                arguments: {
                  action: "create",
                  title: "Routine <script>texte</script>",
                  prompt: "Produire le rapport",
                  schedule: {
                    kind: "once",
                    at: "2090-01-02T09:00",
                    timezone: "Indian/Reunion",
                  },
                  active: false,
                },
              },
            ],
          };
        return { content: "Tâche enregistrée.", toolCalls: [] };
      },
    });
    const app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/state",
      lab,
    );
    await app.assistant.save({
      version: 0,
      settings: {
        ...defaultAssistant,
        completed: true,
        step: 5,
        conversationDefaults: {
          selection: {
            provider: "demo",
            modelId: "demo",
            contextWindow: 32768,
            capacitySource: "configured",
          },
          fileAccess: "read",
          networkAccess: false,
        },
      },
    });
    const conversation = (
      await app.conversations.create({ title: "Discussion du rapport" })
    ).conversation;
    const reserved = reserve();
    await new Promise<void>((r) => reserved.listen(0, "127.0.0.1", r));
    const port = (reserved.address() as { port: number }).port;
    await new Promise<void>((r) => reserved.close(() => r()));
    const origin = "http://127.0.0.1:" + port,
      server = createWebServer({
        origin,
        access: new WebAccess({
          secret: "task-ui-secret-at-least-32-characters",
          password: "test-password",
        }),
        lab,
        ...app,
      });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    app.scheduler.start();
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/#conversations");
      await page.fill("#password", "test-password");
      await page.click("#login-submit");
      await page.waitForFunction(
        () => !document.querySelector("#app-view")!.hasAttribute("hidden"),
      );
      await page.evaluate(async (id) => {
        await (window as any).openConversation(id);
      }, conversation.id);
      await page.fill(
        "#conversation-prompt",
        "Planifie le rapport sans le lancer, 2 janvier 2090 à 09:00 Indian/Reunion.",
      );
      await page.locator('#conversation-send button[type="submit"]').click();
      await page.waitForSelector(".task-chat-event");
      assert.equal(calls, 3);
      assert.equal((await app.tasks.list()).tasks.length, 1);
      assert(
        (await page.locator(".task-chat-event").innerText()).includes(
          "Routine <script>texte</script>",
        ),
      );
      assert.equal(await page.locator(".task-chat-event script").count(), 0);
      assert.equal(
        await page
          .locator('.task-chat-event [data-icon="automations"] svg')
          .count(),
        1,
      );
      assert(await page.locator('.task-chat-event').evaluate(element=>getComputedStyle(element).getPropertyValue('--receipt-color').trim()!==getComputedStyle(element).getPropertyValue('--green').trim()));
      await mkdir("docs/qualification/task-tools", { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "docs/qualification/task-tools/receipt-" + width + ".png",
        });
        await page.locator(".task-chat-event").click();
        await page.waitForSelector("#task-detail[open]");
        await page.waitForFunction(() =>
          document
            .querySelector("#task-detail-title")!
            .textContent!.includes("Routine"),
        );
        await page.locator("#task-detail [data-close-editor]").click();
      }
      await page.reload();
      await page.waitForFunction(
        () => !document.querySelector("#app-view")!.hasAttribute("hidden"),
      );
      await page.evaluate(async (id) => {
        await (window as any).openConversation(id);
      }, conversation.id);
      await page.waitForSelector(".task-chat-event");
      assert.equal(calls, 3);
      assert.deepEqual(errors, []);
      await writeFile(
        "docs/qualification/task-tools/browser.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            fixture: "Real HTTP/core/tool/SQLite with simulated provider",
            calls,
            receiptPersists: true,
            sharedTaskEditor: true,
            textOnlyTitle: true,
            widths: [320, 390, 820, 1440],
            jsErrors: 0,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await app.close();
      await lab.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
