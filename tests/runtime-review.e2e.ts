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
  "configuration races preserve independent edits, latest profile and logout without DOM churn",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp("/tmp/heart-config-review-"),
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
      const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
        }),
        page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let writes = 0;
      page.on("request", (r) => {
        if (r.url().endsWith("/api/policies") && r.method() === "POST")
          writes++;
      });
      await page.goto(origin + "/#settings-policies");
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("[data-policy-section]");
      const other = await page.context().newPage();
      await other.goto(origin + "/#settings-policies");
      await other.waitForSelector("[data-policy-section]");
      await page.locator("[data-policy-section=memory]").click();
      await other.locator("[data-policy-section=memory]").click();
      await page.fill("#policy-candidates", "7");
      await page.click("#policy-save");
      await page.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      await other.fill("#policy-injectedItems", "9");
      await other.click("#policy-save");
      await other.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      assert.equal((await app.assistant.policies()).memory.candidates, 7);
      assert.equal((await app.assistant.policies()).memory.injectedItems, 9);
      await other.close();
      await page.click("#policies-refresh");
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>("#policies-refresh")!
            .disabled,
      );
      const version = (await app.assistant.get()).version,
        before = writes;
      await page.locator("[data-policy-section=tools]").click();
      await page.click("#policy-save");
      await page.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      assert.equal(writes, before);
      assert.equal((await app.assistant.get()).version, version);
      const mutations = await page.evaluate(() => {
        const observer = new MutationObserver(() => {});
        observer.observe(document.querySelector("#conversation-prompt")!, {
          attributes: true,
          attributeFilter: ["maxlength"],
        });
        for (let i = 0; i < 10; i++) (window as any).heartPolicies.sync();
        const n = observer.takeRecords().length;
        observer.disconnect();
        return n;
      });
      assert.equal(mutations, 0);
      const stale = await page.evaluate(
        async () => await (await fetch("/api/state")).json(),
      );
      let finishRead!: () => void;
      const gate = new Promise<void>((r) => (finishRead = r));
      let requested!: () => void;
      const started = new Promise<void>((r) => (requested = r));
      await page.route("**/api/state", async (route) => {
        requested();
        await gate;
        return route.fulfill({ json: stale });
      });
      await page.evaluate(() => {
        (window as any).__refreshDone = false;
        (window as any)
          .refreshState()
          .finally(() => ((window as any).__refreshDone = true));
      });
      await started;
      await page.locator("[data-policy-section=messages]").click();
      await page.fill("#policy-maxCharacters", "24680");
      await page.click("#policy-save");
      await page.waitForSelector("#policy-dialog:not([open])", {
        state: "attached",
      });
      await page.evaluate(() => {
        (window as any).__wrongLimits = [];
        (window as any).__maxObserver = new MutationObserver(() => {
          const n = document
            .querySelector("#conversation-prompt")!
            .getAttribute("maxlength");
          if (n !== "24680") (window as any).__wrongLimits.push(n);
        });
        (window as any).__maxObserver.observe(
          document.querySelector("#conversation-prompt"),
          { attributes: true, attributeFilter: ["maxlength"] },
        );
      });
      finishRead();
      await page.waitForFunction(() => (window as any).__refreshDone);
      assert.equal(
        await page.evaluate("state.assistant.version"),
        (await app.assistant.get()).version,
      );
      assert.deepEqual(
        await page.evaluate(
          "(window.__maxObserver.disconnect(),window.__wrongLimits)",
        ),
        [],
      );
      await page.unroute("**/api/state");
      for (const kind of ["policies", "instructions"]) {
        await page.evaluate((k) => (location.hash = "settings-" + k), kind);
        if (kind === "policies") {
          await page.waitForSelector("[data-policy-section]");
          await page.locator("[data-policy-section=tools]").click();
          await page.fill("#policy-maxCallsPerBatch", "21");
        } else {
          await page.waitForSelector(".instruction-row");
          await page.locator("[data-instruction-id=web]").click();
          await page.fill("#instruction-text", "Saved before logout");
        }
        let finish!: () => void;
        const saveGate = new Promise<void>((r) => (finish = r));
        let posted!: () => void;
        const committed = new Promise<void>((r) => (posted = r));
        await page.route("**/api/" + kind, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          posted();
          await saveGate;
          return route.fulfill({ response });
        });
        await page.click(
          kind === "policies" ? "#policy-save" : "#instruction-save",
        );
        await committed;
        await page.evaluate(() =>
          document.getElementById("logout-button")!.click(),
        );
        await page.waitForSelector("#login-view:not([hidden])");
        finish();
        await page.waitForFunction(
          (k) =>
            !document.querySelector<HTMLButtonElement>(
              k === "policies" ? "#policy-save" : "#instruction-save",
            )!.disabled,
          kind,
        );
        assert.equal(await page.evaluate("state.assistant"), null);
        assert.equal(await page.locator("[data-policy-section]").count(), 0);
        assert.equal(await page.locator(".instruction-row").count(), 0);
        assert.equal(await page.inputValue("#instruction-text"), "");
        await page.unroute("**/api/" + kind);
        await page.fill("#password", "fake-password");
        await page.click("#login-submit");
        await page.waitForSelector("#app-view:not([hidden])");
      }
      // An old authenticated response cannot reopen the interface after logout.
      const connected = await page.evaluate(
        async () => await (await fetch("/api/state")).json(),
      );
      let releaseLogout!: () => void;
      const logoutGate = new Promise<void>((r) => (releaseLogout = r));
      let stateRequested!: () => void;
      const reading = new Promise<void>((r) => (stateRequested = r));
      await page.route("**/api/state", async (route) => {
        stateRequested();
        await logoutGate;
        return route.fulfill({ json: connected });
      });
      await page.evaluate(() => {
        (window as any).__refreshDone = false;
        (window as any)
          .refreshState()
          .finally(() => ((window as any).__refreshDone = true));
      });
      await reading;
      await page.evaluate(() =>
        document.getElementById("logout-button")!.click(),
      );
      await page.waitForSelector("#login-view:not([hidden])");
      releaseLogout();
      await page.waitForFunction(() => (window as any).__refreshDone);
      assert.equal(await page.evaluate("state.authenticated"), false);
      assert.equal(await page.evaluate("state.assistant"), null);
      assert.equal(await page.locator("#app-view").isVisible(), false);
      assert.equal(await page.locator("[data-policy-section]").count(), 0);
      assert.equal(await page.locator(".instruction-row").count(), 0);
      assert.equal(calls, 0);
      assert.deepEqual(errors, []);
      await mkdir("docs/qualification/runtime-review", { recursive: true });
      await writeFile(
        "docs/qualification/runtime-review/browser.json",
        JSON.stringify(
          {
            fixture: "SQLite disposable, simulated providers",
            independentMemoryEditsMerged: true,
            unchangedSaveWrites: 0,
            composerMutationsAfterTenSyncs: mutations,
            staleStatePreservesProfile: true,
            staleStateCannotRestoreLogout: true,
            lateWritesCannotRestorePrivateCatalogs: true,
            providerCalls: calls,
            jsErrors: errors.length,
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
      await rm(root, { recursive: true, force: true });
    }
  },
);
