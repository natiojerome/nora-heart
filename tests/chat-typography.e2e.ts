import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer as reserve} from 'node:net';
import os from 'node:os';import path from 'node:path';import {test} from 'node:test';
import {chromium} from '@playwright/test';
import {TestLab} from '../src/app/test-lab.ts';import {WebAccess} from '../src/app/web-access.ts';import {createWebServer} from '../src/interfaces/web/server.ts';
import {assistantFixture} from './assistant.fixture.ts';import {defaultAssistant} from '../src/app/assistant.ts';import {conversationFixture} from './conversation-fixture.ts';

const emoji='😀 😅 😂 🥹 😍 🤔 😴 🤖 👋 👍 ✅ ❌ ⚠️ 🔄 ⏳ 💬 📂 🔍 🧠 🛠️ 🚀 💡 🎉 ❤️ 💔 ☀️ 🌙 ⭐ 🔥 💧 🌈 🍀 🐼';
const composed='👩🏽‍💻 👨🏻‍💻 🧑🏿‍🚀 👨‍👩‍👧‍👦 🏳️‍🌈 🇷🇪 🇫🇷 🇺🇸 1️⃣ 2️⃣ #️⃣ ❤️ ☺︎ ☺️';
const unicode='Jérôme — cœur, œuf, Æsir, Noël, déjà, où, ça, « guillemets »… 10\u202f000,50 € ; © ® ™ ± × ÷ ≤ ≥ ≠ ∞ → ↔ ✓ ★ ♫';
const combining='NFC : é à ô ñ — NFD : e\u0301 a\u0300 o\u0302 n\u0303 — famille 👨‍👩‍👧‍👦, métier 👩🏽‍💻, drapeau 🇷🇪';
const rtl='مرحبا جيروم، هذا اختبار للنص العربي مع Nora 2026. שלום עולם — العربية والعبرية 123';
const cjk='日本語の文章と絵文字の表示を確認します。中文没有空格也应该自然换行。한국어 텍스트도 확인합니다。'.repeat(5);
const long='LongIdentifiantSansEspace'.repeat(100);
const code='const message = "'+composed+'";\n\tconst accents = "'+combining+'";\nconst long = "'+long+'";';
const cases=[
 {label:'Emojis et symboles',content:'## Emojis et symboles\n\n'+emoji+'\n\n### Séquences composées\n\n'+composed+'\n\n'+unicode+'\n\n'+combining},
 {label:'Emojis en continu',content:'## Emojis sans espaces\n\n'+('👩🏽‍💻👨‍👩‍👧‍👦🇷🇪'.repeat(60))},
 {label:'Markdown riche',content:'# Titre 1\n## Titre 2\n### Titre 3\n#### Titre 4\n##### Titre 5\n###### Titre 6\n\n**Gras 😀**, *italique é*, ***mixte 👩🏽‍💻***, ~~barré~~, `code 🇷🇪`.\n\n> Citation française avec des accents.\n> Deuxième ligne 🧠.\n\n1. Premier point\n2. Deuxième point\n   - Élément imbriqué 👍\n   - Autre élément\n\nSéparateur\n\n---\n\nLien [Documentation é & œ](https://example.invalid/docs?q=%C3%A9).\n\nLittéraux : &lt;script&gt; &amp; **pas du HTML actif**.\n\nCaractères échappés : \\*étoiles\\* et \\[crochets\\].'},
 {label:'Code et tabulations',content:'## Code Unicode et ligne très longue\n\n```js\n'+code+'\n```'},
 {label:'Longueurs extrêmes',content:'## Retours à la ligne\n\n'+long+'\n\n[URL longue](https://example.invalid/'+long+')\n\n'+('Un paragraphe lisible, avec des accents et un emoji 👩🏽‍💻. '.repeat(180))},
 {label:'Texte arabe et hébreu',content:rtl},
 {label:'Texte asiatique',content:cjk},
 {label:'Tableau Unicode',content:'| État | Détail |\n|---|---|\n| ✅ Prêt | '+composed+' |\n| ⏳ En cours | '+unicode+' |\n| 🔍 À vérifier | '+rtl+' |'},
];
const rawUser=unicode+'\n\n'+composed+'\n'+combining+'\n\tTabulation et    quatre espaces\n<svg>texte littéral</svg> **texte brut**';
const inputForm={title:'Formulaire 👩🏽‍💻 — '+long.slice(0,250),description:unicode,questions:[{id:'choice',type:'single',label:'Choix '+long.slice(0,250),options:[{id:'yes',label:'Oui ✅ '+composed,description:long.slice(0,250)},{id:'no',label:'Non ❌'}]},{id:'text',type:'text',label:'Précision en Unicode',maxLength:200}]};

