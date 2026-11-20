import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer as reserve } from "node:net";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { assistantFixture } from "./assistant.fixture.ts";
import { conversationFixture } from "./conversation-fixture.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
const rich =
  '## Prochaines étapes\n\n1. Préparer le contenu.\n2. Tester sur mobile.\n\n| Action | Responsable | État |\n| --- | --- | --- |\n| Vérifier la conversation | Assistant | En cours |\n\n```js\nconst description = "' +
  "x".repeat(260) +
  '";\n```\n\n![Image distante](https://example.invalid/pixel.png)\n<img src="https://example.invalid/tracker" onerror="window.__unsafe=true"><script>window.__unsafe=true</script>\n[Piège](javascript:alert(1))';
test(
  "chat keeps composer visible, renders safe rich messages, preserves reading position and next draft",
  { timeout: 45000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "heart-chat-"));
    const lab = new TestLab({
      directory: path.join(dir, "lab"),
      authDirectory: path.join(dir, "auth"),
    });
    await lab.prepare();
    let slow = false,
      release: (() => void) | undefined;
    let tool = true;
    const fixture = await conversationFixture(
      path.join(dir, "threads"),
      () => ({
        id: "fake-rich",
        async generate(request) {
          if (slow) {
            slow = false;
            request.onActivity?.("reasoning");
            await new Promise<void>((resolve) => (release = resolve));
          }
          if (tool) {
            tool = false;
            return {
              content: "Je consulte les fichiers.",
              toolCalls: [
                {
                  id: randomUUID(),
                  name: "files.list",
                  arguments: { path: "." },
                },
              ],
            };
          }
          return { content: rich, toolCalls: [] };
        },
      }),
    );
    const { conversation } = await fixture.service.create({
      title: "Une discussion avec un titre très long " + "a".repeat(90),
    });
    for (let i = 0; i < 12; i++)
      await fixture.service.send(conversation.id, {
        provider: "demo",
        contextWindow: 32768,
        prompt: `Étape ${i + 1} : ${"URL".repeat(60)}`,
      });
    for (const [at, content] of [
      ["2026-11-14T19:59:00Z", "La veille à La Réunion"],
      ["2026-11-14T20:01:00Z", "Après minuit à La Réunion"],
    ])
      await fixture.storage.sessions.append(conversation.id, {
        id: randomUUID(),
        runId: randomUUID(),
        at,
        type: "message",
        data: { role: "user", content },
      });
    const assistant = assistantFixture();
    await assistant.save({
      version: 0,
      settings: {
        ...defaultAssistant,
        avatar: "orion",
        completed: true,
        step: 5,
      },
    });
    // Reserve an ephemeral local port, never a production service.
    const reservation = reserve();
    await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const origin = `http://127.0.0.1:${port}`;
    const access = new WebAccess({
      secret: "fake-chat-session-secret-at-least-32-chars",
      password: "fake-chat-password",
    });
    const server = createWebServer({
      origin,
      access,
      lab,
      conversations: fixture.service,
      assistant,
      assetsDirectory: process.env.HARNESS_TEST_WEB_ASSETS,
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
          timezoneId: "Indian/Reunion",
        }),
        errors: string[] = [],
        external: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin === origin)
          return route.continue();
        external.push(route.request().url());
        return route.abort();
      });
      await page.goto(origin + "/?conversation=" + conversation.id);
      // Qualify the unauthenticated screen too: previous reviews only covered the app.
      for (const [width, height] of [
        [320, 740],
        [390, 844],
        [820, 1050],
        [1440, 900],
        [740, 390],
      ]) {
        await page.setViewportSize({ width, height });
        const bounds = await page.evaluate(() => {
          const field = document
            .getElementById("password")!
            .getBoundingClientRect();
          const wrapper = document
            .querySelector(".auth-token-field")!
            .getBoundingClientRect();
          const submit = document
            .getElementById("login-submit")!
            .getBoundingClientRect();
          const logo = document.querySelector<HTMLImageElement>(".auth-mark")!;
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            fieldContained:
              field.left >= wrapper.left &&
              field.right <= wrapper.right &&
              field.bottom <= wrapper.bottom,
            submitFits: submit.left >= 0 && submit.right <= innerWidth,
            logoLoaded: logo.complete && logo.naturalWidth > 0,
          };
        });
        assert(!bounds.overflow, `login overflows at ${width}x${height}`);
        assert(
          bounds.fieldContained && bounds.submitFits,
          "login controls overlap or overflow",
        );
        assert(bounds.logoLoaded, "login logo unavailable");
        if (process.env.HARNESS_LOGIN_SCREENSHOTS) {
          await mkdir(process.env.HARNESS_LOGIN_SCREENSHOTS, {
            recursive: true,
          });
          await page.screenshot({
            path: path.join(
              process.env.HARNESS_LOGIN_SCREENSHOTS,
              `login-${width}.png`,
            ),
            fullPage: true,
          });
        }
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.fill("#password", "fake-wrong-password");
      await page.click("#toggle-login-token");
      assert.equal(
        await page.locator("#password").getAttribute("type"),
        "text",
      );
      await page.click("#toggle-login-token");
      assert.equal(
        await page.locator("#password").getAttribute("type"),
        "password",
      );
      await page.click("#login-submit");
      await page.waitForSelector("#login-error:not([hidden])");
      assert(
        await page.locator("#login-submit svg").isVisible(),
        "retry lost submit icon",
      );
      assert.equal(
        await page.textContent("#login-submit-label"),
        "Ouvrir mon espace",
      );
      await page.fill("#password", "fake-chat-password");
      await page.click("#login-submit");
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.waitForSelector(".markdown-body .content-table");
      // A repeated presentation update is a no-op for the custom selects and
      // branding. This catches observer feedback storms without timing thresholds.
      await page.waitForTimeout(50);
      const controlMutations = await page.evaluate(async () => {
        let count = 0;
        const observer = new MutationObserver(records => { count += records.length; });
        document.querySelectorAll(".select-trigger,[data-assistant-logo],link[rel=icon]")
          .forEach(node => observer.observe(node, { attributes: true, childList: true, subtree: true }));
        for (let n = 0; n < 10; n++) (window as any).heartUI.picture();
        await new Promise(resolve => setTimeout(resolve, 30));
        observer.disconnect();
        return count;
      });
      assert.equal(controlMutations, 0, "unchanged UI does not rewrite selects or reload branding");
      const stats=await fixture.service.get(conversation.id);
      assert.equal(await page.textContent('#status-message-count'),String(stats.messageCount));
      assert.match(await page.textContent('#status-context')||'',/^~[0-9]+ %$/);
      await page.click('[data-usage-detail="credits"]');
      await page.waitForSelector('#usage-dialog[open]');
      await page.waitForFunction(()=>document.getElementById('usage-message')?.textContent?.includes('Simulation locale'));
      assert.equal(await page.locator('#usage-dashboard').isVisible(),false);
      await page.click('#close-usage');
      let fixtureRemaining=72;
      await page.route('**/api/provider-usage?**', route=>route.fulfill({json:{provider:'chatgpt',modelId:'fixture-sol',status:'available',observedAt:new Date().toISOString(),source:'Compte ChatGPT · quotas Codex',message:'Quota général du même compte. Plafond propre à Heart non communiqué.',quota:{scope:'account',appLimitAvailable:false,windows:[{limitId:'codex',limitName:'Compte Codex',usedPercent:100-fixtureRemaining,remainingPercent:fixtureRemaining,windowDurationMins:10080,resetsAt:'2026-11-20T11:58:48.000Z'}]}}}));
      await page.evaluate("window.heartUsage.selection({provider:'chatgpt',modelId:'fixture-sol',conversationId:"+JSON.stringify(conversation.id)+"})");
      await page.waitForFunction(()=>document.getElementById('status-credits')?.textContent==='72 % · 7 j');
      assert.equal(await page.textContent('#status-balance-label'),'Quota compte');
      await page.click('[data-usage-detail="credits"]');
      assert.match(await page.locator('#usage-details').innerText(), /72 %\s+restants/);
      assert.match(await page.locator('#usage-details').innerText(), /Plafond propre à Heart/);
      const quotaShots=path.resolve('docs/design/account-quota');await mkdir(quotaShots,{recursive:true});
      for(const width of [320,390,820,1440]){
        await page.setViewportSize({width,height:844});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        const settings=await page.locator('.chat-heading #chat-context').boundingBox();assert(settings&&settings.width>=44&&settings.height>=44&&settings.x>=0&&settings.x+settings.width<=width,'settings remain a reachable header action');
        const bounds=await page.locator('#usage-dialog').boundingBox();assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1);
        for(const selector of ['#usage-details','#usage-message','#usage-observed']){
          const content=await page.locator(selector).boundingBox();
          assert(content&&content.x>=bounds.x+16&&content.x+content.width<=bounds.x+bounds.width-16,'usage text must keep interior margins');
        }
        if(width===390)await page.screenshot({path:path.join(quotaShots,'mobile.png')});
      }
      await page.click('#close-usage');
      await page.setViewportSize({width:390,height:844});
      const sheetShots=path.resolve('docs/design/usage-dialogs');await mkdir(sheetShots,{recursive:true});
      for(const detail of ['messages','context','credits','reset']){
        await page.click(`[data-usage-detail="${detail}"]`);
        await page.waitForSelector('#usage-dialog[open]');
        await page.screenshot({path:path.join(sheetShots,detail+'-mobile.png')});
        await page.click(['messages','context'].includes(detail)?'#usage-done':'#close-usage');
      }
      await page.setViewportSize({width:390,height:420});
      await page.click('[data-usage-detail="credits"]');
      const shortBounds=await page.locator('#usage-dialog').boundingBox();
      const footer=await page.locator('#usage-dialog .editor-actions').boundingBox();
      assert(shortBounds&&footer&&shortBounds.y>=0&&footer.y+footer.height<=420,'usage actions stay accessible on a short screen');
      await page.click('#close-usage');
      await page.setViewportSize({width:390,height:844});
      fixtureRemaining=0;
      await page.evaluate("window.heartUsage.selection({provider:'chatgpt',modelId:'fixture-sol',accountKey:'different-account',conversationId:"+JSON.stringify(conversation.id)+"})");
      await page.waitForFunction(()=>document.getElementById('status-credits')?.textContent==='0 % · 7 j');
      await page.unroute('**/api/provider-usage?**');
      // Late metadata from a previous model must never replace the current counters.
      let releaseUsage!:()=>void;
      const delayedUsage=new Promise<void>(resolve=>{releaseUsage=resolve;});
      const requestSeen=new Promise<void>(resolve=>{
        void page.route('**/api/provider-usage?**',async route=>{
          const selected=new URL(route.request().url()).searchParams.get('provider');
          if(selected==='openrouter'){resolve();await delayedUsage;}
          await route.fulfill({json:{provider:selected,modelId:'mock',status:'available',observedAt:new Date().toISOString(),source:'Test fixture',message:'Fixture',...(selected==='openrouter'?{balance:{remaining:42,currency:'USD',scope:'key'}}:{})}});
        });
      });
      await page.evaluate("window.heartUsage.selection({provider:'openrouter',modelId:'delayed',conversationId:"+JSON.stringify(conversation.id)+"})");
      await requestSeen;
      await page.evaluate("window.heartUsage.selection({provider:'anthropic',modelId:'current',conversationId:"+JSON.stringify(conversation.id)+"})");
      await page.waitForFunction(()=>document.getElementById('status-credits')?.textContent==='—');
      releaseUsage();await page.waitForTimeout(80);
      assert.equal(await page.textContent('#status-credits'),'—');
      assert.equal(await page.textContent('#status-context'),'—');
      await page.unroute('**/api/provider-usage?**');
      await page.evaluate("window.heartUsage.selection({provider:'demo',modelId:'',conversationId:"+JSON.stringify(conversation.id)+"})");

      assert.equal(
        await page
          .locator(
            ".conversation-history img,.conversation-history script,.conversation-history iframe",
          )
          .count(),
        0,
      );
      assert.deepEqual(external, []);
      assert.equal(
        await page.evaluate(() => !!(window as any).__unsafe),
        false,
      );
      assert.equal(
        await page
          .locator('.conversation-history a[href^="javascript:"]')
          .count(),
        0,
      );
      assert((await page.locator(".markdown-body h2").count()) > 1);
      const days = await page.locator(".chat-date-separator").allTextContents();
      assert(days.some((day) => /14 novembre 2026/.test(day)));
      assert(days.some((day) => /15 novembre 2026/.test(day)));
      const midnight = page
        .locator(".conversation-message.user")
        .filter({ hasText: "Après minuit à La Réunion" });
      assert.match(
        (await midnight.locator("time").textContent()) ?? "",
        /15 nov\. 2026.*00:01/,
      );

      assert(
        await page.locator(".chat-heading .nora-logo").isVisible(),
        "static Nora portrait missing from header",
      );
      assert(
        (await page
          .locator(".message-content > .message-meta .nora-logo")
          .count()) > 1,
        "reply identity must be inside the response bubble",
      );
      assert.equal(
        await page.locator(".chat-presence,video,canvas").count(),
        0,
        "character animation must stay removed",
      );
      assert.equal(
        await page
          .locator(".conversation-context-bar")
          .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
        48,
        "aligned context badges and readable conversation title",
      );

      assert.equal(await page.locator('#conversation-send #chat-permissions').count(),0);
      assert.equal(await page.locator('.chat-heading #chat-context').count(),1);
      assert.equal(await page.locator('.conversation-context-bar #chat-context').count(),0);
      assert.equal(await page.locator('.conversation-context-bar #choose-brain,.conversation-context-bar #chat-permissions,.conversation-context-bar #chat-effort').count(),0);
      assert.equal(await page.locator('.chat-configuration #choose-brain').count(),1);
      assert.equal(await page.locator('.chat-configuration #chat-permissions').count(),1);

      assert.equal(await page.locator('.conversation-message.tool,.tool-entry').count(),0);
      const geometry = async () =>
        page.evaluate(() => {
          const history = document.getElementById("conversation-history")!,
            form = document.getElementById("conversation-send")!,
            button = document.getElementById("conversation-submit")!;
          return {
            height: innerHeight,
            width: innerWidth,
            scroll: scrollY,
            overflow: document.documentElement.scrollWidth > innerWidth,
            historyBottom: history.getBoundingClientRect().bottom,
            formTop: form.getBoundingClientRect().top,
            buttonBottom: button.getBoundingClientRect().bottom,
          };
        });
      for (const [width, height] of [
        [320, 740],
        [390, 844],
        [820, 1050],
        [1440, 900],
        [740, 390],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(80);
        const status=await page.locator('.chat-status-bar').boundingBox();
        const title=await page.locator('.conversation-context-bar').boundingBox();
        assert(status&&title&&Math.abs(status.y-(title.y+title.height))<=1);
        assert(status.height<=42&&status.x>=0&&status.x+status.width<=width+1);
        assert.equal(await page.locator('.chat-status-bar button:visible').count(),4);
        const g = await geometry();
        assert(!g.overflow, `overflow at ${width}x${height}`);
        assert.equal(g.scroll, 0);
        assert(
          g.buttonBottom <= height + 1,
          `send covered at ${width}x${height}`,
        );
        assert(
          g.historyBottom <= g.formTop + 1,
          `messages overlap composer at ${width}x${height}: ${JSON.stringify(g)}`,
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        const vv = Object.assign(new EventTarget(), {
          height: 360,
          width: 390,
          offsetTop: 22,
          scale: 1,
        });
        (window as any).__viewport = window.visualViewport;
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: vv,
        });
        window.dispatchEvent(new Event("resize"));
      });
      await page.waitForTimeout(80);
      assert(
        (await geometry()).buttonBottom <= 382,
        `composer hidden by visual keyboard: ${JSON.stringify(await geometry())}`,
      );
      await page.click("#chat-context");
      const modal = await page.locator("#context-dialog").boundingBox();
      assert(
        modal && modal.y >= 22 && modal.y + modal.height <= 382,
        "context sheet outside visual viewport",
      );
      await page.click("#close-context");
      await page.evaluate(() => {
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: (window as any).__viewport,
        });
        window.dispatchEvent(new Event("resize"));
      });
      await page
        .locator("#conversation-history")
        .evaluate((node) => (node.scrollTop = 40));
      await page.waitForTimeout(100);
      await fixture.service.send(conversation.id, {
        provider: "demo",
        contextWindow: 32768,
        prompt: "Nouveau message pendant la relecture",
      });
      await page.evaluate(async (id) => {
        const data = await (await fetch("/api/conversations/" + id)).json();
        (window as any).heartChat.render(data);
      }, conversation.id);
      await page.waitForTimeout(100);
      assert(
        (await page
          .locator("#conversation-history")
          .evaluate((node) => node.scrollTop)) < 100,
        "reading position lost",
      );
      await page.click("#jump-latest");
      assert(
        await page
          .locator("#conversation-history")
          .evaluate(
            (node) =>
              node.scrollHeight - node.scrollTop - node.clientHeight < 65,
          ),
      );
      slow = true;
      await page.fill("#conversation-prompt", "Message à envoyer");
      await page.click("#conversation-submit");
      await page.waitForSelector(".response-activity");
      await page.fill("#conversation-prompt", "Mon prochain brouillon");
      await page.waitForSelector('.response-activity[data-phase="reasoning"]');
      assert.match(
        (await page.locator(".response-activity").textContent()) ?? "",
        /Analyse de la demande/,
      );
      assert(await page.locator(".activity-elapsed").isVisible());
      const beforeActivity = await page.locator(".conversation-message.assistant").first().elementHandle();
      const beforeMarkdown = await page.locator(".markdown-body").first().elementHandle();
      // Change activity without appending a journal event: preserve the message
      // DOM even when the phase requires a presentation update.
      await page.evaluate(async id => {
        const data = await (await fetch('/api/conversations/' + id)).json();
        (window as any).heartChat.render({...data, events: [...data.events, {id:'fixture-nonvisual-event',type:'context.usage',data:{}}], activity: {...data.activity, phase: 'answer'}});
      }, conversation.id);
      assert(await beforeActivity!.evaluate(node => node.isConnected), "phase updates preserve existing bubbles");
      // Two polling cycles with unchanged journal must keep message nodes alive.
      await page.waitForTimeout(2200);
      assert(await beforeActivity!.evaluate(node => node.isConnected), "activity polling preserves existing bubbles");
      assert(await beforeMarkdown!.evaluate(node => node.isConnected), "activity polling does not reparse Markdown");
      release!();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLButtonElement>("#conversation-submit")
            ?.disabled,
      );
      assert.equal(
        await page.inputValue("#conversation-prompt"),
        "Mon prochain brouillon",
      );
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.focus("#conversation-prompt");
      await page.keyboard.press("Shift+Enter");
      assert((await page.inputValue("#conversation-prompt")).includes("\n"));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.click("#chat-back");
      assert(await page.locator("#sessions-dialog").isVisible());
      await page.keyboard.press("Escape");
      assert(!(await page.locator("#sessions-dialog").isVisible()));
      assert(await page.locator(".chat-heading").isVisible());
      for (const width of [320, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.locator(".chat-heading [data-open-navigation]").click();
        assert(await page.locator("#navigation-dialog").isVisible());
        const drawer = await page.locator("#navigation-dialog").boundingBox();
        assert(
          drawer && drawer.x === 0 && drawer.width <= width,
          "drawer outside viewport",
        );
        await page.keyboard.press("Escape");
        assert(!(await page.locator("#navigation-dialog").isVisible()));
        assert(
          await page
            .locator(".chat-heading [data-open-navigation]")
            .evaluate((node) => node === document.activeElement),
          "menu does not restore focus",
        );
      }
      await page.locator(".chat-heading [data-open-navigation]").click();
      await page.locator('#navigation-dialog [data-nav="memories"]').click();
      assert.equal(await page.evaluate(() => location.hash), "#memories");
      assert(!(await page.locator("#navigation-dialog").isVisible()));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await fixture.storage.close();
      await lab.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
