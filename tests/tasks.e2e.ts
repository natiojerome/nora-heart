import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createServer as reserve } from "node:net";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";

test(
  "durable task UI creates, edits, pauses, runs with feedback, notifies and survives reload across four widths",
  { timeout: 45000 },
  async () => {
    const root = await mkdtemp("/tmp/heart-task-ui-"),
      file = root + "/state.sqlite",
      lab = new TestLab({
        directory: root + "/lab",
        authDirectory: root + "/auth",
      });
    await lab.prepare();
    await migrateSqlite(file);
    let calls = 0,
      release!: () => void,
      started!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      working = new Promise<void>((r) => (started = r));
    lab.model = () => ({
      id: "fake",
      async generate(request) {
        calls++;
        assert(!request.tools.some((t) => t.name === "files.create"));
        started();
        await gate;
        return { content: "Rapport simulé prêt.", toolCalls: [] };
      },
    });
    const app = await openWebConversations(
      { driver: "sqlite", file },
      root + "/state",
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
            provider: "demo",
            modelId: "demo",
            contextWindow: 32768,
            capacitySource: "configured",
          },
          fileAccess: "read",
          networkAccess: false,
        },
      },
    });
    const conversation = (
      await app.conversations.create({ title: "Discussion du rapport" })
    ).conversation;
    const reserved = reserve();
    await new Promise<void>((r) => reserved.listen(0, "127.0.0.1", r));
    const port = (reserved.address() as { port: number }).port;
    await new Promise<void>((r) => reserved.close(() => r()));
    const origin = "http://127.0.0.1:" + port,
      server = createWebServer({
        origin,
        access: new WebAccess({
          secret: "task-ui-secret-at-least-32-characters",
          password: "test-password",
        }),
        lab,
        ...app,
      });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    app.scheduler.start();
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      assert.equal((await fetch(origin + "/api/tasks")).status, 401);
      await page.goto(origin + "/#automations");
      await page.fill("#password", "test-password");
      await page.click("#login-submit");
      await page.waitForSelector("#task-create:not([disabled])");
      await page.click("#task-create");
      await page.fill("#task-title", "Rapport quotidien");
      await page.fill("#task-prompt", "Prépare un point sur la discussion.");
      await page.waitForSelector("#task-conversation-trigger:not([disabled])");
      await page.click("#task-conversation-trigger");
      await page
        .locator('#select-sheet-options [data-value="' + conversation.id + '"]')
        .click();
      const year = new Date().getUTCFullYear() + 1;
      await page.fill("#task-date", year + "-01-02T09:00");
      await page.fill("#task-timezone", "Indian/Reunion");
      let saved!: () => void;
      const saveGate = new Promise<void>((r) => (saved = r));
      await page.route("**/api/tasks", async (route) => {
        if (route.request().method() === "POST") await saveGate;
        return route.continue();
      });
      await page.click("#task-save");
      await page.waitForFunction(
        () => document.querySelector<HTMLButtonElement>("#task-save")!.disabled,
      );
      assert.match(
        await page.locator("#task-editor-status").innerText(),
        /Enregistrement/,
      );
      saved();
      await page.waitForSelector("#task-editor:not([open])", {
        state: "attached",
      });
      await page.unroute("**/api/tasks");
      await page.waitForSelector("[data-task-id]");
      assert.equal(calls, 0);
      let task = (await app.tasks.list()).tasks[0];
      assert.equal(task.nextAt, year + "-01-02T05:00:00.000Z");
      await page.locator("[data-task-id]").click();
      await page.waitForSelector("#task-toggle:not([disabled])");
      await page.click("#task-edit");
      await page.fill("#task-prompt", "Brouillon à conserver.");
      await app.tasks.active(task.id, { version: task.version, active: false });
      await page.click("#task-save");
      await page.waitForFunction(() =>
        document
          .querySelector("#task-editor-status")!
          .textContent!.includes("modifiée"),
      );
      assert.equal(
        await page.inputValue("#task-prompt"),
        "Brouillon à conserver.",
      );
      await page.locator("#task-editor [data-close-editor]").click();
      await page.click("#tasks-refresh");
      await page.waitForSelector("#tasks-refresh:not([disabled])");
      await page.locator("[data-task-id]").click();
      await page.waitForSelector("#task-toggle:not([disabled])");
      assert.equal(await page.locator("#task-toggle").innerText(), "Reprendre");
      await page.click("#task-toggle");
      await page.waitForFunction(
        () => document.querySelector("#task-toggle")!.textContent === "Pause",
      );
      await page.click("#task-toggle");
      await page.waitForFunction(
        () =>
          document.querySelector("#task-toggle")!.textContent === "Reprendre",
      );
      await page.click("#task-run-now");
      await working;
      await page.waitForSelector("#task-run-now[disabled]");
      assert.equal(calls, 1);
      release();
      await page.waitForFunction(() =>
        document
          .querySelector("#task-history")!
          .textContent!.includes("Terminée"),
      );
      assert.equal((await app.tasks.get(task.id)).runs.length, 1);
      await page
        .getByRole("button", { name: "Marquer comme lu", exact: true })
        .click();
      await page.waitForFunction(() =>
        document.querySelector("#tasks-badge")!.hasAttribute("hidden"),
      );
      assert.equal((await app.tasks.list()).unread, 0);
      await page.locator("#task-detail [data-close-editor]").click();
      await page.reload();
      await page.waitForSelector("[data-task-id]");
      assert.equal((await app.tasks.list()).tasks[0].active, false);
      await mkdir("docs/qualification/tasks", { recursive: true });
      for (const width of [320, 390, 820, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "docs/qualification/tasks/list-" + width + ".png",
        });
        await page.locator("[data-task-id]").click();
        await page.waitForSelector("#task-edit:not([disabled])");
        assert(
          await page.evaluate(() => {
            const r = document
              .querySelector("#task-detail")!
              .getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth;
          }),
        );
        await page.screenshot({
          path: "docs/qualification/tasks/history-" + width + ".png",
        });
        await page.click("#task-edit");
        await page.waitForSelector("#task-editor[open]");
        assert(
          await page.evaluate(() => {
            const r = document
              .querySelector("#task-editor")!
              .getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth;
          }),
        );
        await page.screenshot({
          path: "docs/qualification/tasks/editor-" + width + ".png",
        });
        await page.locator("#task-editor [data-close-editor]").click();
      }
      // Unchanged background reads must preserve DOM, focus, scroll and all loaded history.
      const detail = await app.tasks.get(task.id),
        synthetic = Array.from({ length: 25 }, (_, index) => ({
          ...detail.runs[0],
          id: randomUUID(),
          sequence: String(25 - index),
          seen: true,
        }));
      let detailReads = 0,
        listReads = 0;
      await page.route("**/api/tasks/" + task.id + "*", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        detailReads++;
        const url = new URL(route.request().url()),
          before = Number(url.searchParams.get("before") ?? 26),
          count = Number(url.searchParams.get("limit") ?? 20),
          rows = synthetic.filter((run) => Number(run.sequence) < before),
          runs = rows.slice(0, count);
        await route.fulfill({
          json: {
            ...detail,
            runs,
            nextCursor: rows.length > count ? runs.at(-1)!.sequence : null,
          },
        });
      });
      page.on("request", (request) => {
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname === "/api/tasks"
        )
          listReads++;
      });
      await page.locator("[data-task-id]").click();
      await page.waitForFunction(
        () => document.querySelectorAll(".task-run").length === 20,
      );
      await page.click("#task-history-more");
      await page.waitForFunction(
        () => document.querySelectorAll(".task-run").length === 25,
      );
      await page.clock.install();
      await page.evaluate(() => {
        const review: any = ((window as any).__taskReview = { mutations: 0 });
        review.card = document.querySelector("[data-task-id]");
        review.first = document.querySelector(".task-run");
        review.scroll = document.querySelector("#task-detail .editor-scroll");
        (document.querySelector("#task-edit") as HTMLButtonElement).focus();
        review.scroll.scrollTop = 160;
        review.top = review.scroll.scrollTop;
        review.observer = new MutationObserver(
          (records) => (review.mutations += records.length),
        );
        for (const id of [
          "tasks-status",
          "tasks-worker",
          "tasks-refresh",
          "tasks-badge",
          "task-cards",
          "task-detail",
        ])
          review.observer.observe(document.getElementById(id)!, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
      });
      const beforeReads = listReads;
      const refreshed = page.waitForResponse(
        (response) =>
          response.url().includes("/api/tasks/" + task.id) &&
          response.request().method() === "GET",
      );
      await page.clock.runFor(16000);
      await refreshed;
      await page.waitForTimeout(70);
      const idle = await page.evaluate(() => {
        const r = (window as any).__taskReview;
        return {
          mutations: r.mutations,
          sameCard: r.card === document.querySelector("[data-task-id]"),
          sameHistory: r.first === document.querySelector(".task-run"),
          rows: document.querySelectorAll(".task-run").length,
          focus: document.activeElement?.id,
          scrollPreserved: r.scroll.scrollTop === r.top,
        };
      });
      assert.deepEqual(idle, {
        mutations: 0,
        sameCard: true,
        sameHistory: true,
        rows: 25,
        focus: "task-edit",
        scrollPreserved: true,
      });
      assert.equal(listReads - beforeReads, 1);
      assert(detailReads >= 3);
      // A fresh status still updates the already loaded history.
      synthetic[0].detail = "Résultat actualisé";
      const changed = page.waitForResponse(
        (response) =>
          response.url().includes("/api/tasks/" + task.id) &&
          response.request().method() === "GET",
      );
      await page.clock.runFor(15000);
      await changed;
      await page.waitForFunction(() =>
        document
          .querySelector("#task-history")!
          .textContent!.includes("Résultat actualisé"),
      );
      assert.equal(await page.locator(".task-run").count(), 25);
      await page.evaluate(() =>
        (window as any).__taskReview.observer.disconnect(),
      );
      await page.locator("#task-detail [data-close-editor]").click();
      await page.click("#task-create");
      await page.fill("#task-prompt", "Brouillon pendant la lecture");
      const editingReads = listReads;
      await page.clock.runFor(16000);
      assert.equal(listReads, editingReads);
      assert.equal(
        await page.inputValue("#task-prompt"),
        "Brouillon pendant la lecture",
      );
      await page.locator("#task-editor [data-close-editor]").click();
      // Logout/reset while a read is pending must not lock the next session's refresh.
      let releaseRead!: () => void, readStarted!: () => void;
      const blocked = new Promise<void>((resolve) => (releaseRead = resolve)),
        readPending = new Promise<void>((resolve) => (readStarted = resolve));
      await page.route("**/api/tasks", async (route) => {
        if (route.request().method() === "GET") {
          readStarted();
          await blocked;
        }
        await route.continue();
      });
      await page.click("#tasks-refresh");
      await readPending;
      await page.evaluate(() => (window as any).heartTasks.reset());
      releaseRead();
      await page.unroute("**/api/tasks");
      await page.evaluate(() => (window as any).heartTasks.sync());
      await page.waitForSelector("[data-task-id]");
      await page.waitForSelector("#tasks-refresh:not([disabled])");
      await mkdir("docs/qualification/tasks-review", { recursive: true });
      await writeFile(
        "docs/qualification/tasks-review/browser.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            fixture:
              "disposable SQLite and simulated provider; 25 history rows",
            idleBackgroundReads: 1,
            observedIdleWindowMs: 16000,
            ...idle,
            changedStatusUpdated: true,
            editorPollingPaused: true,
            resetDuringReadRecovers: true,
            jsErrors: errors.length,
            simulatedCalls: calls,
          },
          null,
          2,
        ) + "\n",
      );
      await page.clock.resume();
      await page.setViewportSize({ width: 390, height: 844 });
      for (let index = 0; index < 44; index++)
        await app.tasks.save({
          version: 0,
          title: "Catalogue " + index,
          prompt: "Do not run: pagination fixture",
          conversationId: conversation.id,
          schedule: {
            kind: "once",
            at: year + "-01-02T09:00",
            timezone: "Indian/Reunion",
          },
          missed: "catch_up",
          active: false,
          notify: false,
        });
      await page.click("#tasks-refresh");
      await page.waitForFunction(
        () => document.querySelectorAll("[data-task-id]").length === 20,
      );
      await page.locator("#tasks-more").scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.querySelectorAll("[data-task-id]").length >= 40,
      );
      await page.locator("#tasks-more").scrollIntoViewIfNeeded();
      await page.waitForFunction(
        () => document.querySelectorAll("[data-task-id]").length === 45,
      );
      assert.equal(
        new Set(
          await page
            .locator("[data-task-id]")
            .evaluateAll((nodes) =>
              nodes.map((node) => (node as HTMLElement).dataset.taskId),
            ),
        ).size,
        45,
      );
      await mkdir("docs/qualification/tasks-consolidation", {
        recursive: true,
      });
      await writeFile(
        "docs/qualification/tasks-consolidation/browser.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            cataloguePages: [20, 20, 5],
            automaticLoading: true,
            duplicateCards: 0,
            realProviderCalls: 0,
            fixture: "isolated SQLite and simulated model",
            priorFunctionalAndIdleChecks: true,
          },
          null,
          2,
        ) + "\n",
      );
      assert.deepEqual(errors, []);
      assert.equal(calls, 1);
      await writeFile(
        "docs/qualification/tasks/browser.json",
        JSON.stringify(
          {
            fixture: "SQLite disposable, simulated provider",
            widths: [320, 390, 820, 1440],
            creationWithoutInference: true,
            saveFeedback: true,
            conflictPreservesDraft: true,
            pauseResume: true,
            runNow: true,
            notificationReadPersists: true,
            reload: true,
            simulatedCalls: calls,
            jsErrors: 0,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      release();
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await app.close();
      await lab.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
