import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileTools } from "../src/modules/tools/files/index.ts";
import { memoryTools } from "../src/modules/tools/memory/index.ts";

test("file tools work independently of a model, engine or storage", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "harness-tools-"));
  const tools = new Map(fileTools().map(tool => [tool.name, tool]));
  const context = { workspace };
  try {
    await tools.get("files.create")!.execute({ path: "note.txt", content: "A useful note" }, context);
    assert.equal(JSON.parse(await tools.get("files.read")!.execute({ path: "note.txt" }, context)).content, "A useful note");
    assert.deepEqual(JSON.parse(await tools.get("files.list")!.execute({}, context)).entries.map((item: {name:string}) => item.name), ["note.txt"]);
    await assert.rejects(tools.get("files.create")!.execute({ path: "note.txt", content: "replacement" }, context));
    assert.equal(JSON.parse(await tools.get("files.read")!.execute({ path: "note.txt" }, context)).content, "A useful note");
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("memory tools use an injected service without accessing a database or model", async () => {
  const calls: string[] = [];
  const tools = memoryTools({
    async remember(content) { calls.push(`remember:${content}`); return { id: "external", content }; },
    async search(query) { calls.push(`search:${query}`); return [{ id: "external", content: "Found" }]; },
  });
  const context = { workspace: "." };
  const remember = tools.find(tool => tool.name === "memory.remember")!;
  const search = tools.find(tool => tool.name === "memory.search")!;
  assert.deepEqual(JSON.parse(await remember.execute({ content: "Preference" }, context)), { id: "external", content: "Preference" });
  assert.deepEqual(JSON.parse(await search.execute({ query: "Preference" }, context)), [{ id: "external", content: "Found" }]);
  await assert.rejects(remember.execute({ content: 123 }, context), /invalide/);
  await assert.rejects(search.execute({}, context), /invalide/);
  assert.deepEqual(calls, ["remember:Preference", "search:Preference"]);
});

test('explicit host scope accepts absolute paths and parent paths while protected files stay confined',async()=>{
 const {LocalFiles}=await import('../src/modules/tools/files/index.ts');
 const {mkdir,writeFile,stat,chmod,symlink}=await import('node:fs/promises');
 const root=await mkdtemp(path.join(os.tmpdir(),'heart-host-files-')),workspace=path.join(root,'thread'),outside=path.join(root,'outside.txt');
 await mkdir(workspace);await writeFile(outside,'original');await chmod(outside,0o755);await symlink(outside,path.join(workspace,'link.txt'));
 try{
  const protectedFiles=new LocalFiles(workspace),host=new LocalFiles(workspace,true);
  await assert.rejects(protectedFiles.read(outside),/relatif/);await assert.rejects(protectedFiles.read('../outside.txt'),/hors/);await assert.rejects(protectedFiles.read('link.txt'),/symboliques/);
  const read=await host.read(outside);assert.equal(read.content,'original');assert.equal((await host.read('../outside.txt')).content,'original');assert.equal((await host.read('link.txt')).content,'original');
  await host.update(outside,'changed',read.revision);assert.equal((await stat(outside)).mode&0o777,0o755);
  await assert.rejects(host.update(outside,'stale',read.revision),/changé/);
  await host.update('link.txt','through-link',(await host.info('link.txt')).revision);assert.equal((await host.read(outside)).content,'through-link');
  await host.remove('link.txt',(await host.info('link.txt')).revision);assert.equal((await host.read(outside)).content,'through-link');
  const made=path.join(root,'created.txt');await host.create(made,'new');await host.move(made,path.join(root,'moved.txt'),(await host.info(made)).revision);await host.remove(path.join(root,'moved.txt'),(await host.info(path.join(root,'moved.txt'))).revision);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('file tool revision receipts remain short, path-bound, stale-safe and local to one tool set',async()=>{
 const {LocalFiles}=await import('../src/modules/tools/files/index.ts');
 const root=await mkdtemp(path.join(os.tmpdir(),'heart-file-receipts-')),files=new LocalFiles(root),tools=new Map(fileTools().map(tool=>[tool.name,tool])),context={workspace:root};
 const run=(name:string,args:any)=>tools.get(name)!.execute(args,context);
 try{
  await files.create('a.txt','first');await files.create('b.txt','other');
  const doc=JSON.parse(await run('files.read',{path:'a.txt'}));assert(doc.revision.length<30);assert.notEqual(doc.revision,(await files.info('a.txt')).revision);
  await assert.rejects(run('files.update',{path:'b.txt',content:'bad',revision:doc.revision}),/autre chemin/);assert.equal((await files.read('b.txt')).content,'other');
  await run('files.update',{path:'a.txt',content:'changed',revision:doc.revision});assert.equal((await files.read('a.txt')).content,'changed');
  await assert.rejects(run('files.update',{path:'a.txt',content:'stale',revision:doc.revision}),/changé/);
  const fresh=fileTools().find(tool=>tool.name==='files.update')!;await assert.rejects(fresh.execute({path:'a.txt',content:'expired',revision:doc.revision},context),/expirée/);
  // Owner UI and older integrations still use the canonical revision contract.
  await fresh.execute({path:'a.txt',content:'owner-edit',revision:(await files.info('a.txt')).revision},context);assert.equal((await files.read('a.txt')).content,'owner-edit');
 }finally{await rm(root,{recursive:true,force:true});}
});
