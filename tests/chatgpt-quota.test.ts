import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,writeFile,rm,chmod,symlink} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {accountFingerprint,readChatGptAccountQuota,readAccountQuotaSnapshot} from '../src/modules/models/chatgpt/index.ts';
import {collectAccountQuota} from '../src/app/account-quota.ts';
const settings={accessToken:'fake-secret-token',accountId:'private-account-id',expectedEmail:'owner@example.test'};
const window=(percent=28)=>({used_percent:percent,limit_window_seconds:604800,reset_at:1795175928});
const payload=()=>({email:settings.expectedEmail,account_id:settings.accountId,rate_limit:{primary_window:window(),secondary_window:null},credits:{balance:'private-credits'},access_token:'never-return-this'});
const response=(value:unknown)=>new Response(JSON.stringify(value));

test('ChatGPT quota reads HTTP without Codex, keeps actual windows and strips all credentials',async()=>{
 let calls=0;
 const data=await readChatGptAccountQuota(settings,async(url,init)=>{
  calls++;assert.equal(url,'https://chatgpt.com/backend-api/wham/usage');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
  assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fake-secret-token');return response(payload());
 });
 assert.equal(calls,1);assert.equal(data.windows.length,1);assert.equal(data.windows[0].windowDurationMins,10080);assert.equal(data.windows[0].remainingPercent,72);assert.equal(data.windows[0].resetsAt,'2026-11-20T11:58:48.000Z');
 for(const text of ['private-account-id','fake-secret-token','never-return-this','owner@example.test','private-credits'])assert(!JSON.stringify(data).includes(text));
});

test('ChatGPT quota requires the same account and never retries a denied or malformed source',async()=>{
 for(const value of [{...payload(),email:'someone-else@example.test'},{...payload(),account_id:'wrong'}, {...payload(),rate_limit:{primary_window:window(120)}}, {...payload(),rate_limit:{primary_window:{...window(),reset_at:'not-a-date'}}}]){
  await assert.rejects(readChatGptAccountQuota(settings,async()=>response(value)),/indisponibles/);
 }
 let calls=0;await assert.rejects(readChatGptAccountQuota(settings,async()=>{calls++;return new Response('private response body',{status:401});}),/indisponibles/);assert.equal(calls,1);
});

test('ChatGPT quota preserves true zero, absent windows and model-specific buckets',async()=>{
 for(const used of [0,100]){
  const data=await readChatGptAccountQuota(settings,async()=>response({...payload(),rate_limit:{primary_window:window(used)},additional_rate_limits:[{limit_name:'Sol',metered_feature:'sol',rate_limit:{secondary_window:{...window(40),limit_window_seconds:18000}}}]}));
  assert.equal(data.windows[0].remainingPercent,100-used);assert.equal(data.windows[1].limitId,'sol');assert.equal(data.windows[1].windowDurationMins,300);
 }
 const missing=await readChatGptAccountQuota(settings,async()=>response({...payload(),rate_limit:null}));assert.equal(missing.status,'unavailable');assert.deepEqual(missing.windows,[]);
});

test('quota snapshots reject stale data, switched accounts, symlinks and unsafe permissions',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-quota-')),file=path.join(dir,'quota.json');
 const original=await readChatGptAccountQuota(settings,async()=>response(payload()));
 const read=()=>readAccountQuotaSnapshot(file,settings.expectedEmail,180000,process.getuid!());
 try{
  await writeFile(file,JSON.stringify(original),{mode:0o640});assert.equal((await read()).windows[0].remainingPercent,72);
  await assert.rejects(readAccountQuotaSnapshot(file,'other@example.test',180000,process.getuid!()));
  for(const value of [{...original,observedAt:new Date(Date.now()-181000).toISOString()},{...original,observedAt:new Date(Date.now()+60000).toISOString()},{...original,status:'unavailable'},{...original,windows:[{...original.windows[0],remainingPercent:99}]}]){
   await writeFile(file,JSON.stringify(value));await assert.rejects(read());
  }
  await writeFile(file,JSON.stringify(original));await chmod(file,0o666);await assert.rejects(read());await chmod(file,0o640);
  const link=path.join(dir,'link');await symlink(file,link);await assert.rejects(readAccountQuotaSnapshot(link,settings.expectedEmail,180000,process.getuid!()));
  await assert.rejects(readAccountQuotaSnapshot(file,settings.expectedEmail,NaN,process.getuid!()));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('collector replaces previous success on failure without changing source secrets or leaking the error',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-collect-'));
 const sourceFile=path.join(dir,'source.json'),heartAccountFile=path.join(dir,'heart.json'),snapshotFile=path.join(dir,'snapshot.json');
 const source=JSON.stringify({tokens:{access_token:settings.accessToken,account_id:settings.accountId,refresh_token:'not-used'}});
 try{
  await writeFile(sourceFile,source,{mode:0o600});await writeFile(heartAccountFile,JSON.stringify({email:settings.expectedEmail}),{mode:0o600});
  assert.equal(await collectAccountQuota({sourceFile,heartAccountFile,snapshotFile},async()=>response(payload())),true);
  assert.equal(JSON.parse(await readFile(snapshotFile,'utf8')).status,'available');
  assert.equal(await collectAccountQuota({sourceFile,heartAccountFile,snapshotFile},async()=>{throw new Error('secret-token-in-failure');}),false);
  const failed=await readFile(snapshotFile,'utf8');assert.equal(JSON.parse(failed).status,'unavailable');assert.deepEqual(JSON.parse(failed).windows,[]);
  assert(!failed.includes('secret'));assert(!failed.includes(settings.expectedEmail));assert.equal(await readFile(sourceFile,'utf8'),source);
 }finally{await rm(dir,{recursive:true,force:true});}
});
