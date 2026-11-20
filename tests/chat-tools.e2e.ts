import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { assistantFixture } from "./assistant.fixture.ts";
import { conversationFixture } from "./conversation-fixture.ts";
import { defaultAssistant } from "../src/app/assistant.ts";

test(
  "chat toolbar persists prompts, sends real attachments, stops a run and preserves drafts across conversations",
  { timeout: 40000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "heart-chat-tools-"));
    const lab = new TestLab({
      directory: path.join(dir, "lab"),
      authDirectory: path.join(dir, "auth"),
    });
    await lab.prepare();
    let slow = false,
      received = "";
    let replayGate:Promise<void>|undefined,releaseReplay:(()=>void)|undefined,replayStarted:(()=>void)|undefined;
    const fixture = await conversationFixture(
      path.join(dir, "threads"),
      () => ({
        id: "mock-chat-tools",
        async generate(request) {
          if(replayGate){const gate=replayGate;replayGate=undefined;replayStarted?.();await gate;}
          if (slow) {
            slow = false;
            await new Promise<void>((_, reject) => {
              request.signal!.throwIfAborted();
              request.signal!.addEventListener(
                "abort",
                () => reject(request.signal!.reason),
                { once: true },
              );
            });
          }
          const user = request.messages.findLast(
            (item) => item.role === "user",
          );
          if (user?.role === "user" && user.attachments?.length)
            received = Buffer.from(
              user.attachments[0].data!,
              "base64",
            ).toString();
          return { content: "Message reçu.", toolCalls: [] };
        },
      }),
    );
    const first = (
      await fixture.service.create({ title: "Première conversation" })
    ).conversation;
    const second = (
      await fixture.service.create({ title: "Autre conversation" })
    ).conversation;
    const assistant = assistantFixture();
    await assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const server = createWebServer({
      origin: "http://127.0.0.1",
      access: new WebAccess({
        secret: "fake-chat-tools-secret-with-at-least-32-chars",
        password: "fake-password",
      }),
      lab,
      conversations: fixture.service,
      assistant,
      assetsDirectory: process.env.HARNESS_TEST_WEB_ASSETS,
    });
    // Origin must include its chosen port for the same-origin mutation checks.
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((r) => server.close(() => r()));
    const origin = `http://127.0.0.1:${port}`;
    const live = createWebServer({
      origin,
      access: new WebAccess({
        secret: "fake-chat-tools-secret-with-at-least-32-chars",
        password: "fake-password",
      }),
      lab,
      conversations: fixture.service,
      assistant,
      assetsDirectory: process.env.HARNESS_TEST_WEB_ASSETS,
    });
    await new Promise<void>((r) => live.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      page.setDefaultTimeout(7000);
      await page.addInitScript("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{window.__copiedMessage=text;}}});");
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/?conversation=" + first.id);
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.click("#chat-quick-prompts");
      await page.click("#quick-prompt-manage");
      await page.click("#quick-prompt-new");
      await page.fill("#quick-prompt-title", "Résumé pratique");
      await page.fill("#quick-prompt-description", "Décisions et actions");
      await page.fill(
        "#quick-prompt-content",
        "Résume les décisions et prochaines actions.",
      );
      await page.locator("#quick-prompt-form button[type=submit]").click();
      await page.waitForSelector("#quick-prompt-editor-dialog", {
        state: "hidden",
      });
      assert.equal((await fixture.chatAssets.assets.prompts()).length, 1);
      await page.locator("#quick-prompt-list .quick-prompt-main").click();
      assert.match(
        await page.inputValue("#conversation-prompt"),
        /Résume les décisions/,
      );
      await page.click("#chat-clear-draft");
      assert.equal(await page.inputValue("#conversation-prompt"), "");
      await page.click("#chat-attachments");
      await page.setInputFiles("#chat-file-input", {
        name: "note.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Contenu réel transmis au modèle"),
      });
      await page.waitForSelector(".chat-file-row");
      await page.waitForFunction(
        () => document.getElementById("attachment-upload")!.hidden,
      );
      await page.locator(".chat-file-open").click();
      await page.waitForSelector("#chat-file-preview-body pre");
      assert.equal(
        await page.textContent("#chat-file-preview-body pre"),
        "Contenu réel transmis au modèle",
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.click("#conversation-submit");
      await page.waitForSelector(".message-attachment");
      await page.waitForFunction(
        () => !document.getElementById("conversation-submit")!.hidden,
      );
      assert.equal(received, "Contenu réel transmis au modèle");
      const events = (await fixture.service.get(first.id)).events;
      assert(
        !JSON.stringify(events).includes(
          Buffer.from("Contenu réel transmis au modèle").toString("base64"),
        ),
      );
      const attachments = await fixture.service.attachments(first.id);
      assert.equal(attachments[0].used, true);
      const denied = await browser.newContext();
      assert.equal(
        (
          await denied.request.get(
            origin +
              `/api/conversations/${first.id}/attachments/${attachments[0].id}/raw`,
          )
        ).status(),
        401,
      );
      await denied.close();
      const originalEvent=(await fixture.service.get(first.id)).events.find(event=>event.type==='message'&&(event.data as any).role==='user')!;
      const originalData=originalEvent.data as any;
      const originalBubble=page.locator(`.conversation-message.user[data-event-id="${originalEvent.id}"]`);
      await page.waitForSelector(`.conversation-message.user[data-event-id="${originalEvent.id}"] .resend-message:enabled`);
      await originalBubble.getByRole('button',{name:'Copier mon message',exact:true}).click();
      assert.equal(await page.evaluate(()=>(window as any).__copiedMessage),originalData.content);
      // The fallback must preserve the text and not overwrite a draft.
      await page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=(action)=>{if(action==='copy'){window.__copiedMessage=document.querySelector('textarea[readonly]')?.value;return true;}return false;};");
      await page.fill('#conversation-prompt','Brouillon conservé pendant la relance');
      await originalBubble.locator('.copy-message').click();assert.equal(await page.evaluate(()=>(window as any).__copiedMessage),originalData.content);
      await page.click('#chat-attachments');await page.setInputFiles('#chat-file-input',{name:'prochain.txt',mimeType:'text/plain',buffer:Buffer.from('Pour le prochain message seulement')});
      await page.waitForFunction(()=>document.getElementById('attachment-upload')!.hidden);await page.keyboard.press('Escape');
      const pendingBefore=await page.evaluate(()=>(window as any).heartChatTools.selected().map((file:any)=>file.id));assert.equal(pendingBefore.length,1);
      replayGate=new Promise<void>(resolve=>{releaseReplay=resolve;});const startedReplay=new Promise<void>(resolve=>{replayStarted=resolve;});
      let replayRequests=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/messages'))replayRequests++;});
      await originalBubble.locator('.resend-message').evaluate((button:any)=>{button.click();button.click();});await startedReplay;
      assert.equal(replayRequests,1);assert(await originalBubble.locator('.resend-message').isDisabled());
      assert.equal(await page.inputValue('#conversation-prompt'),'Brouillon conservé pendant la relance');
      releaseReplay!();await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#conversation-submit')?.disabled);
      const afterReplay=(await fixture.service.get(first.id)).events;const userEvents=afterReplay.filter(event=>event.type==='message'&&(event.data as any).role==='user');
      assert.equal(userEvents.length,2);assert.deepEqual(userEvents.at(-1)?.data,originalData);assert(afterReplay.some(event=>event.id===originalEvent.id));
      assert.equal(received,'Contenu réel transmis au modèle');assert.equal(await page.inputValue('#conversation-prompt'),'Brouillon conservé pendant la relance');
      assert.deepEqual(await page.evaluate(()=>(window as any).heartChatTools.selected().map((file:any)=>file.id)),pendingBefore);
      const actionShots=path.resolve('docs/design/chat-actions');await mkdir(actionShots,{recursive:true});
      await page.screenshot({path:path.join(actionShots,'messages-mobile.png')});
      await page.route('**/api/conversations/*/messages',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Relance temporairement indisponible.'})}),{times:1});
      await originalBubble.locator('.resend-message').click();await page.waitForFunction(()=>document.getElementById('global-message')?.textContent?.includes('Relance temporairement'));
      await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#conversation-submit')?.disabled);
      assert.equal(await page.inputValue('#conversation-prompt'),'Brouillon conservé pendant la relance');assert.deepEqual(await page.evaluate(()=>(window as any).heartChatTools.selected().map((file:any)=>file.id)),pendingBefore);
      await page.getByRole('button',{name:'Retirer prochain.txt du prochain message',exact:true}).click();await page.fill('#conversation-prompt','');
      assert(await page.locator('#conversation-submit').isDisabled());assert(await originalBubble.locator('.resend-message').isEnabled());
      await originalBubble.locator('.resend-message').click();
      await page.waitForSelector(`.conversation-message.user[data-event-id="${originalEvent.id}"] .resend-message:enabled`);
      const emptyDraftReplay=(await fixture.service.get(first.id)).events.filter(event=>event.type==='message'&&(event.data as any).role==='user');assert.equal(emptyDraftReplay.length,3);assert.deepEqual(emptyDraftReplay.at(-1)?.data,originalData);
      slow = true;
      await page.fill("#conversation-prompt", "Commence le travail");
      await page.click("#conversation-submit");
      await page.waitForSelector("#chat-stop:not([hidden])");
      await page.fill("#conversation-prompt", "Brouillon de la première");
      await page.click("#chat-back");
      await page
        .locator("#discussion-cards button")
        .filter({ hasText: "Autre conversation" })
        .click();
      await page.waitForFunction(
        (id) => new URL(location.href).searchParams.get("conversation") === id,
        second.id,
      );
      await page.fill("#conversation-prompt", "Brouillon de la seconde");
      await page.click("#chat-back");
      await page
        .locator("#discussion-cards button")
        .filter({ hasText: "Première conversation" })
        .click();
      await page.waitForFunction(
        (id) => new URL(location.href).searchParams.get("conversation") === id,
        first.id,
      );
      assert.equal(
        await page.inputValue("#conversation-prompt"),
        "Brouillon de la première",
      );
      await page.click("#chat-stop");
      await page.waitForFunction(
        () => !document.getElementById("conversation-submit")!.hidden,
      );
      assert.equal((await fixture.service.get(first.id)).busy, false);
      assert.match(
        (await page.textContent("#conversation-history")) ?? "",
        /interrompue|annulée/i,
      );
      assert.equal(
        await page.inputValue("#conversation-prompt"),
        "Brouillon de la première",
      );
      await page.reload();
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.click("#chat-quick-prompts");
      await page.locator("#quick-prompts-menu .quick-prompt-main").click();
      assert.match(
        await page.inputValue("#conversation-prompt"),
        /Résume les décisions/,
      );
      await page.click("#chat-quick-prompts");
      await page.click("#quick-prompt-manage");
      await page
        .locator("#quick-prompt-list")
        .getByRole("button", { name: "Modifier", exact: true })
        .click();
      await page.fill("#quick-prompt-content", "Nouveau texte");
      await page.locator("#quick-prompt-form button[type=submit]").click();
      await page.waitForSelector("#quick-prompt-editor-dialog", {
        state: "hidden",
      });
      assert.equal((await fixture.chatAssets.assets.prompts())[0].version, 2);
      await page
        .locator("#quick-prompt-list")
        .getByRole("button", { name: "Supprimer", exact: true })
        .click();
      await page.click("#quick-prompt-delete-confirm");
      await page.waitForSelector("#quick-prompt-delete-dialog", {
        state: "hidden",
      });
      assert.equal((await fixture.chatAssets.assets.prompts()).length, 0);
      await page.keyboard.press('Escape');
      await page.click('#chat-context');
      await page.waitForSelector('#context-dialog[open]');
      await page.locator('[data-settings-section="context"]').click();
      await page.locator('#context-dialog summary').filter({hasText:'Outils déclarés'}).click();
      const lastRun=(await fixture.service.get(first.id)).events.findLast(event=>event.type==='run.started');
      assert.deepEqual(await page.locator('#conversation-tools li').allTextContents(),(lastRun?.data as {tools:string[]}).tools);
      assert(!(await page.locator('#conversation-tools').innerText()).includes('terminal.exec'));
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      live.closeAllConnections();
      await new Promise<void>((r) => live.close(() => r()));
      await lab.close();
      await fixture.storage.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
