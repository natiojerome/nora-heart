import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm,chmod,chown,stat,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:http';
import {openHostTerminal} from '../src/app/host-terminal.ts';
import {HostFiles} from '../src/modules/tools/host-files/index.ts';
import {LocalFiles} from '../src/modules/tools/files/index.ts';
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
    const files=new HostFiles(path.join(root,'terminal.sock'),workspace);
    await chown(outside,1000,1000);await chmod(outside,0o755);
    const doc=await files.read(outside);assert.equal(doc.content,'host-visible');
    await assert.rejects(new LocalFiles(workspace).read(outside),/relatif/);
    await files.replace(outside,'host-visible','host-edited',doc.revision);
    assert.equal(await readFile(outside,'utf8'),'host-edited');assert.equal((await stat(outside)).mode&0o777,0o755);assert.equal((await stat(outside)).uid,1000);assert.equal((await stat(outside)).gid,1000);
    await assert.rejects(files.update(outside,'stale',doc.revision),/changé/);
    const link=path.join(workspace,'link');await symlink(outside,link);
    const linked=await files.read('link');assert.equal(linked.content,'host-edited');await files.remove('link',linked.revision);assert.equal(await readFile(outside,'utf8'),'host-edited');
    const binary=path.join(root,'binary.dat'),bytes=Buffer.alloc(256*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
    await files.import(binary,(async function*(){for(let i=0;i<bytes.length;i+=8192)yield bytes.subarray(i,i+8192);})());
    const download=await files.download(binary),chunks:Uint8Array[]=[];for await(const chunk of download.body)chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(download.entry.size,bytes.length);
    const binaryInfo=await files.info(binary);await files.move(binary,path.join(root,'moved.dat'),binaryInfo.revision);await files.remove(path.join(root,'moved.dat'),binaryInfo.revision);
    await files.mkdir(path.join(root,'folder'));await files.create(path.join(root,'folder','new.txt'),'created');
    const created=await files.info(path.join(root,'folder','new.txt'));await files.remove(created.path,created.revision);await files.remove(path.join(root,'folder'),(await files.info(path.join(root,'folder'))).revision);
    await assert.rejects(new HostFiles(path.join(root,'terminal.sock'),root).read(outside),/refusée/);
    await assert.rejects(new HostFiles(path.join(root,'missing.sock'),workspace).read(outside),/Aucun repli/);
    const abort=new AbortController();abort.abort();await assert.rejects(new HostFiles(path.join(root,'terminal.sock'),workspace,abort.signal).read(outside));
    const cmd=await client.start(workspace,{cwd:'/',command:`set -eu; test "$(id -u)" = 0; test -z "\${HEART_YOLO_TEST_SECRET-}"; cat ${outside}; node -e 'fetch("http://127.0.0.1:${port}").then(r=>r.text()).then(console.log)'`});
    const result=await finish(cmd.id);assert.equal(result.command.exitCode,0,result.output);assert.match(result.output,/host-edited/);assert.match(result.output,/real-network-ok/);assert.doesNotMatch(result.output,/never-inherited/);assert.equal(result.command.cwd,'/');
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
