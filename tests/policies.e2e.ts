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
  "runtime policies can be edited, reset, merged and reloaded on mobile without model calls",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp("/tmp/heart-policies-ui-"),
      file = root + "/state.sqlite";
    const lab = new TestLab({
      directory: root + "/lab",
      authDirectory: root + "/auth",
    });
    await lab.prepare();
    await migrateSqlite(file);
    lab.models = async () => ({
      models: [{ id: "fake", name: "Fake", contextWindow: 100000 }],
    });
    let calls = 0;
    lab.model = () => ({
      id: "fake",
      async generate() {
        calls++;
        return { content: "Simulation", toolCalls: [] };
      },
    });
    const app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/state",
      lab,
    );
    await app.assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const reserved = reserve();
    await new Promise<void>((r) => reserved.listen(0, "127.0.0.1", r));
    const port = (reserved.address() as { port: number }).port;
    await new Promise<void>((r) => reserved.close(() => r()));
    const origin = "http://127.0.0.1:" + port;
    const server = createWebServer({
      origin,
      access: new WebAccess({
        secret: "instructions-fixture-secret-at-least-32",
        password: "fake-password",
      }),
      lab,
      ...app,
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let reads = 0;
      page.on("request", (r) => {
        if (r.url().endsWith("/api/policies") && r.method() === "GET") reads++;
      });
      assert.equal((await fetch(origin + "/api/policies")).status, 401);
      await page.goto(origin + "/#settings");
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("#settings-panel-appearance:not([hidden])");
      assert.equal(reads, 0);
      await page.click("#settings-tab-policies");
      await page.waitForSelector("[data-policy-section]");
      assert.equal(
        await page.locator("[role=tab][data-settings-tab]").count(),
        5,
      );
      assert.equal(await page.locator("[data-policy-section]").count(), 4);
      const n = reads;
      await page.click("#settings-tab-appearance");
      await page.click("#settings-tab-policies");
      assert.equal(reads, n);
      await page.locator("[data-policy-section=messages]").click();
      await page.fill("#policy-maxCharacters", "20000");
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await page.route("**/api/policies", async (route) => {
        if (route.request().method() === "POST") await gate;
        await route.continue();
      });
      await page.click("#policy-save");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLButtonElement>("#policy-save")!.disabled,
      );
      assert.match(
        await page.locator("#policy-status").innerText(),
        /Enregistrement/,
      );
      release();
      await page.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      await page.unroute("**/api/policies");
      assert.equal(
        (await app.assistant.policies()).messages.maxCharacters,
        20000,
      );
      assert.equal(
        await page.locator("#conversation-prompt").getAttribute("maxlength"),
        "20000",
      );
      assert.equal(calls, 0);
      await page.reload();
      await page.waitForSelector("[data-policy-section]");
      await page.locator("[data-policy-section=messages]").click();
      assert.equal(await page.inputValue("#policy-maxCharacters"), "20000");
      await page.click("#policy-reset");
      assert.equal(await page.inputValue("#policy-maxCharacters"), "8000");
      assert.equal(
        (await app.assistant.policies()).messages.maxCharacters,
        20000,
        "reset only prepares a draft",
      );
      await page.fill("#policy-maxCharacters", "0");
      await page.click("#policy-save");
      await page.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      assert.equal(
        await page.locator("#conversation-prompt").getAttribute("maxlength"),
        null,
      );
      await page.locator("[data-policy-section=tools]").click();
      await page.fill("#policy-maxCallsPerBatch", "20");
      const current = await app.assistant.get();
      await app.assistant.patch({
        version: current.version,
        base: { name: current.settings.name },
        patch: { name: "Elios" },
      });
      await page.click("#policy-save");
      await page.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      assert.equal((await app.assistant.get()).settings.name, "Elios");
      await page.locator("[data-policy-section=tools]").click();
      await page.fill("#policy-maxCallsPerBatch", "25");
      const c = await app.assistant.policyCatalog();
      await app.assistant.savePolicy({
        version: c.version,
        section: "tools",
        baseValue: c.policies.tools,
        value: { maxCallsPerBatch: 30 },
      });
      await page.click("#policy-save");
      await page.waitForFunction(() =>
        document
          .querySelector("#policy-status")!
          .textContent!.includes("ailleurs"),
      );
      assert.equal(await page.inputValue("#policy-maxCallsPerBatch"), "25");
      assert.equal((await app.assistant.policies()).tools.maxCallsPerBatch, 30);
      await page.locator("#policy-dialog [data-close-editor]").click();
      await page.click("#policies-refresh");
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>("#policies-refresh")!
            .disabled,
      );
      const stale = await app.assistant.policyCatalog();
      let finishRead!: () => void;
      const readGate = new Promise<void>((r) => (finishRead = r));
      await page.route("**/api/policies", async (route) => {
        if (route.request().method() === "GET") {
          await readGate;
          return route.fulfill({ json: stale });
        }
        return route.continue();
      });
      await page.click("#policies-refresh");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLButtonElement>("#policies-refresh")!
            .disabled,
      );
      await page.locator("[data-policy-section=tools]").click();
      await page.fill("#policy-maxCallsPerBatch", "40");
      await page.click("#policy-save");
      await page.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      finishRead();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>("#policies-refresh")!
            .disabled,
      );
      assert.match(
        await page.locator("[data-policy-section=tools]").innerText(),
        /40 appels/,
      );
      assert.equal(
        await page.evaluate("state.assistant.version"),
        (await app.assistant.get()).version,
      );
      await page.unroute("**/api/policies");
      // Real HTTP transport: a >32 KiB UTF-8 message now reaches the engine with the owner's unlimited message policy.
      const conversation = await app.conversations.create({
        title: "Long message",
      });
      const result = await page.evaluate(async (id) => {
        const response = await fetch("/api/conversations/" + id + "/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": eval("csrf"),
          },
          body: JSON.stringify({
            provider: "chatgpt",
            modelId: "fake",
            prompt: "é".repeat(17000),
          }),
        });
        return { status: response.status, body: await response.text() };
      }, conversation.conversation.id);
      // The fake provider receives the complete UTF-8 payload through the actual HTTP and context pipeline.
      assert.equal(result.status, 200, result.body);
      assert(calls > 0);
      const history = await app.conversations.get(conversation.conversation.id);
      assert(JSON.stringify(history).includes("é".repeat(17000)));
      const dismiss = page.locator("#global-message:not([hidden]) button");
      if (await dismiss.count()) await dismiss.first().click();
      await mkdir("docs/qualification/policies", { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForFunction(() => {
          const r = document
            .querySelector("#settings-tab-policies")!
            .getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth;
        });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "docs/qualification/policies/list-" + width + ".png",
        });
        await page.locator("[data-policy-section=memory]").click();
        await page.waitForSelector("#policy-dialog[open]");
        assert(
          await page.evaluate(() => {
            const r = document
              .querySelector("#policy-dialog")!
              .getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth;
          }),
        );
        await page.screenshot({
          path: "docs/qualification/policies/memory-" + width + ".png",
        });
        await page.locator("#policy-dialog [data-close-editor]").click();
      }
      assert.deepEqual(errors, []);
      await writeFile(
        "docs/qualification/policies/summary.json",
        JSON.stringify(
          {
            fixture: "SQLite disposable, simulated providers",
            widths: [320, 390, 820, 1440],
            cards: 4,
            tabs: 5,
            persistence: true,
            conflictsPreserveDraft: true,
            loadingFeedback: true,
            unlimitedComposer: true,
            transportStatus: result.status,
            errors,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
