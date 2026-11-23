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
import type { ModelResponse } from "../src/contracts/models.ts";

test(
  "overlooked fact is reviewed, saved and visibly confirmed without technical audit blocks",
  { timeout: 40000 },
  async () => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "heart-memory-review-ui-"),
      ),
      file = root + "/state.sqlite";
    const lab = new TestLab({
      directory: root + "/lab",
      authDirectory: root + "/auth",
    });
    await lab.prepare();
    const originalState = lab.state.bind(lab);
    lab.state = async () => ({
      ...(await originalState()),
      chatgpt: { connected: true, profile: "fake-account" },
    });
    await migrateSqlite(file);
    lab.models = async () => ({
      models: [{ id: "fake", name: "Modèle simulé", contextWindow: 32768 }],
    });
    lab.capabilities = async () => ({ id: "fake", contextWindow: 32768 });
    lab.model = () => ({
      id: "fake-chatgpt",
      async generate(request): Promise<ModelResponse> {
        if (request.tools.some((t) => t.name === "memory.assess"))
          return {
            content: "",
            toolCalls: [
              {
                id: "assessment",
                name: "memory.assess",
                arguments: {
                  decisions: [
                    {
                      action: "remember",
                      evidence: "Je suis né le 12 février 1991.",
                      note: "La date reste utile pour les prochains échanges.",
                      arguments: {
                        title: "Date de naissance",
                        content: "La personne est née le 12 février 1991.",
                        kind: "fact",
                        scope: "personal",
                      },
                    },
                  ],
                },
              },
            ],
          };
        if (request.messages.at(-1)?.role === "tool")
          return {
            content:
              "Tu as 35 ans. Ta date de naissance est maintenant sauvegardée pour les prochaines conversations.",
            toolCalls: [],
          };
        return { content: "Tu as 35 ans.", toolCalls: [] };
      },
    });
    const app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/app",
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
            provider: "chatgpt",
            modelId: "fake",
            contextWindow: 32768,
            capacitySource: "configured",
          },
          fileAccess: "none",
          networkAccess: false,
        },
      },
    });
    const { conversation } = await app.conversations.create({
      title: "Une information dans une question",
    });
    const reserved = reserve();
    await new Promise<void>((r) => reserved.listen(0, "127.0.0.1", r));
    const port = (reserved.address() as { port: number }).port;
    await new Promise<void>((r) => reserved.close(() => r()));
    const origin = "http://127.0.0.1:" + port;
    const server = createWebServer({
      origin,
      access: new WebAccess({
        secret: "memory-review-browser-fixture-long-enough",
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
      await page.goto(
        origin + "/?conversation=" + conversation.id + "#conversations",
      );
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.waitForFunction(()=>!!window.heartContextExperiments);
      await page.evaluate(()=>(window as any).heartSettings.open('context'));
      await page.locator('#context-experiments summary').click();
      assert.equal(await page.locator('#context-measure').isChecked(),false);
      assert.equal(await page.locator('#context-compact-review').isChecked(),false);
      assert.equal(await page.locator('#context-compact-review').isDisabled(),true);
      await page.locator('#context-measure').check();
      await page.locator('#use-brain').click();
      await page.fill(
        "#conversation-prompt",
        "Je suis né le 12 février 1991. Quel âge ai-je ?",
      );
      await page.click("#conversation-submit");
      await page.waitForSelector(".memory-chat-event.created");
      await page.waitForFunction(() =>
        document
          .getElementById("conversation-history")
          ?.textContent?.includes("maintenant sauvegardée"),
      );
      assert.equal((await app.memories.list()).memories.length, 1);
      const measured=(await app.conversations.get(conversation.id)).events.filter(e=>e.type==='run.progress'&&(e.data as any).kind==='model-usage');
      assert(measured.length>=3);assert(measured.some(e=>(e.data as any).purpose.name==='memory'));

      assert.equal(await page.locator(".memory-chat-event.created").count(), 1);
      assert.match(
        await page.locator(".memory-chat-meta").innerText(),
        /a mémorisé/i,
      );
      assert.equal(
        await page.locator(".conversation-message.tool,.tool-entry").count(),
        0,
      );
      assert(
        !(await page
          .locator("#conversation-history")
          .innerText()
          .then(
            (text) =>
              text.includes("memory.assess") || text.includes('"decisions"'),
          )),
      );
      assert.equal(
        await page
          .locator(".turn-commentary")
          .filter({ hasText: /^$/ })
          .count(),
        0,
        "internal review audit creates no empty public row",
      );
      await mkdir("docs/qualification/memory-review", { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "docs/qualification/memory-state/chat-" + width + ".png",
        });
      }
      await page.locator(".memory-chat-event").click();
      await page.waitForSelector("#memory-dialog[open]");
      assert.equal(
        await page.inputValue("#memory-content"),
        "La personne est née le 12 février 1991.",
      );
      await page.locator("#memory-dialog [data-close-editor]").first().click();
      await page.evaluate(()=>{location.hash='memories'});
      await page.waitForSelector('.memory-card');
      assert.equal(await page.locator('.memory-card').count(),1,'The memory list refreshes after a chat save without manual reload');

      await page.goto(origin+'/?conversation='+conversation.id+'#conversations');
      await page.reload();
      await page.waitForSelector(".memory-chat-event.created");
      assert.equal(await page.locator(".memory-chat-event").count(), 1);
      await page.waitForFunction(()=>!!window.heartContextExperiments);
      await page.evaluate(()=>(window as any).heartSettings.open('context'));
      await page.locator('#context-experiments summary').click();
      assert.equal(await page.locator('#context-measure').isChecked(),true,'per-fil in-tab preference survives reload');
      await page.locator('#context-measure').uncheck();
      await page.locator('#use-brain').click();
      // Reproduce the reported normal question with a broken auxiliary review.
      let recoveredPrimary=0,failedReview=0;
      lab.model=()=>({id:'fake-recovery',async generate(request){
        if(request.tools.some(t=>t.name==='memory.assess')){failedReview++;return {content:'',toolCalls:[]};}
        recoveredPrimary++;return {content:'Le Harness assemble le contexte, transmet les outils au modèle et conserve les résultats vérifiés.',toolCalls:[]};
      }});
      await page.fill('#conversation-prompt','Du coup description du fonctionnement ?');await page.click('#conversation-submit');
      await page.waitForFunction(()=>document.getElementById('conversation-history')?.textContent?.includes('Le Harness assemble le contexte'));
      assert.equal(recoveredPrimary,2);assert.equal(failedReview,1);
      assert(!(await page.locator('#conversation-history').innerText()).includes('La vérification de mémoire n’a pas abouti'));
      assert((await app.conversations.get(conversation.id)).events.some(e=>e.type==='run.progress'&&(e.data as any).audit?.code==='MISSING_DECISION'));
      assert.deepEqual(errors, []);
      await writeFile(
        "docs/qualification/memory-state/browser.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            scope:
              "Real Chromium + HTTP + Heart composition + disposable SQLite; intentionally forgetful simulated primary, structured simulated review",
            reviewRecoveredOmittedFact: true,
            brokenReviewDoesNotHideHarnessExplanation:true,
            canonicalToolPersisted: true,
            cardVisible: true,
            opensLatestMemory: true,
            reloadPreservesReceipt: true,
            memoryListRefreshedAfterChatSave:true,
            noTechnicalOrEmptyAuditRows: true,
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
