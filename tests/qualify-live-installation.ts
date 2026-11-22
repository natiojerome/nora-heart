/** Opt-in, real installed services + Venice. Never runs in the offline test suite. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    live: { type: "boolean" },
    "venice-key-file": { type: "string" },
    "mcp-env-file": { type: "string" },
    model: { type: "string", default: "deepseek-v4-flash-0731" },
    proof: { type: "string" },
  },
});
assert(
  values.live &&
    values.root &&
    values["venice-key-file"] &&
    values["mcp-env-file"],
  "Explicit --live, disposable --root and private credential file paths required.",
);
const root = path.resolve(values.root),
  identity = JSON.parse(
    await readFile(path.join(root, ".heart/install.json"), "utf8"),
  );
assert.equal(identity.root, root);
assert.match(identity.unit, /^heart-[a-f0-9]{10}$/);
assert(
  root.startsWith("/projects/heart live qa-"),
  "Only explicitly named disposable QA installations are supported.",
);
const secret = JSON.parse(
  await readFile(path.join(root, ".heart/config/secrets.json"), "utf8"),
);
const venice = JSON.parse(
  await readFile(values["venice-key-file"], "utf8"),
).venice;
const keys = parseEnv(await readFile(values["mcp-env-file"], "utf8"));
assert(
  venice &&
    ["MEMORY", "PROJECTS", "VAULT"].every(
      (s) => keys["NORA_MCPS_" + s + "_TOKEN"],
    ),
  "Private configured keys required.",
);
const tag = "HEART-LIVE-QA-" + randomUUID(),
  code = randomUUID(),
  file = "live-check.txt";
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
  errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
let stage = "login",
  csrf = "",
  memoryId: string | undefined,
  baselineMemories = new Set<string>();
let beforeUSD: number | undefined;
let memorySnapshotReady = false;
const report: Record<string, unknown> = {
  passed: false,
  at: new Date().toISOString(),
  tag,
  model: values.model,
  credentials:
    "Explicitly reused private existing keys through onboarding; no account or key created",
  llm: "real Venice, no transport mocks",
};
async function get(url: string) {
  const r = await page.request.get(identity.origin + url);
  assert(r.ok(), "GET " + url + " rejected: " + r.status());
  return r.json();
}
async function post(url: string, data: unknown) {
  const r = await page.request.post(identity.origin + url, {
    headers: { Origin: identity.origin, "x-csrf-token": csrf },
    data,
    timeout: 180000,
  });
  assert(r.ok(), "POST " + url + " rejected: " + r.status());
  return r.json();
}
async function state() {
  const s = await get("/api/state");
  csrf = s.csrf;
  return s;
}
async function choose(selector: string, value: string) {
  await page.locator(selector).evaluate((node, value) => {
    (node as HTMLSelectElement).value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}
async function completed(id: string) {
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    const s = await get("/api/conversations/" + id + "?limit=200");
    if (!["idle", "running"].includes(s.work.status)) {
      const failure = s.events.findLast((e: any) => e.type === "run.failed");
      if (s.work.status !== "completed")
        throw Error(
          "Model turn " +
            s.work.status +
            ": " +
            (failure?.data.error ?? "No public diagnostic"),
        );

      return s;
    }
    await page.waitForTimeout(300);
  }
  throw Error("Model turn timeout");
}
function tools(s: any) {
  return s.events
    .filter((e: any) => e.type === "tool.finished")
    .map((e: any) => ({ name: e.data.name, error: !!e.data.error }));
}
try {
  await page.goto(identity.origin);
  assert.equal(
    await page.evaluate(() => isSecureContext),
    false,
    "Exercise real non-loopback HTTP.",
  );
  await page.fill("#password", secret.password);
  await page.click("#login-submit");
  await page.waitForSelector("#setup-dialog[open]");
  assert.equal((await state()).assistant.version, 0, "Fixture must be unused.");
  stage = "onboarding Venice";
  await page.fill("#setup-name", "Iris Live QA");
  await page.click("#setup-next");
  await page.click("#setup-next");
  await page.click("#setup-next");
  await page
    .getByRole("button", { name: "Connecter un fournisseur", exact: true })
    .click();
  await page.click('[data-configure-provider="venice"]');
  await page.fill("#api-key", venice);
  await page.click("#save-api-key");
  await page.waitForSelector("#setup-dialog[open]");
  const catalog = await get("/api/models?provider=venice"),
    model = catalog.models.find((m: any) => m.id === values.model);
  assert(
    model?.supportsTools &&
      model.pricing?.input <= 0.2 &&
      model.pricing?.output <= 0.5,
    "Select an inexpensive live model with tool calling.",
  );
  report.pricingUSDPerMillion = model.pricing;
  const usageBefore = await get(
    "/api/provider-usage?provider=venice&modelId=" +
      encodeURIComponent(values.model!) +
      "&refresh=1",
  );
  beforeUSD = usageBefore.balance?.remaining;
  report.usageAvailable = usageBefore.status === "available";
  report.usageMessage = usageBefore.message;
  report.initialUSDBalance = beforeUSD;
  await page
    .getByRole("button", { name: "Choisir le modèle et l’effort", exact: true })
    .click();
  await choose("#defaults-provider", "venice");
  await page.waitForFunction(
    (modelId) =>
      Array.from(
        document.querySelector<HTMLSelectElement>("#defaults-model")!.options,
      ).some((o) => o.value === modelId),
    values.model,
  );
  await choose("#defaults-model", values.model!);
  if (model.reasoningEfforts?.includes("none"))
    await choose("#defaults-effort", "none");
  await page.click("#save-defaults");
  await page.waitForSelector("#setup-dialog[open]");
  await page
    .getByRole("button", { name: "Utiliser Venice AI · API", exact: true })
    .click();
  stage = "onboarding real MCP";
  await page.waitForSelector("#install-services-connect");
  for (const service of ["memory", "projects", "vault"])
    await page.fill(
      "#install-key-" + service,
      keys["NORA_MCPS_" + service.toUpperCase() + "_TOKEN"]!,
    );
  await page.click("#install-services-connect");
  await page.waitForFunction(
    () =>
      document.querySelector("#install-services-connect") &&
      !document
        .querySelector("#install-services-connect")!
        .hasAttribute("disabled"),
    {},
    { timeout: 60000 },
  );
  assert.equal((await state()).installation.ready, true);
  await page.click("#setup-next");
  await page.waitForSelector("#setup-dialog:not([open])", {
    state: "attached",
  });
  const ready = await state();
  assert(ready.assistant.settings.completed);
  assert.equal(
    ready.assistant.settings.conversationDefaults.selection.modelId,
    values.model,
  );
  assert.deepEqual(ready.installation.services, [
    "memory",
    "projects",
    "vault",
  ]);
  report.onboarding = true;
  const memories = await get("/api/memories");
  baselineMemories = new Set(memories.memories.map((m: any) => m.id));
  memorySnapshotReady = true;
  const connections = await get("/api/external-tools");
  const projects = connections.connections.find(
    (c: any) => c.label === "Services · projects",
  );
  assert(projects?.tools.some((t: any) => t.name === "projects_search"));
  report.realServices = ready.installation.services;
  stage = "real model local and remote tools";
  const { conversation } = await post("/api/conversations", { title: tag });
  await post("/api/conversations/" + conversation.id + "/file-access", {
    access: "develop",
  });
  await post("/api/conversations/" + conversation.id + "/execution-policy", {
    network: true,
    maxSteps: 8,
  });
  await page.goto(
    identity.origin + "/?conversation=" + conversation.id + "#conversations",
  );
  await page.waitForSelector("#conversation-prompt", { state: "visible" });
  await page.fill(
    "#conversation-prompt",
    `Test technique autorisé. Exécute réellement ces actions, sans formulaire : 1. Avec files.create crée ${file} contenant exactement ${tag}. 2. Avec files.read relis ce fichier. 3. Avec terminal.start exécute node --version et vérifie sa sortie. 4. Via l'outil MCP projects_search recherche ${tag} (aucune création de projet). 5. Avec memory.remember enregistre ce seul souvenir de test : titre "${tag}", contenu "Le code de contrôle technique de ${tag} est ${code}.", kind fact, scope personal. Je demande explicitement sa mémorisation ; aucune autre info n'est à mémoriser. Ne consulte aucun secret du coffre. Réponds ensuite en une phrase avec les résultats réels.`,
  );
  await page.click("#conversation-submit");
  const result = await completed(conversation.id),
    executed = tools(result);
  report.executedTools = executed;
  assert(
    executed.every((t: any) => !t.error),
    "A real tool failed.",
  );
  for (const required of [
    "files.create",
    "files.read",
    "terminal.start",
    "memory.remember",
  ])
    assert(
      executed.some((t: any) => t.name === required),
      "Missing tool " + required,
    );
  assert(
    executed.some((t: any) => t.name.includes("projects_search")),
    "Real projects MCP was not invoked.",
  );
  const disk = await readFile(path.join(result.workspaceRoot, file), "utf8");
  assert.equal(disk, tag);
  report.modelFileVerified = true;
  const afterMemory = await get("/api/memories");
  const memory = afterMemory.memories.find(
    (m: any) => !baselineMemories.has(m.id) && m.content.includes(code),
  );
  assert(memory, "Remote memory not visible through Heart.");
  memoryId = memory.id;
  report.remoteMemoryCreated = true;
  stage = "restart and new conversation recall";
  execFileSync("systemctl", ["restart", identity.unit + "-web.service"]);
  for (let n = 0; n < 100; n++) {
    try {
      const r = await page.request.get(identity.origin + "/healthz");
      if (r.ok()) break;
    } catch {}
    await page.waitForTimeout(200);
  }
  await page.reload();
  await page.waitForSelector("#app-view:not([hidden])");
  const afterRestart = await state();
  assert(afterRestart.installation.ready);
  assert.equal(
    afterRestart.assistant.settings.conversationDefaults.selection.modelId,
    values.model,
  );
  const { conversation: next } = await post("/api/conversations", {
    title: tag + " recall",
  });
  await post("/api/conversations/" + next.id + "/execution-policy", {
    network: true,
    maxSteps: 4,
  });
  await page.goto(
    identity.origin + "/?conversation=" + next.id + "#conversations",
  );
  await page.waitForSelector("#conversation-prompt", { state: "visible" });
  await page.fill(
    "#conversation-prompt",
    `Utilise memory.search avec ${tag} pour retrouver le code de contrôle technique enregistré. Réponds uniquement par le code exact trouvé. Ne crée/modifie aucun souvenir ni fichier.`,
  );
  await page.click("#conversation-submit");
  const recalled = await completed(next.id);
  assert(
    tools(recalled).some((t: any) => t.name === "memory.search" && !t.error),
  );
  assert(
    recalled.events.some(
      (e: any) =>
        e.type === "message" &&
        e.data.role === "assistant" &&
        !e.data.toolCalls?.length &&
        e.data.content.includes(code),
    ),
    "Code not recalled in the independent conversation.",
  );
  report.newConversationRecallAfterRestart = true;
  report.recallTools = tools(recalled);
  const afterUsage = await get(
    "/api/provider-usage?provider=venice&modelId=" +
      encodeURIComponent(values.model!) +
      "&refresh=1",
  );
  if (beforeUSD !== undefined && afterUsage.balance?.remaining !== undefined)
    report.sharedAccountUSDDecrease = beforeUSD - afterUsage.balance.remaining;
  assert.deepEqual(errors, []);
  report.jsErrors = errors;
  report.passed = true;
} catch (error) {
  report.failedStage = stage;
  report.diagnostic =
    error instanceof Error ? error.message : "Qualification failed";
  process.exitCode = 1;
} finally {
  // Delete only synthetic memories absent from the initial snapshot and carrying our unique marker.
  try {
    if (memorySnapshotReady) {
      const current = await get("/api/memories");
      const synthetic = current.memories.filter(
        (m: any) =>
          !baselineMemories.has(m.id) &&
          (m.id === memoryId ||
            m.title.includes(tag) ||
            m.content.includes(tag)),
      );
      for (const m of synthetic)
        await post("/api/memories/" + m.id + "/status", {
          version: m.version,
          status: "forgotten",
        });
      const after = await get("/api/memories");
      assert(
        !after.memories.some(
          (m: any) =>
            synthetic.some((q: any) => q.id === m.id) && m.status === "active",
        ),
      );
      report.syntheticMemoryRemoved = synthetic.length;
    }
  } catch {
    report.cleanupFailed = true;
    process.exitCode = 1;
  }
  if (beforeUSD !== undefined) {
    try {
      const usage = await get(
        "/api/provider-usage?provider=venice&modelId=" +
          encodeURIComponent(values.model!) +
          "&refresh=1",
      );
      if (usage.balance?.remaining !== undefined)
        report.sharedAccountUSDDecrease = beforeUSD - usage.balance.remaining;
    } catch {}
  }
  await browser.close();
  let serialized = JSON.stringify(report, null, 2);
  for (const value of [
    venice,
    secret.password,
    secret.session,
    secret.postgres,
    ...Object.values(keys),
  ])
    if (typeof value === "string" && value.length >= 8)
      serialized = serialized.replaceAll(value, "[redacted]");
  if (values.proof) {
    await mkdir(values.proof, { recursive: true });
    await writeFile(
      path.join(values.proof, "live-installation.json"),
      serialized,
    );
  }
  console.log(serialized);
}
