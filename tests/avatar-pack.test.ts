import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const base=fileURLToPath(new URL('../src/interfaces/web/public/avatar-pack/',import.meta.url));
function chunks(bytes:Buffer){
 const result:{type:string;bytes:Buffer}[]=[];
 assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
 for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4);result.push({type:bytes.toString('ascii',offset,offset+4),bytes:bytes.subarray(offset+8,offset+8+size)});offset+=8+size+(size%2);}
 return result;
}
for (const packId of ['nora-v1','masculine-v1','neutral-v1']) test(`${packId} has real animated frames, transparent fallbacks and all sizes with verified hashes`,async()=>{
 const root=path.join(base,packId);
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 assert.match(manifest.id,/^[0-9a-f-]{36}$/);
 let animations=0,posters=0;
 for(const file of manifest.files){
  assert(!file.path.includes('..'));
  const bytes=await readFile(path.join(root,file.path));
  assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
  if(file.path.endsWith('.webp')){
   const data=chunks(bytes),animation=data.find(chunk=>chunk.type==='ANIM');
   assert(animation,`${file.path} must contain real animation control`);
   assert.equal(animation.bytes.readUInt16LE(4),file.loop?0:1);
   const frames=data.filter(chunk=>chunk.type==='ANMF');assert(frames.length>=(file.loop?20:12));
   assert(new Set(frames.map(frame=>createHash('sha256').update(frame.bytes).digest('hex'))).size>1);
   const extended=data.find(chunk=>chunk.type==='VP8X')!;assert(extended.bytes[0]&0x10,'alpha flag required');
   assert.equal(extended.bytes.readUIntLE(4,3)+1,file.size);assert.equal(extended.bytes.readUIntLE(7,3)+1,file.size);
   animations++;
  }
  if(file.path.endsWith('.png')){
   assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
   assert.equal(bytes.readUInt32BE(16),file.size);assert.equal(bytes.readUInt32BE(20),file.size);
   assert.equal(bytes[25],6,'RGBA PNG required');posters++;
  }
 }
 assert.equal(animations,39);assert.equal(posters,27);
 for(const state of manifest.states)for(const size of manifest.portraitSizes)for(const extension of ['png','webp']){
  assert(manifest.files.some((file:{path:string})=>file.path===`portrait/${state}-${size}.${extension}`));
 }
});
