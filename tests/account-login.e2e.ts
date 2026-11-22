/** Browser-only account-first journey; the portal SQL protocol is qualified separately on PostgreSQL. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess } from "../src/app/web-access.ts";
import { openWebConversations } from "../src/app/web-conversations.ts";
import { Installation, loadInstallation } from "../src/app/installation.ts";
import { AccountLogin } from "../src/app/account-login.ts";
import type {
  ExternalToolRepository,
  ExternalToolConnection,
} from "../src/contracts/external-tools.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";
import { migrateSqlite } from "../src/modules/storage/sqlite/index.ts";

test(
  "mobile first connection uses portal approval, keeps service keys server-side and opens setup only for the bound account",
  { timeout: 35000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "heart-account-ui-")),
      file = path.join(root, "test.sqlite"),
      privateFile = path.join(root, "installation.json"),
      inviteFile = path.join(root, "invite.json"),
      before = process.env.HARNESS_INSTALL_REVISION;
    await migrateSqlite(file);
    await writeFile(
      inviteFile,
      JSON.stringify({
        hash: createHash("sha256").update("synthetic-bootstrap").digest("hex"),
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
      { mode: 0o600 },
    );
    const lab = new TestLab({
      directory: path.join(root, "lab"),
      authDirectory: path.join(root, "auth"),
    });
    await lab.prepare();
    const app = await openWebConversations(
      { driver: "sqlite", file },
      path.join(root, "state"),
      lab,
    );
    let approved = false,
      portalOrigin = "";
    const owner = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "owner@example.test",
    };
    const portal = createServer(async (req, res) => {
      if (req.url?.startsWith("/connect")) {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<form method="POST" action="/approve"><h1>Connecter Heart</h1><p>Code MATCH1234</p><button>Connecter</button></form>',
        );
        return;
      }
      if (req.url === "/approve") {
        approved = true;
        res.end("Vous pouvez revenir dans Heart.");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/oauth/device_authorization") {
        res.end(
          JSON.stringify({
            device_code: "private-device-secret",
            user_code: "MATCH1234",
            verification_uri_complete:
              portalOrigin + "/connect?user_code=MATCH1234",
            expires_in: 600,
            interval: 5,
          }),
        );
        return;
      }
      if (req.url === "/oauth/token") {
        if (!approved) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "authorization_pending" }));
        } else
          res.end(
            JSON.stringify({
              access_token: "private-access-secret",
              account: owner,
            }),
          );
        return;
      }
      if (req.url === "/api/heart/bootstrap") {
        assert.equal(req.headers.authorization, "Bearer private-access-secret");
        res.end(
          JSON.stringify({
            account: owner,
            services: Object.fromEntries(
              ["memory", "projects", "vault"].map((s) => [
                s,
                {
                  url: "https://mcps.test/" + s,
                  token: "private-" + s + "-key",
                },
              ]),
            ),
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((r) => portal.listen(0, "127.0.0.1", r));
    portalOrigin = "http://127.0.0.1:" + (portal.address() as any).port;
    const values = new Map<string, ExternalToolConnection>(),
      repo: ExternalToolRepository = {
        async list() {
          return [...values.values()];
        },
        async get(id) {
          return values.get(id) ?? null;
        },
        async save(value, version) {
          const next = { ...value, version: version + 1 };
          values.set(value.id, next);
          return next;
        },
      };
    const names = [
      "memory_search",
      "memory_get",
      "memory_create",
      "memory_update",
      "memory_forget",
      "memory_revisions",
      "projects_search",
      "projects_get",
      "projects_create",
      "vault_create",
      "vault_read",
    ];
    const installation = new Installation(privateFile, repo, async () => ({
      definitions: names.map((name) => ({
        name,
        description: name,
        inputSchema: { type: "object" },
        readOnlyHint: true,
      })),
      async call() {
        return "{}";
      },
      async close() {},
    }));
    const login = new AccountLogin(
      installation,
      "00000000-0000-4000-8000-000000000003",
      portalOrigin,
    );
    const reservation = createServer();
    await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
    const port = (reservation.address() as any).port;
    await new Promise<void>((r) => reservation.close(() => r()));
    const origin = "http://127.0.0.1:" + port;
    const server = createWebServer({
      origin,
      access: new WebAccess({
        secret: "synthetic-session-secret-at-least-32-chars",
        password: "synthetic-password",
        inviteFile,
      }),
      lab,
      ...app,
      installation,
      accountLogin: login,
      accountRequired: true,
      restart: () => {
        void loadInstallation(privateFile).then((saved) => {
          process.env.HARNESS_INSTALL_REVISION = saved.revision!;
        });
      },
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage({
          viewport: { width: 390, height: 844 },
        }),
        errors: string[] = [],
        responses: any[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.url().includes("/api/account/"))
          void r
            .json()
            .then((data) => responses.push(data))
            .catch(() => {});
      });
      const blocked = await page.request.post(origin + "/api/account/start", {
        headers: { Origin: origin },
        data: {},
      });
      assert.equal(blocked.status(), 403);
      await page.goto(origin + "/#invite=synthetic-bootstrap");
      await page.waitForSelector("#account-connect:not([disabled])");
      assert(await page.locator("#login-form").isHidden());
      assert(!page.url().includes("synthetic-bootstrap"));
      const state = await (
        await page.request.get(origin + "/api/state")
      ).json();
      assert.equal(state.authenticated, false);
      assert(state.accountLogin.bootstrapReady);
      const forbidden = await page.request.post(
        origin + "/api/projects-root/commands",
        { headers: { Origin: origin }, data: { command: "node --version" } },
      );
      assert.equal(forbidden.status(), 401);
      const popupPromise = page.waitForEvent("popup");
      await page.click("#account-connect");
      const popup = await popupPromise;
      await popup
        .getByRole("button", { name: "Connecter", exact: true })
        .click();
      await page.waitForSelector("#setup-dialog[open]", { timeout: 20000 });
      const ready = await (
        await page.request.get(origin + "/api/state")
      ).json();
      assert(ready.authenticated && ready.installation.ready);
      assert.equal(ready.installation.account.id, owner.id);
      assert.equal(ready.installation.services.length, 3);
      assert.equal(
        (await loadInstallation(privateFile)).env.HEART_MCP_MEMORY_TOKEN,
        "private-memory-key",
      );
      assert(!JSON.stringify(responses).includes("private-"));
      assert.deepEqual(errors, []);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    } finally {
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      portal.closeAllConnections();
      await new Promise<void>((r) => portal.close(() => r()));
      await app.close();
      await lab.close();
      if (before === undefined) delete process.env.HARNESS_INSTALL_REVISION;
      else process.env.HARNESS_INSTALL_REVISION = before;
      await rm(root, { recursive: true, force: true });
    }
  },
);