test('extended chat typography: Unicode, emoji, SVG icons, clipboard, RTL, long content, themes and forms', {timeout:90000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-typography-'));
 const lab=new TestLab({directory:path.join(directory,'lab'),authDirectory:path.join(directory,'auth')});await lab.prepare();
 const fixture=await conversationFixture(path.join(directory,'threads'),()=>({id:'typography-fixture',async generate(request){
  const prompt=request.messages.findLast(m=>m.role==='user')?.content;
  if(prompt==='Formulaire Unicode'&&!request.messages.some(m=>m.role==='tool'&&m.name==='interactions.request_input'))return{content:'',toolCalls:[{id:'unicode-form',name:'interactions.request_input',arguments:JSON.parse(JSON.stringify(inputForm))}]};
  return{content:cases.find(item=>item.label===prompt)?.content??'Texte reçu : '+prompt,toolCalls:[]};
 }}));
 const conversation=(await fixture.service.create({title:'Typographie — '+composed})).conversation;
 for(const item of cases)await fixture.service.send(conversation.id,{provider:'demo',prompt:item.label,contextWindow:262144});
 await fixture.service.send(conversation.id,{provider:'demo',prompt:rtl,contextWindow:262144});
 await fixture.service.send(conversation.id,{provider:'demo',prompt:rawUser,contextWindow:262144});
 const formConversation=(await fixture.service.create({title:'Formulaire Unicode'})).conversation;
 await fixture.service.send(formConversation.id,{provider:'demo',prompt:'Formulaire Unicode',contextWindow:262144});
 const assistant=assistantFixture();await assistant.save({version:0,settings:{...defaultAssistant,completed:true,step:5}});
 const reservation=reserve();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));const origin='http://127.0.0.1:'+port;
 const server=createWebServer({origin,access:new WebAccess({secret:'fake-typography-session-secret-at-least-32-chars',password:'fake-password'}),lab,assistant,conversations:fixture.service});await new Promise<void>(r=>server.listen(port,'127.0.0.1',r));
 const browser=await chromium.launch({args:process.getuid?.()===0?['--no-sandbox']:[]});
 const shots=path.resolve('docs/design/chat-typography');await mkdir(shots,{recursive:true});const measurements:unknown[]=[];
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?conversation='+conversation.id);await page.fill('#password','fake-password');await page.click('#login-submit');await page.waitForSelector('.markdown-body');if(await page.getByRole('button',{name:'Fermer la notification'}).count())await page.getByRole('button',{name:'Fermer la notification'}).click();
  for(const text of [emoji,composed,unicode,combining,rtl,cjk])assert((await page.locator('#conversation-history').textContent())?.includes(text));
  const own=page.locator('.conversation-message.user').last();assert.equal(await own.locator('.user-message-text').textContent(),rawUser);assert.equal(await own.locator('svg').count(),3);assert.equal(await page.locator('.user-message-text').filter({hasText:rtl}).first().evaluate(node=>getComputedStyle(node).direction),'rtl');
  await own.getByRole('button',{name:'Copier mon message'}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),rawUser);
  const codeMessage=page.locator('.conversation-message.assistant').filter({has:page.getByRole('heading',{name:'Code Unicode et ligne très longue',exact:true})});
  await codeMessage.getByRole('button',{name:'Copier',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),code+'\n');
  const first=page.locator('.conversation-message.assistant').filter({has:page.getByRole('heading',{name:'Emojis et symboles',exact:true})});await first.getByRole('button',{name:'Copier la réponse'}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),cases[0].content);
  const iconSource=await readFile('src/interfaces/web/public/icons.js','utf8');const catalogue=iconSource.slice(iconSource.indexOf('  const icons = {'),iconSource.indexOf('  const painted ='));
  const names=[...catalogue.matchAll(/^\s*(?:"([^"]+)"|'([^']+)'|([\w-]+))\s*:/gm)].map(m=>m[1]||m[2]||m[3]);assert(names.length>=40);
  await page.evaluate(names=>{const host=document.createElement('section');host.className='conversation-message assistant';host.id='icon-gallery';host.innerHTML='<h3>Icônes de l’interface</h3>';const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:10px';for(const name of names){const item=document.createElement('div'),icon=document.createElement('span'),label=document.createElement('small');icon.dataset.icon=name;icon.style.cssText='display:block;width:24px;height:24px';label.textContent=name;label.style.fontSize='10px';item.append(icon,label);grid.append(item);}host.append(grid);document.querySelector('#conversation-history')!.prepend(host);(window as any).heartUI.renderIcons(host);},names);
  const iconAudit=await page.locator('#icon-gallery svg').evaluateAll(nodes=>nodes.map(node=>{const box=(node as SVGGraphicsElement).getBBox();return{name:(node.parentElement as HTMLElement).dataset.icon,x:box.x,y:box.y,width:box.width,height:box.height,stroke:getComputedStyle(node).stroke};}));
  assert.equal(iconAudit.length,names.length);assert(await page.locator('#icon-gallery').evaluate(root=>{const before=[...root.querySelectorAll('svg')];(window as any).heartIcons.render(root);return before.every((svg,index)=>svg===root.querySelectorAll('svg')[index]);}),'Unchanged icon reconciliation preserves SVG nodes');assert(await page.locator('#icon-gallery svg').evaluateAll(nodes=>nodes.every(node=>node.getAttribute('aria-hidden')==='true')));for(const icon of iconAudit){assert(icon.width>0&&icon.height>0&&icon.stroke!=='none',JSON.stringify(icon));assert(icon.x>=.8&&icon.y>=.8&&icon.x+icon.width<=23.2&&icon.y+icon.height<=23.2,'Icon clipped: '+JSON.stringify(icon));}
  await page.locator('#icon-gallery').evaluate(node=>(node as HTMLElement).hidden=true);
  for(const theme of ['light','night','sage','graphite'])for(const width of [320,390,820,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const overflow=await page.locator('.conversation-message').evaluateAll(nodes=>nodes.map(node=>({id:(node as HTMLElement).dataset.eventId??node.id,width:node.clientWidth,scroll:node.scrollWidth})).filter(box=>box.scroll>box.width+2));
   assert.deepEqual(overflow,[],JSON.stringify({theme,width,overflow}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   measurements.push({theme,width,overflow:0});
   if(width===390&&(theme==='light'||theme==='night')){await first.getByRole('heading',{name:'Emojis et symboles',exact:true}).evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(shots,'emoji-'+theme+'-mobile.png')});}
  }
  for(const viewport of [{width:844,height:390},{width:320,height:568}]){await page.setViewportSize(viewport);await page.waitForFunction(({height})=>{const box=document.querySelector('.composer-zone')!.getBoundingClientRect();return box.y>=0&&box.bottom<=height+1;},viewport);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const composer=await page.locator('.composer-zone').boundingBox();assert(composer&&composer.y>=0&&composer.y+composer.height<=viewport.height+1);assert(await page.locator('#conversation-history').evaluate(node=>node.clientHeight>30));measurements.push({...viewport,overflow:0});}
  for(const width of [320,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='200%');const overflow=await page.locator('.conversation-message').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth+2).map(node=>({id:node.id||(node as HTMLElement).dataset.eventId,className:node.className,width:node.clientWidth,scroll:node.scrollWidth,children:[...node.querySelectorAll('*')].filter(c=>c.scrollWidth>c.clientWidth+2).slice(0,5).map(c=>({tag:c.tagName,cls:c.className,width:c.clientWidth,scroll:c.scrollWidth}))})));assert.deepEqual(overflow,[],'200% text size at '+width);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));measurements.push({width,textSize:'200%',overflow:0});if(width===320)await own.screenshot({path:path.join(shots,'text-200-mobile.png')});await page.evaluate(()=>document.documentElement.style.fontSize='');}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.locator('#icon-gallery').evaluate(node=>(node as HTMLElement).hidden=false);await page.locator('#icon-gallery').evaluate(node=>{(node as HTMLElement).style.cssText='position:fixed;top:0;left:0;width:390px;height:max-content;z-index:2147483647;margin:0;padding:16px;background:var(--canvas)';document.body.append(node);});await page.locator('#icon-gallery').screenshot({path:path.join(shots,'icons-mobile.png')});await page.locator('#icon-gallery').evaluate(node=>{document.querySelector('#conversation-history')!.prepend(node);(node as HTMLElement).style.cssText='';});
  await page.locator('#icon-gallery').evaluate(node=>(node as HTMLElement).hidden=true);
  const arabic=page.locator('.markdown-body').filter({hasText:rtl}).filter({hasNot:page.locator('table')}).filter({hasNot:page.locator('.content-table')});
  assert.equal(await arabic.first().locator('p').first().evaluate(node=>getComputedStyle(node).direction),'rtl');
  await arabic.first().evaluate(node=>node.closest('.conversation-message')!.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(shots,'rtl-mobile.png')});
  await page.goto(origin+'/?conversation='+formConversation.id);await page.waitForSelector('.interaction-message form');
  for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});const overflow=await page.locator('.interaction-message').evaluate(node=>node.scrollWidth-node.clientWidth);assert(overflow<=2,'Form content overflow at '+width+': '+overflow);}
  await page.setViewportSize({width:390,height:844});await page.getByRole('radio',{name:inputForm.questions[0].options![0].label,exact:true}).check();await page.getByRole('textbox',{name:'Précision en Unicode'}).fill('😀'.repeat(201));await page.locator('.interaction-message button[type=submit]').click();assert.match(await page.locator('.interaction-feedback').textContent()??'',/Vérifie/);assert((await fixture.service.get(formConversation.id)).pendingInput);
  const base=composed+'\n'+combining,answerUnicode=base+'😀'.repeat(200-[...base].length);await page.getByRole('textbox',{name:'Précision en Unicode'}).fill(answerUnicode);const response=page.waitForResponse(r=>r.url().includes('/interactions/')&&r.request().method()==='POST');await page.locator('.interaction-message button[type=submit]').click();assert.equal((await response).status(),200);await page.waitForSelector('.interaction-message.resolved');
  await page.reload();await page.waitForSelector('.interaction-message.resolved');assert((await page.locator('.interaction-summary').textContent())?.includes(answerUnicode));
  assert.equal(await page.locator('.interaction-summary dd').last().evaluate(node=>getComputedStyle(node).whiteSpace),'pre-wrap');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(shots,'report.json'),JSON.stringify({at:new Date().toISOString(),browser:'Chromium Linux',supplier:'deterministic fixture, no inference',emojiSequences:[emoji,composed],icons:iconAudit.length,cases:cases.map(item=>item.label),checks:['Unicode intact through HTTP, persistence, renderer and clipboard','SVG icon geometry','16 theme/viewport combinations','200% root text size at 320/1440','RTL direction','200/201 Unicode code-point validation','form labels, answers and reload'],measurements,limits:['Physical iOS/Android keyboard and system fonts not qualified','Emoji artwork depends on the operating system','No inference-provider qualification in this suite']},null,2)+'\n');
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fixture.storage.close();await lab.close();await rm(directory,{recursive:true,force:true});}
});
