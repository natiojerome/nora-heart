import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createServer as reserve } from "node:net";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { assistantFixture } from "./assistant.fixture.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { conversationFixture } from "./conversation-fixture.ts";
import type { Event } from "../src/contracts/storage.ts";
import type { Json } from "../src/contracts/json.ts";

test(
  "owner reviews uncertain effects in a compact dialog, repairs without inference and continues the same conversation",
  { timeout: 45000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "heart-recovery-ui-")),
      lab = new TestLab({
        directory: path.join(root, "lab"),
        authDirectory: path.join(root, "auth"),
      });
    await lab.prepare();
    let calls = 0;
    const f = await conversationFixture(path.join(root, "threads"), () => ({
      id: "fake-recovery",
      async generate() {
        calls++;
        return { content: "Suite du travail", toolCalls: [] };
      },
    }));
    const conversation = (
        await f.service.create({ title: "Travail interrompu" })
      ).conversation,
      runId = randomUUID();
    const add = async (type: Event["type"], data: unknown) =>
      f.storage.sessions.append(conversation.id, {
        id: randomUUID(),
        at: new Date().toISOString(),
        runId,
        type,
        data: data as Json,
      });
    await add("run.started", {});
    await add("message", { role: "user", content: "Prépare mes fichiers" });
    await add("message", {
      role: "assistant",
      content: "Je crée les documents",
      toolCalls: [
        { id: "done", name: "files.write", arguments: {} },
        { id: "unknown", name: "terminal.exec", arguments: {} },
      ],
    });
    await add("message", {
      role: "tool",
      name: "files.write",
      callId: "done",
      content: "Document enregistré",
      error: false,
    });
    await add("tool.started", { callId: "unknown", name: "terminal.exec" });
    const assistant = assistantFixture();
    await assistant.save({
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
        secret: "fake-recovery-session-key-at-least-32-characters",
        password: "fake-password",
      }),
      lab,
      assistant,
      conversations: f.service,
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        origin + "/?conversation=" + conversation.id + "#conversations",
      );
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector(".recovery-panel");
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.click(".recovery-panel button");
        await page.waitForSelector(".recovery-dialog[open]");
        assert(
          await page
            .locator(".recovery-dialog button[type=submit]")
            .isDisabled(),
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        const box = await page.locator(".recovery-dialog").boundingBox();
        assert(box && box.width <= width && box.x >= 0);
        const folder = path.resolve("docs/qualification/recovery");
        await mkdir(folder, { recursive: true });
        await page.screenshot({
          path: path.join(folder, "review-" + width + ".png"),
        });
        await page.getByRole("button", { name: "Fermer", exact: true }).click();
      }
      const stale = (await f.service.get(conversation.id)).recovery.lastEventId;
      await page.click(".recovery-panel button");
      await page
        .getByRole("button", {
          name: "J’ai vérifié les effets possibles",
          exact: true,
        })
        .click();
      await page
        .locator(".recovery-dialog textarea")
        .fill("Fichier présent ; commande terminée, sortie à vérifier.");
      await page
        .getByRole("button", { name: "Clôturer sans rejouer", exact: true })
        .click();
      await page.waitForSelector(".recovery-dialog", { state: "detached" });
      await page.waitForSelector(".recovery-panel", { state: "detached" });
      assert.equal(calls, 0);
      assert.deepEqual(
        (await f.service.get(conversation.id)).recovery.calls,
        [],
      );
      await assert.rejects(
        f.service.reconcile(conversation.id, {
          lastEventId: stale,
          acknowledged: true,
          note: "",
        }),
        /changé/,
      );
      await page.evaluate(async (id) => {
        await (window as any).api("/api/conversations/" + id + "/messages", {
          method: "POST",
          body: JSON.stringify({
            prompt: "Continue",
            provider: "demo",
            contextWindow: 8192,
          }),
        });
      }, conversation.id);
      assert.equal(calls, 1);
      assert.equal(
        (await f.service.get(conversation.id)).conversation.id,
        conversation.id,
      );
      assert.deepEqual(errors, []);
      await writeFile(
        path.resolve("docs/qualification/recovery/browser.json"),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            viewports: [320, 390, 820, 1440],
            noOverflow: true,
            repairModelCalls: 0,
            continuationModelCalls: calls,
            staleRepairRejected: true,
            jsErrors: errors,
            scope:
              "Disposable fixture; no owner data or real provider inference",
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await f.storage.close();
      await lab.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
