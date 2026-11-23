import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { ProjectManagement } from "../src/app/project-management.ts";
import { projectTrackingFixture } from "./project-tracking.fixture.ts";

test(
  "project plan on mobile: independent of memory, nested goals, evidence, conflicts and no idle redraw",
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "heart-plan-browser-"),
    );
    const f = projectTrackingFixture(),
      manager = new ProjectManagement(f.repository, f.repository);
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
    );
    await app.assistant.save({
      version: 0,
      settings: { ...defaultAssistant, completed: true, step: 5 },
    });
    const access = new WebAccess({
      secret: "project-tracking-fake-session-secret-at-least-32",
      password: "fake-password",
    });
    const probe = createWebServer({ origin: "http://127.0.0.1", access, lab });
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const origin = `http://127.0.0.1:${port}`;
    const serverOptions = {
      ...app,
      memories: undefined as typeof app.memories | undefined,
      projectManagement: manager,
      origin,
      access,
      lab,
    };
    const server = createWebServer(serverOptions);
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      assert.equal(
        (
          await page.request.get(origin + "/api/projects/" + f.project.id)
        ).status(),
        401,
      );
      await page.goto(origin + "/#projects");
      await page.fill("#password", "fake-password");
      await page.click("#login-submit");
      await page.waitForSelector("#app-view:not([hidden])");
      await page
        .locator("#project-cards button")
        .filter({ hasText: f.project.title })
        .click();
      await page.waitForSelector(".project-global");
      assert(
        (await page.textContent(".project-global"))?.includes(
          f.project.objective!,
        ),
      );
      assert.equal(
        (await (await page.request.get(origin + "/api/state")).json())
          .memoriesAvailable,
        false,
      );
      // Global objective editor is an overlay, values persist remotely, project catalogue follows rename.
      await page
        .locator(".project-tracking")
        .getByRole("button", { name: "Modifier", exact: true })
        .first()
        .click();
      await page.fill("#project-plan-title", "Projet suivi");
      await page.fill(
        "#project-plan-objective",
        "Livrer la démonstration complète",
      );
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      await page.waitForSelector("#project-plan-editor:not([open])", {
        state: "attached",
      });
      await page.waitForFunction(() =>
        document
          .querySelector(".project-global")
          ?.textContent?.includes("Livrer la démonstration complète"),
      );
      assert.equal(f.project.title, "Projet suivi");
      const choose = async (id: string, value: string) => {
        await page.evaluate(
          ({ id, value }) => {
            const s = document.getElementById(id) as HTMLSelectElement;
            s.value = value;
            s.dispatchEvent(new Event("change", { bubbles: true }));
          },
          { id, value },
        );
      };
      // Multiple nested objectives and an actionable child step.
      await page
        .locator(".project-tracking")
        .getByRole("button", { name: "Ajouter", exact: true })
        .click();
      await choose("project-plan-kind", "goal");
      await page.fill("#project-plan-title", "Version publique");
      await page.fill(
        "#project-plan-successCriteria",
        "Démonstration vérifiée",
      );
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      await page.waitForSelector(".project-plan-item");
      const goal = [...f.items.values()].find((i) => i.kind === "goal")!;
      await page
        .locator(`[data-item-id="${goal.id}"]`)
        .getByRole("button", { name: "Ajouter une étape", exact: true })
        .click();
      await choose("project-plan-kind", "goal");
      await page.fill("#project-plan-title", "Parcours complet");
      await page.fill("#project-plan-successCriteria", "Résultat vérifié");
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll(".project-plan-item").length === 2,
      );
      const nested = [...f.items.values()].find(
        (i) => i.title === "Parcours complet",
      )!;
      assert.equal(nested.parentId, goal.id);
      await page
        .locator(`[data-item-id="${nested.id}"]`)
        .getByRole("button", { name: "Ajouter une étape", exact: true })
        .click();
      await page.fill("#project-plan-title", "Tester sur mobile");
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll(".project-plan-item").length === 3,
      );
      const task = [...f.items.values()].find((i) => i.kind === "task")!;
      assert.equal(task.parentId, nested.id);
      // No fake completion: remote refusal keeps the edited form. Conflict does not silently overwrite.
      await page
        .locator(`[data-item-id="${nested.id}"]`)
        .getByRole("button", { name: "Modifier", exact: true })
        .click();
      await choose("project-plan-status", "completed");
      await page.fill("#project-plan-evidence", "Parcours fini");
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .getElementById("project-plan-editor-status")
          ?.textContent?.includes("étapes ouvertes"),
      );
      assert.equal(f.items.get(nested.id)?.status, "proposed");
      await page.getByRole("button", { name: "Annuler", exact: true }).click();
      await page
        .locator(`[data-item-id="${task.id}"]`)
        .getByRole("button", { name: "Modifier", exact: true })
        .click();
      await choose("project-plan-status", "done");
      await page.fill("#project-plan-successCriteria", "Mobile utilisable");
      await page.fill(
        "#project-plan-evidence",
        "Parcours Chromium 390px réussi",
      );
      await page.evaluate(() => loadProjects());
      assert.equal(
        await page.inputValue("#project-plan-evidence"),
        "Parcours Chromium 390px réussi",
      );
      assert(
        await page
          .locator("#project-plan-editor")
          .evaluate((e) => e.hasAttribute("open")),
      );
      f.conflict();
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .getElementById("project-plan-editor-status")
          ?.textContent?.includes("modifié ailleurs"),
      );
      assert.equal(
        await page.inputValue("#project-plan-evidence"),
        "Parcours Chromium 390px réussi",
      );
      await page
        .getByRole("button", { name: "Enregistrer", exact: true })
        .click();
      await page.waitForSelector("#project-plan-editor:not([open])", {
        state: "attached",
      });
      assert.equal(f.items.get(task.id)?.status, "done");
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".project-statistics > div")].some(
          (e) =>
            e.textContent?.includes("Étapes") &&
            e.querySelector("strong")?.textContent === "1 / 1",
        ),
      );
      // Page totals are remote and global; older pages are loaded on request.
      for (let n = 0; n < 51; n++)
        await manager.saveItem(f.project.id, {
          kind: "task",
          title: "Étape paginée " + n,
          operationId: randomUUID(),
        });
      await page
        .locator(".project-tracking")
        .getByRole("button", { name: "Actualiser", exact: true })
        .click();
      await page.waitForSelector(
        '.project-tracking button:text-is("Charger la suite")',
      );
      assert.equal(await page.locator(".project-plan-item").count(), 50);
      await page
        .locator(".project-tracking")
        .getByRole("button", { name: "Charger la suite", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelectorAll(".project-plan-item").length === 54,
      );
      const before = f.calls.filter(
        (c) => c.name === "projects_overview",
      ).length;
      await page.waitForTimeout(1100);
      assert.equal(
        f.calls.filter((c) => c.name === "projects_overview").length,
        before,
      );
      await mkdir("docs/qualification/project-tracking", { recursive: true });
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: "instant" }),
        );
        await page.screenshot({
          path: `docs/qualification/project-tracking/plan-${width}.png`,
        });
      }
      await page
        .locator(`[data-item-id="${task.id}"]`)
        .getByRole("button", { name: "Modifier", exact: true })
        .click();
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page
            .locator("#project-plan-editor")
            .evaluate((e) => e.getBoundingClientRect().width <= innerWidth),
        );
      }
      await page.getByRole("button", { name: "Annuler", exact: true }).click();
      serverOptions.memories = app.memories;
      app.memories.list = async () => {
        throw new Error("Synthetic memory outage");
      };
      await page.reload();
      await page
        .locator("#project-cards button")
        .filter({ hasText: f.project.title })
        .waitFor();
      await page
        .locator("#project-cards button")
        .filter({ hasText: f.project.title })
        .click();
      await page.waitForSelector(".project-global");
      assert(
        (await page.textContent(".project-global"))?.includes(
          f.project.objective!,
        ),
      );
      assert.deepEqual(errors, []);
      await writeFile(
        "docs/qualification/project-tracking/browser.json",
        JSON.stringify(
          {
            viewports: [320, 390, 768, 1440],
            memoryRequired: false,
            memoryOutageDoesNotBlockProjects: true,
            hierarchy: true,
            remoteCounts: true,
            completionGuard: true,
            conflictPreservesInputs: true,
            pagination: 54,
            idleRequests: 0,
            jsErrors: errors,
            simulatedBackend: true,
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
