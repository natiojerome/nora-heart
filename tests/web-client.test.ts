import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function fixture(transport:typeof fetch) {
 const browser:{heartHttp?:Window['heartHttp']}={},finished:unknown[]=[],tokens:string[]=[];
 let expired=0,begun=0,currentCsrf="fake-csrf";
 vm.runInNewContext(await readFile('src/interfaces/web/public/api-client.js','utf8'),{window:browser,fetch:transport,Headers,structuredClone,TypeError,Error});
 const client=browser.heartHttp!.create({fetch:transport,csrf:()=>currentCsrf,receivedCsrf:value=>{tokens.push(value);currentCsrf=value;},expired:()=>{expired++;},feedback:()=>{begun++;return error=>{finished.push(error);};}});
 return {client,tokens,finished,setCsrf(value:string){currentCsrf=value;},get expired(){return expired;},get begun(){return begun;}};
}
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}

test('browser client coalesces simultaneous reads without caching or sharing mutable response objects',async()=>{
 const held=deferred<Response>();let calls=0;
 const f=await fixture(async()=>{calls++;return calls===1?held.promise:Response.json({value:2});});
 const first=f.client.api('/api/read'),second=f.client.api('/api/read',{quiet:true});
 assert.equal(calls,1);held.resolve(Response.json({value:{number:1},csrf:'fake-new-csrf'}));
 const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.notEqual(a,b);
 a.value.number=99;assert.equal(b.value.number,1);
 await f.client.api('/api/read');assert.equal(calls,2);assert.equal(f.begun,2);assert.equal(f.finished.length,2);assert(f.tokens.includes('fake-new-csrf'));
});

test('writes invalidate older in-flight reads, never coalesce and retain CSRF and binary headers',async()=>{
 const old=deferred<Response>(),fresh=deferred<Response>();let reads=0,writes=0;
 const f=await fixture(async(_url,options)=>{
  if(!options?.method||options.method==='GET')return ++reads===1?old.promise:fresh.promise;
  writes++;const headers=new Headers(options.headers);assert.equal(headers.get('x-csrf-token'),'fake-csrf');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  assert.equal(headers.get('content-type'),writes===3?'application/octet-stream':'application/json');return Response.json({ok:true});
 });
 const previous=f.client.api('/api/read');await Promise.all([f.client.post('/api/save'),f.client.post('/api/save')]);assert.equal(writes,2);
 const next=f.client.api('/api/read');old.resolve(Response.json({version:1}));assert.equal((await previous).version,1);
 const joined=f.client.api('/api/read');assert.equal(reads,2,'An older completion cannot clear the newer request');fresh.resolve(Response.json({version:2}));assert.equal((await next).version,2);assert.equal((await joined).version,2);
 await f.client.api('/api/binary',{method:'PUT',body:new Uint8Array([1,2]),headers:new Headers({'Content-Type':'application/octet-stream'})});assert.equal(writes,3);
});

test('client handles expiry and network failure once, preserves cancellation and independently signalled reads',async()=>{
 let calls=0;const f=await fixture(async()=>{calls++;return Response.json({error:'private-server-detail'},{status:401});});
 await assert.rejects(f.client.api('/api/private'),/session a expiré/);assert.equal(f.expired,1);assert.equal(calls,1);assert.equal(f.finished.length,1);
 const network=await fixture(async()=>{throw new TypeError('private transport information');});await assert.rejects(network.client.post('/api/save'),/Vérifie le résultat/);assert.equal(network.finished.length,1);
 let reads=0;const separate=await fixture(async()=>{reads++;return Response.json({ok:true});});
 await Promise.all([separate.client.api('/api/read',{signal:new AbortController().signal}),separate.client.api('/api/read',{signal:new AbortController().signal})]);assert.equal(reads,2);
 const stopped=await fixture(async()=>{throw new DOMException('Cancelled','AbortError');});await assert.rejects(stopped.client.api('/api/read',{signal:AbortSignal.abort()}),{name:'AbortError'});
});


test('browser client rejects malformed successful responses without retrying writes and normalizes methods', async()=>{
 let writes=0;
 const f=await fixture(async(_url,init)=>{writes++;assert.equal(init?.method,'POST');return new Response('<html>proxy failure</html>',{status:200});});
 await assert.rejects(f.client.api('/api/save',{method:'post',body:'{}'}),/serveur illisible.*Vérifie le résultat/);
 assert.equal(writes,1);assert.equal(f.finished.length,1);assert(f.finished[0] instanceof Error);
 const unauthorized=await fixture(async()=>new Response('upstream response',{status:401}));
 await assert.rejects(unauthorized.client.api('/api/private'),/session a expiré/);assert.equal(unauthorized.expired,1);
 const empty=await fixture(async()=>new Response(null,{status:204}));
 assert.equal(await empty.client.post('/api/no-content'),undefined);
});


test('a response from an older session cannot expire or overwrite a newer login',async()=>{
 const denied=deferred<Response>();const f=await fixture(async()=>denied.promise);
 const old=f.client.api('/api/old-read');f.setCsrf('new-session-token');
 denied.resolve(Response.json({error:'expired'},{status:401}));await assert.rejects(old,/session a expiré/);assert.equal(f.expired,0);
 const stale=deferred<Response>();const g=await fixture(async()=>stale.promise);
 const reading=g.client.api('/api/state');g.setCsrf('new-session-token');
 stale.resolve(Response.json({authenticated:true,csrf:'old-session-token'}));await reading;assert.deepEqual(g.tokens,[]);
});
