import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp,rm } from 'node:fs/promises';
import { createServer as reserve } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { TestLab } from '../src/app/test-lab.ts';
import { WebAccess } from '../src/app/web-access.ts';
import { createWebServer } from '../src/interfaces/web/server.ts';

test('avatar preview plays real frames, changes state, preserves transparency and respects mobile/reduced motion', {timeout:45000},async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'heart-avatar-'));
 const reservation=reserve();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const origin=`http://127.0.0.1:${port}`,url=origin+'/avatar-pack/nora-v1/';
 const lab=new TestLab({directory:path.join(folder,'lab'),authDirectory:path.join(folder,'auth')});await lab.prepare();
 const server=createWebServer({origin,access:new WebAccess({secret:'fake-avatar-test-secret-not-a-real-owner-secret',password:'fake-test-password'}),lab});
 await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));
 const cached=path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell');
 const browser=await chromium.launch({headless:true,executablePath:existsSync(cached)?cached:undefined,args:process.getuid?.()===0?['--no-sandbox']:[]});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage();
  const errors:string[]=[],external:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
  await page.goto(url);await page.waitForFunction(()=>document.querySelector<HTMLImageElement>('#main-portrait')?.complete);
  assert.equal(await page.locator('.size-item').count(),6);
  assert((await page.locator('#main-portrait').getAttribute('src'))?.endsWith('.webp'));
  const decode=await page.evaluate(async()=>{
   // ImageDecoder verifies rendered frames, rather than trusting the filename.
   const Decoder=(window as unknown as {ImageDecoder:new(options:{data:ArrayBuffer;type:string})=>any}).ImageDecoder;
   const decoder=new Decoder({data:await(await fetch('./portrait/working-128.webp')).arrayBuffer(),type:'image/webp'});
   await decoder.tracks.ready;
   const count=decoder.tracks.selectedTrack.frameCount;
   const first=(await decoder.decode({frameIndex:0})).image,last=(await decoder.decode({frameIndex:Math.floor(count/2)})).image;
   const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!;
   ctx.drawImage(first,0,0);const a=ctx.getImageData(0,0,128,128).data;
   ctx.clearRect(0,0,128,128);ctx.drawImage(last,0,0);const b=ctx.getImageData(0,0,128,128).data;
   let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
   first.close();last.close();decoder.close();return {count,changed,cornerAlpha:a[3],maxAlpha:Math.max(...a.filter((_,i)=>i%4===3))};
  });
  assert(decode.count>=20);assert(decode.changed>100);assert.equal(decode.cornerAlpha,0);assert.equal(decode.maxAlpha,255);
  await page.click('[data-state="waiting"]');
  await page.waitForFunction(()=>document.getElementById('main-portrait')?.dataset.transition==='yes');
  await page.waitForFunction(()=>document.querySelector<HTMLImageElement>('#main-portrait')?.getAttribute('src')==='./portrait/waiting-256.webp');
  await page.click('#pause');assert((await page.locator('#main-portrait').getAttribute('src'))?.endsWith('.png'));
  await page.click('#theme');assert(await page.locator('body').evaluate(node=>node.classList.contains('dark')));
  for(const width of [320,390,820]){
   await page.setViewportSize({width,height:900});await page.goto(url);await page.waitForSelector('.size-item');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
  }
  const reduced=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),still=await reduced.newPage();
  await still.goto(url);await still.waitForSelector('.size-item');
  assert((await still.locator('#main-portrait').getAttribute('src'))?.endsWith('.png'));
  assert(await still.locator('#pause').isDisabled());
  assert.equal((await context.request.get(origin+'/avatar-pack/nora-v1/not-an-asset.webp')).status(),404);
  assert.equal((await context.request.get(origin+'/api/memories')).status(),401);
  const identities = [];
  for (const packId of ['masculine-v1','neutral-v1']) {
    const target=origin+'/avatar-pack/'+packId+'/';
    const response=await context.request.get(target+'manifest.json');assert.equal(response.status(),200);
    const manifest=await response.json();identities.push(manifest.id);
    assert.equal(manifest.source.type,'new-original-layered-artwork');
    await page.setViewportSize({width:390,height:844});await page.goto(target);await page.waitForSelector('.size-item');
    assert((await page.textContent('h1'))?.includes(manifest.displayName));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const changed=await page.evaluate(async()=>{
      const Decoder=(window as unknown as {ImageDecoder:new(options:{data:ArrayBuffer;type:string})=>any}).ImageDecoder;
      const decoder=new Decoder({data:await(await fetch('./portrait/working-128.webp')).arrayBuffer(),type:'image/webp'});
      await decoder.tracks.ready;
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const c=canvas.getContext('2d')!;
      const first=(await decoder.decode({frameIndex:0})).image;c.drawImage(first,0,0);const a=c.getImageData(0,0,128,128).data;
      const next=(await decoder.decode({frameIndex:6})).image;c.clearRect(0,0,128,128);c.drawImage(next,0,0);const b=c.getImageData(0,0,128,128).data;
      let count=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])count++;
      first.close();next.close();decoder.close();return count;
    });
    assert(changed>100);
    await page.click('[data-state="waiting"]');
    await page.waitForFunction(()=>document.querySelector<HTMLImageElement>('#main-portrait')?.getAttribute('src')==='./portrait/waiting-256.webp');
    await page.click('#pause');assert((await page.locator('#main-portrait').getAttribute('src'))?.endsWith('.png'));
  }
  assert.equal(new Set(identities).size,2);
  await page.goto(origin+'/avatar-pack/');assert.equal(await page.locator('a.primary').count(),3);
  await page.goto(origin+'/avatar-pilots/v2/');await page.waitForSelector('img[data-id]');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.click('#pause');assert((await page.locator('img[data-id]').first().getAttribute('src'))?.endsWith('.png'));
  await page.click('#theme');assert(await page.locator('body').evaluate(node=>node.classList.contains('dark')));
  const partial=await context.request.get(origin+'/avatar-pilots/v2/neutral-original.mp4',{headers:{Range:'bytes=0-31'}});
  assert.equal(partial.status(),206);assert.equal((await partial.body()).length,32);assert.match(partial.headers()['content-range'],/^bytes 0-31\//);
  const invalidRange=await context.request.get(origin+'/avatar-pilots/v2/neutral-original.mp4',{headers:{Range:'bytes=999999999-'}});assert.equal(invalidRange.status(),416);
  await page.goto(origin+'/avatar-portraits/v3/');
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].length===6&&[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].every(img=>img.complete&&img.naturalWidth===256));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const portraitAnimation=await page.evaluate(async()=>{
    const Decoder=(window as unknown as {ImageDecoder:new(options:{data:ArrayBuffer;type:string})=>any}).ImageDecoder;
    const decoder=new Decoder({data:await(await fetch('./orion-waiting-256.webp')).arrayBuffer(),type:'image/webp'});
    await decoder.tracks.ready;
    const first=(await decoder.decode({frameIndex:0})).image,next=(await decoder.decode({frameIndex:24})).image;
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d')!;
    ctx.drawImage(first,0,0);const a=ctx.getImageData(0,0,256,256).data;
    ctx.clearRect(0,0,256,256);ctx.drawImage(next,0,0);const b=ctx.getImageData(0,0,256,256).data;
    let changed=0,questionPixels=0;
    for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
    for(let y=10;y<90;y++)for(let x=210;x<255;x++){const i=(y*256+x)*4;if(a[i+3]>128&&a[i+1]>140&&a[i+2]>150&&a[i]<150)questionPixels++;}
    const frames=decoder.tracks.selectedTrack.frameCount;first.close();next.close();decoder.close();
    return {frames,changed,questionPixels,alpha:a[3]};
  });
  assert(portraitAnimation.frames>=90);assert(portraitAnimation.changed>100);assert(portraitAnimation.questionPixels>50);assert.equal(portraitAnimation.alpha,0);
  await page.selectOption('#size','64');
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].every(img=>img.complete&&img.naturalWidth===64));
  await page.click('#pause');assert((await page.locator('img[data-id]').first().getAttribute('src'))?.endsWith('.png'));
  await page.click('#theme');assert(await page.locator('body').evaluate(node=>node.classList.contains('dark')));
  await still.goto(origin+'/avatar-portraits/v3/');
  assert((await still.locator('img[data-id]').first().getAttribute('src'))?.endsWith('.png'));
  const portraitRange=await context.request.get(origin+'/avatar-portraits/v3/orion-working-original.mp4',{headers:{Range:'bytes=0-31'}});
  assert.equal(portraitRange.status(),206);
  await page.goto(origin+'/avatar-portraits/v4/');
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].length===6&&[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].every(img=>img.complete&&img.naturalWidth===256));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const bubble=await page.evaluate(async()=>{
    const Decoder=(window as unknown as {ImageDecoder:new(options:{data:ArrayBuffer;type:string})=>any}).ImageDecoder;
    const decoder=new Decoder({data:await(await fetch('./prisme-waiting-256.webp')).arrayBuffer(),type:'image/webp'});
    await decoder.tracks.ready;
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d')!;
    const first=(await decoder.decode({frameIndex:0})).image;ctx.drawImage(first,0,0);const a=ctx.getImageData(0,0,256,256).data;
    const next=(await decoder.decode({frameIndex:24})).image;ctx.clearRect(0,0,256,256);ctx.drawImage(next,0,0);const b=ctx.getImageData(0,0,256,256).data;
    let changed=0,visible=0;for(let y=30;y<100;y++)for(let x=195;x<250;x++){const i=(y*256+x)*4;if(a[i+3]>128)visible++;if(a[i+3]!==b[i+3])changed++;}
    const count=decoder.tracks.selectedTrack.frameCount;first.close();next.close();decoder.close();return {count,changed,visible,alpha:a[3]};
  });
  assert(bubble.count>=90);assert(bubble.visible>100);assert(bubble.changed>20);assert.equal(bubble.alpha,0);
  await page.selectOption('#size','64');
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].every(img=>img.complete&&img.naturalWidth===64));
  await page.click('#pause');assert((await page.locator('img[data-id]').first().getAttribute('src'))?.endsWith('.png'));
  await page.click('#theme');assert(await page.locator('body').evaluate(node=>node.classList.contains('dark')));
  await page.goto(origin+'/avatar-portraits/v5/');
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].length===6&&[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].every(img=>img.complete&&img.naturalWidth===256));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const identity of ['orion','prisme']){
    const work=await page.evaluate(async identity=>{
      const Decoder=(window as unknown as {ImageDecoder:new(options:{data:ArrayBuffer;type:string})=>any}).ImageDecoder;
      const decoder=new Decoder({data:await(await fetch(`./${identity}-working-256.webp`)).arrayBuffer(),type:'image/webp'});await decoder.tracks.ready;
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d')!;
      const first=(await decoder.decode({frameIndex:0})).image;ctx.drawImage(first,0,0);const a=ctx.getImageData(0,192,256,64).data;
      const next=(await decoder.decode({frameIndex:24})).image;ctx.clearRect(0,0,256,256);ctx.drawImage(next,0,0);const b=ctx.getImageData(0,192,256,64).data;
      let changed=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])changed++;
      first.close();next.close();decoder.close();return changed;
    },identity);assert(work>200,'typing must visibly animate the lower portrait, not only eyes');
  }
  await page.selectOption('#size','64');
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('img[data-id]')].every(img=>img.complete&&img.naturalWidth===64));
  await page.click('#pause');assert((await page.locator('img[data-id]').first().getAttribute('src'))?.endsWith('.png'));
  const fallback=await context.newPage();
  await fallback.route('**/portrait/working-256.webp',route=>route.abort());
  await fallback.goto(url);
  await fallback.waitForFunction(()=>document.querySelector<HTMLImageElement>('#main-portrait')?.getAttribute('src')==='./portrait/working-256.png');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 }finally{await browser.close();await lab.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(folder,{recursive:true,force:true});}
});
