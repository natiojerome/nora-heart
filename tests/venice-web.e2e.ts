import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer as reserve } from "node:net";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { assistantFixture } from "./assistant.fixture.ts";
import { conversationFixture } from "./conversation-fixture.ts";

test("Venice web is separate from the API in mobile settings; catalogue selection survives reopening", { timeout: 30000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-web-ui-"));
  const lab = new TestLab({ directory: path.join(root, "lab"), authDirectory: path.join(root, "auth") });
  await lab.prepare();
  const original = lab.state.bind(lab);
  lab.state = async () => ({ ...await original(), api: { openai: false, anthropic: false, openrouter: false,
    venice: false, "venice-web": true } });
  const models = [{ id: "web-fixture", name: "DeepSeek web fixture", contextWindow: 524288,
    supportsTools: true, vision: false, reasoningEfforts: [] as string[], pricing: { input: null, output: null, request: null } }];
  lab.models = async provider => { assert.equal(provider, "venice-web"); return { models }; };
  lab.capabilities = async () => models[0];
  const fixture = await conversationFixture(path.join(root, "threads"), undefined, undefined, undefined,
    undefined, undefined, async () => models[0]);
  const conversation = (await fixture.service.create({ title: "Web fixture" })).conversation;
  await fixture.service.selectModel(conversation.id, { provider: "venice-web", modelId: "web-fixture", contextWindow: 524288 });
  const assistant = assistantFixture();
  await assistant.save({ version: 0, settings: { ...defaultAssistant, completed: true, step: 5 } });
  const reservation = reserve();
  await new Promise<void>(r => reservation.listen(0, "127.0.0.1", r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(r => reservation.close(() => r()));
  const origin = `http://127.0.0.1:${port}`;
  const server = createWebServer({ origin, access: new WebAccess({ secret: "venice-web-fixture-secret-at-least-32-chars", password: "fixture-password" }),
    lab, conversations: fixture.service, assistant });
  await new Promise<void>(r => server.listen(port, "127.0.0.1", r));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(origin + "/?conversation=" + conversation.id);
    await page.fill("#password", "fixture-password"); await page.click("#login-submit");
    await page.waitForSelector("body.chat-mode", { state: "attached" });
    await page.evaluate(() => (window as any).heartConversationModel.open());
    await page.waitForSelector("#model-preferences-dialog[open]");
    await page.waitForFunction(() => (document.querySelector("#model-options") as HTMLSelectElement)?.value === "web-fixture");
    assert.equal(await page.inputValue("input[name=provider]:checked"), "venice-web");
    assert.match(await page.textContent("#cost-note") ?? "", /web Venice.*émulés/);
    assert.equal((await fixture.service.get(conversation.id)).conversation.selection?.contextWindow, 524288);
    await page.reload();
    await page.waitForSelector("body.chat-mode", { state: "attached" });
    assert.equal((await fixture.service.get(conversation.id)).conversation.selection?.provider, "venice-web");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await new Promise<void>(r => server.close(() => r()));
    await lab.close(); await fixture.storage.close(); await rm(root, { recursive: true, force: true });
  }
});
