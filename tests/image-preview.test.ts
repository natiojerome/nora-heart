import assert from 'node:assert/strict';
import {test} from 'node:test';
import {imagePreview} from '../src/app/image-preview.ts';

async function bytes(body:AsyncIterable<Uint8Array>){const chunks=[];for await(const chunk of body)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
test('image preview streams complete original bytes, recognizes raster signatures and SVG without trusting an extension',async()=>{
  for(const [type,name,header] of [
    ['image/png','opaque.bin',Buffer.from([137,80,78,71,13,10,26,10])],
    ['image/jpeg','image.jpg',Buffer.from([255,216,255,224])],
    ['image/gif','image.gif',Buffer.from('GIF89a')],
    ['image/webp','image.webp',Buffer.from('RIFF1234WEBP')],
    ['image/avif','image.avif',Buffer.from('0000ftypavif')],
    ['image/svg+xml','graph.svg',Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">')],
  ] as const){
    const original=Buffer.concat([header,Buffer.alloc(70000,32)]);
    let reads=0,closed=false;
    async function* stream(){try{for(let offset=0;offset<original.length;offset+=333){reads++;yield original.subarray(offset,offset+333);}}finally{closed=true;}}
    const result=await imagePreview(stream(),name);assert.equal(result.mediaType,type);assert(reads<10,'Only the prefix is read before returning a stream');
    assert.deepEqual(await bytes(result.body()),original);assert(closed);
  }
});
test('image preview rejects empty, forged and active non-image content and closes its input on failure or cancellation',async()=>{
  for(const content of ['', '<html><script>unsafe()</script></html>', '<!DOCTYPE html><svg></svg>']){
    let closed=false;async function* source(){try{yield Buffer.from(content);yield Buffer.alloc(2000);}finally{closed=true;}}
    await assert.rejects(imagePreview(source(),'forged.png'),/affiché comme image/);assert(closed);
  }
  let closed=false;async function* source(){try{yield Buffer.concat([Buffer.from('GIF89a'),Buffer.alloc(2000)]);yield Buffer.alloc(2000);}finally{closed=true;}}
  const result=await imagePreview(source(),'image.gif');for await(const _ of result.body())break;assert(closed,'consumer cancellation closes source');
  closed=false;const unread=await imagePreview(source(),'image.gif');await unread.close();assert(closed,'HTTP disposal also closes a prefetched source before body consumption');
});
