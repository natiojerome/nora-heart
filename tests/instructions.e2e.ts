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
  "owner browses, edits, persists and resets instruction blocks without inference or losing conflicting drafts",
  { timeout: 45000 },
  async () => {
    const root = await mkdtemp("/tmp/heart-instructions-ui-"),
      file = root + "/state.sqlite";
    const lab = new TestLab({
      directory: root + "/lab",
      authDirectory: root + "/auth",
    });
    await lab.prepare();
    await migrateSqlite(file);
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
      let catalogRequests = 0;
      page.on("request", (request) => {
        if (
          request.url().endsWith("/api/instructions") &&
          request.method() === "GET"
        )
          catalogRequests++;
      });
      assert.equal((await fetch(origin + "/api/instructions")).status, 401);
      await page.goto(origin + "/#settings");
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("#settings-panel-appearance:not([hidden])");
      assert.equal(
        await page.locator(".instruction-row").count(),
        0,
        "Instructions load only when opened",
      );
      await page.evaluate(() => (location.hash = "instructions"));
      await page.waitForSelector(".instruction-row");
      assert.equal(await page.locator(".instruction-row").count(), 12);
      assert.equal(
        await page.locator("#screen-instructions").isVisible(),
        true,
      );
      assert.equal(
        await page.locator("#settings-panel-assistant #edit-assistant").count(),
        1,
      );
      assert.equal(
        await page
          .locator("#settings-panel-appearance #edit-assistant")
          .count(),
        0,
      );
      assert.equal(
        await page.locator("#assistant-presentation-preview").textContent(),
        await app.assistant.instructions(),
      );
      await page.click("#settings-tab-assistant");
      await page.waitForSelector("#settings-panel-assistant:not([hidden])");
      await page.click("#edit-assistant");
      await page.waitForSelector("#assistant-dialog[open]");
      await page.fill("#assistant-editor-name", "Elios");
      await page.click("#assistant-editor-gender-trigger");
      await page
        .locator('#select-sheet-options [data-value="neutral"]')
        .click();
      const customPersonality =
        "Réponds simplement, avec des exemples concrets. Présente-toi sous le nom Elios.";
      await page.fill("#assistant-personality-text", customPersonality);
      await mkdir("docs/qualification/settings-tabs", {
        recursive: true,
      });
      await page.screenshot({
        path: "docs/qualification/settings-tabs/personality-editor-mobile.png",
      });
      await page.click("#assistant-save");
      await page.waitForSelector("#assistant-dialog:not([open])", {
        state: "attached",
      });
      assert((await app.assistant.instructions()).includes(customPersonality));
      assert.equal((await app.assistant.get()).settings.gender, "neutral");
      await page.reload();
      await page.waitForSelector("#settings-panel-assistant:not([hidden])");
      assert(
        (
          await page.locator("#assistant-presentation-preview").textContent()
        )?.includes(customPersonality),
      );
      await page.click("#edit-assistant");
      assert.equal(
        await page.inputValue("#assistant-personality-text"),
        customPersonality,
      );
      await page.click("#assistant-personality-reset");
      assert.equal(
        await page.inputValue("#assistant-personality-text"),
        (await app.assistant.get()).personalityDefault,
      );
      await page.click("#assistant-save");
      await page.waitForSelector("#assistant-dialog:not([open])", {
        state: "attached",
      });
      await page.evaluate(() => (location.hash = "settings"));
      await page.waitForSelector("#screen-settings:not([hidden])");
      assert.equal(
        await page
          .locator("#settings-panel-appearance #edit-assistant")
          .count(),
        0,
      );
      await page.click("#edit-appearance");
      await page.waitForSelector("#appearance-dialog[open]");
      assert.equal(await page.locator("#appearance-dialog select").count(), 1);
      assert.equal(
        await page.locator("#appearance-dialog #theme-choice").count(),
        1,
      );
      await page
        .locator("#appearance-dialog [data-close-editor]")
        .first()
        .click();
      await page.evaluate(() => (location.hash = "settings-instructions"));
      await page.waitForSelector(".instruction-row");
      await page.screenshot({
        path: "docs/qualification/settings-tabs/list-mobile.png",
      });
      const readsBefore = catalogRequests;
      await page.evaluate(() => {
        (window as any).__row = document.querySelector(".instruction-row");
      });
      for (let n = 0; n < 2; n++)
        for (const tab of [
          "appearance",
          "assistant",
          "conversations",
          "instructions",
        ]) {
          await page.click("#settings-tab-" + tab);
          await page.waitForSelector(
            "#settings-panel-" + tab + ":not([hidden])",
          );
        }
      assert.equal(
        catalogRequests,
        readsBefore,
        "Repeated tab visits reuse the instruction catalog",
      );
      assert(
        await page.evaluate(
          () =>
            (window as any).__row ===
            document.querySelector(".instruction-row"),
        ),
        "Unchanged rows keep their DOM",
      );
      await page.locator("#settings-tab-instructions").focus();
      await page.keyboard.press("Home");
      await page.waitForSelector("#settings-panel-appearance:not([hidden])");
      assert.equal(
        await page
          .locator("#settings-tab-appearance")
          .getAttribute("aria-selected"),
        "true",
      );
      await page.keyboard.press("End");
      await page.waitForSelector("#settings-panel-policies:not([hidden])");
      await page.click("#settings-tab-instructions");
      const defaults = (await app.assistant.instructionCatalog()).blocks.find(
        (b) => b.id === "web",
      )!.defaultValue;
      await page.locator('[data-instruction-id="web"]').click();
      await page.waitForSelector("#instruction-dialog[open]");
      assert.equal(await page.inputValue("#instruction-text"), defaults);
      await page.fill(
        "#instruction-text",
        "Toujours citer les sources consultées. PERSONNALISÉ.",
      );
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      await page.route("**/api/instructions", async (route) => {
        if (route.request().method() === "POST") await gate;
        await route.continue();
      });
      await page.click("#instruction-save");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLButtonElement>("#instruction-save")!
            .disabled,
      );
      assert.match(
        await page.locator("#instruction-editor-status").innerText(),
        /Enregistrement/,
      );
      release();
      await page.waitForSelector("#instruction-dialog:not([open])", {
        state: "attached",
      });
      await page.unroute("**/api/instructions");
      assert.match(
        await page.locator('[data-instruction-id="web"]').innerText(),
        /Personnalisé/,
      );
      assert.equal(calls, 0);
      await page.reload();
      await page.waitForSelector(".instruction-row");
      await page.locator('[data-instruction-id="web"]').click();
      assert.match(await page.inputValue("#instruction-text"), /PERSONNALISÉ/);
      await page.click("#instruction-reset");
      assert.equal(await page.inputValue("#instruction-text"), defaults);
      assert.match(
        await page.locator("#instruction-editor-status").innerText(),
        /Enregistre/,
      );
      await page.click("#instruction-save");
      await page.waitForSelector("#instruction-dialog:not([open])", {
        state: "attached",
      });
      assert.equal((await app.assistant.instructionOverrides()).web, undefined);
      await page.locator('[data-instruction-id="memoryPolicy"]').click();
      const old = await app.assistant.instructionCatalog();
      await app.assistant.saveInstruction({
        id: "memoryPolicy",
        value: "Modification autre fenêtre.",
        baseValue: null,
        version: old.version,
      });
      await page.fill("#instruction-text", "Mon brouillon à conserver.");
      await page.click("#instruction-save");
      await page.waitForFunction(() =>
        document
          .querySelector("#instruction-editor-status")
          ?.textContent?.includes("ailleurs"),
      );
      assert.equal(
        await page.inputValue("#instruction-text"),
        "Mon brouillon à conserver.",
      );
      assert.equal(await page.locator("#instruction-dialog[open]").count(), 1);
      await page.locator("#instruction-dialog [data-close-editor]").click();
      await page.click("#instructions-refresh");
      await page.waitForFunction(() =>
        document
          .querySelector('[data-instruction-id="memoryPolicy"]')
          ?.textContent?.includes("autre fenêtre"),
      );
      await page.evaluate(() => {
        const w = window as any;
        w.__mutations = 0;
        w.__observer = new MutationObserver((records) => {
          w.__mutations += records.length;
        });
        w.__observer.observe(document.getElementById("instruction-list"), {
          childList: true,
          subtree: true,
        });
      });
      await page.click("#instructions-refresh");
      await page.waitForFunction(
        () =>
          !(
            document.getElementById("instructions-refresh") as HTMLButtonElement
          ).disabled,
      );
      assert.equal(
        await page.evaluate(() => (window as any).__mutations),
        0,
        "Unchanged refresh preserves DOM",
      );
      await page.evaluate(() => (window as any).__observer.disconnect());
      const stale = await app.assistant.instructionCatalog();
      let releaseRead!: () => void;
      const readGate = new Promise<void>((r) => (releaseRead = r));
      await page.route("**/api/instructions", async (route) => {
        if (route.request().method() === "GET") {
          await readGate;
          return route.fulfill({ json: stale });
        }
        return route.continue();
      });
      await page.click("#instructions-refresh");
      await page.waitForFunction(
        () =>
          (document.getElementById("instructions-refresh") as HTMLButtonElement)
            .disabled,
      );
      await page.locator('[data-instruction-id="progress"]').click();
      await page.fill("#instruction-text", "État récent à conserver.");
      await page.click("#instruction-save");
      await page.waitForSelector("#instruction-dialog:not([open])", {
        state: "attached",
      });
      releaseRead();
      await page.waitForFunction(
        () =>
          !(
            document.getElementById("instructions-refresh") as HTMLButtonElement
          ).disabled,
      );
      assert.match(
        await page.locator('[data-instruction-id="progress"]').innerText(),
        /État récent/,
      );
      assert.equal(
        await page.evaluate("state.assistant.version"),
        (await app.assistant.get()).version,
      );
      await page.unroute("**/api/instructions");
      await page.click("#instructions-refresh");
      await page.waitForFunction(
        () =>
          !(
            document.getElementById("instructions-refresh") as HTMLButtonElement
          ).disabled,
      );
      await mkdir("docs/qualification/settings-tabs", {
        recursive: true,
      });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        for (const tab of [
          "appearance",
          "assistant",
          "conversations",
          "instructions",
        ]) {
          await page.click("#settings-tab-" + tab);
          await page.waitForSelector(
            "#settings-panel-" + tab + ":not([hidden])",
          );
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          if (width === 390 || tab === "instructions")
            await page.screenshot({
              path:
                "docs/qualification/settings-tabs/" +
                tab +
                "-" +
                width +
                ".png",
            });
        }
      }
      await page.setViewportSize({ width: 390, height: 900 });
      await page.click("#settings-tab-appearance");
      await page.click("#edit-appearance");
      await page.click("#theme-choice-trigger");
      await page
        .locator("#select-sheet-options")
        .getByRole("option", { name: "Nocturne", exact: true })
        .click();
      await page.click("#save-appearance");
      await page.waitForSelector("#appearance-dialog:not([open])", {
        state: "attached",
      });
      assert.equal((await app.assistant.get()).settings.theme, "night");
      assert.equal((await app.assistant.get()).settings.name, "Elios");
      assert.equal((await app.assistant.get()).settings.gender, "neutral");
      await page.screenshot({
        path: "docs/qualification/settings-tabs/appearance-night.png",
      });
      await page.click("#settings-tab-instructions");
      await page.waitForFunction(
        () =>
          !(
            document.getElementById("instructions-refresh") as HTMLButtonElement
          ).disabled,
      );
      await page.screenshot({
        path: "docs/qualification/settings-tabs/instructions-night.png",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('[data-instruction-id="memory"]').click();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: "docs/qualification/settings-tabs/editor-mobile.png",
      });
      assert.equal(calls, 0);
      assert.deepEqual(errors, []);
      await writeFile(
        "docs/qualification/settings-tabs/browser.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            scope:
              "Chromium + actual HTTP/SQLite assembly on temporary state; no model call",
            blocks: 12,
            unifiedConfiguration: true,
            fourAccessibleTabs: true,
            lazyCatalog: true,
            noExtraReadsOnRepeatedTabs: true,
            unchangedRowDomPreserved: true,
            keyboardNavigation: true,
            unchangedRefreshDomMutations: 0,
            staleReadCannotRevertSave: true,
            allFourTabsAtEveryViewport: true,
            themeSavePreservesIdentityAndInstructions: true,
            themes: ["light", "night"],
            identityInAssistantTab: true,
            noIdentityEditorInAppearanceTab: true,
            presentationMatchesInjectedText: true,
            nameGenderPersonalityPersisted: true,
            personalityResetPreservesIdentity: true,
            appearanceOnlyTheme: true,
            saveFeedback: true,
            reloadPreservesEdit: true,
            resetRemovesOverride: true,
            conflictKeepsDraft: true,
            unauthenticatedReadRejected: true,
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
      await app.close();
      await lab.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
