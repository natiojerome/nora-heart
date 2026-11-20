import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ChatGptAuth } from "../src/modules/models/chatgpt/index.ts";

const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const clientId = "oaiapp_test_registration";
const fakeAccount = { clientId, subject: "test-user", accessToken: "fake-old", refreshToken: "fake-refresh",
  expiresAt: 0, scopes: scopes.split(" ") };

async function port() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const result = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return result;
}

async function browser(auth: ChatGptAuth, inspect: (url: URL) => void = () => {}) {
  let resolveReady!: (url: string) => void, rejectReady!: (error: unknown) => void;
  const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const controller = new AbortController();
  const selectedPort = await port();
  const pending = auth.login({ appName: "Nora Heart", port: selectedPort, signal: controller.signal, onReady: resolveReady });
  void pending.catch(rejectReady);
  try {
    const entry = await ready;
    const page = await fetch(entry);
    assert.equal(page.headers.get("cache-control"), "no-store");
    const html = await page.text();
    const href = html.match(/href="([^"]+)"/)![1].replaceAll("&amp;", "&");
    const authorize = new URL(href);
    inspect(authorize);
    // A malicious callback must not consume the legitimate attempt or crash it.
    assert.equal((await fetch(new URL("/", entry))).status, 404);
    const invalid = new URL("/auth/callback", entry);
    invalid.searchParams.set("state", "é".repeat(43));
    assert.equal((await fetch(invalid)).status, 400);
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ state: authorize.searchParams.get("state")!, code: "fake-code", client_id: clientId }).toString();
    const response = await fetch(callback);
    await response.text();
    return await pending;
  } catch (error) {
    controller.abort();
    await pending.catch(() => undefined);
    throw error;
  }
}

