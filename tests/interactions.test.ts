import type {Json} from "../src/contracts/json.ts";
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Engine,type RunOptions} from '../src/core/engine.ts';
import {interactionsFrom} from '../src/core/interactions.ts';
import {interactionTools,inputRequest,inputResponse} from '../src/modules/tools/interactions/index.ts';
import {JsonlSessions} from '../src/modules/storage/json/index.ts';
import type {Tool} from '../src/contracts/tools.ts';import type {ModelProvider,ModelResponse} from '../src/contracts/models.ts';

const form={title:'Choisir la suite',questions:[{id:'format',label:'Quel format ?',type:'single',options:[{id:'court',label:'Court'},{id:'detail',label:'Détaillé'}]},{id:'canaux',label:'Quels canaux ?',type:'multiple',options:[{id:'web',label:'Web'},{id:'mail',label:'Mail'}],minSelections:1,maxSelections:2},{id:'note',label:'Une précision',type:'text',required:false,maxLength:40}]};
const formArgs=JSON.parse(JSON.stringify(form)) as Json;
test('interactive tool validates schemas, choices, cardinality, optional text and rejects forged answers',async()=>{
 const request=inputRequest(form);assert.equal(request.kind,'input_request');
 assert.deepEqual(inputResponse(request,{status:'answered',answers:{format:'court',canaux:['web','mail']}}),{status:'answered',answers:{format:'court',canaux:['mail','web']}});
 for(const answer of [{format:'unknown',canaux:['web']},{format:'court',canaux:[]},{format:'court',canaux:['web','web']},{format:'court',canaux:['web'],other:'forged'},{format:'court',canaux:['web'],note:'x'.repeat(41)}])assert.throws(()=>inputResponse(request,{status:'answered',answers:answer}));
 for(const invalid of [{...form,questions:[]},{...form,questions:[form.questions[0],form.questions[0]]},{title:'A',questions:[{id:'constructor',label:'X',type:'text'}]},{title:'A',questions:[{id:'x',label:'X',type:'single'}]}])assert.throws(()=>inputRequest(invalid));
 assert.deepEqual(inputResponse(request,{status:'cancelled',answers:{}}),{status:'cancelled',answers:{}});
});
test('core persists a pause, resumes after restart exactly once and replans remaining calls after the answer',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-input-'));try{
  const sessions=new JsonlSessions(dir);let before=0,after=0,calls=0;
  const actions:Tool[]=[{name:'before',description:'before',permission:'files.write',parameters:{type:'object'},async execute(){before++;return 'done';}},{name:'after',description:'after',permission:'files.write',parameters:{type:'object'},async execute(){after++;return 'done';}}];
  const provider:ModelProvider={id:'test',async generate(request):Promise<ModelResponse>{calls++;if(calls===1)return{content:'',toolCalls:[{id:'b',name:'before',arguments:{}},{id:'q',name:'interactions.request_input',arguments:formArgs},{id:'a',name:'after',arguments:{}}]};if(calls===2){assert.equal(after,0);assert(request.messages.some(m=>m.role==='tool'&&m.callId==='a'&&m.error));return{content:'',toolCalls:[{id:'fresh-after',name:'after',arguments:{}}]};}assert.equal(after,1);assert(request.messages.some(m=>m.role==='tool'&&m.callId==='q'&&m.content.includes('court')));return{content:'Réponse reçue',toolCalls:[]};}};
  const options:RunOptions={sessionId:'test',prompt:'Prépare',provider,workspace:dir,displayName:'Nora',permissions:new Set(['files.write','user.input'])};
  const first=await new Engine(sessions,[...actions,...interactionTools()]).run(options);assert(first.waitingFor);assert.equal(calls,1);assert.equal(before,1);assert.equal(after,0);
  const saved=interactionsFrom(await sessions.read('test'));assert.equal(saved[0].status,'pending');
  await assert.rejects(new Engine(sessions,[...actions,...interactionTools()]).run(options),/formulaire/);
  const resume={requestId:first.waitingFor!,response:{status:'answered' as const,answers:{format:'court',canaux:['web']}}};
  const restarted=new Engine(new JsonlSessions(dir),[...actions,...interactionTools()]);const result=await restarted.run({...options,resume});assert.equal(result.text,'Réponse reçue');assert.equal(before,1);assert.equal(after,1);assert.equal(calls,3);
  assert((await restarted.run({...options,resume})).alreadyResolved);assert.equal(calls,3);
  await assert.rejects(restarted.run({...options,resume:{...resume,response:{status:'answered',answers:{format:'detail',canaux:['web']}}}}),/autre réponse/);
  const history=await sessions.read('test');assert.equal(history.filter(e=>e.type==='message'&&(e.data as any).role==='user').length,1);assert.equal(interactionsFrom(history)[0].status,'answered');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('cancellation is durable without a model call and cancels the rest of the paused batch',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-input-cancel-'));try{
  const sessions=new JsonlSessions(dir);let calls=0,executions=0;
  const action:Tool={name:'action',description:'action',parameters:{type:'object'},permission:'files.write',async execute(){executions++;return 'done';}};
  const provider:ModelProvider={id:'test',async generate(){calls++;return{content:'',toolCalls:[{id:'q',name:'interactions.request_input',arguments:formArgs},{id:'a',name:'action',arguments:{}}]};}};
  const options:RunOptions={sessionId:'test',prompt:'Prépare',provider,workspace:dir,displayName:'Nora',permissions:new Set(['files.write','user.input'])};
  const engine=new Engine(sessions,[action,...interactionTools()]);const first=await engine.run(options);
  const answer=await engine.run({...options,resume:{requestId:first.waitingFor!,response:{status:'cancelled',answers:{}}}});assert(answer.cancelled);assert.equal(calls,1);assert.equal(executions,0);assert.equal(interactionsFrom(await sessions.read('test'))[0].status,'cancelled');
  const continued:ModelProvider={id:'other',async generate(request):Promise<ModelResponse>{assert(request.messages.some(m=>m.role==='tool'&&m.callId==='a'&&m.error));return{content:'Autre sujet',toolCalls:[]};}};
  assert.equal((await engine.run({...options,prompt:'Autre chose',provider:continued})).text,'Autre sujet');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('a second question in the same batch is superseded and must be proposed after reading the first answer',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'heart-input-chain-'));try{
  const sessions=new JsonlSessions(dir);let calls=0;
  const provider:ModelProvider={id:'test',async generate(request):Promise<ModelResponse>{calls++;
   if(calls===1)return{content:'',toolCalls:[{id:'first',name:'interactions.request_input',arguments:formArgs},{id:'stale-second',name:'interactions.request_input',arguments:formArgs}]};
   if(calls===2){assert(request.messages.some(m=>m.role==='tool'&&m.callId==='stale-second'&&m.error));return{content:'',toolCalls:[{id:'fresh-second',name:'interactions.request_input',arguments:formArgs}]};}
   return{content:'Terminé',toolCalls:[]};}};
  const engine=new Engine(sessions,interactionTools()),options:RunOptions={sessionId:'test',prompt:'Prépare',provider,workspace:dir,displayName:'Nora',permissions:new Set(['user.input'])};
  const first=await engine.run(options),response={status:'answered' as const,answers:{format:'court',canaux:['web']}};
  const second=await engine.run({...options,resume:{requestId:first.waitingFor!,response}});assert(second.waitingFor);assert.equal(calls,2);
  assert.equal((await engine.run({...options,resume:{requestId:second.waitingFor!,response}})).text,'Terminé');assert.equal(calls,3);assert(interactionsFrom(await sessions.read('test')).every(item=>item.status==='answered'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('choice B supersedes A, preserves prior effects and obeys permissions on fresh proposals', async () => {
 const directory=await mkdtemp(path.join(os.tmpdir(),'heart-choice-'));
 try {
  const sessions=new JsonlSessions(directory);
  for(const writable of [true,false]) {
   const effects:string[]=[];let calls=0;
   const action:Tool={name:'apply',description:'apply',permission:'files.write',parameters:{type:'object'},async execute(args){effects.push((args as {choice:string}).choice);return 'done';}};
   const provider:ModelProvider={id:'test',async generate(request):Promise<ModelResponse>{
    calls++;
    if(calls===1)return{content:'',toolCalls:[{id:'before',name:'apply',arguments:{choice:'before'}},{id:'ask',name:'interactions.request_input',arguments:{title:'Choisir',questions:[{id:'choice',label:'A ou B ?',type:'single',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}]}},{id:'old-a',name:'apply',arguments:{choice:'a'}}]};
    if(calls===2){
     assert.deepEqual(effects,['before']);
     assert(request.messages.some(m=>m.role==='tool'&&m.callId==='ask'&&m.content.includes('"b"')));
     assert(request.messages.some(m=>m.role==='tool'&&m.callId==='old-a'&&m.error));
     return{content:'',toolCalls:[{id:'fresh-b',name:'apply',arguments:{choice:'b'}}]};
    }
    assert(request.messages.some(m=>m.role==='tool'&&m.callId==='fresh-b'&&m.error===!writable));
    return{content:'Choix réévalué',toolCalls:[]};
   }};
   const options:RunOptions={sessionId:'choice-'+writable,prompt:'Choisir avant action',provider,workspace:directory,displayName:'Nora',permissions:new Set(['user.input','files.write'])};
   const engine=new Engine(sessions,[action,...interactionTools()]),paused=await engine.run(options);
   const resume={requestId:paused.waitingFor!,response:{status:'answered' as const,answers:{choice:'b'}}};
   await engine.run({...options,permissions:new Set(writable?['user.input','files.write']:['user.input']),resume});
   assert.deepEqual(effects,writable?['before','b']:['before']);assert.equal(calls,3);
   assert((await engine.run({...options,resume})).alreadyResolved);assert.equal(calls,3);
   const history=await sessions.read(options.sessionId);
   assert(history.some(e=>e.type==='tool.finished'&&(e.data as any).callId==='old-a'&&(e.data as any).skipped));
  }
 } finally {await rm(directory,{recursive:true,force:true});}
});
