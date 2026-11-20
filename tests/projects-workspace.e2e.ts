import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  symlink,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";

test(
  "owner opens project files and real terminal without a conversation, preserving separate chat workspaces",
  { timeout: 45000 },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "heart-root-web-")),
      root = path.join(directory, "custom projects");
    const lab = new TestLab({
      directory: path.join(directory, "lab"),
      authDirectory: path.join(directory, "auth"),
    });
    await lab.prepare();
    const file = path.join(directory, "state.sqlite");
    await migrateSqlite(file);
    const app = await openWebConversations(
      { driver: "sqlite", file },
      path.join(directory, "state"),
      lab,
      undefined,
      root,
    );
    let modelCalls = 0;
    lab.model = () => {
      modelCalls++;
      throw new Error("No inference expected");
    };
    await app.assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const access = new WebAccess({
      secret: "projects-workspace-test-secret-at-least-32",
      password: "fake-password",
    });
    const probe = createWebServer({ origin: "http://127.0.0.1", access, lab });
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const origin = `http://127.0.0.1:${port}`,
      server = createWebServer({ origin, access, lab, ...app });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      await writeFile(path.join(directory, "outside.txt"), "private outside");
      await symlink(
        path.join(directory, "outside.txt"),
        path.join(root, "link.txt"),
      );
      await mkdir(path.join(root, "demo"));
      await writeFile(
        path.join(root, "demo", "binary.bin"),
        Buffer.from([0, 255, 1, 2]),
      );
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      assert.equal(
        (await page.request.get(origin + "/api/projects-root")).status(),
        401,
      );
      await page.goto(origin + "/#tools");
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("#app-view:not([hidden])");
      assert.equal((await app.conversations.list()).conversations.length, 0);
      await page.click("#capabilities-files");
      await page.waitForSelector("#workspace-dialog[open]");
      assert(
        (await page.textContent("#workspace-conversation"))?.includes(root),
      );
      assert(!(await page.locator("#workspace-permissions").isVisible()));
      await page.click("#workspace-new-file");
      await page.fill("#workspace-name", "note.md");
      await page.fill("#workspace-content", "Root file");
      await page.click("#workspace-save");
      await page.waitForSelector("#workspace-editor:not([open])", {
        state: "attached",
      });
      assert.equal(
        await readFile(path.join(root, "note.md"), "utf8"),
        "Root file",
      );
      const binary = await page.request.get(
        origin + "/api/projects-root/workspace/raw?path=demo%2Fbinary.bin",
      );
      assert.equal(binary.status(), 200);
      assert.deepEqual(await binary.body(), Buffer.from([0, 255, 1, 2]));
      for (const target of ["../outside.txt", "link.txt"])
        assert.equal(
          (
            await page.request.get(
              origin +
                "/api/projects-root/workspace?read=true&path=" +
                encodeURIComponent(target),
            )
          ).status(),
          400,
        );
      assert.equal(
        (
          await page.request.post(origin + "/api/projects-root/workspace", {
            data: { action: "mkdir", path: "csrf-denied" },
          })
        ).status(),
        403,
      );
      await page.locator("#workspace-dialog [data-workspace-close]").click();
      await page.click("#capabilities-terminal");
      await page.waitForSelector("#terminal-dialog[open]");
      await page.fill(
        "#terminal-command",
        "pwd; printf terminal-ok > terminal.txt; cat terminal.txt",
      );
      await page.click("#terminal-run");
      await page.waitForFunction(() =>
        document
          .querySelector("#terminal-output")
          ?.textContent?.includes("terminal-ok"),
      );
      assert.equal(
        await readFile(path.join(root, "terminal.txt"), "utf8"),
        "terminal-ok",
      );
      assert(
        (await page.textContent("#terminal-output"))?.includes("/workspace"),
      );
      await page.locator("#terminal-dialog [data-terminal-close]").click();
      assert.equal((await app.conversations.list()).conversations.length, 0);
      assert.equal(modelCalls, 0);
      const conversation = (
        await app.conversations.create({ title: "Separate chat" })
      ).conversation;
      const conversationRoot = path.join(
        directory,
        "state",
        "conversations",
        conversation.id,
      );
      await mkdir(conversationRoot, { recursive: true });
      await writeFile(path.join(conversationRoot, "chat-only.txt"), "chat");
      await page.goto(
        origin + "/?conversation=" + conversation.id + "#conversations",
      );
      await page.waitForSelector("#chat-workspace:not([disabled])");
      await page.click("#chat-workspace");
      await page.waitForSelector("#workspace-dialog[open]");
      await page.waitForFunction(() => document.getElementById("workspace-list")?.textContent?.includes("chat-only.txt"));
      assert(!(await page.textContent("#workspace-list"))?.includes("note.md"));
      await page.locator("#workspace-dialog [data-workspace-close]").click();
      await page.evaluate(() => (location.hash = "tools"));
      await page.click("#capabilities-files");
      await page.waitForSelector("#workspace-dialog[open]");
      await page.waitForFunction(() =>
        document
          .querySelector("#workspace-list")
          ?.textContent?.includes("note.md"),
      );
      await mkdir("docs/qualification/projects-root", { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: `docs/qualification/projects-root/files-${width}.png`,
        });
      }
      assert.equal(modelCalls, 0);
      assert.deepEqual(errors, []);
      await writeFile(
        "docs/qualification/projects-root/browser.json",
        JSON.stringify(
          {
            viewports: [320, 390, 820, 1440],
            actualShell: true,
            noConversationRequired: true,
            conversationWorkspaceSeparate: true,
            rootAfterOpeningChat: true,
            binaryDownload: true,
            traversalAndSymlinkDenied: true,
            csrfEnforced: true,
            modelCalls,
            jsErrors: errors.length,
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
      await rm(directory, { recursive: true, force: true });
    }
  },
);
