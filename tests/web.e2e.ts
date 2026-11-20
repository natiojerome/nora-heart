import { assistantFixture } from "./assistant.fixture.ts";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium, type Browser } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess, writeWebInvitation } from "../src/app/web-access.ts";
import { structuredMemoryFixture } from "./structured-memory-fixture.ts";
import { conversationFixture } from "./conversation-fixture.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";

async function reservePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  return port;
}

test(
  "web atelier supports invitation, isolated simulation, module checks and private API setup on desktop and mobile",
  { timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "harness-web-browser-"),
    );
    const inviteFile = path.join(directory, "invitation.json");
    const lab = new TestLab({
      directory: path.join(directory, "lab"),
      authDirectory: path.join(directory, "auth"),
    });
    let connected = false,
      catalogueFailed = false,
      catalogueCalls = 0;
    let connectionStatus: "idle" | "pending" | "connected" = "idle";
    let catalogue: {id:string;name:string;reasoningEfforts?:string[];defaultReasoningEffort?:string}[] = [
      { id: "test-model-a", name: "Test model A", reasoningEfforts:["low","high"],defaultReasoningEffort:"low" },
      { id: "test-model-b", name: "Test model B" },
    ];
    const originalState = lab.state.bind(lab);
    lab.state = async () => {
      const value = await originalState();
      return {
        ...value,
        chatgpt: {
          ...value.chatgpt,
          connected,
          clientId: connected ? "fake-registration" : undefined,
        },
        login: { status: connectionStatus },
      };
    };
    let openRouterCalls = 0,
      openRouterFailed = false;
    let freeCatalogue = [
      {
        id: "vendor/a:free",
        name: "Alpha gratuit",
        contextWindow: 32768,
        pricing: { input: 0, output: 0, request: 0 },
        supportsTools: true,
      },
      {
        id: "vendor/b",
        name: "Beta Pro",
        contextWindow: 65536,
        pricing: { input: 1.5, output: 3, request: 0 },
        supportsTools: false,
      },
    ];
    lab.models = async (provider) => {
      if (provider === "openrouter") {
        openRouterCalls++;
        if (openRouterFailed)
          throw new Error(
            "Catalogue OpenRouter indisponible. Actualise la liste pour réessayer.",
          );
        return { models: freeCatalogue };
      }
      catalogueCalls++;
      if (catalogueFailed) throw new Error("Fake unavailable catalogue");
      return { models: catalogue };
    };
    const access = new WebAccess({
      secret: "fake-browser-session-secret-at-least-32-characters",
      password: "fake-test-password",
      inviteFile,
    });
    const origin = `http://127.0.0.1:${await reservePort()}`;
    const persistent = await conversationFixture(
      path.join(directory, "conversations"),undefined,undefined,undefined,undefined,undefined,undefined,async()=>lab.models('chatgpt'),
    );
    const structured = structuredMemoryFixture();
    const server = createWebServer({
      origin,
      access,
      assetsDirectory: process.env.HARNESS_TEST_WEB_ASSETS,
      lab,
      assistant: assistantFixture(),
      conversations: persistent.service,
      memories: structured.manager,
    });
    let browser: Browser | undefined;
    try {
      await lab.prepare();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(Number(new URL(origin).port), "127.0.0.1", resolve);
      });
      const cachedChromium = path.join(
        os.homedir(),
        ".cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
      );
      const executablePath =
        process.env.HARNESS_TEST_CHROMIUM ??
        (existsSync(cachedChromium) ? cachedChromium : undefined);
      browser = await chromium.launch({
        headless: true,
        executablePath,
        args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1050 },
        serviceWorkers: "block",
      });
      const externalRequests: string[] = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        externalRequests.push(url.origin);
        return route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const openPicker=async()=>{await page.waitForFunction(()=>{const select=document.getElementById("conversation-list") as HTMLSelectElement;return !!select?.value&&!select.disabled;});if(!await page.locator('#model-preferences-dialog').isVisible()){await page.evaluate(()=> (window as any).heartConversationModel.open());await page.waitForSelector('#model-preferences-dialog[open]');}};
      const choose = async (selector: string, value: string) => {
        const id = selector.replace(/^#/, "");
        await page.locator(`[data-select-id="${id}"]`).click();
        await page.waitForSelector("#select-sheet[open]");
        const label = await page
          .locator(selector)
          .locator("option")
          .evaluateAll(
            (nodes, value) =>
              nodes
                .find((node) => (node as HTMLOptionElement).value === value)
                ?.textContent?.trim() || "",
            value,
          );

        await page
          .locator("#select-sheet-options")
          .getByRole("option", { name: label, exact: true })
          .click();
        await page.waitForSelector("#select-sheet:not([open])", {
          state: "attached",
        });
        assert.equal(await page.inputValue(selector), value);
      };
      const captureEditor = async (name: string) => {
        if (!process.env.HARNESS_EDITOR_SCREENSHOTS) return;
        await mkdir(process.env.HARNESS_EDITOR_SCREENSHOTS, {
          recursive: true,
        });
        await page.screenshot({
          path: path.join(
            process.env.HARNESS_EDITOR_SCREENSHOTS,
            name + ".png",
          ),
        });
      };
      const pageErrors: string[] = [];
      const characterRequests: string[] = [];
      page.on("request", (request) => {
        if (/\/avatar-(?:pack|portraits)\//.test(request.url()))
          characterRequests.push(request.url());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const invite = await writeWebInvitation(inviteFile);
      await page.goto(origin);
      await page.fill("#password", invite);
      await page.click("#login-submit");
      await page.waitForSelector("#app-view:not([hidden])");
      assert.equal(await page.evaluate(() => window.location.hash), "");
      assert.equal(await page.evaluate(() => document.cookie), "");
      assert.equal(
        (await context.cookies()).find(
          (cookie) => cookie.name === "harness_session",
        )?.httpOnly,
        true,
      );
      await assert.rejects(readFile(inviteFile), { code: "ENOENT" });

      await page.waitForSelector("#setup-dialog[open]");
      await page.fill("#setup-name", "Elios");
      await page.check("[name=gender][value=neutral]");
      await page.click("#setup-next");
      await page.check("[name=theme][value=sage]");
      await page.click("#setup-next");
      await choose("#setup-personality", "direct");
      assert.match(await page.inputValue('#setup-personality-text'),/direct, concis/);
      const installPersonality=(await page.inputValue('#setup-personality-text'))+'\nPrivilégie les exemples TypeScript et indique les incertitudes.';
      await page.fill('#setup-personality-text',installPersonality);
      await page.click("#setup-next");
      await page
        .getByRole("button", {
          name: "Explorer en simulation locale",
          exact: true,
        })
        .click();
      await page.click("#setup-next");
      await page.waitForSelector("#setup-dialog:not([open])", {
        state: "attached",
      });
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "sage",
      );
      const savedSetup = await (
        await context.request.get(origin + "/api/state")
      ).json();
      assert.equal(savedSetup.assistant.settings.name, "Elios");
      assert.equal(savedSetup.assistant.settings.personalityInstructions,installPersonality);
      assert.match(savedSetup.assistant.settings.avatarPackId,/^[0-9a-f-]{36}$/);
      await page.evaluate(()=>location.hash='settings-assistant');await page.click('#edit-assistant');await page.waitForSelector('#assistant-dialog[open]');
      assert.equal(await page.inputValue('#assistant-personality-text'),installPersonality);
      const avatarId=await page.inputValue('#assistant-avatar-pack');
      await page.fill('#assistant-editor-name','Aster');const refined='Réponds en français et tutoie-moi.\nExplique les décisions avec des exemples concrets, sans formules toutes faites.';await page.fill('#assistant-personality-text',refined);
      for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});const box=await page.locator('#assistant-dialog').boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      const personaShots=path.resolve('docs/design/assistant-personality');await mkdir(personaShots,{recursive:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(personaShots,'editor-mobile.png')});
      let personaWrites=0;await page.route('**/api/assistant',route=>{if(route.request().method()==='POST'&&++personaWrites===1)return route.fulfill({status:503,json:{error:'Sauvegarde indisponible'}});return route.continue();});
      await page.click('#assistant-save');await page.waitForSelector('#assistant-dialog .dialog-feedback.error');assert.equal(await page.inputValue('#assistant-personality-text'),refined);assert(await page.locator('#assistant-dialog').isVisible());
      await page.unroute('**/api/assistant');await page.click('#assistant-save');await page.waitForSelector('#assistant-dialog',{state:'hidden'});
      const personalized=await (await context.request.get(origin+'/api/assistant')).json();assert.equal(personalized.settings.name,'Aster');assert.equal(personalized.settings.personalityInstructions,refined);assert.equal(personalized.settings.avatarPackId,avatarId);
      await page.click('#edit-assistant');await page.locator('#assistant-dialog .personality-templates summary').click();await choose('#assistant-personality-template','creative');assert.equal(await page.inputValue('#assistant-personality-text'),refined);await page.click('#assistant-apply-template');assert.match(await page.inputValue('#assistant-personality-text'),/créatif/);await page.keyboard.press('Escape');
      await page.click('#edit-assistant');assert.equal(await page.inputValue('#assistant-personality-text'),refined);await page.locator('#assistant-dialog [data-close-editor]').click();
      await page.reload();await page.waitForSelector('#app-view:not([hidden])');await page.click('#edit-assistant');assert.equal(await page.inputValue('#assistant-personality-text'),refined);assert.equal(await page.inputValue('#assistant-avatar-pack'),avatarId);await page.locator('#assistant-dialog [data-close-editor]').click();
      await page.setViewportSize({width:1440,height:1050});await page.evaluate(()=>location.hash='playground');

      assert.equal(savedSetup.assistant.settings.completed, true);
      const noCsrf = await context.request.post(origin + "/api/assistant", {
        headers: { Origin: origin },
        data: {
          version: savedSetup.assistant.version,
          settings: savedSetup.assistant.settings,
        },
      });
      assert.equal(noCsrf.status(), 403);
      const stale = await context.request.post(origin + "/api/assistant", {
        headers: { Origin: origin, "X-CSRF-Token": savedSetup.csrf },
        data: { version: 0, settings: savedSetup.assistant.settings },
      });
      assert.equal(stale.status(), 409);
      await page.evaluate(() => (location.hash = "playground"));
      await page.click("#run-test");
      await page.waitForSelector("#response-result:not([hidden])");
      assert.match(
        (await page.textContent("#answer-text")) ?? "",
        /bienvenue\.txt/,
      );
      assert.match((await page.textContent("#result-timing")) ?? "", /simulé/);
      await page.click(".event-details summary");
      assert.match(
        (await page.textContent("#event-list")) ?? "",
        /files\.list/,
      );
      assert.match(
        (await page.textContent("#event-list")) ?? "",
        /Essai terminé/,
      );
      assert.equal(
        await page.locator("#answer-text script, #event-list script").count(),
        0,
      );

      // Creation from the home title bar reaches the same persistent chat.
      await page.evaluate(() => (location.hash = "home"));
      await page.click("#home-new-conversation");
      await page.fill("#conversation-title", "Projet PostgreSQL");
      await page.click("#conversation-create button[type=submit]");
      await page.waitForFunction(
        () =>
          !!document.querySelector<HTMLSelectElement>("#conversation-list")
            ?.value,
      );
      const conversationId = await page.inputValue("#conversation-list");
      await page.click("#choose-brain");
      assert(
        await page
          .locator("#model-preferences-dialog")
          .evaluate((node) => (node as HTMLDialogElement).open),
      );
      assert.equal(
        await page.locator("#model-preferences-dialog #provider-config").count(),
        1,
      );
      await page.locator("[data-close-model-preferences]").first().click();
      assert.equal(
        await page.locator("#model-preferences-dialog #provider-config").count(),
        1,
      );
      await page.fill("#conversation-prompt", "Décision : PostgreSQL");
      await page.click("#conversation-submit");
      await page.waitForFunction(() =>
        document
          .getElementById("conversation-history")
          ?.textContent?.includes("Résultat de files.list"),
      );
      await page.reload();
      await page.waitForFunction(() =>
        document
          .getElementById("conversation-history")
          ?.textContent?.includes("Décision : PostgreSQL"),
      );
      assert.equal(await page.inputValue("#conversation-list"), conversationId);
      await page.click("#chat-back");
      await page.click("#session-new-conversation");
      await page.fill("#conversation-title", "Autre conversation");
      await page.click("#conversation-create button[type=submit]");
      await page.waitForFunction(
        (id) =>
          document.querySelector<HTMLSelectElement>("#conversation-list")
            ?.value !== id,
        conversationId,
      );
      await page.waitForFunction(
        () =>
          document.getElementById("chat-title")?.textContent ===
          "Autre conversation",
      );
      assert(
        !(await page.textContent("#conversation-history"))?.includes(
          "Décision : PostgreSQL",
        ),
      );
      await page.click("#chat-back");
      await page
        .locator("#discussion-cards .item-row")
        .filter({ hasText: "Projet PostgreSQL" })
        .click();
      await page.waitForFunction(() =>
        document
          .getElementById("conversation-history")
          ?.textContent?.includes("Décision : PostgreSQL"),
      );

      await page.evaluate(() => (location.hash = "playground"));
      await page.click('[data-suite="memory"]');
      await page.waitForFunction(() =>
        document
          .getElementById("check-output-title")
          ?.textContent?.includes("réussies"),
      );
      assert.match(
        (await page.textContent("#check-output")) ?? "",
        /memory|mémoire|tests|pass/i,
      );

      // Saving this artificial key must never trigger an inference request.
      await page.evaluate(() => (location.hash = "models"));
      const key = "fake-web-browser-api-key-not-valid";
      await page.click('[data-configure-provider="openai"]');
      await page.fill("#api-key", key);
      await page.click("#save-api-key");
      await page.waitForSelector("#api-key-editor", { state: "hidden" });
      assert.equal(await page.inputValue("#api-key"), "");
      assert.equal(
        await page.textContent("#openai-card-status"),
        "Clé configurée",
      );
      const state = await context.request.get(`${origin}/api/state`);
      const stateText = await state.text();
      assert.equal(state.status(), 200);
      assert.equal(JSON.parse(stateText).api.openai, true);
      assert.equal(stateText.includes(key), false);
      assert.equal(
        ((await page.textContent("body")) ?? "").includes(key),
        false,
      );
      assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0,
      );

      await page.click('[data-configure-provider="openrouter"]');
      await page.fill("#api-key", "fake-openrouter-browser-key");
      await page.click("#save-api-key");
      await page.waitForSelector("#api-key-dialog", { state: "hidden" });
      assert.equal(
        await page.textContent("#openrouter-card-status"),
        "Clé configurée",
      );
      assert.equal(await page.inputValue("#api-key"), "");
      await openPicker();await page.click('label:has(input[value="openrouter"])');
      assert.match(
        (await page.textContent("#cost-note")) ?? "",
        /tarif affiché/,
      );
      await page.click("#model-options-trigger");
      assert(
        await page
          .getByRole("option", { name: "Beta Pro", exact: true })
          .isVisible(),
      );
      assert.match(
        (await page.locator("#select-sheet-options").textContent()) ?? "",
        /1,5 \$.*3 \$/,
      );
      await page
        .locator("#model-picker-filters")
        .getByRole("button", { name: "Gratuits", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("option", { name: "Beta Pro", exact: true })
          .count(),
        0,
      );
      await page
        .locator("#model-picker-filters")
        .getByRole("button", { name: "Tous", exact: true })
        .click();
      assert(
        await page
          .getByRole("option", { name: "Beta Pro", exact: true })
          .isVisible(),
      );
      await page.keyboard.press("Escape");
      await choose("#model-options", "vendor/a:free");
      assert.equal(await page.locator("#model-id").isVisible(), false);
      assert.equal(await page.inputValue("#context-window"), "32768");
      assert(await page.locator("#context-window").isDisabled());
      const callsBefore = openRouterCalls;
      await page.evaluate(() => {
        (globalThis as any).eval(
          "modelsUpdatedAt=new Date(Date.now()-360000).toISOString()",
        );
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForFunction(() =>
        document
          .getElementById("refresh-models")
          ?.textContent?.includes("Actualiser"),
      );
      assert(openRouterCalls > callsBefore);
      freeCatalogue = freeCatalogue.slice(1);
      await page.click("#refresh-models");
      await page.waitForFunction(
        () => document.querySelectorAll("#model-options option").length === 2,
      );
      assert.equal(await page.inputValue("#model-id"), "");
      assert(await page.locator("#run-test").isDisabled());
      openRouterFailed = true;
      await page.click("#refresh-models");
      await page.waitForFunction(() =>
        document
          .getElementById("model-help")
          ?.textContent?.includes("indisponible"),
      );
      assert(await page.locator("#model-options-trigger").isDisabled());
      assert(await page.locator("#run-test").isDisabled());
      openRouterFailed = false;
      await page.click("#refresh-models");
      await page.waitForFunction(() =>
        document
          .getElementById("model-help")
          ?.textContent?.includes("Mis à jour"),
      );
      await choose("#model-options", "vendor/b");
      assert.equal(await page.inputValue("#context-window"), "65536");

      assert(
        !((await page.textContent("body")) ?? "").includes(
          "fake-openrouter-browser-key",
        ),
      );
      await page.click('label:has(input[value="openai"])');

      // Memory administration never calls a model and survives a page reload.
      await page.evaluate(() => (location.hash = "projects"));
      await page.click("#new-project");
      await page.fill("#project-title", "Projet mémoire");
      await page.fill("#project-objective", "Valider la mémoire du projet");
      let releaseProject!: () => void;
      let projectAttempts = 0;
      await page.route("**/api/projects", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        projectAttempts++;
        await new Promise<void>((resolve) => {
          releaseProject = resolve;
        });
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            message: "Serveur temporairement indisponible — test.",
          }),
        });
      });
      await page.click("#project-create button[type=submit]");
      await page.waitForSelector('#project-dialog[aria-busy="true"]');
      assert(await page.locator("#project-title").isDisabled());
      assert(
        await page.locator("#project-create button[type=submit]").isDisabled(),
      );
      assert.match(
        (await page
          .locator("#project-dialog .dialog-feedback")
          .textContent()) ?? "",
        /Création du projet/,
      );
      for (const [width, height] of [
        [320, 740],
        [390, 844],
        [820, 1050],
        [1440, 900],
        [740, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForFunction(
          () =>
            Math.abs(
              parseFloat(
                document.documentElement.style.getPropertyValue(
                  "--viewport-height",
                ),
              ) - innerHeight,
            ) < 1,
        );
        const rect = await page.locator("#project-dialog").boundingBox();
        assert(
          rect &&
            rect.x >= 0 &&
            rect.y >= 0 &&
            rect.x + rect.width <= width + 1 &&
            rect.y + rect.height <= height + 1,
          "editor outside viewport",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "editor overflows",
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await captureEditor("project-pending-mobile");
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.keyboard.press("Escape");
      assert(
        await page.locator("#project-dialog").isVisible(),
        "write dismissed before result",
      );
      await page.evaluate(() =>
        document
          .querySelector<HTMLFormElement>("#project-create")!
          .requestSubmit(),
      );
      assert.equal(projectAttempts, 1, "duplicate request during write");
      releaseProject();
      await page.waitForSelector("#project-dialog .dialog-feedback.error");
      assert.equal(
        await page.inputValue("#project-title"),
        "Projet mémoire",
        "failed write lost draft",
      );
      assert(
        !(await page
          .locator("#project-create button[type=submit]")
          .isDisabled()),
      );
      await page.unroute("**/api/projects");
      await page.click("#project-create button[type=submit]");
      await page.waitForFunction(
        () => document.querySelectorAll("#memory-scope option").length === 2,
      );
      await page.evaluate(() => (location.hash = "memories"));
      await page.click("#new-memory");
      await choose(
        "#memory-scope",
        (await page
          .locator("#memory-scope option")
          .last()
          .getAttribute("value"))!,
      );
      await page.fill("#memory-title", "Préférence de base");
      await page.fill("#memory-content", "Utiliser PostgreSQL pour ce projet.");
      await choose("#memory-kind", "constraint");
      await page.click("#memory-save");
      await page.waitForSelector(".memory-card");
      assert.match(
        (await page.textContent("#memory-list")) ?? "",
        /Projet mémoire.*v1/,
      );
      await page.getByRole("button", { name: "Modifier", exact: true }).click();
      await page.fill(
        "#memory-content",
        "Utiliser PostgreSQL 18 pour ce projet.",
      );
      assert.equal(
        await page.locator("#screen-memories form").count(),
        0,
        "editor inserted in list",
      );
      await page.route("**/api/memories/*", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            message:
              "Le souvenir a changé. Relis la version actuelle avant de réessayer.",
          }),
        });
      });
      await page.click("#memory-save");
      await page.waitForSelector("#memory-dialog .dialog-feedback.error");
      assert.equal(
        await page.inputValue("#memory-content"),
        "Utiliser PostgreSQL 18 pour ce projet.",
      );
      assert(await page.locator("#memory-dialog").isVisible());
      assert(!(await page.locator("#memory-save").isDisabled()));
      await page.setViewportSize({ width: 390, height: 844 });
      await captureEditor("memory-error-mobile");
      await page.evaluate(() => {
        (window as any).__editorViewport = window.visualViewport;
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: Object.assign(new EventTarget(), {
            height: 360,
            width: 390,
            offsetTop: 22,
            scale: 1,
          }),
        });
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(60);
      const editorGeometry = await page.evaluate(() => {
        const dialog = document
          .getElementById("memory-dialog")!
          .getBoundingClientRect();
        const save = document
          .getElementById("memory-save")!
          .getBoundingClientRect();
        const feedback = document
          .querySelector("#memory-dialog .dialog-feedback")!
          .getBoundingClientRect();
        return {
          top: dialog.top,
          bottom: dialog.bottom,
          saveBottom: save.bottom,
          feedbackTop: feedback.top,
        };
      });
      assert(
        editorGeometry.top >= 22 && editorGeometry.bottom <= 382,
        "editor covered by visual keyboard",
      );
      assert(
        editorGeometry.saveBottom <= editorGeometry.feedbackTop,
        "feedback covers save action",
      );
      await captureEditor("memory-error-keyboard-mobile");
      await page.click("#memory-kind-trigger");
      const pickerBounds = await page.locator("#select-sheet").boundingBox();
      assert(
        pickerBounds &&
          pickerBounds.y >= 22 &&
          pickerBounds.y + pickerBounds.height <= 382,
        "picker hidden by visual keyboard",
      );
      await page.keyboard.press("Escape");
      assert(await page.locator("#memory-dialog").isVisible());

      await page.evaluate(() => {
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: (window as any).__editorViewport,
        });
        window.dispatchEvent(new Event("resize"));
      });

      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.unroute("**/api/memories/*");
      await page.click("#memory-save");
      await page.waitForFunction(() =>
        document.getElementById("memory-list")?.textContent?.includes("v2"),
      );
      await page.reload();
      await page.waitForFunction(() =>
        document
          .getElementById("memory-list")
          ?.textContent?.includes("PostgreSQL 18"),
      );
      await page.getByRole("button", { name: "Oublier", exact: true }).click();
      await page.waitForSelector(".memory-card", { state: "hidden" });
      await page.check("#memory-show-forgotten");
      await page.waitForSelector(".memory-card.forgotten");
      await page
        .getByRole("button", { name: "Restaurer", exact: true })
        .click();
      await page.waitForSelector(".memory-card.active");
      assert.match((await page.textContent("#memory-list")) ?? "", /v4/);
      await page
        .getByRole("button", { name: "Historique", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .getElementById("memory-list")
          ?.textContent?.includes("4 versions conservées"),
      );

      await page.evaluate(() => (location.hash = "settings"));
      await page.click("#edit-appearance");
      assert(await page.locator("#appearance-dialog").isVisible());
      await page.click("#theme-choice-trigger");
      await page.keyboard.press("End");
      assert.equal(
        await page
          .locator('#select-sheet-options [role="option"]:focus')
          .getAttribute("data-value"),
        "system",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.inputValue("#theme-choice"),
        "sage",
        "cancel changed selection",
      );
      assert(
        await page.locator("#appearance-dialog").isVisible(),
        "cancel dismissed parent editor",
      );
      assert(
        await page
          .locator("#theme-choice-trigger")
          .evaluate((node) => node === document.activeElement),
        "sheet did not restore focus",
      );
      await choose("#theme-choice", "night");
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "night",
      );
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "sage",
      );
      assert(
        await page
          .locator("#edit-appearance")
          .evaluate((node) => node === document.activeElement),
        "editor did not restore focus",
      );

      // Existing connections must load their catalogue on page open, without
      // having to reconnect or type in an invisible datalist.
      connected = true;
      await page.evaluate(() => (location.hash = "models"));
      await page.reload();
      await openPicker();await page.click('label:has(input[value="chatgpt"])');
      await page.waitForFunction(
        () => document.querySelectorAll("#model-options option").length === 3,
      );
      assert.equal(catalogueCalls, 1);
      assert.equal(
        await page.locator("#model-options-trigger").isVisible(),
        true,
      );
      assert.equal(await page.locator("#model-id").isVisible(), false);
      assert.equal(await page.locator("#run-test").isDisabled(), true);
      await choose("#model-options", "test-model-a");
      assert.equal(await page.inputValue("#model-id"), "test-model-a");
      await openPicker();await choose('#reasoning-effort','high');assert.equal(await page.inputValue('#reasoning-effort'),'high');
      assert.equal(await page.locator("#run-test").isDisabled(), false);
      await page.click('label:has(input[value="openai"])');
      assert.equal(await page.locator("#model-id").isVisible(), true);
      await page.fill("#model-id", "my-api-model");
      await page.click('label:has(input[value="chatgpt"])');
      assert.equal(await page.inputValue("#model-options"), "test-model-a");
      await openPicker();assert.equal(await page.inputValue('#reasoning-effort'),'high');
      const settingsCapture=path.resolve('docs/design/conversation-settings');await mkdir(settingsCapture,{recursive:true});
      const optionsViewport=page.viewportSize()!;await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:path.join(settingsCapture,'model-options-mobile.png')});await page.setViewportSize(optionsViewport);
      await page.click('#conversation-model-save');await page.waitForSelector('#model-preferences-dialog',{state:'hidden'});
      const badgeShots=path.resolve('docs/design/chat-actions');await mkdir(badgeShots,{recursive:true});
      const badgeViewport=page.viewportSize()!;await page.setViewportSize({width:390,height:844});await page.evaluate(()=>location.hash='conversations');
      await page.waitForSelector('body.chat-mode',{state:'attached'});assert.equal(await page.locator('.chat-configuration #chat-effort').innerText(),'Effort élevé');
      await page.screenshot({path:path.join(badgeShots,'configuration-mobile.png')});
      await page.evaluate(()=>location.hash='models');await page.setViewportSize(badgeViewport);await openPicker();
      assert.equal(catalogueCalls, 2);
      catalogueFailed = true;
      await page.click("#refresh-models");
      await page.waitForFunction(() =>
        document
          .getElementById("model-help")
          ?.textContent?.includes("Impossible"),
      );
      assert.equal(await page.locator("#run-test").isDisabled(), true);
      catalogueFailed = false;
      catalogue = [{ id: "test-model-new", name: "New test model" }];
      await page.click("#refresh-models");
      await page.waitForFunction(
        () => document.querySelectorAll("#model-options option").length === 2,
      );
      assert.equal(await page.inputValue("#model-options"), "");
      await choose("#model-options", "test-model-new");
      assert.equal(await page.locator("#run-test").isDisabled(), false);

      // Completing a connection from the existing page must refresh its catalogue too.
      connected = false;
      await page.reload();
      await openPicker();await page.click('label:has(input[value="chatgpt"])');
      lab.startLogin = async () => {
        connectionStatus = "pending";
        return { status: "pending", url: origin };
      };
      lab.loginStatus = () => ({ status: connectionStatus });
      const popupPromise = context.waitForEvent("page");
      const startedConnection = page.waitForResponse(response => response.url() === origin + "/api/chatgpt/login" && response.request().method() === "POST");
      await page.locator('[data-close-model-preferences]').first().click();
      await page.click("#connect-chatgpt");
      await (await popupPromise).close();
      await startedConnection; // Do not let the fixture complete before login has started.
      connected = true;
      connectionStatus = "connected";
      await page.waitForFunction(()=>document.getElementById('chatgpt-card-status')?.textContent==='Compte connecté');await openPicker();
      await page.waitForFunction(
        () => document.querySelectorAll("#model-options option").length === 2,
      );
      assert.match(
        (await page.textContent("#model-help")) ?? "",
        /1 modèle disponible/,
      );
      assert.equal(await page.inputValue("#model-options"), "");

      catalogue = Array.from({ length: 12 }, (_, index) => ({
        id: `sheet-model-${index}`,
        name: `Modèle ${index}`,
      }));
      await page.click("#refresh-models");
      await page.waitForFunction(
        () => document.querySelectorAll("#model-options option").length === 13,
      );
      await page.click("#model-options-trigger");
      assert(await page.locator("#select-sheet-search").isVisible());
      await page.fill("#select-sheet-search", "Modèle 11");
      assert.equal(
        await page.locator('#select-sheet-options [role="option"]').count(),
        1,
      );
      await page.locator("#select-sheet-options [role=option]").click();
      assert.equal(await page.inputValue("#model-options"), "sheet-model-11");

      await persistent.service.create({ title: "A".repeat(160) });
      await structured.manager.createProject({ title: "P".repeat(160) });
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        storageState: await context.storageState(),
        serviceWorkers: "block",
      });
      await mobile.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        externalRequests.push(url.origin);
        return route.abort("blockedbyclient");
      });
      const mobilePage = await mobile.newPage();
      mobilePage.on("pageerror", (error) => pageErrors.push(error.message));
      await mobilePage.goto(origin);
      await mobilePage.waitForSelector("#app-view:not([hidden])");
      assert.equal(
        await mobilePage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      assert.equal(
        await mobilePage
          .locator("#setup-dialog")
          .evaluate((node) => (node as HTMLDialogElement).open),
        false,
      );
      for (const width of [320, 390, 820, 1440]) {
        await mobilePage.setViewportSize({ width, height: 844 });
        for (const route of [
          "home",
          "conversations",
          "projects",
          "memories",
          "more",
          "models",
          "tools",
          "lab",
          "settings",
          "automations",
          "consumption",
          "files",
          "backups",
        ]) {
          await mobilePage.evaluate((route) => (location.hash = route), route);
          await mobilePage.waitForFunction(
            (route) =>
              document.querySelector<HTMLElement>(`[data-screen="${route}"]`)
                ?.hidden === false,
            route,
          );
          assert(
            await mobilePage.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${route} overflows at ${width}`,
          );
          const typography = await mobilePage
            .locator(`[data-screen="${route}"] .page-heading`)
            .first()
            .evaluate((header) => {
              const title = getComputedStyle(header.querySelector("h1")!);
              const sub = getComputedStyle(
                header.querySelector(".page-subtitle")!,
              );
              return {
                title: title.fontSize,
                titleLine: title.lineHeight,
                sub: sub.fontSize,
                subLine: sub.lineHeight,
              };
            });
          assert.deepEqual(
            typography,
            {
              title: "18px",
              titleLine: "22.5px",
              sub: "12px",
              subLine: "16.2px",
            },
            `${route} has inconsistent heading`,
          );
          const barState = await mobilePage
            .locator(`[data-screen="${route}"] .page-heading`)
            .first()
            .evaluate((header) => {
              const rect = header.getBoundingClientRect();
              const icon =
                header.querySelector<HTMLElement>(".page-heading-icon")!;
              const menu = document.querySelector(
                `#navigation-dialog [data-icon="${icon.dataset.icon}"]`,
              );
              return {
                top: rect.top,
                height: rect.height,
                headerBottom: document
                  .querySelector(".topbar")!
                  .getBoundingClientRect().bottom,
                iconMatches: !!menu && icon.innerHTML === menu.innerHTML,
              };
            });
          assert.equal(
            barState.top,
            barState.headerBottom,
            `${route} title bar detached from header`,
          );
          assert.equal(barState.height, 60);
          if(route!=='lab')assert(barState.iconMatches, `${route} does not share its menu icon`);
          await mobilePage.evaluate(() =>
            window.scrollTo(0, document.documentElement.scrollHeight),
          );
          const afterScroll = await mobilePage
            .locator(`[data-screen="${route}"] .page-heading`)
            .first()
            .boundingBox();
          assert(
            afterScroll && afterScroll.y === barState.top,
            `${route} title scrolled away`,
          );
          if (
            ["home", "projects", "memories", "conversations"].includes(route)
          ) {
            const action = await mobilePage
              .locator(`[data-screen="${route}"] .page-actions .page-create`)
              .first()
              .boundingBox();
            assert(
              action &&
                action.x > width / 2 &&
                action.y >= barState.top &&
                action.y + action.height <= barState.top + 60 &&
                action.height >= 44,
              `${route} creation action outside title bar`,
            );
          }
          await mobilePage.evaluate(() => window.scrollTo(0, 0));
        }
      }
      await mobilePage.setViewportSize({ width: 390, height: 844 });
      await mobilePage.evaluate(() => (location.hash = "playground"));
      await mobilePage.click("#run-test");
      await mobilePage.waitForSelector("#response-result:not([hidden])");
      assert.match(
        (await mobilePage.textContent("#answer-text")) ?? "",
        /bienvenue\.txt/,
      );
      assert.equal(
        await mobilePage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      assert.deepEqual(pageErrors, []);
      assert.deepEqual(
        characterRequests,
        [],
        "character assets should not be requested",
      );
      assert.deepEqual(externalRequests, []);
      await mobile.close();
      await context.close();
    } finally {
      await browser?.close();
      await lab.close();
      await persistent.storage.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
