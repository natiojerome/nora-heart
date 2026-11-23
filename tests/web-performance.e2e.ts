import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {createServer as reserve} from 'node:net';
import {chromium} from '@playwright/test';
import {TestLab} from '../src/app/test-lab.ts';import {WebAccess} from '../src/app/web-access.ts';import {createWebServer} from '../src/interfaces/web/server.ts';
import {assistantFixture} from './assistant.fixture.ts';import {defaultAssistant} from '../src/app/assistant.ts';import {conversationFixture} from './conversation-fixture.ts';

test('browser shares in-flight reads and preserves SVG DOM during repeated icon reconciliation', {timeout:30000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-ui-perf-'));
 const lab=new TestLab({directory:path.join(directory,'lab'),authDirectory:path.join(directory,'auth')});await lab.prepare();
 const fixture=await conversationFixture(path.join(directory,'threads'));
 await fixture.service.create({title:'Session de mesure temporaire'});
 const assistant=assistantFixture();await assistant.save({version:0,settings:{...defaultAssistant,completed:true,step:5}});
 const reservation=reserve();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));const origin='http://127.0.0.1:'+port;
 const server=createWebServer({origin,access:new WebAccess({secret:'fake-performance-session-secret-at-least-32-chars',password:'fake-password'}),lab,assistant,conversations:fixture.service});await new Promise<void>(r=>server.listen(port,'127.0.0.1',r));
 const browser=await chromium.launch({args:process.getuid?.()===0?['--no-sandbox']:[]});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/#settings');await page.fill('#password','fake-password');await page.click('#login-submit');await page.waitForSelector('#screen-settings:not([hidden])');
  let requests=0;await page.route('**/api/conversations?performance=1',route=>{requests++;return route.continue();});
  const independent=await page.evaluate(async()=>{const [a,b]=await Promise.all([(window as any).api('/api/conversations?performance=1',{quiet:true}),(window as any).api('/api/conversations?performance=1',{quiet:true})]);a.conversations[0].title='Local consumer edit';return b.conversations[0].title!=='Local consumer edit';});
  assert.equal(requests,1);assert(independent);
  const icons=await page.evaluate(()=>{(window as any).heartIcons.render(document);const nodes=[...document.querySelectorAll('[data-icon] svg')],observer=new MutationObserver(()=>{});observer.observe(document,{subtree:true,attributes:true,childList:true,characterData:true});for(let i=0;i<10;i++)(window as any).heartIcons.render(document);const mutations=observer.takeRecords().length;observer.disconnect();return{count:nodes.length,mutations,preserved:nodes.every((svg,index)=>svg===document.querySelectorAll('[data-icon] svg')[index])};});
  assert(icons.count>10);assert.equal(icons.mutations,0);assert(icons.preserved);assert.deepEqual(errors,[]);
  const work=await page.evaluate(()=>{
   const controller=(window as any).heartWork,target=document.getElementById('conversation-work')!;
   const item={id:'00000000-0000-4000-8000-000000000001',title:'Synthetic task',work:{status:'running',at:'one'}};
   controller.update([item]);const first=target.firstElementChild,observer=new MutationObserver(()=>{});
   observer.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});
   for(let i=0;i<10;i++)controller.update([{...item,work:{...item.work,at:String(i),phase:i%2?'reasoning':'waiting'}}]);
   const mutations=observer.takeRecords().length;observer.disconnect();const preserved=first===target.firstElementChild;
   controller.update([]);return{mutations,preserved};
  });
  assert.equal(work.mutations,0,'unchanged visible task state must not redraw on internal progress');assert(work.preserved);

  const reportDirectory=path.resolve('docs/qualification/ui-cleanup');await mkdir(reportDirectory,{recursive:true});await writeFile(path.join(reportDirectory,'2026-11-17.json'),JSON.stringify({at:new Date().toISOString(),browser:'Chromium Linux',scope:'actual browser controllers and HTTP on disposable state; no inference or owner writes',simultaneousIdenticalReads:2,networkRequests:requests,responseConsumersIndependent:independent,iconReconciliations:10,icons:icons.count,domMutations:icons.mutations,svgNodesPreserved:icons.preserved,workReconciliations:10,workDomMutations:work.mutations,workNodesPreserved:work.preserved,jsErrors:errors.length,limits:['No claim about total startup time or all rendering costs','No pagination or network delta added','Physical mobile devices not qualified']},null,2)+'\n');
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fixture.storage.close();await lab.close();await rm(directory,{recursive:true,force:true});}
});
