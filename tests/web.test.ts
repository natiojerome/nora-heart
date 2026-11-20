import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createServer as createTcpServer } from "node:net";
import { request as httpRequest } from "node:http";
import { TestLab } from "../src/app/test-lab.ts";
import { WebAccess, writeWebInvitation } from "../src/app/web-access.ts";
import { createWebServer } from "../src/interfaces/web/server.ts";

async function availablePort(): Promise<number> {
  const reservation = createTcpServer();
  await new Promise<void>(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  return port;
}

test("web access consumes invitations once, signs sessions and binds CSRF", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-web-access-"));
  try {
    const file = path.join(directory, "invite.json");
    const invite = await writeWebInvitation(file);
    const access = new WebAccess({ secret: "fake-session-key-".repeat(3), inviteFile: file });
    const result = await access.login({ invite }, "test-ip");
    assert.ok(access.session(result.token));
    assert.equal(access.checkCsrf(result.token, result.csrf), true);
    assert.equal(access.checkCsrf(result.token, "wrong"), false);
    assert.equal(access.session(`${result.token}x`), undefined);
    await assert.rejects(access.login({ invite }, "test-ip"), /refusé/);
    access.logout(result.token);
    assert.equal(access.session(result.token), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("web server protects state, mutations and credentials, then runs an isolated demo", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-web-http-"));
  const lab = new TestLab({ directory: path.join(directory, "lab"), authDirectory: path.join(directory, "auth") });
  await lab.prepare();
  const access = new WebAccess({ secret: "fake-web-signing-key-".repeat(3), password: "fake-web-test-password" });
  const port = await availablePort();
  const address = `http://127.0.0.1:${port}`;
  await writeFile(path.join(directory, "app.js"), "// public test asset");
  const server = createWebServer({ origin: address, access, lab, assetsDirectory: directory });
  await new Promise<void>(resolve => server.listen(port, "127.0.0.1", resolve));
  let cookie = "", csrf = "";
  const request = (route: string, input?: unknown, extra: Record<string, string> = {}) => fetch(address + route, {
    method: input === undefined ? "GET" : "POST",
    headers: { Origin: address, "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf, ...extra },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  try {
    const asset = await request("/app.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control")!, /max-age=0, must-revalidate/);
    const etag = asset.headers.get("etag")!;
    assert.ok(etag);
    await asset.text();
    const revalidated = await request("/app.js", undefined, { "If-None-Match": etag });
    assert.equal(revalidated.status, 304);
    assert.equal(await revalidated.text(), "");
    assert.equal((await request("/app.js", undefined, { "If-None-Match": 'W/"old-version"' })).status, 200);
    await writeFile(path.join(directory, "app.js"), "// new public test asset after deployment");
    const updatedAsset = await request("/app.js", undefined, { "If-None-Match": etag });
    assert.equal(updatedAsset.status, 200);
    assert.notEqual(updatedAsset.headers.get("etag"), etag);
    assert.match(await updatedAsset.text(), /after deployment/);
    assert.match((await request("/api/state")).headers.get("cache-control")!, /no-store/);
    assert.deepEqual(await (await request("/api/state")).json(), { authenticated: false });
    assert.equal((await request("/api/test", { provider: "demo", prompt: "list" })).status, 401);
    assert.equal((await request("/api/login", { password: "fake-web-test-password" }, { Origin: "https://evil.test" })).status, 403);
    const login = await request("/api/login", { password: "fake-web-test-password" });
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(login.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(login.headers.get("set-cookie")!, /SameSite=Strict/);
    csrf = (await login.json()).csrf;
    assert.equal((await request("/api/test", { provider: "demo", prompt: "list" }, { "X-CSRF-Token": "wrong" })).status, 403);
    const state = await (await request("/api/state")).json();
    assert.equal(state.authenticated, true);
    assert.equal(state.chatgpt.connected, false);
    assert.equal(state.api.openai, false);
    const result = await request("/api/test", { provider: "demo", prompt: "List files", maxSteps: 4 });
    assert.equal(result.status, 200);
    const run = await result.json();
    assert.match(run.text, /bienvenue.txt/);
    assert.equal(run.simulated, true);
    assert.ok(run.events.some((event: { type: string }) => event.type === "tool.finished"));
    assert.deepEqual((await readdir(path.join(directory, "lab"))).filter(name => name.startsWith("run-")), []);
    const saved = await request("/api/credentials", { provider: "openai", apiKey: "fake-private-test-key" });
    assert.deepEqual(await saved.json(), { configured: true });
    const after = await (await request("/api/state")).json();
    assert.equal(after.api.openai, true);
    assert.equal(JSON.stringify(after).includes("fake-private-test-key"), false);
    assert.equal((await stat(path.join(directory, "lab", "api-keys.json"))).mode & 0o777, 0o600);
    assert.equal((await request("/api/test", { provider: "unknown", prompt: "x" })).status, 400);
    assert.equal((await request("/api/test", { provider: "demo", prompt: "x", maxSteps: 100 })).status, 400);
    assert.equal((await request("/api/tests", { suite: "../../../escape" })).status, 500);
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(address + "/api/state", { headers: { Host: "evil.test" } }, response => { response.resume(); resolve(response.statusCode); });
      req.once("error", reject); req.end();
    });
    assert.equal(invalidHost, 403);
    await request("/api/logout", {});
    assert.equal((await request("/api/models")).status, 401);
  } finally {
    await lab.close(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("web ChatGPT relay allows only the pending loopback callback and never accepts a remote URL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-web-relay-"));
  const lab = new TestLab({ directory: path.join(directory, "lab"), authDirectory: path.join(directory, "auth"), oauthPort: await availablePort() });
  await lab.prepare();
  try {
    const login = await lab.startLogin();
    assert.equal(login.status, "pending");
    assert.equal(new URL(login.url!).origin, "https://auth.openai.com");
    assert.equal(new URL(login.url!).searchParams.has("id_token_hint"), false);
    await assert.rejects(lab.finishLogin("http://169.254.169.254/latest/meta-data"), /Adresse de retour invalide/);
    const callback = new URL(new URL(login.url!).searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ code: "fake-code", client_id: "fake-client", state: "wrong-state" }).toString();
    // Rejected locally before any OpenAI token request.
    await assert.rejects(lab.finishLogin(callback.href), /Adresse de retour refusée/);
    assert.equal(lab.loginStatus().status, "pending");
  } finally { await lab.close(); await rm(directory, { recursive: true, force: true }); }
});


test('OpenRouter credentials persist privately without replacing existing API keys',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-openrouter-'));
 const options={directory:path.join(directory,'state'),authDirectory:path.join(directory,'auth')};
 try {
  const lab=new TestLab(options);await lab.prepare();await lab.setKey('openai','fake-openai-key');await lab.setKey('openrouter','fake-openrouter-key');
  const restarted=new TestLab(options);await restarted.prepare();const state=await restarted.state();assert(state.api.openai);assert(state.api.openrouter);assert(!JSON.stringify(state).includes('fake-openrouter-key'));
  assert.equal((await stat(path.join(options.directory,'api-keys.json'))).mode&0o777,0o600);
  assert(restarted.model({provider:'openrouter',modelId:'vendor/paid'}));
  await restarted.close();await lab.close();
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('maintenance rejects new writes and counts an in-flight mutation until its actual completion',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'heart-maintenance-'));
 const gate=path.join(root,'maintenance'),lab=new TestLab({directory:path.join(root,'state'),authDirectory:path.join(root,'auth')});await lab.prepare();
 const port=await availablePort(),origin='http://127.0.0.1:'+port;
 let release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r),original=lab.setKey.bind(lab);
 lab.setKey=async(...args)=>{entered();await waiting;return original(...args);};
 const server=createWebServer({origin,maintenanceFile:gate,lab,access:new WebAccess({secret:'test-maintenance-session-key-at-least-32',password:'fake-password'})});
 await new Promise<void>(r=>server.listen(port,'127.0.0.1',r));
 try{
  const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'fake-password'})});
  const {csrf}=await login.json() as {csrf:string},cookie=login.headers.get('set-cookie')!.split(';')[0];
  const headers={Origin:origin,'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf};
  const pending=fetch(origin+'/api/credentials',{method:'POST',headers,body:JSON.stringify({provider:'openai',apiKey:'fake-only-test-key'})});await started;
  await writeFile(gate,'backup');
  const health=await (await fetch(origin+'/healthz')).json() as {activeMutations:number;maintenance:boolean};
  assert.equal(health.activeMutations,1);assert.equal(health.maintenance,true);
  const blocked=await fetch(origin+'/api/credentials',{method:'POST',headers,body:'{}'});assert.equal(blocked.status,503);
  release();await pending;
  const after=await (await fetch(origin+'/healthz')).json() as {activeMutations:number};assert.equal(after.activeMutations,0);
 }finally{release();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await lab.close();await rm(root,{recursive:true,force:true});}
});
