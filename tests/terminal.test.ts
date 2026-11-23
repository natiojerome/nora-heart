import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  BubblewrapExecution,
  HostExecution,
  terminalTools,
} from "../src/modules/tools/terminal/index.ts";
import { LocalFiles } from "../src/modules/tools/files/index.ts";
import { conversationFixture } from "./conversation-fixture.ts";

async function fixture(
  run: (
    root: string,
    workspace: string,
    execution: BubblewrapExecution,
  ) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-terminal-")),
    workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const execution = new BubblewrapExecution(path.join(root, "commands"), {
    nodeBinary: process.execPath,
  });
  try {
    await run(root, workspace, execution);
  } finally {
    for (const command of await execution.list(workspace))
      if (command.status === "running")
        await execution.stop(workspace, command.id);
    await rm(root, { recursive: true, force: true });
  }
}
async function finish(
  execution: BubblewrapExecution,
  workspace: string,
  id: string,
) {
  for (let i = 0; i < 500; i++) {
    const result = await execution.read(workspace, id, 0, 1048576);
    if (result.command.status !== "running") return result;
    await delay(10);
  }
  throw new Error("Test command did not finish");
}

test("sandbox executes Node, Git and rg; host files and inherited secrets stay outside", async () =>
  fixture(async (root, workspace, execution) => {
    await writeFile(path.join(root, "private"), "secret-outside-workspace");
    process.env.HEART_TEST_PARENT_SECRET = "never-in-child";
    try {
      const command = await execution.start(workspace, {
        command: `set -eu; node -e 'if(process.env.HEART_TEST_PARENT_SECRET)throw Error("inherited secret"); console.log("node-ok")'; test ! -e /etc/personal-harness/web.env; test ! -e /projects/nora-heart; printf 'one\\ntwo\\n' > note.txt; rg -n two note.txt; git init -q; git diff --stat`,
        network: false,
      });
      const result = await finish(execution, workspace, command.id);
      assert.equal(result.command.exitCode, 0);
      assert.match(result.output, /node-ok/);
      assert.match(result.output, /2:two/);
      assert.doesNotMatch(result.output, /never-in-child/);
      assert.equal(
        await readFile(path.join(workspace, "note.txt"), "utf8"),
        "one\ntwo\n",
      );
    } finally {
      delete process.env.HEART_TEST_PARENT_SECRET;
    }
  }));

test("network namespace follows the explicit owner choice", async () =>
  fixture(async (_root, workspace, execution) => {
    for (const network of [false, true]) {
      const command = await execution.start(workspace, {
        command: `node -e 'console.log(Object.keys(require("node:os").networkInterfaces()).filter(name=>name!=="lo").length)'`,
        network,
      });
      const result = await finish(execution, workspace, command.id);
      assert.equal(result.command.exitCode, 0);
      assert.equal(Number(result.output.trim()) > 0, network);
    }
  }));

test("commands accept stdin, are scoped, retain paged output and stop on request", async () =>
  fixture(async (root, workspace, execution) => {
    const interactive = await execution.start(workspace, {
      command: "read value; printf 'received:%s' \"$value\"",
    });
    await execution.write(workspace, interactive.id, "hello\n");
    assert.match(
      (await finish(execution, workspace, interactive.id)).output,
      /received:hello/,
    );
    const other = path.join(root, "other");
    await mkdir(other);
    await assert.rejects(execution.read(other, interactive.id));
    await assert.rejects(
      execution.start(workspace, { command: "pwd", cwd: ".." }),
    );
    const many = await execution.start(workspace, {
      command: "node -e 'process.stdout.write(\"x\".repeat(150000))'",
    });
    await finish(execution, workspace, many.id);
    let offset = 0,
      total = "";
    for (;;) {
      const part = await execution.read(workspace, many.id, offset, 10000);
      total += part.output;
      offset = part.nextOffset;
      if (!part.more) break;
    }
    assert.equal(total.length, 150000);
    const running = await execution.start(workspace, {
      command:
        'setsid node -e \'setInterval(()=>require("node:fs").appendFileSync("heartbeat","x"),20)\' & wait',
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        await readFile(path.join(workspace, "heartbeat"));
        break;
      } catch {
        await delay(10);
      }
    }
    assert.equal(
      (await execution.stop(workspace, running.id)).status,
      "interrupted",
    );
    const before = await readFile(path.join(workspace, "heartbeat"));
    await delay(100);
    assert.deepEqual(await readFile(path.join(workspace, "heartbeat")), before);
  }));

