import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readOpenRouterUsage} from '../src/modules/models/ai-sdk/index.ts';
const response=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
test('OpenRouter separates key budget, real reset, free request counters and private identity',async()=>{
 const calls:string[]=[];
 const fetcher:typeof fetch=async(url,options)=>{calls.push(String(url));assert.equal(options?.method,'GET');return response({label:'private-key-fragment',hash:'secret',usage:2.5,usage_daily:0,usage_weekly:1,usage_monthly:2,label_private:'secret',limit_remaining:3,effective_budget:{remaining_usd:0,reset_interval:'monthly',resets_at:'2026-12-01T00:00:00Z'},free_model_daily_requests:{remaining:0,limit:50}});};
 const usage=await readOpenRouterUsage('fake-private-key','fake:free',fetcher);
 assert.deepEqual(usage.spend,{scope:'key',currency:'USD',total:2.5,daily:0,weekly:1,monthly:2});
 assert.deepEqual(usage.balance,{remaining:0,currency:'USD',scope:'budget'});assert.equal(usage.reset?.at,'2026-12-01T00:00:00.000Z');assert.equal(usage.dailyRequests?.remaining,0);
 assert.deepEqual(calls,['https://openrouter.ai/api/v1/key']);assert(!JSON.stringify(usage).includes('secret'));assert(!JSON.stringify(usage).includes('private-key'));
 const paid=await readOpenRouterUsage('fake','fake-paid',fetcher);assert.equal(paid.dailyRequests,undefined);
});
test('OpenRouter never converts unknown credits or cadence into a balance or dated reset',async()=>{
 const unknown=await readOpenRouterUsage('fake','model',async()=>response({limit:null,limit_remaining:null}));assert.equal(unknown.balance,undefined);assert.equal(unknown.reset,undefined);
 const budget=await readOpenRouterUsage('fake','model',async()=>response({limit_remaining:2.4,limit_reset:'weekly'}));assert.equal(budget.balance?.scope,'key');assert.equal(budget.reset?.at,undefined);assert.equal(budget.reset?.interval,'weekly');
 const unavailable=await readOpenRouterUsage('fake','model',async()=>new Response('secret error',{status:401}));assert.equal(unavailable.status,'unavailable');assert(!JSON.stringify(unavailable).includes('secret'));
});
test('OpenRouter account credits require declared management capability and preserve negative real balances',async()=>{
 const calls:string[]=[];
 const usage=await readOpenRouterUsage('fake','model',async url=>{calls.push(String(url));return response(String(url).endsWith('/credits')?{total_credits:10,total_usage:10.5}:{is_management_key:true,limit_remaining:4,limit_reset:'daily'});});
 assert.equal(calls.length,2);assert.deepEqual(usage.balance,{remaining:-0.5,currency:'USD',scope:'account'});assert.equal(usage.reset?.scope,'key');
 const fallback=await readOpenRouterUsage('fake','model',async url=>String(url).endsWith('/credits')?new Response('',{status:403}):response({is_management_key:true,limit_remaining:4}));assert.equal(fallback.balance?.scope,'key');assert.equal(fallback.balance?.remaining,4);
});

test('usage cache coalesces pending refreshes and direct ChatGPT does not borrow Codex quotas',async()=>{
 const {TestLab}=await import('../src/app/test-lab.ts');
 const lab=new TestLab({directory:'/unused',authDirectory:'/unused',apiKeys:{openrouter:'fake'}});
 const original=globalThis.fetch;let calls=0,release!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});
 globalThis.fetch=async()=>{calls++;await waiting;return response({limit_remaining:5,limit_reset:'daily'});};
 try{
  const first=lab.usage('openrouter','model');const second=lab.usage('openrouter','model',true);assert.equal(calls,1);
  release();await Promise.all([first,second]);await lab.usage('openrouter','model');assert.equal(calls,1);
  await lab.usage('openrouter','model',true);assert.equal(calls,2);
  const chatgpt=await lab.usage('chatgpt','model');assert.equal(chatgpt.balance,undefined);assert.equal(chatgpt.reset,undefined);assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});
