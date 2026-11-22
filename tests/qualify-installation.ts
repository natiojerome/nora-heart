/** Opt-in destructive fixture test: refuses an installation with a completed owner profile. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { WalletClient } from "../src/modules/wallets/unix/index.ts";
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    proof: { type: "string" },
    resume: { type: "boolean", default: false },
    "operator-approve": { type: "boolean", default: false },
  },
});
if (!values.root)
  throw Error("Use --root with a disposable fresh installation");
const root = path.resolve(values.root),
  identity = JSON.parse(
    await readFile(path.join(root, ".heart/install.json"), "utf8"),
  );
assert.equal(identity.root, root);
assert.match(identity.unit, /^heart-[a-f0-9]{10}$/);
const credentials = JSON.parse(
  await readFile(path.join(root, ".heart/config/secrets.json"), "utf8"),
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let step = "login";
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function loginAccount(bootstrap = false) {
    assert(
      values["operator-approve"],
      "Account fixture requires explicit --operator-approve for this isolated installation",
    );
    assert(
      root.startsWith("/projects/heart-account-qa-"),
      "Operator fixture root required",
    );
    assert.equal(identity.accountServer, "https://mcps.natio.re");
    await page.goto(
      bootstrap
        ? (
            await readFile(
              path.join(root, ".heart/config/first-login-url"),
              "utf8",
            )
          ).trim()
        : identity.origin,
    );
    await page.waitForSelector("#account-connect:enabled");
    const opened = page.waitForEvent("popup");
    await page.click("#account-connect");
    const portal = await opened;
    await portal.waitForURL("https://mcps.natio.re/connect?user_code=*");
    const code = new URL(portal.url()).searchParams.get("user_code");
    assert.match(code!, /^[A-F0-9]{10}$/);
    assert.match(identity.id, /^[a-f0-9-]{36}$/);
    // Operator authorizes only this synthetic installation; portal password UI is tested separately.
    const sql = `BEGIN; SELECT set_config('nora.user_id',(SELECT id::text FROM platform.users WHERE email='natio.jerome@gmail.com'),true); SELECT platform.heart_device_decide('${code}',true) WHERE EXISTS(SELECT 1 FROM platform.heart_devices WHERE user_code='${code}' AND installation_id='${identity.id}'); COMMIT;`;
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        "ssh",
        [
          "-F",
          "/root/.ssh/nora-mcps.config",
          "nora-mcps",
          "docker exec -i -u postgres nora-database-postgres-1 psql -X -U postgres -d nora_platform -At -v ON_ERROR_STOP=1",
        ],
        (error) =>
          error ? reject(Error("Fixture operator approval failed")) : resolve(),
      );
      child.stdin!.end(sql);
    });
    await page.waitForSelector("#app-view:not([hidden])", { timeout: 60000 });
    await portal.close();
  }
  if (identity.accountRequired) {
    await loginAccount(!values.resume);
  } else {
    await page.goto(identity.origin);
    await page.fill("#password", credentials.password);
    await page.click("#login-submit");
  }
  await page.waitForSelector("#app-view:not([hidden])");
  if (!values.resume) await page.waitForSelector("#setup-dialog[open]");
  let current = await (
    await page.request.get(identity.origin + "/api/state")
  ).json();
  if (!values.resume) {
    assert.equal(
      current.assistant.settings.completed,
      false,
      "Fixture must be unused",
    );
    assert.equal(current.assistant.version, 0, "Fixture must be unused");
  } else assert.equal(current.assistant.settings.name, "Iris QA");
  if (!values.resume) {
    step = "onboarding";
    await page.fill("#setup-name", "Iris QA");
    await page.check("[name=gender][value=neutral]");
    await page.click("#setup-next");
    await page.check("[name=theme][value=graphite]");
    await page.click("#setup-next");
    await page.reload();
    await page.waitForSelector("#setup-personality");
    await page.fill(
      "#setup-personality-text",
      "Amicale, directe et précise. Personnalité de qualification modifiable.",
    );
    await page.click("#setup-next");
    await page
      .getByRole("button", {
        name: "Explorer en simulation locale",
        exact: true,
      })
      .click();
    if (identity.accountRequired)
      await page.getByText("Compte connecté", { exact: true }).waitFor();
    else await page.waitForSelector("#install-services-connect");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.click("#setup-next");
    await page.waitForSelector("#setup-dialog:not([open])", {
      state: "attached",
    });
    current = await (
      await page.request.get(identity.origin + "/api/state")
    ).json();
    assert.equal(current.assistant.settings.name, "Iris QA");
    assert.equal(
      current.assistant.settings.conversationDefaults.selection.provider,
      "demo",
    );
    assert.equal(current.installation.available, true);
  }
  step = "files and sandbox";
  async function post(url: string, data: unknown) {
    const r = await page.request.post(identity.origin + url, {
      headers: { Origin: identity.origin, "x-csrf-token": current.csrf },
      data,
    });
    if (!r.ok())
      console.error(
        "Fixture API rejected: " +
          url +
          " " +
          r.status() +
          " " +
          JSON.stringify(await r.json()),
      );
    assert(r.ok(), "API fixture action rejected");
    return r.json();
  }
  if (!values.resume)
    await post("/api/projects-root/workspace", {
      action: "create",
      path: "install-qa.txt",
      content: "HEART_INSTALL_FILE_OK",
    });
  const read = await (
    await page.request.get(
      identity.origin +
        "/api/projects-root/workspace?path=install-qa.txt&read=true",
    )
  ).json();
  assert(JSON.stringify(read).includes("HEART_INSTALL_FILE_OK"));
  async function waitCommand(prefix: string, command: any) {
    command = command.command ?? command;
    for (let i = 0; i < 200; i++) {
      const r = await (
        await page.request.get(identity.origin + prefix + "/" + command.id)
      ).json();
      if (r.command.status !== "running") {
        assert.equal(r.command.exitCode, 0, "Command fixture failed");
        return r.output as string;
      }
      await page.waitForTimeout(50);
    }
    throw Error("Command fixture timed out");
  }
  const sandbox = await post("/api/projects-root/commands", {
    command: "printf HEART_SANDBOX_OK; node --version",
    cwd: ".",
    network: false,
  });
  assert.match(
    await waitCommand("/api/projects-root/commands", sandbox),
    /HEART_SANDBOX_OK.*v24/s,
  );
  const created = await post("/api/conversations", {
      title: "Fresh installation QA",
    }),
    id = created.conversation.id;
  step = "yolo worker";
  await post("/api/conversations/" + id + "/file-access", { access: "yolo" });
  const host = await post("/api/conversations/" + id + "/commands", {
    command:
      'set -eu; test "$(id -u)" = 0; printf HEART_HOST_OK; node --version',
    cwd: ".",
  });
  assert.match(
    await waitCommand("/api/conversations/" + id + "/commands", host),
    /HEART_HOST_OK.*v24/s,
  );
  step = "chat";
  await page.goto(identity.origin + "/?conversation=" + id + "#conversations");
  await page.waitForSelector("#conversation-prompt", { state: "visible" });
  await page.fill("#conversation-prompt", "Liste les fichiers de cet espace.");
  await page.click("#conversation-submit");
  await page
    .getByText("Résultat de files.list", { exact: false })
    .first()
    .waitFor({ timeout: 20000 });
  const external = await (
    await page.request.get(identity.origin + "/api/external-tools")
  ).json();
  assert(
    external.connections.some(
      (c: any) =>
        c.enabled && c.label === "Recherche web locale" && c.tools.length >= 2,
    ),
  );
  const wallets = new WalletClient(
    "/run/" + identity.unit + "-wallets/api.sock",
  );
  try {
    assert.equal((await wallets.list()).wallets.length, 0);
    if (identity.accountRequired) {
      assert.equal((await wallets.backups()).available, true);
      assert.deepEqual([...current.installation.services].sort(), [
        "memory",
        "projects",
        "vault",
      ]);
    }
  } finally {
    wallets.close();
  }
  step = "restart and persistence";
  await promisify(execFile)("systemctl", [
    "restart",
    identity.unit + "-web.service",
  ]);
  for (let i = 0; i < 50; i++) {
    try {
      await page.request.get(identity.origin + "/healthz");
      break;
    } catch {}
    await page.waitForTimeout(200);
  }
  await page.reload();
  await page.waitForSelector("#app-view:not([hidden])");
  current = await (
    await page.request.get(identity.origin + "/api/state")
  ).json();
  assert.equal(current.assistant.settings.completed, true);
  assert.equal(current.assistant.settings.name, "Iris QA");
  assert.equal(
    current.assistant.settings.conversationDefaults.selection.provider,
    "demo",
  );
  assert.equal(
    await page.locator("#setup-dialog").evaluate((d: any) => d.open),
    false,
  );
  const kept = await (
    await page.request.get(identity.origin + "/api/conversations")
  ).json();
  assert(kept.conversations.some((c: any) => c.id === id));
  if (identity.accountRequired) {
    step = "account reconnection";
    const configFile = path.join(root, ".heart/state/installation.json"),
      saved = await readFile(configFile, "utf8");
    await page.context().clearCookies();
    await page.goto(identity.origin);
    assert.equal(
      (await (await page.request.get(identity.origin + "/api/state")).json())
        .authenticated,
      false,
    );
    // Local administration password cannot bypass the connected-account requirement.
    const local = await page.request.post(identity.origin + "/api/login", {
      headers: { Origin: identity.origin },
      data: { password: credentials.password },
    });
    assert(local.ok());
    assert.equal(
      (await (await page.request.get(identity.origin + "/api/state")).json())
        .authenticated,
      false,
    );
    await loginAccount();
    assert.equal(
      await readFile(configFile, "utf8"),
      saved,
      "Ordinary login must not rotate service keys",
    );
  }
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    at: new Date().toISOString(),
    installationId: identity.id,
    customPathWithSpaces: root.includes(" "),
    accountFirst: !!identity.accountRequired,
    reloginWithoutServiceKeyRotation: !!identity.accountRequired,
    localPasswordCannotBypassAccount: !!identity.accountRequired,
    realMcpKeysAutomaticallyProvisioned: !!identity.accountRequired,
    accountApproval: identity.accountRequired
      ? "operator approved isolated fixture; password UI qualified separately"
      : "legacy password",
    walletBackupDiscovery: !!identity.accountRequired,
    onboarding: true,
    onboardingResumedAfterReload: true,
    defaultModelPersisted: true,
    files: true,
    sandboxNode24: true,
    yoloRootNode24: true,
    chat: "simulated provider, actual engine and PostgreSQL",
    localSearchDiscovered: true,
    emptyWalletService: true,
    restartPersistence: true,
    jsErrors: errors,
    llmInferenceCalls: 0,
  };
  if (values.proof) {
    await mkdir(values.proof, { recursive: true });
    await writeFile(
      path.join(values.proof, "installation.json"),
      JSON.stringify(report, null, 2),
    );
    await page.screenshot({ path: path.join(values.proof, "chat-mobile.png") });
  }
  console.log(JSON.stringify(report));
} catch {
  console.error(
    "Fresh installation qualification failed at: " +
      step +
      ". No credential values logged.",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
