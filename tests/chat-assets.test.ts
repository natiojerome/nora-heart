import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { chatAssetsFixture } from "./chat-assets.fixture.ts";
import { conversationFixture } from "./conversation-fixture.ts";

test("quick prompts validate scope and use versions without changing engine or memory", async () => {
  const { assets } = chatAssetsFixture();
  const first = await assets.savePrompt({
    title: "Résumé",
    description: "Le point utile",
    content: "Résume en trois points.",
    context: "all",
  });
  assert.equal(first.version, 1);
  assert.equal((await assets.prompts()).length, 1);
  const second = await assets.savePrompt({
    ...first,
    content: "Résume les décisions.",
  });
  assert.equal(second.version, 2);
  await assert.rejects(assets.savePrompt({ ...first }), /modifié/);
  await assert.rejects(
    assets.savePrompt({ title: "x", content: "y", context: "bad" }),
    /invalide/,
  );
  await assets.deletePrompt(second.id, 2);
  assert.deepEqual(await assets.prompts(), []);
});
test("attachments validate bytes, isolate conversations, hydrate only at model boundary and retain sent files", async () => {
  const { assets } = chatAssetsFixture(),
    id = randomUUID();
  const file = await assets.upload(id, {
    name: "note.md",
    mediaType: "text/markdown",
    data: Buffer.from("Texte privé du fichier").toString("base64"),
  });
  assert.equal((await assets.attachments(id)).length, 1);
  await assert.rejects(assets.read(randomUUID(), file.id), /introuvable/);
  await assert.rejects(
    assets.upload(id, {
      name: "../secret",
      mediaType: "text/plain",
      data: "eA==",
    }),
    /Nom/,
  );
  await assert.rejects(
    assets.upload(id, { name: "x.png", mediaType: "image/png", data: "eA==" }),
    /PNG/,
  );
  await assert.rejects(assets.references(id, [file.id, file.id]), /distinctes/);
  const refs = await assets.references(id, [file.id]);
  assert(!("data" in refs[0]));
  let resolved = "";
  const provider = assets.provider(
    {
      id: "fake",
      supportsTools:false,
      async generate(request) {
        resolved =
          request.messages[0].role === "user"
            ? (request.messages[0].attachments?.[0].data ?? "")
            : "";
        return { content: "ok", toolCalls: [] };
      },
    },
    id,
  );
  assert.equal(provider.supportsTools,false);
  await provider.generate({
    instructions: "test",
    messages: [{ role: "user", content: "Lis", attachments: refs }],
    tools: [],
  });
  assert.equal(
    Buffer.from(resolved, "base64").toString(),
    "Texte privé du fichier",
  );
  assert(!("data" in refs[0]));
  await assets.claim(id, [file.id]);
  await assert.rejects(assets.remove(id, file.id), /historique/);
});
test("cancel acknowledges run settlement, releases the conversation, and never replays a tool", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "heart-cancel-"));
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fixture = await conversationFixture(dir, () => ({
    id: "fake-cancel",
    async generate(request) {
      started();
      await new Promise((_, reject) =>
        request.signal!.addEventListener(
          "abort",
          () => reject(request.signal!.reason),
          { once: true },
        ),
      );
      return { content: "never", toolCalls: [] };
    },
  }));
  try {
    const { conversation } = await fixture.service.create({ title: "Arrêt" });
    const pending = fixture.service.send(conversation.id, {
      prompt: "Attends",
      provider: "demo",
      contextWindow: 32768,
    });
    await ready;
    const cancelled = await fixture.service.cancel(conversation.id);
    await pending;
    assert.equal(cancelled.busy, false);
    assert(
      cancelled.events.some(
        (event) =>
          event.type === "run.failed" &&
          (event.data as { cancelled?: boolean }).cancelled,
      ),
    );
    assert(!cancelled.events.some((event) => event.type === "tool.started"));
  } finally {
    await fixture.storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancelling a tool batch records skipped calls without executing or replaying them", async () => {
  const { Engine } = await import("../src/core/engine.ts");
  const events: import("../src/contracts/storage.ts").Event[] = [];
  const sessions: import("../src/contracts/storage.ts").SessionStore = {
    async read() {
      return [...events];
    },
    async append(_id, event) {
      events.push(event);
    },
  };
  const controller = new AbortController();
  let executed = 0;
  const engine = new Engine(sessions, [
    {
      name: "slow",
      description: "Test cancellation",
      parameters: { type: "object" },
      permission: "files.read",
      async execute() {
        executed++;
        controller.abort();
        throw new Error("Interrupted");
      },
    },
  ]);
  const base = {
    sessionId: randomUUID(),
    workspace: os.tmpdir(),
    displayName: "Test",
    permissions: new Set(["files.read"] as const),
  };
  await assert.rejects(
    engine.run({
      ...base,
      prompt: "Batch",
      signal: controller.signal,
      provider: {
        id: "fake",
        async generate() {
          return {
            content: "",
            toolCalls: [
              { id: "first", name: "slow", arguments: {} },
              { id: "second", name: "slow", arguments: {} },
            ],
          };
        },
      },
    }),
  );
  assert.equal(executed, 1);
  assert(
    events.some(
      (event) =>
        event.type === "message" &&
        (event.data as { callId?: string }).callId === "second",
    ),
  );
  const result = await engine.run({
    ...base,
    prompt: "Continue",
    provider: {
      id: "fake-next",
      async generate() {
        return { content: "Continued without replay", toolCalls: [] };
      },
    },
  });
  assert.equal(result.text, "Continued without replay");
  assert.equal(executed, 1);
});


test('conversation activity is live, scoped to its run and cleared after completion',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-activity-'));
 let started!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 const fixture=await conversationFixture(dir,()=>({id:'mock-activity',async generate(request){request.onActivity?.('reasoning');started();await gate;return {content:'Done',toolCalls:[]};}}));
 try {
  const first=(await fixture.service.create({title:'Active'})).conversation,other=(await fixture.service.create({title:'Other'})).conversation;
  const pending=fixture.service.send(first.id,{prompt:'Test',provider:'demo',contextWindow:32768});await ready;
  assert.deepEqual((await fixture.service.get(first.id)).activity?.phase,'reasoning');assert.equal((await fixture.service.get(first.id)).activity?.modelCalls,1);
  assert.equal((await fixture.service.get(other.id)).activity,null);
  release();await pending;assert.equal((await fixture.service.get(first.id)).activity,null);
  assert(!(await fixture.service.get(first.id)).events.some(event=>JSON.stringify(event.data).includes('onActivity')));
 }finally{release();await fixture.storage.close();await rm(dir,{recursive:true,force:true});}
});
