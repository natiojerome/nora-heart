import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Installation, loadInstallation } from "../src/app/installation.ts";
import type {
  ExternalToolConnection,
  ExternalToolRepository,
  ConnectExternalTools,
} from "../src/contracts/external-tools.ts";
function repository(): ExternalToolRepository {
  const values = new Map<string, ExternalToolConnection>();
  return {
    async get(id) {
      return structuredClone(values.get(id) ?? null);
    },
    async list() {
      return [...values.values()].map((c) => structuredClone(c));
    },
    async save(value, version) {
      assert.equal(values.get(value.id)?.version ?? 0, version);
      const next = { ...value, version: version + 1 };
      values.set(value.id, structuredClone(next));
      return next;
    },
  };
}
const definitions = [
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
].map((name) => ({
  name,
  description: name,
  inputSchema: { type: "object" },
  readOnlyHint: true,
}));
const connect: ConnectExternalTools = async () => ({
  definitions,
  async call() {
    return "{}";
  },
  async close() {},
});
test("installer MCP onboarding stores private keys separately from catalogue and survives reload", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "heart-install-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "installation.json"),
    repo = repository(),
    installation = new Installation(file, repo, connect);
  assert.deepEqual((await installation.status()).services, []);
  await installation.configure({
    memory: {
      url: "https://example.com/memory",
      token: "synthetic-memory-secret",
    },
    projects: {
      url: "https://example.com/projects",
      token: "synthetic-projects-secret",
    },
    vault: {
      url: "https://example.com/vault",
      token: "synthetic-vault-secret",
    },
  });
  const saved = await loadInstallation(file);
  assert.equal(saved.env.HEART_MCP_MEMORY_TOKEN, "synthetic-memory-secret");
  assert.match(saved.env.HARNESS_MEMORY_MCP_CONNECTION_ID, /^[0-9a-f-]{36}$/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(process.env.HEART_MCP_MEMORY_TOKEN, undefined);
  assert(
    !JSON.stringify(await repo.list()).includes("synthetic-memory-secret"),
  );
  assert(
    !JSON.stringify(await installation.status()).includes(
      "synthetic-vault-secret",
    ),
  );
  assert.equal((await installation.status()).ready, false);
  const reloaded = new Installation(file, repo, connect);
  assert.deepEqual((await reloaded.status()).services, [
    "memory",
    "projects",
    "vault",
  ]);
  await reloaded.configure({
    memory: {
      url: "https://example.com/memory",
      token: "new-synthetic-memory-secret",
    },
  });
  assert.equal(
    (await loadInstallation(file)).env.HARNESS_MEMORY_MCP_CONNECTION_ID,
    saved.env.HARNESS_MEMORY_MCP_CONNECTION_ID,
  );
  assert.notEqual((await loadInstallation(file)).revision, saved.revision);
  assert.equal((await repo.list()).length, 3);
});
test("wrong/incompatible services never persist credentials or bindings; configuration parser rejects foreign environment keys", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "heart-install-reject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "installation.json"),
    repo = repository();
  const invalid = new Installation(file, repo, async () => ({
    definitions: [],
    async call() {
      return "{}";
    },
    async close() {},
  }));
  await assert.rejects(
    invalid.configure({
      memory: { url: "https://example.com", token: "synthetic" },
    }),
    /incompatible/,
  );
  assert.equal((await repo.list()).length, 0);
  assert.equal(
    (await loadInstallation(file)).env.HEART_MCP_MEMORY_TOKEN,
    undefined,
  );
  await assert.rejects(
    invalid.configure({
      memory: { url: "http://example.com", token: "synthetic" },
    }),
  );
  await writeFile(
    file,
    JSON.stringify({ version: 1, env: { PATH: "/untrusted" } }),
  );
  await assert.rejects(loadInstallation(file), /invalide/);
});
test("simultaneous onboarding submissions cannot overlap and a failed connection is recoverable", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "heart-install-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let release!: () => void;
  const waiting = new Promise<void>((r) => (release = r));
  let first = true;
  const installation = new Installation(
    path.join(root, "installation.json"),
    repository(),
    async () => {
      if (first) {
        first = false;
        await waiting;
        throw Error("Synthetic transport failure");
      }
      return connect({} as any);
    },
  );
  const pending = installation.configure({
    vault: { url: "https://example.com/vault", token: "synthetic" },
  });
  await assert.rejects(installation.configure({}), /cours/);
  release();
  await assert.rejects(pending);
  await installation.configure({
    vault: { url: "https://example.com/vault", token: "synthetic" },
  });
  assert.deepEqual((await installation.status()).services, ["vault"]);
});

test("account login keeps device/service secrets out of browser state, binds one owner and reuses local keys on next login", async (t) => {
  const { AccountLogin } = await import("../src/app/account-login.ts");
  const root = await mkdtemp(path.join(tmpdir(), "heart-account-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const installation = new Installation(
    path.join(root, "installation.json"),
    repository(),
    connect,
  );
  let approved = false,
    other = false,
    bootstrap = 0,
    polls = 0;
  const owner = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner@example.test",
  };
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/oauth/device_authorization")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("client_id"), "nora-heart");
      return Response.json({
        device_code: "private-device-capability",
        user_code: "ABCDE12345",
        verification_uri_complete:
          "https://mcps.test/connect?user_code=ABCDE12345",
        expires_in: 600,
        interval: 5,
      });
    }
    if (url.endsWith("/oauth/token")) {
      polls++;
      if (!approved)
        return Response.json(
          { error: "authorization_pending" },
          { status: 400 },
        );
      return Response.json({
        access_token: "private-access-capability",
        account: other
          ? { ...owner, id: "00000000-0000-4000-8000-000000000002" }
          : owner,
      });
    }
    bootstrap++;
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer private-access-capability",
    );
    return Response.json({
      account: owner,
      services: Object.fromEntries(
        ["memory", "projects", "vault"].map((s) => [
          s,
          { url: "https://mcps.test/" + s, token: "private-key-" + s },
        ]),
      ),
    });
  };
  const login = new AccountLogin(
    installation,
    "00000000-0000-4000-8000-000000000003",
    "https://mcps.test",
    transport,
  );
  const flow = await login.start("register");
  assert.equal(new URL(flow.url).searchParams.get("screen_hint"), "signup");
  assert(!JSON.stringify(flow).includes("private-device"));
  assert((await login.poll(flow.flowId)).pending);
  assert((await login.poll(flow.flowId)).pending);
  assert.equal(polls, 1, "Enforce polling interval locally.");
  approved = true;
  const next = await login.start();
  const result = await login.poll(next.flowId);
  assert(!result.pending);
  assert.equal(result.account!.id, owner.id);
  assert.equal(bootstrap, 1);
  assert(!JSON.stringify(result).includes("private-key"));
  const saved = await loadInstallation(path.join(root, "installation.json"));
  assert.equal(saved.account!.id, owner.id);
  assert.equal(saved.env.HEART_MCP_MEMORY_TOKEN, "private-key-memory");
  await assert.rejects(login.start("register"), /déjà liée/);
  const repeated = await login.start();
  assert.equal(new URL(repeated.url).searchParams.get("screen_hint"), null);
  assert.equal((await login.poll(repeated.flowId)).restartRequired, false);
  assert.equal(bootstrap, 1, "Normal login does not rotate service keys.");
  other = true;
  const wrong = await login.start();
  await assert.rejects(login.poll(wrong.flowId), /propriétaire/);
  assert.equal(
    bootstrap,
    1,
    "Wrong owner never provisions keys or changes local authority.",
  );
});
