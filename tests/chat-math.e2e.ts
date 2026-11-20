import assert from 'node:assert/strict';import {test} from 'node:test';import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createServer as reserve} from 'node:net';import {chromium} from '@playwright/test';
import {TestLab} from '../src/app/test-lab.ts';import {WebAccess} from '../src/app/web-access.ts';import {createWebServer} from '../src/interfaces/web/server.ts';import {conversationFixture} from './conversation-fixture.ts';import {assistantFixture} from './assistant.fixture.ts';import {defaultAssistant} from '../src/app/assistant.ts';
const long=Array.from({length:24},(_,i)=>`x_{${i}}^2`).join('+');
const corpus=String.raw`## Fractions et puissances
Dans le texte : $\frac{a^2+b^2}{\sqrt{c}}$ et \(e^{i\pi}+1=0\).

$$
\int_0^{\infty} e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}
$$

\[
\begin{pmatrix} a & b \\ c & d \end{pmatrix}\begin{pmatrix}x\\y\end{pmatrix}=\begin{pmatrix}1\\0\end{pmatrix}
\]

$$\begin{aligned} f(x)&=x^2+2x+1\\ &= (x+1)^2\end{aligned}$$

Un ensemble \(\mathbb{R}\), des lettres \(\alpha+\beta=\gamma\), une somme \(\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}\).

| Valeur | Expression |
|---|---|
| Carré | $x^2$ |
| Racine | $\sqrt{x}$ |

## Longue équation
$$`+long+String.raw`=0$$

## Code et prix
Les prix restent $10 et $20, ou 10 $ et 20 $. Un dollar échappé : \$x\$.

`+'```tex\n$literal$ \\frac{a}{b}\n```'+String.raw`
Code en ligne : `+'`$code$`'+String.raw`.

## Erreur conservée
\(\commandeInconnue{test}\)

## Commandes non fiables
\(\href{javascript:alert(1)}{clic}\)
\(\includegraphics{https://example.invalid/secret.png}\)
<span data-heart-math="forged" data-math-index="0">Ne pas interpréter ce HTML</span>
<script>window.__unsafe=true</script><math><mi>raw</mi></math>`;

