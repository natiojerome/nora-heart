import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as reserve } from "node:net";
import { chromium } from "@playwright/test";
import { skillsFixture } from "./skills.fixture.ts";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";

test(
  "skills catalogue is responsive, lazy, cached, readable and saves activation with feedback, persistence and conflict protection",
  { timeout: 45000 },
  async () => {
    const f = await skillsFixture(),
      file = f.root + "/state.sqlite",
      lab = new TestLab({
        directory: f.root + "/lab",
        authDirectory: f.root + "/auth",
      });
    await lab.prepare();
    await migrateSqlite(file);
    let calls = 0;
    lab.model = () => ({
      id: "fake",
      async generate() {
        calls++;
        return { content: "Fake", toolCalls: [] };
      },
    });
    const app = await openWebConversations(
      { driver: "sqlite", file },
      f.root + "/state",
      lab,
      f.manifest,
    );
    await app.assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const reserved = reserve();
    await new Promise<void>((r) => reserved.listen(0, "127.0.0.1", r));
    const port = (reserved.address() as { port: number }).port;
    await new Promise<void>((r) => reserved.close(() => r()));
    const origin = "http://127.0.0.1:" + port,
      server = createWebServer({
        origin,
        access: new WebAccess({
          secret: "skills-test-secret-at-least-32-characters",
          password: "test-password",
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
      page.on("pageerror", (e) => errors.push(e.message));
      let reads = 0;
      page.on("request", (r) => {
        if (r.url().endsWith("/api/skills") && r.method() === "GET") reads++;
      });
      assert.equal((await fetch(origin + "/api/skills")).status, 401);
      await page.goto(origin + "/#settings");
      await page.fill("#password", "test-password");
      await page.click("#login-submit");
      await page.waitForSelector("#app-view:not([hidden])");
      assert.equal(reads, 0);
      await page.evaluate(() => (location.hash = "tools"));
      await page.waitForSelector("#capabilities-tools:not([hidden])");
      assert.equal(reads, 0);
      assert(!(await page.locator("#mcp-add").isVisible()));
      assert(!(await page.locator("#skills-section").isVisible()));
      await page.locator("#capabilities-tab-tools").focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => location.hash === "#tools-skills");
      await page.waitForSelector("[data-skill-id]");
      assert.equal(await page.locator("[data-skill-id]").count(), 2);
      assert((await page.locator("#skills-list").textContent())?.includes("Disponible"));
      assert(!(await page.locator("#mcp-add").isVisible()));
      assert(!(await page.locator("#capabilities-tools").isVisible()));
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const n = reads;
      await page.evaluate(() => (location.hash = "settings"));
      await page.evaluate(() => (location.hash = "tools-skills"));
      await page.waitForSelector("[data-skill-id]");
      assert.equal(reads, n);
      await page.locator('[data-skill-id="' + f.id + '"]').click();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLInputElement>("#skill-enabled")!.disabled,
      );
      assert(await page.locator("#skill-enabled").isChecked());
      assert(
        (await page.locator("#skill-source").textContent())!.includes(
          f.instructions,
        ),
      );
      assert.equal(
        await page.locator("#skill-invocation").textContent(),
        "$code-review",
      );
      assert.match(
        (await page.locator("#skill-resource-list").textContent()) ?? "",
        /references\/report.md/,
      );
      let finish!: () => void;
      const gate = new Promise<void>((r) => (finish = r));
      await page.route("**/api/skills", async (route) => {
        if (route.request().method() === "POST") await gate;
        return route.continue();
      });
      // The existing custom switch forwards its change to the native checked state.
      await page.locator("#skill-enabled").click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>("#skill-enabled")!.disabled,
      );
      assert.match(
        await page.locator("#skill-status").innerText(),
        /Enregistrement/,
      );
      finish();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLInputElement>("#skill-enabled")!.disabled,
      );
      assert.equal((await app.skills.list()).skills[0].enabled, false);
      await page.unroute("**/api/skills");
      await page.locator("#skill-dialog [data-close-editor]").click();
      await page.reload();
      await page.waitForSelector("[data-skill-id]");
      assert.match(
        await page.locator('[data-skill-id="' + f.id + '"]').innerText(),
        /Désactivé/,
      );
      await page.locator('[data-skill-id="' + f.id + '"]').click();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLInputElement>("#skill-enabled")!.disabled,
      );
      assert(!(await page.locator("#skill-enabled").isChecked()));
      const current = await app.skills.list();
      await app.skills.set({
        id: f.id,
        revision: current.skills[0].revision,
        enabled: true,
        baseEnabled: false,
        version: current.version,
      });
      // This stale dialog tries to save based on the previous disabled state.
      await page.locator("#skill-enabled").click();
      await page.waitForFunction(() =>
        document
          .querySelector("#skill-status")!
          .textContent!.includes("ailleurs"),
      );
      assert.equal((await app.skills.list()).skills[0].enabled, true);
      assert(
        !(await page.locator("#skill-enabled").isChecked()),
        "conflicting draft restores previous UI value",
      );
      await page.locator("#skill-dialog [data-close-editor]").click();
      await page.click("#skills-refresh");
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>("#skills-refresh")!
            .disabled,
      );
      const notice = page.locator("#global-message:not([hidden]) button");
      if (await notice.count()) await notice.click();
      await mkdir("docs/qualification/skills", { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "docs/qualification/skills/list-" + width + ".png",
        });
        await page.locator('[data-skill-id="' + f.id + '"]').click();
        await page.waitForFunction(
          () =>
            !document.querySelector<HTMLInputElement>("#skill-enabled")!
              .disabled,
        );
        await page
          .locator("#skill-dialog details")
          .first()
          .evaluate((e) => ((e as HTMLDetailsElement).open = true));
        assert(
          await page.evaluate(() => {
            const r = document
              .querySelector("#skill-dialog")!
              .getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth;
          }),
        );
        await page.screenshot({
          path: "docs/qualification/skills/detail-" + width + ".png",
        });
        await page.locator("#skill-dialog [data-close-editor]").click();
      }
      assert.equal(calls, 0, "catalogue and configuration never call a model");
      const conversation = (
        await app.conversations.create({ title: "Skill through HTTP" })
      ).conversation;
      await app.conversations.mutateWorkspace(conversation.id, {
        action: "create",
        path: "app.ts",
        content: "return total / count;",
      });
      let workflow = 0;
      lab.model = () => ({
        id: "fake",
        async generate(request) {
          calls++;
          assert(request.instructions.includes(f.instructions));
          assert(!request.tools.some((t) => t.name === "files.create"));
          if (workflow++ === 0)
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
          if (workflow === 2) {
            assert(
              JSON.stringify(request.messages).includes("REFERENCE-REPORT"),
            );
            return {
              content: "",
              toolCalls: [
                {
                  id: "source",
                  name: "files.read",
                  arguments: { path: "app.ts" },
                },
              ],
            };
          }
          assert(
            JSON.stringify(request.messages).includes("return total / count;"),
          );
          return {
            content:
              "Skill vérifié : division à contrôler lorsque count vaut zéro.",
            toolCalls: [],
          };
        },
      });
      const response = await page.evaluate(
        async ({ id }) =>
          (window as any).post("/api/conversations/" + id + "/messages", {
            provider: "demo",
            contextWindow: 32768,
            prompt: "$code-review examine app.ts",
          }),
        { id: conversation.id },
      );
      assert(JSON.stringify(response).includes("Skill vérifié"));
      assert.equal(calls, 3);
      await page.evaluate(async (id) => {
        location.hash = "conversations";
        await (window as any).openConversation(id);
      }, conversation.id);
      await page.waitForFunction(() =>
        document
          .querySelector("#conversation-history")!
          .textContent!.includes("Skill vérifié"),
      );
      await page.evaluate(() => (location.hash = "tools-skills"));
      await page.waitForSelector("[data-skill-id]");
      let releaseDetail!: () => void;
      const detailGate = new Promise<void>((r) => (releaseDetail = r));
      let startedDetail!: () => void;
      const detailStarted = new Promise<void>((r) => (startedDetail = r));
      await page.route("**/api/skills/" + f.id, async (route) => {
        const response = await route.fetch();
        startedDetail();
        await detailGate;
        return route.fulfill({ response });
      });
      await page.locator('[data-skill-id="' + f.id + '"]').click();
      await detailStarted;
      await page.locator("#skill-dialog [data-close-editor]").click();
      await page.evaluate(() =>
        document.getElementById("logout-button")!.click(),
      );
      await page.waitForSelector("#login-view:not([hidden])");
      const received = page.waitForResponse((r) =>
        r.url().endsWith("/api/skills/" + f.id),
      );
      releaseDetail();
      await received;
      assert.equal(await page.locator("#skill-source").textContent(), "");
      assert.equal(await page.locator("#skill-description").textContent(), "");
      assert.equal(await page.locator("[data-skill-id]").count(), 0);
      assert.deepEqual(errors, []);
      await writeFile(
        "docs/qualification/skills/browser.json",
        JSON.stringify(
          {
            fixture: "SQLite disposable, simulated model",
            widths: [320, 390, 820, 1440],
            lazy: true,
            cached: true,
            sourceReadable: true,
            activationPersists: true,
            loadingFeedback: true,
            conflictProtected: true,
            configurationProviderCalls: 0,
            simulatedWorkflowCalls: 3,
            httpWorkflowVisibleInChat: true,
            lateDetailAfterLogoutIgnored: true,
            jsErrors: 0,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await app.close();
      await lab.close();
      await f.close();
    }
  },
);