test("ChatGPT OAuth validates PKCE and signed identity, persists host and reuses registrations", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-oauth-"));
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test", alg: "RS256", use: "sig" };
  let nonce = "", challenge = "", callback = "";
  const hosts: string[] = [];
  let registration = 0;
  const auth = new ChatGptAuth({ directory, fetch: async (url, init) => {
    if (String(url).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    assert.equal(String(url), "https://auth.openai.com/api/accounts/oauth/token");
    assert.equal(init?.redirect, "error");
    const body = init!.body as URLSearchParams;
    assert.equal(body.get("client_id"), clientId);
    assert.equal(body.get("redirect_uri"), callback);
    assert.equal(body.get("resource"), "https://api.openai.com/v1");
    const { createHash } = await import("node:crypto");
    assert.equal(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"), challenge);
    const identity = await new SignJWT({ nonce, email: "test@example.invalid" }).setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://auth.openai.com").setAudience(clientId).setSubject("test-user").setIssuedAt().setExpirationTime("1h").sign(privateKey);
    return Response.json({ access_token: "fake-access", refresh_token: "fake-refresh", id_token: identity,
      token_type: "Bearer", expires_in: 3600, scope: scopes });
  } });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await browser(auth, url => {
        hosts.push(url.searchParams.get("ext_agent_host_id")!);
        nonce = url.searchParams.get("nonce")!;
        challenge = url.searchParams.get("code_challenge")!;
        callback = url.searchParams.get("redirect_uri")!;
        assert.equal(url.origin, "https://auth.openai.com");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.equal(url.searchParams.get("client_id"), i ? clientId : "dynamic_agent_client");
        assert.equal(url.searchParams.has("agent_name_hint"), !i);
        registration++;
      });
      assert.equal(result.connected, true);
      assert.equal(result.email, "test@example.invalid");
      assert.equal(JSON.stringify(result).includes("fake-access"), false);
    }
    assert.equal(registration, 2);
    assert.equal(hosts[0], hosts[1]);
    assert.match(hosts[0], /^urn:uuid:/);
    assert.equal((await stat(path.join(directory, "default.json"))).mode & 0o777, 0o600);
    assert.equal(await auth.accessToken(), "fake-access");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ChatGPT OAuth rejects an invalid nonce without replacing the active credentials", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-oauth-reject-"));
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test" };
  const original = { ...fakeAccount, expiresAt: Date.now() + 3600_000 };
  await writeFile(path.join(directory, "default.json"), JSON.stringify(original), { mode: 0o600 });
  const auth = new ChatGptAuth({ directory, fetch: async url => {
    if (String(url).endsWith("jwks.json")) return Response.json({ keys: [jwk] });
    const id = await new SignJWT({ nonce: "wrong" }).setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://auth.openai.com").setAudience(clientId).setSubject("test-user").setIssuedAt().setExpirationTime("1h").sign(privateKey);
    return Response.json({ access_token: "untrusted-access", refresh_token: "untrusted-refresh", id_token: id,
      token_type: "Bearer", expires_in: 3600, scope: scopes });
  } });
  try {
    await assert.rejects(browser(auth), /Connexion ChatGPT impossible/);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "default.json"), "utf8")), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ChatGPT refresh is serialized across instances, rotates tokens and preserves credentials on transient failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-refresh-"));
  await writeFile(path.join(directory, "default.json"), JSON.stringify(fakeAccount), { mode: 0o600 });
  let requests = 0;
  const transport: typeof fetch = async (_url, init) => {
    requests++;
    const body = init!.body as URLSearchParams;
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("client_id"), clientId);
    assert.equal(body.get("refresh_token"), "fake-refresh");
    assert.equal(body.has("scope"), false);
    await new Promise(resolve => setTimeout(resolve, 25));
    return Response.json({ access_token: "fake-new", refresh_token: "fake-rotated", token_type: "Bearer", expires_in: 3600 });
  };
  try {
    const a = new ChatGptAuth({ directory, fetch: transport });
    const b = new ChatGptAuth({ directory, fetch: transport });
    assert.deepEqual(await Promise.all([a.accessToken(), b.accessToken()]), ["fake-new", "fake-new"]);
    assert.equal(requests, 1);
    assert.equal(JSON.parse(await readFile(path.join(directory, "default.json"), "utf8")).refreshToken, "fake-rotated");
    await writeFile(path.join(directory, "default.json"), JSON.stringify(fakeAccount), { mode: 0o600 });
    const unavailable = new ChatGptAuth({ directory, fetch: async () => Response.json({ error: "temporary-private-message" }, { status: 503 }) });
    await assert.rejects(unavailable.accessToken(), /credentials conservés/);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "default.json"), "utf8")), fakeAccount);
    const revoked = new ChatGptAuth({ directory, fetch: async () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await assert.rejects(revoked.accessToken(), /reauthorization_required/);
    assert.equal((await revoked.status()).connected, false);
    assert.equal(JSON.stringify(await readFile(path.join(directory, "default.json"), "utf8")).includes("fake-refresh"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ChatGPT logout clears local secrets and reports whether remote revocation succeeded", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-logout-"));
  try {
    for (const success of [true, false]) {
      await writeFile(path.join(directory, "default.json"), JSON.stringify(fakeAccount), { mode: 0o600 });
      const auth = new ChatGptAuth({ directory, fetch: async (url, init) => {
        if (String(url).endsWith("openid-configuration")) return Response.json({ revocation_endpoint: "https://auth.openai.com/revoke" });
        assert.equal(String(url), "https://auth.openai.com/revoke");
        assert.equal((init!.body as URLSearchParams).get("token"), "fake-refresh");
        return new Response(null, { status: success ? 200 : 503 });
      } });
      assert.deepEqual(await auth.logout(), { remoteRevoked: success });
      assert.equal((await auth.status()).connected, false);
      const saved = JSON.parse(await readFile(path.join(directory, "default.json"), "utf8"));
      assert.equal(saved.clientId, clientId);
      assert.equal(saved.refreshToken, undefined);
    }
    await chmod(path.join(directory, "default.json"), 0o644);
    await assert.rejects(new ChatGptAuth({ directory }).status(), /0600/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("cancelling ChatGPT login closes the loopback listener and releases the registration lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-login-cancel-"));
  const selectedPort = await port();
  const controller = new AbortController();
  const auth = new ChatGptAuth({ directory, fetch: async () => { throw new Error("Unexpected network request"); } });
  try {
    await assert.rejects(auth.login({ appName: "Nora", port: selectedPort, signal: controller.signal,
      onReady() { controller.abort(); } }), { name: "AbortError" });
    assert.equal((await auth.status()).connected, false);
    await assert.rejects(stat(path.join(directory, "default.lock")), { code: "ENOENT" });
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(selectedPort, "127.0.0.1", resolve); });
    await new Promise<void>(resolve => server.close(() => resolve()));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
