import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
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
import { createAiSdkProvider, readVeniceUsage } from "../src/modules/models/ai-sdk/index.ts";

test(
  "Venice UI connects privately, chooses live catalogue/effort defaults and overrides, persists chat and handles catalogue failure",
  { timeout: 45000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "heart-venice-ui-")),
      file = path.join(root, "state.sqlite");
    const lab = new TestLab({
      directory: path.join(root, "lab"),
      authDirectory: path.join(root, "auth"),
    });
    await lab.prepare();
    await migrateSqlite(file);
    let failed = false,
      catalogCalls = 0,
      modelCalls = 0;
    let usageFailed = false;
    lab.usage = async (provider, modelId) => {
      assert.equal(provider, "venice");
      return readVeniceUsage("fake-venice-key", modelId, async () => usageFailed
        ? new Response("private failure", { status: 401 })
        : Response.json({ data: {
          balances: { USD: 4.99946144, DIEM: 2.5, BUNDLED_CREDITS: 0 },
          nextEpochBegins: "2026-11-22T00:00:00Z",
          rateLimits: [{ apiModelId: "venice-qa", rateLimits: [{ type: "RPM", amount: 1000 }, { type: "TPM", amount: 30000000 }] }],
        } }));
    };
    const models = [
      {
        id: "venice-qa",
        name: "Venice QA",
        contextWindow: 65536,
        supportsTools: true,
        vision: true,
        reasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
        pricing: { input: 0.3, output: 1.2, request: null },
      },
    ];
    lab.models = async (provider) => {
      assert.equal(provider, "venice");
      catalogCalls++;
      if (failed) throw Error("Catalogue Venice AI indisponible.");
      return { models };
    };
    lab.model = (body) => {
      assert.equal(body.provider, "venice");
      assert.equal(body.modelId, "venice-qa");
      return createAiSdkProvider({
        provider: "venice",
        modelId: "venice-qa",
        apiKey: "fake-key",
        reasoningEffort: body.reasoningEffort as string | undefined,
        fetch: async (_url, init) => {
          modelCalls++;
          const body = JSON.parse(String(init?.body));
          assert.equal(body.reasoning_effort, "high");
          const assess = body.tools?.find((tool: any) =>
            tool.function.description.includes("memory.assess"),
          );
          const message = assess
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "assess",
                    type: "function",
                    function: {
                      name: assess.function.name,
                      arguments: JSON.stringify({
                        decisions: [
                          {
                            action: "none",
                            evidence: "",
                            note: "Test technique.",
                          },
                        ],
                      }),
                    },
                  },
                ],
              }
            : { role: "assistant", content: "Bonjour depuis Venice QA." };
          return Response.json({
            id: "qa",
            object: "chat.completion",
            created: 1,
            model: "venice-qa",
            choices: [
              {
                index: 0,
                message,
                finish_reason: assess ? "tool_calls" : "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          });
        },
      });
    };
    const app = await openWebConversations(
      { driver: "sqlite", file },
      path.join(root, "state"),
      lab,
    );
    await app.assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const reservation = reserve();
    await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const origin = "http://127.0.0.1:" + port;
    const server = createWebServer({
      origin,
      access: new WebAccess({
        secret: "venice-ui-private-fixture-at-least-32-characters",
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
      const choose = async (selector: string, value: string) => {
        await page.locator(selector).evaluate((element, value) => {
          const select = element as HTMLSelectElement;
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
      };
      await page.goto(origin + "/#providers");
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector('[data-configure-provider="venice"]', {
        state: "visible",
      });
      await page.click('[data-configure-provider="venice"]');
      await page.fill("#api-key", "fake-venice-browser-key");
      await page.click("#save-api-key");
      await page.waitForSelector("#api-key-dialog", { state: "hidden" });
      assert.equal(
        await page.textContent("#venice-card-status"),
        "Clé configurée",
      );
      assert.equal(await page.inputValue("#api-key"), "");
      await page.evaluate(() => (location.hash = "consumption"));
      await page.waitForSelector(".consumption-card .consumption-primary");
      assert.match(await page.locator("#consumption-providers").innerText(), /Solde USD[\s\S]*4,9995[\s\S]*DIEM disponibles[\s\S]*2,5 DIEM/);
      const beforeUsage = modelCalls;
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      usageFailed = true;
      await page.click("#consumption-refresh");
      await page.waitForSelector(".consumption-card .consumption-primary", { state: "hidden" });
      assert(!((await page.locator("#consumption-providers").innerText()).includes("private failure")));
      usageFailed = false;
      await page.click("#consumption-refresh");
      await page.waitForSelector(".consumption-card .consumption-primary");
      assert.equal(modelCalls, beforeUsage);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => (location.hash = "settings-conversations"));
      await page.click("#edit-conversation-defaults");
      await page.waitForSelector("#defaults-dialog[open]");
      await choose("#defaults-provider", "venice");
      await page.waitForFunction(() =>
        Array.from(
          document.querySelector<HTMLSelectElement>("#defaults-model")!.options,
        ).some((o) => o.value === "venice-qa"),
      );
      await choose("#defaults-model", "venice-qa");
      await choose("#defaults-effort", "high");
      await page.click("#save-defaults");
      await page.waitForSelector("#defaults-dialog", { state: "hidden" });
      const defaults = await app.assistant.defaults();
      assert.equal(defaults.defaults.selection?.provider, "venice");
      assert.equal(defaults.defaults.selection?.reasoningEffort, "high");
      assert.equal(defaults.defaults.selection?.contextWindow, 65536);
      await page.reload();
      await page.click("#edit-conversation-defaults");
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLSelectElement>("#defaults-effort")
            ?.value === "high",
      );
      assert.equal(await page.inputValue("#defaults-provider"), "venice");
      await page.click("#close-defaults");
      const conversation = (
        await app.conversations.create({ title: "Venice browser" })
      ).conversation;
      assert.equal(conversation.selection?.provider, "venice");
      await page.goto(
        origin + "/?conversation=" + conversation.id + "#conversations",
      );
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.waitForFunction(() => document.getElementById("status-balance-label")?.textContent === "Solde USD");
      await page.click('[data-usage-detail="credits"]');
      await page.waitForSelector("#usage-dialog[open]");
      assert.match(await page.locator("#usage-details").innerText(), /Solde USD[\s\S]*DIEM disponibles[\s\S]*requêtes\/min[\s\S]*1\s*000/);
      assert.equal(await page.textContent("#status-reset"), "—");
      await page.click("#close-usage");
      await page.fill(
        "#conversation-prompt",
        "Test technique sans information à mémoriser.",
      );
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>("#conversation-submit")!
            .disabled,
      );
      await page.evaluate(() => (window as any).heartConversationModel.open());
      await page.waitForSelector("#model-preferences-dialog[open]");
      assert.equal(
        await page.locator("input[name=provider]:checked").inputValue(),
        "venice",
      );
      assert.equal(await page.inputValue("#reasoning-effort"), "high");
      assert.match(
        (await page.textContent("#context-capacity-help")) || "",
        /Venice AI/,
      );
      await page.click("#model-options-trigger");
      assert(
        await page
          .getByRole("option", { name: "Venice QA", exact: true })
          .isVisible(),
      );
      assert.match(
        await page.locator("#select-sheet-options").innerText(),
        /0,3 \$.*1,2 \$/,
      );
      await page
        .getByRole("option", { name: "Venice QA", exact: true })
        .click();
      await page.click("#refresh-models");
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>("#refresh-models")!
            .disabled,
      );
      assert(catalogCalls >= 2);
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      await page.click("#conversation-model-save");
      await page.waitForSelector("#model-preferences-dialog", {
        state: "hidden",
      });
      await page.fill(
        "#conversation-prompt",
        "Dis bonjour, test technique sans information à mémoriser.",
      );
      await page.click("#conversation-submit");
      await page.waitForFunction(() =>
        document
          .querySelector("#conversation-history")
          ?.textContent?.includes("Bonjour depuis Venice QA."),
      );
      assert(modelCalls >= 2);
      await page.reload();
      await page.waitForFunction(() =>
        document
          .querySelector("#conversation-history")
          ?.textContent?.includes("Bonjour depuis Venice QA."),
      );
      assert.equal(
        (await app.conversations.get(conversation.id)).conversation.selection
          ?.reasoningEffort,
        "high",
      );
      await page.evaluate(() => (window as any).heartConversationModel.open());
      await page.waitForSelector("#model-preferences-dialog[open]");
      failed = true;
      await page.click("#refresh-models");
      await page.waitForFunction(() =>
        document
          .querySelector("#model-help")
          ?.textContent?.includes("Impossible"),
      );
      assert(await page.locator("#conversation-submit").isDisabled());
      failed = false;
      await page.click("#refresh-models");
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLSelectElement>("#model-options")!
            .disabled,
      );
      assert.deepEqual(errors, []);
      const restarted = new TestLab({
        directory: path.join(root, "lab"),
        authDirectory: path.join(root, "auth"),
      });
      await restarted.prepare();
      assert.equal((await restarted.state()).api.venice, true);
      await restarted.close();
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