test('math renders locally after Markdown sanitization, preserves source, code and money, scrolls on mobile and rejects unsafe commands', {timeout:60000},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-math-'));const lab=new TestLab({directory:path.join(dir,'lab'),authDirectory:path.join(dir,'auth')});await lab.prepare();
 const fixture=await conversationFixture(path.join(dir,'threads'),()=>({id:'math-fixture',async generate(request){return{content:request.messages.findLast(m=>m.role==='user')?.content==='Maths'?corpus:'Bonjour, texte ordinaire.',toolCalls:[]};}}));const conversation=(await fixture.service.create({title:'Formules mathématiques'})).conversation;
 const assistant=assistantFixture();await assistant.save({version:0,settings:{...defaultAssistant,completed:true,step:5}});const reservation=reserve();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));const origin='http://127.0.0.1:'+port;
 const server=createWebServer({origin,access:new WebAccess({secret:'fake-math-session-secret-at-least-32-chars',password:'fake-password'}),lab,assistant,conversations:fixture.service});await new Promise<void>(r=>server.listen(port,'127.0.0.1',r));const browser=await chromium.launch({args:process.getuid?.()===0?['--no-sandbox']:[]});
 try{const context=await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage(),errors:string[]=[],external:string[]=[],assets:string[]=[],csp:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/vendor/katex/'))assets.push(r.url());});await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
 await page.addInitScript(()=>{(window as any).__csp=[];document.addEventListener('securitypolicyviolation',e=>(window as any).__csp.push(e.violatedDirective));});
 await page.goto(origin+'/?conversation='+conversation.id);await page.fill('#password','fake-password');await page.click('#login-submit');await page.waitForSelector('body.chat-mode',{state:'attached'});await page.fill('#conversation-prompt','Bonjour');await page.click('#conversation-submit');await page.getByText('Bonjour, texte ordinaire.',{exact:true}).waitFor();assert.equal(assets.length,0,'No KaTeX download for plain chat');
 await page.fill('#conversation-prompt','Maths');await page.click('#conversation-submit');await page.waitForSelector('.katex');await page.waitForFunction(()=>!document.querySelector('[data-heart-math]:not([data-heart-math="forged"])'));await page.evaluate(()=>document.fonts.ready);
 const answer=page.locator('.conversation-message.assistant').last();assert(await answer.locator('.katex').count()>=12);assert(await answer.locator('math mfrac').count()>=4);assert(await answer.locator('math msqrt').count()>=2);assert(await answer.locator('math mtable').count()>=2,JSON.stringify({annotations:await answer.locator('math annotation').allTextContents(),errors:await answer.locator('.math-error').allTextContents()}));assert((await answer.locator('math annotation').allTextContents()).includes(corpus.split('$')[1]));assert(await answer.locator('math annotation[encoding="application/x-tex"]').count()>=12);assert.equal(await answer.locator('pre .katex,code .katex').count(),0);assert.equal(await answer.locator('pre').textContent(),'$literal$ \\frac{a}{b}\n');
 assert((await answer.textContent())?.includes('Les prix restent $10 et $20, ou 10 $ et 20 $. Un dollar échappé : $x$.'));assert.equal(await answer.locator('[data-heart-math="forged"] .katex').count(),0);assert.equal(await page.locator('a[href^="javascript:"],img[src*="example.invalid"]').count(),0);assert.equal(await page.evaluate(()=>!!(window as any).__unsafe),false);assert.match(await answer.locator('.math-error').first().textContent()??'',/commandeInconnue/);
 assert.equal(assets.filter(url=>url.endsWith('/katex.min.js')).length,1);assert(assets.some(url=>url.endsWith('.woff2')));assert.deepEqual(external,[]);
 const shots=path.resolve('docs/design/chat-math');await mkdir(shots,{recursive:true});for(const theme of ['light','night'])for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await answer.evaluate(n=>n.scrollWidth<=n.clientWidth+2));assert(await answer.locator('.math-display').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+20)),'Long equation has its own horizontal scroll');if((width===390||width===1440)&&theme==='light'){await answer.getByRole('heading',{name:'Fractions et puissances'}).evaluate(n=>n.closest('article')!.scrollIntoView({block:'start'}));if(await page.getByRole('button',{name:'Fermer la notification'}).count())await page.getByRole('button',{name:'Fermer la notification'}).click();await page.screenshot({path:path.join(shots,width===390?'mobile.png':'desktop.png')});}}
 await answer.locator('.content-table').getByRole('button',{name:'Agrandir',exact:true}).click();await page.waitForSelector('.content-viewer .katex');assert(await page.locator('.content-viewer .katex').count()>=2);await page.keyboard.press('Escape');
 await answer.getByRole('button',{name:'Copier la réponse'}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),corpus);const before=await answer.locator('.katex').first().elementHandle();await page.evaluate(async id=>{const data=await(await fetch('/api/conversations/'+id)).json();(window as any).heartChat.render({...data,events:[...data.events,{id:'math-usage-only',type:'context.usage',data:{}}]});},conversation.id);assert(await before!.evaluate(n=>n.isConnected));
 await page.reload();await page.waitForSelector('.katex');assert(await page.locator('.katex').count()>=12);assert.equal(errors.length,0);csp.push(...await page.evaluate(()=>(window as any).__csp));assert.deepEqual(csp,[]);
 const unavailable=await context.newPage();unavailable.on('pageerror',e=>errors.push(e.message));await unavailable.route('**/vendor/katex/katex.min.js',route=>route.abort());await unavailable.goto(origin+'/?conversation='+conversation.id);await unavailable.waitForSelector('.math-error');assert.equal(await unavailable.locator('.katex').count(),0);assert((await unavailable.locator('.math-error').first().textContent())?.includes(corpus.split('$')[1]));await unavailable.close();assert.equal(errors.length,0);
 await writeFile(path.join(shots,'report.json'),JSON.stringify({at:new Date().toISOString(),browser:'Chromium Linux',provider:'deterministic fixture; no inference',cases:['inline dollar and parentheses','display dollar and brackets','fractions, roots, powers, Greek, integrals, sums, matrix, aligned','table cells and cards','long equation scroll','raw code and dollar prices','invalid formula source fallback','untrusted commands and forged HTML','exact clipboard source','DOM reuse and reload','lazy local JS/CSS/fonts and load failure fallback','8 theme/width combinations'],errors,csp,external},null,2)+'\n');
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await fixture.storage.close();await lab.close();await rm(dir,{recursive:true,force:true});}
});
