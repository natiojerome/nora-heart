import { BubblewrapExecution } from "../src/modules/tools/terminal/index.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { assistantFixture } from "./assistant.fixture.ts";
import { conversationFixture } from "./conversation-fixture.ts";
import { defaultAssistant } from "../src/app/assistant.ts";

test(
  "workspace explorer CRUD, permission sheet, stale editor and mobile layouts",
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "heart-workspace-web-"),
    );
    const lab = new TestLab({
      directory: path.join(directory, "lab"),
      authDirectory: path.join(directory, "auth"),
    });
    await lab.prepare();
    const fixture = await conversationFixture(
      path.join(directory, "threads"),
      undefined,
      undefined,
      new BubblewrapExecution(path.join(directory, "commands"), {
        nodeBinary: process.execPath,
      }),
      new BubblewrapExecution(path.join(directory,"fake-host-commands"),{nodeBinary:process.execPath}),
    );
    const first = (await fixture.service.create({ title: "Mes fichiers" }))
      .conversation;
    const assistant = assistantFixture();
    await assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const access = new WebAccess({
      secret: "workspace-test-secret-with-at-least-32-chars",
      password: "fake-password",
    });
    const probe = createWebServer({ origin: "http://127.0.0.1", access, lab });
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`,
      server = createWebServer({
        origin,
        access,
        lab,
        assistant,
        conversations: fixture.service,
      });
    await new Promise<void>((resolve) =>
      server.listen(port, "127.0.0.1", resolve),
    );
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      page.setDefaultTimeout(7000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/?conversation=" + first.id);
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.click("#chat-permissions");
      await page.waitForSelector("#context-dialog[open]");
      assert.match(await page.locator("#workspace-access-help").innerText(), /sans les modifier/);
      const settingsShots=path.resolve('docs/design/conversation-settings');await mkdir(settingsShots,{recursive:true});
      await page.locator('[data-settings-section="model"]').click();
      assert.equal(await page.locator('#context-dialog[open] #provider-config').count(),0);
      await page.click("#edit-conversation-model");await page.waitForSelector("#model-preferences-dialog[open]");
      for(const width of [320,390,820,1440]){
        await page.setViewportSize({width,height:844});
        const radios=await page.locator('#model-preferences-dialog input[type="radio"]').evaluateAll(nodes=>nodes.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,opacity:getComputedStyle(el).opacity})));
        assert(radios.length);for(const r of radios){assert.equal(r.width,20);assert.equal(r.height,20);assert.equal(r.opacity,'1');}
        assert.equal(await page.locator('#context-dialog [role=tabpanel]:visible').count(),1);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        if(width===390||width===1440)await page.screenshot({path:path.join(settingsShots,width===390?'model-mobile.png':'model-desktop.png')});
      }
      await page.locator("[data-close-model-preferences]").click();
      await page.setViewportSize({width:390,height:844});
      await page.locator('[data-settings-section="execution"]').click();await page.fill('#execution-steps','12');
      await page.locator('[data-settings-section="context"]').click();await page.locator('[data-settings-section="execution"]').click();assert.equal(await page.inputValue('#execution-steps'),'12');
      await page.locator('[data-settings-section="access"]').click();
      const toggle=await page.locator('#execution-network').boundingBox();assert(toggle);assert.equal(toggle.width,42);assert.equal(toggle.height,26);
      await page.check('#execution-network');await page.locator('#network-policy-form button').click();
      await page.waitForFunction(async id=>(await (await fetch('/api/conversations/'+id)).json()).conversation.networkAccess===true,first.id);
      await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#network-policy-form button')?.disabled);
      await page.uncheck('#execution-network');await page.locator('#network-policy-form button').click();
      await page.waitForFunction(async id=>(await (await fetch('/api/conversations/'+id)).json()).conversation.networkAccess===false,first.id);
      await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#network-policy-form button')?.disabled);
      await page.locator('[data-settings-section="execution"]').click();await page.fill('#execution-steps','0');
      await page.screenshot({path:path.join(settingsShots,'execution-mobile.png')});
      await page.locator('[data-settings-section="access"]').click();
      const mobileShots = path.resolve('docs/design/workspace');
      await mkdir(mobileShots, { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await page.locator('#context-dialog').boundingBox();
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width === 390) await page.screenshot({path:path.join(mobileShots, 'permissions-mobile.png')});
      }
      await page.setViewportSize({ width:390, height:844 });
      await page.click("#workspace-access-trigger");
      await page
        .getByRole("option", { name: "Lecture et écriture", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !document
            .getElementById("workspace-new-file")
            ?.hasAttribute("disabled"),
      );
      assert.equal(
        (await fixture.service.get(first.id)).conversation.fileAccess,
        "write",
      );
      await page.locator('#close-context').first().click();
      assert.match(await page.locator('#chat-permissions').getAttribute('aria-label')??'', /Lecture et écriture/);
      await page.click('#chat-workspace');
      await page.waitForSelector('#workspace-dialog[open]');
      assert.equal(await page.inputValue('#workspace-access'), 'write');
      await page.screenshot({path:path.join(mobileShots, 'explorer-mobile.png')});
      await page.click("#workspace-new-folder");
      await page.fill("#workspace-destination", "notes");
      await page.click("#workspace-path-submit");
      await page.waitForSelector("#workspace-path-dialog:not([open])", {
        state: "attached",
      });
      await page
        .locator("#workspace-list .workspace-open")
        .filter({ hasText: "notes" })
        .click();
      await page.waitForFunction(
        () =>
          document.getElementById("workspace-path")?.textContent === "notes",
      );
      await page.fill('#workspace-search', 'absent');
      assert.equal(await page.locator('#workspace-list .workspace-row:visible').count(), 0);
      assert.match(await page.locator('#workspace-count').innerText(), /Aucun résultat/);
      await page.fill('#workspace-search', '');
      await page.click("#workspace-new-file");
      await page.fill("#workspace-name", "notes/a.md");
      await page.fill("#workspace-content", "Bonjour");
      await page.click("#workspace-save");
      await page.waitForSelector("#workspace-editor:not([open])", {
        state: "attached",
      });
      await page.getByRole('button',{name:'Actions pour a.md',exact:true}).click();
      await page.waitForSelector('#workspace-item-menu[open]');
      const menuDownload=page.waitForEvent('download');await page.click('#workspace-item-download');
      assert.equal(await readFile((await (await menuDownload).path())!,'utf8'),'Bonjour');
      for(const width of [390,1440]){await page.setViewportSize({width,height:844});await page.screenshot({path:path.join(settingsShots,width===390?'files-mobile.png':'files-desktop.png')});}
      await page.setViewportSize({width:390,height:844});
      await page
        .locator("#workspace-list .workspace-open")
        .filter({ hasText: "a.md" })
        .click();
      await page.waitForSelector("#workspace-editor[open]");
      assert.equal(await page.inputValue("#workspace-content"), "Bonjour");
      assert.equal(await page.locator('#workspace-content').evaluate(el => el === document.activeElement), false);
      await page.click('#workspace-wrap');
      assert.equal(await page.locator('#workspace-wrap').getAttribute('aria-pressed'), 'true');
      await page.fill("#workspace-content", "Mon brouillon");
      const fileSnapshot = await fixture.service.inspectWorkspace(
        first.id,
        "notes/a.md",
        true,
      );
      assert("document" in fileSnapshot);
      await fixture.service.mutateWorkspace(first.id, {
        action: "update",
        path: "notes/a.md",
        content: "Version concurrente",
        revision: fileSnapshot.document.revision,
      });
      await page.click("#workspace-save");
      await page.waitForFunction(() =>
        globalThis.document
          .querySelector("#workspace-editor .dialog-feedback")
          ?.textContent?.includes("changé"),
      );
      assert.equal(
        await page.inputValue("#workspace-content"),
        "Mon brouillon",
      );
      await page
        .locator('#workspace-editor [aria-label="Fermer l’éditeur"]')
        .click();
      await page.click("#workspace-confirm-submit");
      await page
        .locator("#workspace-list .workspace-open")
        .filter({ hasText: "a.md" })
        .click();
      await page.waitForSelector("#workspace-editor[open]");
      assert.equal(
        await page.inputValue("#workspace-content"),
        "Version concurrente",
      );
      await page.fill("#workspace-content", "Version finale");
      await page.click("#workspace-save");
      await page.waitForSelector("#workspace-editor:not([open])", {
        state: "attached",
      });
      await page
        .locator("#workspace-list .workspace-open")
        .filter({ hasText: "a.md" })
        .click();
      await page.waitForSelector("#workspace-editor[open]");
      const output = path.resolve("docs/design/workspace");
      await mkdir(output, { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        const box = await page.locator("#workspace-editor").boundingBox();
        assert(box && box.x >= 0 && box.x + box.width <= width + 1);
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: path.join(
              output,
              width === 390 ? "mobile.png" : "desktop.png",
            ),
          });
      }
      const download = page.waitForEvent("download");
      await page.click("#workspace-download");
      const saved = await download;
      assert.equal(saved.suggestedFilename(), "a.md");
      await page.setViewportSize({ width: 390, height: 420 });
      assert(await page.locator("#workspace-save").isVisible());
      await page.setViewportSize({ width: 390, height: 844 });
      await page.click("#workspace-move");
      await page.fill("#workspace-destination", "renomme.md");
      await page.click("#workspace-path-submit");
      await page.waitForSelector("#workspace-path-dialog:not([open])", {
        state: "attached",
      });
      await page.locator('#workspace-breadcrumbs').getByRole('button', {name:'Racine',exact:true}).click();
      assert.equal(await page.inputValue('#workspace-search'), '');
      await page
        .locator("#workspace-list .workspace-open")
        .filter({ hasText: "renomme.md" })
        .click();
      await page.waitForSelector("#workspace-editor[open]");
      assert.equal(
        await page.inputValue("#workspace-content"),
        "Version finale",
      );
      await page.click("#workspace-delete");
      await page.click("#workspace-confirm-submit");
      await page.waitForSelector("#workspace-confirm:not([open])", {
        state: "attached",
      });
      await page.getByRole('button',{name:'Actions pour notes',exact:true}).click();
      await page.click('#workspace-item-delete');
      await page.click("#workspace-confirm-submit");
      await page.waitForFunction(() =>
        globalThis.document
          .getElementById("workspace-list")
          ?.textContent?.includes("Ce dossier est vide"),
      );
      const payload = Buffer.alloc(2 * 1024 * 1024 + 17, 0xa5);
      await page.setInputFiles("#workspace-import-input", {
        name: "archive.bin",
        mimeType: "application/octet-stream",
        buffer: payload,
      });
      await page
        .locator("#workspace-list .workspace-open")
        .filter({ hasText: "archive.bin" })
        .click();
      await page.waitForSelector("#workspace-editor[open]");
      assert(await page.locator("#workspace-content").isHidden());
      assert(await page.locator("#workspace-save").isHidden());
      const binaryDownload = page.waitForEvent("download");
      await page.click("#workspace-download");
      const downloaded = await binaryDownload;
      assert.deepEqual(await readFile((await downloaded.path())!), payload);
      await page.click("#workspace-move");
      await page.fill("#workspace-destination", "renamed.bin");
      await page.click("#workspace-path-submit");
      await page.waitForSelector("#workspace-editor:not([open])", {
        state: "attached",
      });
      await page
        .locator("#workspace-list .workspace-open")
        .filter({ hasText: "renamed.bin" })
        .click();
      await page.waitForSelector("#workspace-editor[open]");
      await page.click("#workspace-delete");
      await page.click("#workspace-confirm-submit");
      await page.waitForSelector("#workspace-confirm:not([open])", {
        state: "attached",
      });
      await page.click("#workspace-permissions");
      await page.click("#workspace-access-trigger");
      await page
        .getByRole("option", {
          name: "Développement · fichiers et terminal",
          exact: true,
        })
        .click();
      await page.waitForFunction(
        () =>
          !document
            .getElementById("workspace-new-file")
            ?.hasAttribute("disabled"),
      );
      await page.locator("#close-context").first().click();
      await page.click("#workspace-terminal");
      await page.waitForSelector("#terminal-dialog[open]");
      await page.fill(
        "#terminal-command",
        "printf 'terminal-ui\\n'; node --version",
      );
      await page.click("#terminal-run");
      await page.waitForFunction(() =>
        document
          .getElementById("terminal-output")
          ?.textContent?.includes("terminal-ui"),
      );
      await page.waitForFunction(() =>
        document
          .getElementById("terminal-status")
          ?.textContent?.includes("code 0"),
      );
      const terminalShots = path.resolve("docs/design/development");
      await mkdir(terminalShots, { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: path.join(
              terminalShots,
              width === 390 ? "mobile.png" : "desktop.png",
            ),
          });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.fill(
        "#terminal-command",
        "read value; printf 'stdin:%s' \"$value\"",
      );
      await page.click("#terminal-run");
      await page.waitForFunction(
        () =>
          !document.getElementById("terminal-send")?.hasAttribute("disabled"),
      );
      await page.fill("#terminal-input", "hello");
      await page.click("#terminal-send");
      await page.waitForFunction(() =>
        document
          .getElementById("terminal-output")
          ?.textContent?.includes("stdin:hello"),
      );
      await page.fill(
        "#terminal-command",
        "node -e 'setInterval(()=>{},1000)'",
      );
      await page.click("#terminal-run");
      await page.waitForFunction(
        () =>
          !document.getElementById("terminal-stop")?.hasAttribute("disabled"),
      );
      await page.click("#terminal-stop");
      await page.waitForFunction(() =>
        document
          .getElementById("terminal-status")
          ?.textContent?.includes("Interrompue"),
      );
      await page.locator("[data-terminal-close]").click();
      await page
        .locator('#workspace-dialog [aria-label="Fermer les fichiers"]')
        .click();
      await page.reload();
      await page.waitForSelector("body.chat-mode", { state: "attached" });
      await page.click("#chat-workspace");
      assert.equal(await page.inputValue("#workspace-access"), "develop");
      await page.click('#workspace-permissions');
      await page.click('#workspace-access-trigger');
      await page.getByRole('option',{name:'YOLO · serveur entier, root, sans confirmation',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('workspace-access-help')?.textContent?.includes('YOLO actif'));
      assert(await page.locator('#execution-network').isDisabled());
      await page.locator('#close-context').first().click();
      await page.click('#workspace-terminal');
      await page.waitForSelector('#terminal-dialog[open]');
      assert.match(await page.locator('#terminal-access-help').innerText(),/YOLO.*root/);
      await page.fill('#terminal-command',"printf 'yolo-ui-ok'");await page.click('#terminal-run');
      await page.waitForFunction(()=>document.getElementById('terminal-output')?.textContent?.includes('yolo-ui-ok'));
      await page.locator('[data-terminal-close]').click();
      await page.locator('#workspace-dialog [aria-label="Fermer les fichiers"]').click();
      await page.reload();await page.waitForSelector('body.chat-mode',{state:'attached'});await page.click('#chat-workspace');
      assert.equal(await page.inputValue('#workspace-access'),'yolo');
      assert(await page.locator('#chat-yolo').isVisible());
      await page.locator('#workspace-dialog [aria-label="Fermer les fichiers"]').click();
      await page.click('#chat-yolo');
      await page.waitForSelector('#context-dialog[open]');
      assert.equal(await page.locator('#context-dialog #workspace-access').count(),1);
      await page.click('#workspace-access-trigger');await page.getByRole('option',{name:'Lecture seule',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('workspace-access-help')?.textContent?.includes('sans les modifier'));
      assert.deepEqual(errors, []);
    } finally {
      try {
        for (const command of (await fixture.service.commands(first.id))
          .commands)
          if (command.status === "running")
            await fixture.service.stopCommand(first.id, command.id);
      } catch {}
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture.storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
