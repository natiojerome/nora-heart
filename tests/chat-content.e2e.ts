import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createServer as reserve} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {chromium} from '@playwright/test';
import {TestLab} from '../src/app/test-lab.ts';
import {WebAccess} from '../src/app/web-access.ts';
import {createWebServer} from '../src/interfaces/web/server.ts';
import {assistantFixture} from './assistant.fixture.ts';
import {defaultAssistant} from '../src/app/assistant.ts';
import {conversationFixture} from './conversation-fixture.ts';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"><rect width="720" height="360" rx="20" fill="#eef1ec"/><text x="40" y="55" fill="#18201e" font-family="sans-serif" font-size="24">Activité du projet</text><path d="M60 290H660" stroke="#bec8bf"/><rect x="100" y="200" width="100" height="90" rx="8" fill="#176b5c"/><rect x="310" y="145" width="100" height="145" rx="8" fill="#176b5c"/><rect x="520" y="95" width="100" height="195" rx="8" fill="#176b5c"/><text x="100" y="325" font-family="sans-serif" fill="#18201e">Septembre</text><text x="310" y="325" font-family="sans-serif" fill="#18201e">Octobre</text><text x="520" y="325" font-family="sans-serif" fill="#18201e">Novembre</text></svg>';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nkoAAAAASUVORK5CYII=','base64');
test('chat displays responsive tables and local images, opens files, preserves previews and blocks implicit remote loads', {timeout:45000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-chat-content-'));
 const lab=new TestLab({directory:path.join(dir,'lab'),authDirectory:path.join(dir,'auth')});await lab.prepare();
 let instructions='';
 const fixture=await conversationFixture(path.join(dir,'threads'),()=>({id:'display-fixture',async generate(request){instructions=request.instructions||'';return {content:'# Résultats du projet\n\n| Étape | Statut | Livrable |\n| --- | --- | --- |\n| Interface | Validée | [Notes](out/notes.md) |\n| Graphique | Disponible | SVG |\n| Intégration | En cours | ![Graphique en cellule](out/chart.svg) |\n\n![Activité du projet](out/chart.svg)\n\n[Notes du projet](out/notes.md)\n\n![Image distante](https://images.example.invalid/pixel.png)\n\n![Image absente](out/missing.png)\n\n<img src="https://images.example.invalid/tracker.png" onerror="window.__unsafe=true">\n[Interdit](javascript:alert(1))\n![Traversée](../../private.png)',toolCalls:[]};}}));
 const {conversation}=await fixture.service.create({title:'Tableaux et livrables'});
 await fixture.service.mutateWorkspace(conversation.id,{action:'mkdir',path:'out'});
 for(const [name,content] of [['chart.svg',svg],['notes.md','# Notes du projet\n\nLivrable de démonstration.'],['forged.png','<html><script>window.__unsafe=true</script></html>']])await fixture.service.mutateWorkspace(conversation.id,{action:'create',path:'out/'+name,content});
 await fixture.service.send(conversation.id,{provider:'demo',prompt:'Montre les résultats',contextWindow:32768});
 assert.match(instructions,/Affichage dans le chat/);
 const assistant=assistantFixture();await assistant.save({version:0,settings:{...defaultAssistant,completed:true,step:5}});
 const reservation=reserve();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
 const origin='http://127.0.0.1:'+port;
 const server=createWebServer({origin,access:new WebAccess({secret:'fake-content-session-secret-at-least-32-chars',password:'fake-password'}),lab,conversations:fixture.service,assistant});await new Promise<void>(r=>server.listen(port,'127.0.0.1',r));
 const browser=await chromium.launch({args:process.getuid?.()===0?['--no-sandbox']:[]});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors:string[]=[],external:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.fulfill({contentType:'image/png',body:png});});
  await page.goto(origin+'/?conversation='+conversation.id);await page.fill('#password','fake-password');await page.click('#login-submit');
  await page.waitForSelector('.content-table');
  const localImage=page.locator('.content-image').filter({has:page.getByText('Activité du projet',{exact:true})});
  await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('.content-image img')].some(img=>img.complete&&img.naturalWidth===720));
  assert.deepEqual(external,[],'Remote Markdown and raw HTML do not load implicitly');
  assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
  assert.equal(await page.evaluate(()=>!!(window as any).__unsafe),false);
  assert(await page.getByText('Image indisponible.',{exact:true}).isVisible());
  const read=await context.request.get(origin+`/api/conversations/${conversation.id}/workspace/preview?path=out/chart.svg`);assert.equal(read.status(),200);assert.equal(await read.text(),svg);assert.equal(read.headers()['content-type'],'image/svg+xml');assert.match(read.headers()['content-security-policy'],/sandbox; default-src 'none'/);assert.match(read.headers()['cache-control'],/no-store/);
  assert.equal((await fetch(origin+`/api/conversations/${conversation.id}/workspace/preview?path=out/chart.svg`)).status,401);
  for(const name of ['out/forged.png','../private.png','out/missing.png'])assert.equal((await context.request.get(origin+`/api/conversations/${conversation.id}/workspace/preview?path=`+encodeURIComponent(name))).status(),400);
  const shots=path.resolve('docs/design/chat-content');await mkdir(shots,{recursive:true});
  for(const width of [320,390,820,1440]){
   await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const table=page.locator('.content-table');await table.getByRole('button',{name:'Agrandir',exact:true}).click();
   const modal=page.locator('.content-viewer');await modal.waitFor();
   const box=await modal.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width+1);
   assert.equal(await modal.locator('.content-table-card').count(),width<680?3:0);
   await modal.getByRole('button',{name:'Tableau',exact:true}).click();assert(await modal.locator('table').isVisible());
   await modal.getByRole('button',{name:'Cartes',exact:true}).click();assert.equal(await modal.locator('.content-table-card').count(),3);assert(await modal.getByRole('button',{name:'Agrandir Graphique en cellule',exact:true}).count());
   await modal.getByRole('button',{name:'Copier',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.content-viewer')?.textContent?.includes('Copié'));assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Étape\tStatut\tLivrable/);
   if(width===390)await page.screenshot({path:path.join(shots,'table-cards-mobile.png')});
   if(width===390){await modal.getByRole('button',{name:'Agrandir Graphique en cellule',exact:true}).click();await page.waitForFunction(()=>document.getElementById('content-viewer-title')?.textContent==='Graphique en cellule');}
   await page.keyboard.press('Escape');await modal.waitFor({state:'detached'});assert.equal(await modal.count(),0);assert(await table.getByRole('button',{name:'Agrandir',exact:true}).evaluate(node=>node===document.activeElement));
  }
  await page.setViewportSize({width:390,height:844});
  await localImage.getByRole('button',{name:'Agrandir Activité du projet'}).click();await page.waitForSelector('.content-viewer img');assert(await page.locator('.content-viewer img').isVisible());await page.screenshot({path:path.join(shots,'image-mobile.png')});await page.keyboard.press('Escape');
  const download=page.waitForEvent('download');await localImage.getByRole('link',{name:'Télécharger',exact:true}).click();assert.equal((await download).suggestedFilename(),'chart.svg');
  await localImage.getByRole('button',{name:'Masquer',exact:true}).click();assert.equal(await localImage.locator('img').count(),0);await localImage.getByRole('button',{name:'Afficher l’image',exact:true}).click();await localImage.locator('img').waitFor();
  await page.getByRole('link',{name:'Notes du projet',exact:true}).click();await page.waitForSelector('#workspace-editor[open]');assert.match(await page.inputValue('#workspace-content'),/Livrable de démonstration/);await page.getByRole('button',{name:'Fermer l’éditeur',exact:true}).click();
  const remote=page.locator('.content-image').filter({has:page.getByText('Image distante',{exact:true})});await remote.getByRole('button',{name:'Afficher l’image',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('.content-image img')].some(img=>img.src.includes('images.example.invalid')&&img.complete&&img.naturalWidth>0));assert.equal(external.length,1);
  const preserved=await localImage.locator('img').elementHandle();
  await page.evaluate(async id=>{const data=await(await fetch('/api/conversations/'+id)).json();(window as any).heartChat.render({...data,events:[...data.events,{id:'display-only-event',type:'context.usage',data:{}}]});},conversation.id);
  assert(await preserved!.evaluate(node=>node.isConnected),'Technical updates preserve loaded images');
  assert.equal(external.length,1);
  await page.reload();await page.waitForSelector('.content-table');assert.equal(external.length,1,'Reopening a conversation does not load remote images');await page.waitForFunction(()=>[...document.querySelectorAll<HTMLImageElement>('.content-image img')].some(img=>img.complete&&img.naturalWidth===720));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fixture.storage.close();await lab.close();await rm(dir,{recursive:true,force:true});}
});
