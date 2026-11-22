import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";

test(
  "first onboarding resumes after provider setup and persists the chosen model and effort as new conversation defaults",
  { timeout: 35000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "heart-onboard-")),
      file = path.join(root, "test.sqlite");
    const lab = new TestLab({
      directory: path.join(root, "lab"),
      authDirectory: path.join(root, "auth"),
    });
    await lab.prepare();
    await migrateSqlite(file);
    const model = {
      id: "onboarding-model",
      name: "Onboarding model",
      contextWindow: 65536,
      reasoningEfforts: ["low", "high"],
      supportsTools: true,
    };
    lab.models = async () => ({ models: [model] });
    lab.capabilities = async () => model;
    lab.usage = async (provider, modelId) => ({
      provider: "venice" as const,
      modelId,
      status: "unavailable",
      message: "Synthetic fixture",
      observedAt: new Date().toISOString(),
      source: "Fixture",
    });
    const app = await openWebConversations(
      { driver: "sqlite", file },
      path.join(root, "state"),
      lab,
    );
    // Find an ephemeral HTTP port before supplying the canonical origin.
    const { createServer } = await import("node:net");
    const reservation = createServer();
    await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
    const port = (reservation.address() as any).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const origin = "http://127.0.0.1:" + port,
      server = createWebServer({
        origin,
        access: new WebAccess({
          secret: "synthetic-onboarding-session-secret-32-chars",
          password: "synthetic-password",
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
      const choose = async (selector: string, value: string) =>
        page.locator(selector).evaluate((node, value) => {
          (node as HTMLSelectElement).value = value;
          node.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
      await page.goto(origin);
      await page.fill("#password", "synthetic-password");
      await page.click("#login-submit");
      await page.waitForSelector("#setup-dialog[open]");
      await page.fill("#setup-name", "Aster");
      await page.click("#setup-next");
      await page.click("#setup-next");
      await page.click("#setup-next");
      await page
        .getByRole("button", { name: "Connecter un fournisseur", exact: true })
        .click();
      await page.click('[data-configure-provider="venice"]');
      await page.fill("#api-key", "synthetic-venice-onboarding-key");
      await page.click("#save-api-key");
      await page.waitForSelector("#setup-dialog[open]");
      await page
        .getByRole("button", {
          name: "Choisir le modèle et l’effort",
          exact: true,
        })
        .click();
      await page.waitForSelector("#defaults-dialog[open]");
      await choose("#defaults-provider", "venice");
      await page.waitForFunction(() =>
        [
          ...document.querySelector<HTMLSelectElement>("#defaults-model")!
            .options,
        ].some((o) => o.value === "onboarding-model"),
      );
      await choose("#defaults-model", "onboarding-model");
      await choose("#defaults-effort", "high");
      await page.click("#save-defaults");
      await page.waitForSelector("#setup-dialog[open]");
      await page
        .getByRole("button", { name: "Utiliser Venice AI · API", exact: true })
        .click();
      await page.click("#setup-next");
      await page.waitForSelector("#setup-dialog:not([open])", {
        state: "attached",
      });
      const saved = await app.assistant.defaults();
      assert.deepEqual(saved.defaults.selection, {
        provider: "venice",
        modelId: "onboarding-model",
        contextWindow: 65536,
        capacitySource: "catalog",
        reasoningEffort: "high",
      });
      await page.reload();
      await page.waitForSelector("#app-view:not([hidden])");
      assert((await app.assistant.get()).settings.completed);
      const { conversation } = await app.conversations.create({
        title: "After onboarding",
      });
      assert.deepEqual(conversation.selection, saved.defaults.selection);
      assert.deepEqual(errors, []);
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
