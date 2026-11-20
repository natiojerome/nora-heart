import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:http';
import {openHostTerminal} from '../src/app/host-terminal.ts';
import {HostExecutionClient} from '../src/modules/tools/terminal/index.ts';

test('YOLO Unix worker executes root host commands, stdin/network, scopes journals and stops detached children', {timeout:30000},async()=>{
  assert.equal(process.getuid?.(),0,'Run this opt-in test as root on nora-tests');
  const root=await mkdtemp(path.join(os.tmpdir(),'heart-yolo-'));
  const threads=path.join(root,'threads'),workspace=path.join(threads,randomUUID()),other=path.join(threads,randomUUID());
  await mkdir(workspace,{recursive:true});await mkdir(other);
  const worker=await openHostTerminal({socket:path.join(root,'terminal.sock'),directory:path.join(root,'commands'),workspaceDirectory:threads,home:path.join(root,'home')});
  const client=new HostExecutionClient(path.join(root,'terminal.sock'));
  const network=createServer((_req,res)=>res.end('real-network-ok'));
  await new Promise<void>(resolve=>network.listen(0,'127.0.0.1',resolve));
  const port=(network.address() as {port:number}).port;
  async function finish(id:string){for(let n=0;n<500;n++){const r=await client.read(workspace,id);if(r.command.status!=='running')return r;await delay(10);}throw new Error('Command did not finish');}
  process.env.HEART_YOLO_TEST_SECRET='never-inherited';
  try{
    const outside=path.join(root,'outside.txt');await writeFile(outside,'host-visible');
    const cmd=await client.start(workspace,{cwd:'/',command:`set -eu; test "$(id -u)" = 0; test -z "\${HEART_YOLO_TEST_SECRET-}"; cat ${outside}; node -e 'fetch("http://127.0.0.1:${port}").then(r=>r.text()).then(console.log)'`});
    const result=await finish(cmd.id);assert.equal(result.command.exitCode,0,result.output);assert.match(result.output,/host-visible/);assert.match(result.output,/real-network-ok/);assert.doesNotMatch(result.output,/never-inherited/);assert.equal(result.command.cwd,'/');
    await assert.rejects(client.read(other,cmd.id));
    const input=await client.start(workspace,{command:'read value; printf "received:%s" "$value"'});await client.write(workspace,input.id,'hello\n');assert.match((await finish(input.id)).output,/received:hello/);
    const failed=await client.start(workspace,{command:'exit 7'});assert.equal((await finish(failed.id)).command.exitCode,7);
    const heartbeat=path.join(root,'heartbeat');
    const long=await client.start(workspace,{command:`setsid sh -c 'while :; do echo tick >> ${heartbeat}; sleep 0.03; done' & wait`});
    for(let i=0;i<100;i++){if(await readFile(heartbeat,'utf8').catch(()=>''))break;await delay(20);}
    assert.match(await readFile(heartbeat,'utf8'),/tick/);await client.stop(workspace,long.id);const stopped=await readFile(heartbeat,'utf8');await delay(100);assert.equal(await readFile(heartbeat,'utf8'),stopped);assert.equal((await client.read(workspace,long.id)).command.status,'interrupted');
    const controller=new AbortController();const cancel=await client.start(workspace,{command:'sleep 30'},controller.signal);controller.abort();assert.equal((await finish(cancel.id)).command.status,'interrupted');
    await assert.rejects(new HostExecutionClient(path.join(root,'missing.sock')).start(workspace,{command:'true'}),/indisponible/);
  }finally{delete process.env.HEART_YOLO_TEST_SECRET;await worker.close();await new Promise<void>(resolve=>network.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
