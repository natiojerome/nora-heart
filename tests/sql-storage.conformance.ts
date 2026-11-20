import { Engine } from "../src/core/engine.ts";
import { interactionTools } from "../src/modules/tools/interactions/index.ts";
import type { ModelProvider } from "../src/contracts/models.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import type { SqlStorageConnection } from "../src/contracts/sql-storage.ts";
import type { Event } from "../src/contracts/storage.ts";
import type { MemoryRecord } from "../src/contracts/structured-memory.ts";
import type { ModelSelection } from "../src/contracts/conversations.ts";
import { defaultAssistant } from "../src/app/assistant.ts";
import { recoveryPlan, recoveryEvents } from "../src/core/recovery.ts";

export interface SqlFixture {
  open(): Promise<SqlStorageConnection>;
  cleanup(): Promise<void>;
}
export function sqlStorageConformance(
  label: string,
  fixture: () => Promise<SqlFixture>,
) {
  test(label + " implements the shared SQL storage contract", async (t) => {
    const f = await fixture(),
      a = await f.open(),
      b = await f.open(),
      id = randomUUID(),
      other = randomUUID(),
      at = new Date().toISOString();
    const selection: ModelSelection = {
      provider: "demo",
      modelId: "demo",
      contextWindow: 8192,
      capacitySource: "configured",
    };
    const event = (runId = randomUUID()): Event => ({
      id: randomUUID(),
      at,
      runId,
      type: "message",
      data: { role: "user", content: "Continuité é 🌍" },
    });
    const record = (
      content: string,
      projectId: string | null = null,
    ): MemoryRecord => ({
      id: randomUUID(),
      title: "Préférence ÉTÉ",
      content,
      kind: "preference",
      scope: projectId ? "project" : "personal",
      projectId,
      status: "active",
      version: 1,
      source: { type: "manual" },
      createdAt: at,
      updatedAt: at,
    });
    try {
      await t.test('tasks reserve atomically, keep snapshots and notifications, and elect a single scheduler',async()=>{
        const conversationId=randomUUID();await a.conversations.create({id:conversationId,title:'Task SQL',createdAt:at,updatedAt:at,selection});
        const task:import('../src/contracts/tasks.ts').Task={id:randomUUID(),version:1,title:'SQL task',prompt:'Test',conversationId,schedule:{kind:'once',at,timezone:'UTC'},missed:'catch_up',notify:true,active:true,nextAt:at,createdAt:at,updatedAt:at};
        await a.tasks.save(task,0);assert.equal((await b.tasks.get(task.id))?.title,'SQL task');
        const run:import('../src/contracts/tasks.ts').TaskRun={id:randomUUID(),sequence:'0',revision:1,task:{id:task.id,title:task.title,prompt:task.prompt,conversationId,notify:true},dueAt:at,createdAt:at,scheduled:true,status:'queued',detail:'Queued',seen:false};
        const reserved=await Promise.all([a.tasks.schedule(task,run,null),b.tasks.schedule(task,{...run,id:randomUUID()},null)]);assert.equal(reserved.filter(Boolean).length,1);
        const winner=(await a.tasks.runs(task.id))[0];
        assert((await a.tasks.queued(0,'0')).some(row=>row.id===winner.id));
        const ownSequence=(await a.tasks.getRun(winner.id))!.sequence;
        assert((await b.tasks.queued(0,ownSequence)).every(row=>BigInt(row.sequence)>BigInt(ownSequence)));
        assert.equal(await a.tasks.getRun(randomUUID()),null);
        const queued=winner,claims=await Promise.all([a.tasks.claim(queued,'one',at),b.tasks.claim(queued,'two',at)]);assert.equal(claims.filter(Boolean).length,1);
        const claimed=claims.find(Boolean)!;assert.equal(await a.tasks.transition(queued,{status:'failed',detail:'Stale'}),false);assert.equal(await b.tasks.transition(claimed,{status:'waiting',detail:'Question'}),true);
        assert.equal(await a.tasks.unread(),1);await a.tasks.acknowledge(winner.id,'waiting');
        // Either reservation ID may have won the race.
        const waiting=(await a.tasks.runs(task.id))[0];await a.tasks.acknowledge(waiting.id,'waiting');assert.equal(await b.tasks.unread(),0);
        await a.tasks.transition(waiting,{status:'succeeded',detail:'Done',finishedAt:at});assert.equal(await b.tasks.unread(),1);
        const taskRows=await a.tasks.list(),paged: string[]=[];let after: string|undefined;
        for(;;){const page=await b.tasks.list({after,limit:2});if(!page.length)break;paged.push(...page.map(row=>row.id));after=page.at(-1)!.id;}
        assert.deepEqual(paged,taskRows.map(row=>row.id));
        assert((await a.tasks.latest([task.id])).every(row=>row.task.id===task.id));
        const leader=await a.tasks.lease();assert(leader);try{assert.equal(await b.tasks.lease(),null);}finally{await leader.release();}
        const next=await b.tasks.lease();assert(next);await next.release();
      });

      await t.test('memory limit zero returns all matching records across connections',async()=>{
        const term='policy'+randomUUID().replaceAll('-','');
        const records=Array.from({length:3},(_,i)=>record(term+' '+i));
        for(const item of records)await a.structuredMemories.create(item);
        assert.equal((await b.structuredMemories.list({terms:[term],limit:1})).length,1);
        assert.equal((await b.structuredMemories.list({terms:[term],limit:0})).length,3);
      });
      await t.test('event cursors are session-scoped, ordered, gap-free and incremental',async()=>{
        const session=randomUUID(),foreign=randomUUID();
        const events=Array.from({length:23},()=>event());
        await a.sessions.appendBatch(session,events);
        await a.sessions.append(foreign,event());
        const latest=await b.sessions.page(session,{limit:7});
        assert.deepEqual(latest.events.map(e=>e.id),events.slice(-7).map(e=>e.id));
        assert.equal(latest.hasMore,true);
        const previous=await a.sessions.page(session,{before:latest.before!,limit:7});
        assert.deepEqual(previous.events.map(e=>e.id),events.slice(-14,-7).map(e=>e.id));
        let cursor:null|string=null;const ids:string[]=[];let more=true;
        while(more){const p=await a.sessions.page(session,{after:cursor,limit:5});ids.push(...p.events.map(e=>e.id));cursor=p.after;more=p.hasMore;}
        assert.deepEqual(ids,events.map(e=>e.id));
        assert.equal((await a.sessions.page(session,{after:cursor!})).events.length,0);
        const next=event();await b.sessions.append(session,next);
        assert.deepEqual((await a.sessions.page(session,{after:cursor!})).events.map(e=>e.id),[next.id]);
        await assert.rejects(a.sessions.page(foreign,{after:cursor!}),/Curseur introuvable/);
        await assert.rejects(a.sessions.page(session,{before:cursor!,after:cursor!}),/Pagination invalide/);
        await assert.rejects(a.sessions.page(session,{limit:0}),/Pagination invalide/);
      });
      await t.test('catalogue keyset pages and filters are complete with tied timestamps',async()=>{
        const ids:string[]=[];const title='ÉTÉ-'+randomUUID(),project={id:randomUUID(),title:'Pagination'};
        await a.projects.create(project);
        for(let i=0;i<13;i++){const key=randomUUID();ids.push(key);await a.conversations.create({id:key,title:title+' '+i,createdAt:at,updatedAt:at,selection:null,...(i%2?{projectId:project.id}:{})});}
        let before:import("../src/contracts/conversations.ts").ConversationPosition|undefined;const seen:string[]=[];
        for(;;){const page=await b.conversations.list({before,query:title.toLowerCase(),limit:4});if(!page.length)break;seen.push(...page.map(c=>c.id));before=page.at(-1)!.position;}
        assert.equal(new Set(seen).size,13);assert.deepEqual(seen,[...ids].sort().reverse());
        assert.equal((await b.conversations.list({query:title.toLowerCase(),projectId:project.id})).length,6);
        assert.equal((await b.conversations.list({query:title.toLowerCase(),projectId:'none'})).length,7);
        assert.equal((await b.conversations.get(ids[0]))?.id,ids[0]);
        const first=await b.conversations.list({query:title.toLowerCase(),limit:4});const position=first.at(-1)!.position!;
        await a.conversations.setExecutionPolicy(position.id,true,0);
        const rest=await b.conversations.list({query:title.toLowerCase(),before:position,limit:20});
        assert.equal(rest.length,9,'Changing the boundary row must not change the captured page boundary');
      });

      await t.test(
        "identity, projects, conversations and independent permissions survive reopening",
        async () => {
          assert.equal(a.instanceId, b.instanceId);
          const project = { id: randomUUID(), title: "Projet renommable" };
          await a.projects.create(project);
          assert.deepEqual(await b.projects.get(project.id), project);
          for (const key of [id, other])
            await a.conversations.create({
              id: key,
              title: "Même titre",
              createdAt: at,
              updatedAt: at,
              selection: null,
              projectId: project.id,
            });
          await a.conversations.select(id, selection, null);
          await a.conversations.setFileAccess(id, "develop");
          await a.conversations.setExecutionPolicy(id, true, 7);
          const c = await b.conversations.get(id);
          assert.equal(c?.selection?.contextWindow, 8192);
          assert.equal(c?.fileAccess, "develop");
          assert.equal(c?.maxSteps, 7);
          assert.equal(c?.networkAccess, true);
          assert.equal((await b.conversations.get(other))?.fileAccess, "read");
          assert((await b.conversations.list()).some((c) => c.id === id));
          // SQL stores remote project references without requiring a parallel local row.
          const remoteId=randomUUID(),remoteConversation=randomUUID();
          await a.conversations.create({id:remoteConversation,title:"Remote project",createdAt:at,updatedAt:at,selection:null,projectId:remoteId});
          assert.equal((await b.conversations.get(remoteConversation))?.projectId,remoteId);
          assert.equal(await b.projects.get(remoteId),null);
        },
      );
      await t.test(
        "journal ordering, idempotence and all-or-none batches",
        async () => {
          const e = event();
          await a.sessions.append(id, e);
          await b.sessions.append(id, e);
          assert.deepEqual(await b.sessions.read(id), [e]);
          await assert.rejects(
            b.sessions.append(id, { ...e, data: { different: true } }),
          );
          const before = await a.sessions.read(id);
          await assert.rejects(
            b.sessions.appendBatch(id, [
              event(),
              { ...event(), type: "invalid" as Event["type"] },
            ]),
          );
          assert.deepEqual(await a.sessions.read(id), before);
          const entries = Array.from({ length: 12 }, () => event());
          await Promise.all(
            entries.map((e, index) =>
              (index % 2 ? a : b).sessions.append(id, e),
            ),
          );
          assert.equal((await b.sessions.read(id)).length, 13);
          assert.equal(
            new Set((await b.sessions.read(id)).map((e) => e.id)).size,
            13,
          );
        },
      );
      await t.test(
        "exclusive claims, permission guards and semantic selection comparison",
        async () => {
          const first = randomUUID(),
            second = randomUUID();
          const results = await Promise.allSettled([
            a.sessions.claim(id, first),
            b.sessions.claim(id, second),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          await assert.rejects(b.conversations.setFileAccess(id, "none"));
          await assert.rejects(b.conversations.select(id, selection));
          await assert.rejects(
            b.conversations.setExecutionPolicy(id, false, 0),
          );
          await a.sessions.release(id, first);
          await b.sessions.release(id, second);
          const reordered: ModelSelection = {
            capacitySource: "configured",
            contextWindow: 8192,
            modelId: "demo",
            provider: "demo",
          };
          await a.conversations.select(
            id,
            { ...selection, contextWindow: 16384 },
            reordered,
          );
          await assert.rejects(
            b.conversations.select(id, selection, selection),
          );
        },
      );
      await t.test(
        "memory deduplication, scopes, Unicode search, history and optimistic writes",
        async () => {
          const content = "ÉTÉ " + randomUUID(),
            value = record(content),
            saved = await a.structuredMemories.create(value);
          const duplicate = await b.structuredMemories.create({
            ...value,
            id: randomUUID(),
            title: "Autre titre",
          });
          assert.deepEqual(duplicate, saved);
          const projectId = (await a.conversations.get(id))!.projectId!;
          const scoped = await a.structuredMemories.create(
            record(content, projectId),
          );
          assert.notEqual(scoped.id, saved.id);
          assert(
            (
              await b.structuredMemories.list({
                projectId: null,
                terms: ["été"],
                limit: 200,
              })
            ).some((r) => r.id === saved.id),
          );
          assert(
            !(
              await b.structuredMemories.list({ projectId: null, limit: 200 })
            ).some((r) => r.id === scoped.id),
          );
          assert.equal(
            (await b.structuredMemories.list({ terms: [], limit: 200 })).length,
            0,
          );
          const changed = await a.structuredMemories.replace(
            { ...saved, title: "Corrigé" },
            1,
          );
          assert.equal(changed.version, 2);
          await assert.rejects(
            b.structuredMemories.replace({ ...saved, title: "Concurrent" }, 1),
          );
          await a.structuredMemories.replace(
            { ...changed, status: "forgotten" },
            2,
          );
          assert.equal(
            (await b.structuredMemories.revisions(saved.id)).length,
            3,
          );
          assert(
            !(
              await b.structuredMemories.list({ projectId: null, limit: 200 })
            ).some((r) => r.id === saved.id),
          );
          const active = await a.structuredMemories.create(record(content));
          assert.notEqual(active.id, saved.id);
          await assert.rejects(
            b.structuredMemories.replace({ ...changed, status: "active" }, 3),
          );
          const legacy = await a.memories.save({
            id: randomUUID(),
            content: "UNICODE ÉTÉ " + randomUUID(),
          });
          assert(
            (await b.memories.find(["unicode", "été"], 200)).some(
              (m) => m.id === legacy.id,
            ),
          );
        },
      );
      await t.test(
        "assistant and external connection updates reject stale versions",
        async () => {
          const current = await a.assistant.get(),
            expected = current?.version ?? 0;
          const value = await a.assistant.save(
            { ...defaultAssistant, name: "Test assistant" },
            expected,
          );
          assert.equal(value.version, expected + 1);
          await assert.rejects(
            b.assistant.save({ ...defaultAssistant, name: "Stale" }, expected),
          );
          assert.deepEqual(await b.assistant.get(), value);
          const connection = {
            id: randomUUID(),
            version: 0,
            label: "MCP test",
            url: "https://example.com/mcp",
            auth: { type: "bearer_env" as const, envVar: "TEST_KEY_REFERENCE" },
            enabled: false,
            timeoutMs: 2000,
            tools: [],
          };
          const saved = await a.externalTools.save(connection, 0);
          assert.equal(saved.version, 1);
          await assert.rejects(b.externalTools.save(connection, 0));
          assert.deepEqual(await b.externalTools.get(saved.id), saved);
        },
      );
      await t.test(
        "binary attachments are isolated, claimed atomically and protected after use",
        async () => {
          const attachment = {
              id: randomUUID(),
              conversationId: id,
              name: "binary.bin",
              mediaType: "application/octet-stream",
              size: 4,
              createdAt: at,
              used: false,
            },
            bytes = new Uint8Array([0, 255, 42, 128]);
          await a.chatAssets.putAttachment(attachment, bytes);
          assert.deepEqual(
            new Uint8Array(
              (await b.chatAssets.attachment(id, attachment.id))!.bytes,
            ),
            bytes,
          );
          assert.equal(
            await b.chatAssets.attachment(other, attachment.id),
            null,
          );
          await assert.rejects(
            a.chatAssets.claimAttachments(id, [attachment.id, randomUUID()]),
          );
          assert.equal(
            (await b.chatAssets.attachment(id, attachment.id))!.file.used,
            false,
          );
          await assert.rejects(
            a.chatAssets.claimAttachments(id, [attachment.id, attachment.id]),
          );
          await b.chatAssets.claimAttachments(id, [attachment.id]);
          await assert.rejects(
            a.chatAssets.deleteAttachment(id, attachment.id),
          );
          assert.equal(
            (await b.chatAssets.attachments(id)).find(
              (f) => f.id === attachment.id,
            )?.used,
            true,
          );
          const prompt = {
            id: randomUUID(),
            title: "Prompt",
            description: "",
            content: "Un texte",
            context: "all" as const,
            version: 1,
            updatedAt: at,
          };
          await a.chatAssets.savePrompt(prompt, 0);
          await assert.rejects(b.chatAssets.savePrompt(prompt, 0));
          await assert.rejects(b.chatAssets.deletePrompt(prompt.id, 2));
          await b.chatAssets.deletePrompt(prompt.id, 1);
        },
      );
      await t.test(
        "engine input pauses survive connection changes and invalidate stale dependent calls",
        async () => {
          const session = randomUUID(),
            effects: string[] = [];
          let calls = 0;
          const model: ModelProvider = {
            id: "conformance-brain",
            async generate(
              request,
            ): Promise<import("../src/contracts/models.ts").ModelResponse> {
              calls++;
              const result = request.messages.at(-1);
              if (
                !request.messages.some(
                  (m) =>
                    m.role === "tool" &&
                    m.name === "interactions.request_input",
                )
              )
                return {
                  content: "",
                  toolCalls: [
                    {
                      id: "question",
                      name: "interactions.request_input",
                      arguments: {
                        title: "Choisir",
                        questions: [
                          {
                            id: "choice",
                            label: "A ou B ?",
                            type: "single",
                            options: [
                              { id: "a", label: "A" },
                              { id: "b", label: "B" },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      id: "old-action",
                      name: "apply",
                      arguments: { choice: "a" },
                    },
                  ],
                };
              if (
                result?.role === "tool" &&
                result.name === "apply" &&
                !result.error
              )
                return { content: "Choix B appliqué", toolCalls: [] };
              return {
                content: "",
                toolCalls: [
                  {
                    id: "new-action",
                    name: "apply",
                    arguments: { choice: "b" },
                  },
                ],
              };
            },
          };
          const tools = [
            ...interactionTools(),
            {
              name: "apply",
              description: "Fixture effect",
              permission: "files.write" as const,
              parameters: { type: "object" },
              async execute(args: any) {
                effects.push(args.choice);
                return args.choice;
              },
            },
          ];
          const options = {
            sessionId: session,
            prompt: "Choose",
            provider: model,
            displayName: "Fixture",
            workspace: ".",
            permissions: new Set(["user.input", "files.write"] as const),
            maxSteps: 4,
          };
          const paused = await new Engine(a.sessions, tools).run(options);
          assert(paused.waitingFor);
          assert.equal(calls, 1);
          assert.deepEqual(effects, []);
          const result = await new Engine(b.sessions, tools).run({
            ...options,
            prompt: "",
            resume: {
              requestId: paused.waitingFor,
              response: { status: "answered", answers: { choice: "b" } },
            },
          });
          assert.equal(result.text, "Choix B appliqué");
          assert.deepEqual(effects, ["b"]);
          assert.equal(calls, 3);
          await new Engine(b.sessions, tools).run({
            ...options,
            prompt: "",
            resume: {
              requestId: paused.waitingFor,
              response: { status: "answered", answers: { choice: "b" } },
            },
          });
          assert.equal(calls, 3);
        },
      );
      await t.test(
        "terminal work projection and explicit recovery fence the abandoned owner",
        async () => {
          const runId = randomUUID(),
            e = { ...event(runId), type: "run.started" as const, data: {} };
          await a.sessions.claim(id, runId);
          await a.sessions.append(id, e);
          assert.equal(
            (await b.conversations.get(id))?.work?.status,
            "interrupted",
          );
          const plan = recoveryPlan(
              await b.sessions.read(id),
              await b.sessions.recoveryClaim(id),
            ),
            repair = recoveryEvents(plan, true, "Test isolated owner recovery");
          await assert.rejects(
            b.sessions.reconcile(id, plan.lastEventId, repair),
          );
          await a.close();
          await a.close();
          await assert.rejects(b.sessions.reconcile(id, randomUUID(), repair));
          await b.sessions.reconcile(id, plan.lastEventId, repair);
          assert.equal(await b.sessions.recoveryClaim(id), null);
          await assert.rejects(
            b.sessions.append(id, {
              ...e,
              id: randomUUID(),
              type: "run.progress",
            }),
          );
          await assert.rejects(
            b.sessions.reconcile(id, plan.lastEventId, repair),
          );
          assert.equal(
            (await b.conversations.list()).find((c) => c.id === id)?.work
              ?.status,
            "failed",
          );
          const reopened = await f.open();
          try {
            assert.equal(reopened.instanceId, b.instanceId);
            assert.deepEqual(
              await reopened.sessions.read(id),
              await b.sessions.read(id),
            );
          } finally {
            await reopened.close();
          }
        },
      );
    } finally {
      try {
        const results = await Promise.allSettled([a.close(), b.close()]);
        assert.equal(
          results.filter((r) => r.status === "rejected").length,
          0,
          "Storage close must be idempotent",
        );
      } finally {
        await f.cleanup();
      }
    }
  });
}
