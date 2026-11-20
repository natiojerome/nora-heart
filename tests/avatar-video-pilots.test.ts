import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
const root=fileURLToPath(new URL('../',import.meta.url));
test('video pilots are completed provider videos, with source identity and unapproved review status preserved',async()=>{
 const results=JSON.parse(await readFile(path.join(root,'src/interfaces/web/public/avatar-pilots/v2/results.json'),'utf8'));
 assert.equal(results.model,'bytedance/seedance-2.0');assert.equal(results.status,'awaiting-visual-review');assert.equal(results.pilots.length,2);
 for(const id of ['masculine','neutral']){
  const original=await readFile(path.join(root,`assets/avatar-video-pilots/v2/${id}-pilot.mp4`));
  const result=JSON.parse(await readFile(path.join(root,`assets/avatar-video-pilots/v2/${id}-result.json`),'utf8'));
  assert.equal(result.status,'completed');assert.equal(result.sha256,createHash('sha256').update(original).digest('hex'));
  assert.equal(result.model,'bytedance/seedance-2.0');assert(Number(result.usage.cost)>0);
  const served=await readFile(path.join(root,`src/interfaces/web/public/avatar-pilots/v2/${id}-original.mp4`));assert(original.equals(served));
  for(const kind of ['body','portrait']){
   const animated=await readFile(path.join(root,`src/interfaces/web/public/avatar-pilots/v2/${id}-${kind}.webp`));
   assert.equal(animated.toString('ascii',0,4),'RIFF');assert(animated.includes(Buffer.from('ANIM')));assert(animated.length>50000);
  }
 }
});

test('portrait series preserves five real videos and an explicit local waiting variant, three sizes and explicit waiting symbol provenance',async()=>{
 const dir=path.join(root,'src/interfaces/web/public/avatar-portraits/v3');
 const results=JSON.parse(await readFile(path.join(dir,'results.json'),'utf8'));
 assert.equal(results.status,'awaiting-visual-review');assert.equal(results.portraits.length,6);
 assert.match(results.questionMark,/overlay/);
 for(const identity of ['orion','prisme'])for(const state of ['working','idle','waiting']){
  const id=identity+'-'+state,source=path.join(root,'assets/avatar-portraits/v3');
  const sourceId=id==='prisme-waiting'?'prisme-idle':id;
  const record=JSON.parse(await readFile(path.join(source,sourceId+'-result.json'),'utf8'));
  const servedRecord=results.portraits.find((item: {id:string})=>item.id===id);
  assert.equal(servedRecord.method,sourceId===id?'generated-video':'local-composition');
  if(sourceId!==id)assert.equal(servedRecord.usage,null);
  assert.equal(record.status,'completed');
  const bytes=await readFile(path.join(source,sourceId+'-pilot.mp4'));
  assert.equal(record.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert(bytes.equals(await readFile(path.join(dir,id+'-original.mp4'))));
  for(const size of [64,128,256]){
   const webp=await readFile(path.join(dir,`${id}-${size}.webp`));
   assert(webp.includes(Buffer.from('ANIM')));assert(webp.includes(Buffer.from('ALPH')));
   const png=await readFile(path.join(dir,`${id}-${size}.png`));
   assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  }
 }
});

test('V4 bot portraits retain new Orion provenance, reused Prisme videos and transparent bubble exports',async()=>{
 const dir=path.join(root,'src/interfaces/web/public/avatar-portraits/v4');
 const results=JSON.parse(await readFile(path.join(dir,'results.json'),'utf8'));
 assert.equal(results.status,'awaiting-visual-review');assert.equal(results.portraits.length,6);
 assert.match(results.questionMark,/3D speech bubble/);
 for(const identity of ['orion','prisme'])for(const state of ['working','idle','waiting']){
  const id=identity+'-'+state,version=identity==='orion'?'v4':'v3',sourceId=id==='prisme-waiting'?'prisme-idle':id;
  const record=results.portraits.find((item: {id:string})=>item.id===id);
  assert.equal(record.sourceVersion,version);assert.equal(record.sourceId,sourceId);
  const source=await readFile(path.join(root,`assets/avatar-portraits/${version}/${sourceId}-pilot.mp4`));
  assert.equal(record.sha256,createHash('sha256').update(source).digest('hex'));
  assert(source.equals(await readFile(path.join(dir,id+'-original.mp4'))));
  for(const size of [64,128,256]){
   const png=await readFile(path.join(dir,`${id}-${size}.png`));assert.equal(png.readUInt32BE(16),size);
   const animated=await readFile(path.join(dir,`${id}-${size}.webp`));assert(animated.includes(Buffer.from('ANIM')));
  }
 }
});

test('V5 work and waiting each have a distinct real video, with unchanged rest sources',async()=>{
 const dir=path.join(root,'src/interfaces/web/public/avatar-portraits/v5');
 const results=JSON.parse(await readFile(path.join(dir,'results.json'),'utf8'));
 assert.equal(results.portraits.length,6);assert.equal(results.status,'awaiting-visual-review');
 for(const identity of ['orion','prisme']){
  const rest=results.portraits.find((item:{id:string})=>item.id===identity+'-idle');
  for(const state of ['working','waiting']){
   const id=identity+'-'+state,row=results.portraits.find((item:{id:string})=>item.id===id);
   assert.equal(row.sourceVersion,'v5');assert.equal(row.sourceId,id);assert.equal(row.method,'generated-video');
   assert.notEqual(row.sha256,rest.sha256,'waiting must not reuse the rest video');
   const input=await readFile(path.join(root,'assets/avatar-portraits/v5',id+'-pilot.mp4'));
   assert.equal(row.sha256,createHash('sha256').update(input).digest('hex'));
   assert(input.equals(await readFile(path.join(dir,id+'-original.mp4'))));
   for(const size of [64,128,256]){
    const webp=await readFile(path.join(dir,`${id}-${size}.webp`));assert(webp.includes(Buffer.from('ANIM')));
    const png=await readFile(path.join(dir,`${id}-${size}.png`));assert.equal(png.readUInt32BE(16),size);
   }
  }
 }
});
