import { createServer as reserve } from "node:net";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { assistantFixture } from "./assistant.fixture.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { conversationFixture } from "./conversation-fixture.ts";
import { mcpFixture, externalRepositoryFixture } from "./mcp.fixture.ts";
import { ExternalTools } from "../src/app/external-tools.ts";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";

test(
  "MCP configuration, discovery, approvals, network denial and actual chat tool execution work on mobile and desktop",
  { timeout: 45000 },
  async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "heart-mcp-web-")),
      remote = await mcpFixture(),
      { repository } = externalRepositoryFixture(),
      externalTools = new ExternalTools(repository, (c, signal) =>
        connectMcp(c, { signal }),
      );
    remote.tools[0].readOnlyHint=false;
    const lab = new TestLab({
      directory: path.join(dir, "lab"),
      authDirectory: path.join(dir, "auth"),
    });
    await lab.prepare();
    let inferred = 0;
    const f = await conversationFixture(
      path.join(dir, "threads"),
      () => ({
        id: "fake-web",
        async generate(request) {
          inferred++;
          const tool = request.tools.find((tool) =>
            tool.name.startsWith("mcp_"),
          );
          if (request.messages.at(-1)?.role === "tool")
            return {
              content:
                "Source consultée : [Documentation](https://example.com/docs).",
              toolCalls: [],
            };
          if (!tool)
            return { content: "Réseau ou connexion désactivé.", toolCalls: [] };
          return {
            content: "Je consulte les documents publics.",
            toolCalls: [
              {
                id: randomUUID(),
                name: tool.name,
                arguments: { query: "Documentation MCP officielle" },
              },
            ],
          };
        },
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => externalTools.toolsFor(c),
    );
    const { conversation } = await f.service.create({ title: "Recherche web" }),
      assistant = assistantFixture();
    await assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const access = new WebAccess({
      secret: "fake-mcp-browser-session-secret-32-characters",
      password: "fake-password",
    });
    const reservation = reserve();
    await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const origin = "http://127.0.0.1:" + port;
    const server = createWebServer({
      origin,
      access,
      lab,
      assistant,
      conversations: f.service,
      externalTools,
      assetsDirectory: process.env.HARNESS_TEST_WEB_ASSETS,
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({
      args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
    });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      assert.equal(
        (await page.request.get(origin + "/api/external-tools")).status(),
        401,
      );
      let catalogReads = 0;
      page.on("request", r => { if (r.url().endsWith("/api/external-tools") && r.method() === "GET") catalogReads++; });
      await page.goto(origin + "/#tools");
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("#capabilities-tools:not([hidden])");
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#mcp-tools-refresh")!.disabled);
      assert.equal(catalogReads, 1);
      assert(!(await page.locator("#mcp-add").isVisible()));
      await page.locator("#capabilities-tab-connections").click();
      await page.waitForSelector("#mcp-empty:not([hidden])");
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("#mcp-refresh")!.disabled);
      assert.equal(catalogReads, 1);
      assert(await page.locator("#mcp-add").isVisible());
      assert(!(await page.locator("#skills-section").isVisible()));
      await page.click("#mcp-add");
      await page.fill("#mcp-label", "Documents publics");
      await page.fill("#mcp-url", remote.url);
      await page.click("#mcp-discover");
      await page.waitForFunction(() =>
        document
          .getElementById("mcp-status")
          ?.textContent?.includes("Connexion réussie"),
      );
      assert(await page.locator('#mcp-tool-choices input[value=search]').isDisabled());
      await page.check('#mcp-writes');
      await page.check('#mcp-transient');
      await page.uncheck('#mcp-transient');
      assert(!(await page.locator('#mcp-tool-choices input[value=search]').isDisabled()));
      await page.check("#mcp-tool-choices input[value=search]");
      await page.check("#mcp-enabled");
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        const bounds = await page.locator("#mcp-dialog").boundingBox();
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await mkdir("docs/design/mcp", { recursive: true });
      await page.screenshot({
        path: "docs/qualification/nora-mcps/configuration-mobile.png",
      });
      await page.click("#mcp-save");
      await page.waitForSelector("#mcp-dialog:not([open])", {
        state: "attached",
      });
      await page.waitForSelector(".mcp-connection");
      assert((await page.textContent(".mcp-connection"))?.includes("1 outil"));
      await page.locator(".mcp-connection-tools > summary").click();
      assert((await page.textContent(".mcp-connection-tools"))?.includes("Recherche web"));
      const remoteBefore = remote.calls.length;
      await page.locator("#capabilities-tab-tools").click();
      await page.waitForSelector('#mcp-tools-list [data-mcp-tool="search"]');
      const tool = page.locator('#mcp-tools-list [data-mcp-tool="search"]');
      assert((await tool.textContent())?.includes("Documents publics · MCP"));
      await tool.locator("summary").click();
      assert.equal(await tool.locator("code").textContent(),"search");
      const readsBefore = catalogReads;
      await tool.locator("button").click();
      assert.equal(await page.inputValue("#mcp-label"),"Documents publics");
      await page.locator("#mcp-dialog [data-close-mcp]").click();
      await mkdir("docs/qualification/nora-mcps",{recursive:true});
      for(const width of [320,390,820,1440]) {
        await page.setViewportSize({width,height:900});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:`docs/qualification/nora-mcps/tools-${width}.png`});
      }
      assert.equal(catalogReads,readsBefore);
      assert.equal(remote.calls.length,remoteBefore);
      await page.setViewportSize({width:390,height:844});
      const saved = (await externalTools.list()).connections[0];
      assert(saved.enabled);assert.equal(saved.allowWrites,true);assert.equal(saved.transient,undefined);
      assert.equal(saved.tools.length, 1);
      // Owner session alone is insufficient: mutation still requires CSRF/origin.
      assert.equal(
        (
          await page.request.post(origin + "/api/external-tools", {
            data: { ...saved, toolNames: ["search"] },
          })
        ).status(),
        403,
      );
      await page.evaluate(async (id) => {
        location.hash = "conversations";
        await (window as any).openConversation(id);
        await (window as any).post(`/api/conversations/${id}/messages`, {
          provider: "demo",
          contextWindow: 8192,
          prompt: "Recherche sans réseau",
        });
      }, conversation.id);
      assert.equal(remote.calls.length, 0);
      await page.evaluate(async (id) => {
        await (window as any).post(
          `/api/conversations/${id}/execution-policy`,
          { network: true, maxSteps: 0 },
        );
        await (window as any).openConversation(id);
      }, conversation.id);
      await page.fill("#conversation-prompt", "Recherche la documentation MCP");
      await page.click("#conversation-submit");
      await page.waitForFunction(() =>
        document
          .getElementById("conversation-history")
          ?.textContent?.includes("Source consultée"),
      );
      assert.equal(remote.calls.length, 1);
      assert.equal(remote.calls[0].args.query, "Documentation MCP officielle");
      assert(
        (await page.textContent("#conversation-tools"))?.includes(
          "Documents publics · Recherche web",
        ),
      );
      const detail = await f.service.get(conversation.id);
      assert(
        detail.events.some(
          (e) =>
            e.type === "tool.started" &&
            (e.data as any).title === "Documents publics · Recherche web",
        ),
      );
      assert(
        detail.events.some(
          (e) =>
            e.type === "message" &&
            (e.data as any).role === "tool" &&
            (e.data as any).content.includes("https://example.com/docs"),
        ),
      );
      await page.evaluate(() => {
        (window as any).message("");
      });
      await page.screenshot({ path: "docs/qualification/nora-mcps/chat-mobile.png" });
      await page.evaluate(() => {
        location.hash = "tools-connections";
      });
      await page.click(".mcp-connection button");
      await page.uncheck("#mcp-enabled");
      await page.click("#mcp-save");
      await page.waitForSelector("#mcp-dialog:not([open])", {
        state: "attached",
      });
      assert.equal((await externalTools.list()).connections[0].enabled, false);
      await page.locator("#capabilities-tab-tools").click();
      await page.waitForFunction(()=>document.querySelector('#mcp-tools-list [data-mcp-tool="search"]')?.textContent?.includes("Désactivée"));
      await page.locator("#capabilities-tab-connections").click();
      await page.reload();
      await page.waitForSelector(".mcp-connection");
      assert(
        (await page.textContent(".mcp-connection"))?.includes("Désactivé"),
      );
      await externalTools.save({id:randomUUID(),version:0,label:"Second service",url:remote.url,auth:{type:"none"},enabled:true,allowWrites:true,timeoutMs:10000,toolNames:["search"]});
      await page.goto(origin+"/#tools");await page.reload();
      await page.waitForSelector("#mcp-tools-list .mcp-tool-group");
      assert.equal(await page.locator("#mcp-tools-list .mcp-tool-group").count(),2);
      assert.equal(await page.locator("#mcp-tools-list .mcp-tool-group[open]").count(),0);
      await page.locator("#mcp-tools-list .mcp-tool-group > summary").first().click();
      assert(await page.locator("#mcp-tools-list .mcp-tool-group[open] [data-mcp-tool]").isVisible());
      for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
      assert.deepEqual(errors, []);
      await mkdir("docs/qualification/mcp", { recursive: true });
      await writeFile(
        "docs/qualification/nora-mcps/browser.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            scope:
              "Chromium + local HTTP MCP server + simulated model; temporary state",
            configuredThroughUI: true,
            discovery: true,
            approval: true,
            networkDenial: true,
            realRemoteCalls: remote.calls.length,
            csrfEnforced: true,
            disablePersists: true,
            readableToolTitle: true,
            modelCalls: inferred,
            widths: [320, 390, 820, 1440],
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
      await f.service.shutdown();
      await f.storage.close();
      await lab.close();
      await remote.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