test("development tool loop edits a module, runs its tests and reports evidence; AGENTS.md is injected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-develop-loop-"));
  const execution = new BubblewrapExecution(path.join(root, "commands"), {
    nodeBinary: process.execPath,
  });
  let stage = 0,
    commandId = "",
    sawInstructions = false;
  const fixture = await conversationFixture(
    path.join(root, "threads"),
    () => ({
      id: "coding-test",
      async generate(request) {
        sawInstructions = request.instructions.includes(
          "Project rule: run node --test",
        );
        const last = request.messages.at(-1);
        if (last?.role === "tool" && last.name === "terminal.exec")
          commandId = JSON.parse(last.content).id;
        if (stage === 0) {
          stage++;
          return {
            content: "",
            toolCalls: [
              {
                id: "start",
                name: "terminal.exec",
                arguments: {
                  command:
                    'printf \'export const add = (a,b) => a+b;\\n\' > add.mjs; printf \'import {test} from "node:test"; import assert from "node:assert/strict"; import {add} from "./add.mjs"; test("add",()=>assert.equal(add(2,3),5));\\n\' > add.test.mjs; node --test add.test.mjs; git init -q; git status --short',
                },
              },
            ],
          };
        }
        if (
          last?.role !== "tool" ||
          last.name !== "terminal.read" ||
          JSON.parse(last.content).command.status === "running"
        ) {
          await delay(25);
          return {
            content: "",
            toolCalls: [
              {
                id: `poll-${stage++}`,
                name: "terminal.read",
                arguments: { id: commandId },
              },
            ],
          };
        }
        const result = JSON.parse(last.content);
        assert.equal(result.command.exitCode, 0);
        assert.match(result.output, /pass 1/);
        return {
          content:
            "Test add réussi, deux fichiers créés ; Git les voit comme nouveaux.",
          toolCalls: [],
        };
      },
    }),
    undefined,
    execution,
  );
  try {
    const { conversation } = await fixture.service.create({
      title: "Development",
    });
    await fixture.service.mutateWorkspace(conversation.id, {
      action: "create",
      path: "AGENTS.md",
      content: "Project rule: run node --test",
    });
    await fixture.service.fileAccess(conversation.id, { access: "develop" });
    await fixture.service.executionPolicy(conversation.id, {
      network: false,
      maxSteps: 0,
    });
    const result = await fixture.service.send(conversation.id, {
      prompt: "Implement add and test it.",
      provider: "demo",
      contextWindow: 32768,
    });
    assert(sawInstructions);
    assert(
      result.events.some(
        (event) =>
          event.type === "tool.finished" &&
          (event.data as { name: string }).name === "terminal.exec",
      ),
    );
  } finally {
    await fixture.storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("targeted replacement requires a unique match and revision, including overlapping matches", async () =>
  fixture(async (_root, workspace) => {
    const files = new LocalFiles(workspace);
    await files.create("module.ts", "const value = 1;\n");
    let file = await files.read("module.ts");
    await files.replace(file.path, "value = 1", "value = 2", file.revision);
    assert.equal((await files.read(file.path)).content, "const value = 2;\n");
    await assert.rejects(
      files.replace(file.path, "value", "number", file.revision),
      /changé/,
    );
    await files.create("overlap.txt", "aaa");
    file = await files.read("overlap.txt");
    await assert.rejects(
      files.replace(file.path, "aa", "b", file.revision),
      /plusieurs/,
    );
    assert.equal((await files.read(file.path)).content, "aaa");
  }));

test("an explicitly unbounded conversation can continue beyond eight tool rounds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-step-budget-"));
  let calls = 0;
  const fixture = await conversationFixture(root, () => ({
    id: "long-tool-loop",
    async generate() {
      calls++;
      return calls <= 10
        ? {
            content: "",
            toolCalls: [
              { id: `call-${calls}`, name: "files.list", arguments: {} },
            ],
          }
        : { content: "Done after ten tool rounds", toolCalls: [] };
    },
  }));
  try {
    const { conversation } = await fixture.service.create({
      title: "Long task",
    });
    await fixture.service.executionPolicy(conversation.id, {
      network: false,
      maxSteps: 0,
    });
    const result = await fixture.service.send(conversation.id, {
      prompt: "Continue until done",
      provider: "demo",
      contextWindow: 32768,
    });
    assert.equal(calls, 11);
    assert(result.events.some((event) => event.type === "run.completed"));
  } finally {
    await fixture.storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('YOLO is explicit per thread, routes tools to its worker and revokes only temporary commands on exit',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'heart-yolo-policy-'));
  const calls:string[]=[];let lastInteractive:boolean|undefined;
  const command={id:'11111111-1111-4111-8111-111111111111',command:'whoami',cwd:'/',startedAt:new Date().toISOString(),status:'running' as const,exitCode:null,signal:null};
  const host={async start(_workspace:string,input:{command:string;network?:boolean;interactive?:boolean}){lastInteractive=input.interactive;calls.push(input.network?'host-network':'host-no-network');return command;},async list(){return [command];},async read(){return {command:{...command,status:'completed' as const,exitCode:0},output:'root',offset:0,nextOffset:4,more:false};},async write(){},async stop(){calls.push('stop-host');return {...command,status:'interrupted' as const};}};
  try{
    const missing=await conversationFixture(path.join(root,'missing'));
    const denied=(await missing.service.create({title:'No worker'})).conversation;
    await assert.rejects(missing.service.fileAccess(denied.id,{access:'yolo'}),/indisponible/);
    // Owner command path and persisted policy are independent of the chosen model.
    let generated=0;
    const fixture=await conversationFixture(path.join(root,'enabled'),()=>({id:'yolo-policy-test',async generate(request){
      assert.match(request.instructions,/Mode YOLO explicitement accordé/);
      assert(request.tools.some(tool=>tool.name==='terminal.exec'&&tool.description.includes('root')));
      if(generated++===0)return {content:'',toolCalls:[{id:'host-call',name:'terminal.exec',arguments:{command:'whoami',cwd:'/'}}]};
      assert(request.messages.some(message=>message.role==='tool'&&!message.error));return {content:'Done',toolCalls:[]};
    }}),undefined,undefined,host);
    const first=(await fixture.service.create({title:'YOLO'})).conversation,second=(await fixture.service.create({title:'Protected'})).conversation;
    await fixture.service.fileAccess(first.id,{access:'yolo'});
    await fixture.service.startCommand(first.id,{command:'whoami',cwd:'/',interactive:true});assert.equal(lastInteractive,true);
    assert.deepEqual(calls,['host-network']);
    await fixture.service.send(first.id,{provider:'demo',contextWindow:8192,prompt:'Run whoami'});
    assert.deepEqual(calls,['host-network','host-network']);
    assert.equal((await fixture.restart().get(first.id)).conversation.fileAccess,'yolo');
    assert.notEqual((await fixture.service.get(second.id)).conversation.fileAccess,'yolo');
    await assert.rejects(fixture.service.startCommand(second.id,{command:'whoami'}),/Active/);
    await fixture.service.fileAccess(first.id,{access:'read'});assert.deepEqual(calls,['host-network','host-network','stop-host']);
    Object.assign(command,{independent:true});
    await fixture.service.fileAccess(first.id,{access:'yolo'});
    await fixture.service.fileAccess(first.id,{access:'read'});
    assert.deepEqual(calls,['host-network','host-network','stop-host'],'changing Heart permissions must not stop independent project execution');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('terminal tools return output for short commands and keep long commands readable without killing them',async()=>{
 await fixture(async(_root,workspace,execution)=>{
  const {terminalTools}=await import('../src/modules/tools/terminal/index.ts');const tools=terminalTools(execution,false);const run=tools.find(t=>t.name==='terminal.exec')!;
  const short=JSON.parse(await run.execute({command:'printf inline-output',yieldTimeMs:1000},{workspace}));
  assert.equal(short.status,'completed');assert.equal(short.exitCode,0);assert.equal(short.output,'inline-output');assert.equal(short.more,false);assert(short.id);
  const long=JSON.parse(await run.execute({command:'sleep 0.15; printf eventual-output',yieldTimeMs:0},{workspace}));assert.equal(long.status,'running');
  const result=await finish(execution,workspace,long.id);assert.equal(result.output,'eventual-output');assert.equal(result.command.exitCode,0);
  await assert.rejects(run.execute({command:'true',yieldTimeMs:-1},{workspace}),/invalide/);
 });
});

test('terminal pagination provides executable continuation cursors without losing the final result',async()=>{
 await fixture(async(_root,workspace,execution)=>{
  const tools=new Map(terminalTools(execution,false).map(tool=>[tool.name,tool]));
  const first=JSON.parse(await tools.get('terminal.exec')!.execute({command:"node -e \"process.stdout.write('x'.repeat(150000)+'RESULT:ok')\"",yieldTimeMs:1000},{workspace}));
  assert.equal(first.status,'completed');assert.equal(first.exitCode,0);assert.equal(first.more,true);
  let result=first,text=result.output,pages=1;
  while(result.more){
   assert.equal(result.continuation.tool,'terminal.read');assert.equal(result.continuation.arguments.offset,result.nextOffset);
   result=JSON.parse(await tools.get(result.continuation.tool)!.execute(result.continuation.arguments,{workspace}));text+=result.output;pages++;
  }
  assert(pages>1);assert.equal(text,'x'.repeat(150000)+'RESULT:ok');assert.equal(result.continuation,undefined);
 });
});


test("orphan command recovery persists interruption atomically across concurrent reads", async () => fixture(async (root, workspace, execution) => {
  const id = "00000000-0000-4000-8000-000000000001";
  const folder = path.join(root, "commands", id);
  await mkdir(folder, {recursive:true});
  const command = {id,command:"synthetic orphan, never executed",cwd:".",startedAt:new Date().toISOString(),status:"running",exitCode:null,signal:null};
  await writeFile(path.join(folder,"command.json"),JSON.stringify({command,workspace:await realpath(workspace)}));
  await writeFile(path.join(folder,"output.log"),"preserved output");
  const results = await Promise.all(Array.from({length:8},()=>execution.read(workspace,id)));
  assert(results.every(result=>result.command.status==="interrupted" && result.command.signal==="SERVICE_RESTART"));
  const saved=JSON.parse(await readFile(path.join(folder,"command.json"),"utf8"));
  assert.equal(saved.command.status,"interrupted","maintenance must not see a permanently running orphan");
  assert.equal(saved.workspace,await realpath(workspace));
  assert.equal(await readFile(path.join(folder,"output.log"),"utf8"),"preserved output");
  assert.deepEqual((await readdir(folder)).sort(),["command.json","output.log"]);
}));


test("host commands survive loss of their JS supervisor and stop only after systemd confirmation", async()=>fixture(async(root,workspace)=>{
 const id="00000000-0000-4000-8000-000000000002",directory=path.join(root,"host-commands"),folder=path.join(directory,id);
 await mkdir(folder,{recursive:true});
 const original={command:{id,command:"synthetic unit, never executed",cwd:workspace,startedAt:new Date().toISOString(),status:"running",exitCode:null,signal:null},workspace:await realpath(workspace)};
 const file=path.join(folder,"command.json");await writeFile(file,JSON.stringify(original));await writeFile(path.join(folder,"output.log"),"unchanged");
 let running=true,stops=0;
 const units={async active(value:string){assert.equal(value,id);return running;},async stop(value:string){assert.equal(value,id);stops++;running=false;}};
 const execution=new HostExecution(directory,{home:root,units});
 assert.equal((await execution.read(workspace,id)).command.status,"running");
 assert.equal(JSON.parse(await readFile(file,"utf8")).command.status,"running","backups must still defer for a surviving unit");
 assert.equal((await execution.stop(workspace,id)).status,"interrupted");assert.equal(stops,1);
 assert.equal(JSON.parse(await readFile(file,"utf8")).command.signal,"SERVICE_STOP");
 await execution.stop(workspace,id);assert.equal(stops,1,"a repeated stop must not affect any other process");
 await writeFile(file,JSON.stringify(original));
 const unknown=new HostExecution(directory,{home:root,units:{async active(){throw Error("Supervisor unavailable");},async stop(){throw Error("Must not stop");}}});
 await assert.rejects(unknown.read(workspace,id),/Supervisor unavailable/);
 assert.equal(JSON.parse(await readFile(file,"utf8")).command.status,"running");
}));
