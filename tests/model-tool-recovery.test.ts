import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {test} from "node:test";
import {MockLanguageModelV4} from "ai/test";
import {ModelToolCallError} from "../src/contracts/models.ts";
import {Engine} from "../src/core/engine.ts";
import {AiSdkProvider} from "../src/modules/models/ai-sdk/index.ts";
import {openJsonStorage} from "../src/modules/storage/json/index.ts";

const usage={inputTokens:{total:0,noCache:0,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:0,text:0,reasoning:undefined}};
const definition={name:"files.write",description:"Write a fixture",parameters:{type:"object",properties:{text:{type:"string"}},required:["text"],additionalProperties:false}};
const request={instructions:"Work",messages:[{role:"user" as const,content:"Write"}],tools:[definition]};
const response=(content:any[],done=false)=>({content,finishReason:{unified:done?"stop" as const:"tool-calls" as const,raw:undefined},usage,warnings:[]});

test("an exact offered Heart name is translated locally and revalidated without another model request",async()=>{
 for(const input of ['{"text":"ok"}','{"text":123}']){
  const model=new MockLanguageModelV4({doGenerate:response([{type:"tool-call",toolCallId:"one",toolName:"files.write",input}])});
  if(input.includes('123'))await assert.rejects(new AiSdkProvider(model).generate(request),e=>e instanceof ModelToolCallError&&e.issues[0]?.code==="invalid-arguments");
  else assert.equal((await new AiSdkProvider(model).generate(request)).toolCalls[0]?.name,"files.write");
  assert.equal(model.doGenerateCalls.length,1);
 }
 const unknown=new MockLanguageModelV4({doGenerate:response([{type:"tool-call",toolCallId:"unknown",toolName:"files.write_similar",input:'{"secret":"do-not-persist"}'}])});
 await assert.rejects(new AiSdkProvider(unknown).generate(request),e=>e instanceof ModelToolCallError&&JSON.stringify(e.issues)==='[{"code":"unknown-tool"}]');
});

test("engine corrects a rejected batch without executing any of it or repeating prior successful writes",async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),"heart-tool-recovery-"));
 const storage=await openJsonStorage(directory);const writes:string[]=[];let turn=0;
 const model=new MockLanguageModelV4({doGenerate:async options=>{
  const name=options.tools![0].name;
  switch(turn++){
   case 0:return response([{type:"tool-call",toolCallId:"first",toolName:name,input:'{"text":"first"}'}]);
   case 1:return response([{type:"tool-call",toolCallId:"not-executed",toolName:name,input:'{"text":"not-executed"}'},{type:"tool-call",toolCallId:"bad",toolName:name,input:'{"text":123,"secret":"do-not-persist"}'}]);
   case 2:
    assert.match(String(options.prompt[0].content),/invalid-arguments.*files.write/);
    assert.match(JSON.stringify(options.prompt),/saved:first/);
    assert.doesNotMatch(JSON.stringify(options.prompt),/do-not-persist|not-executed/);
    return response([{type:"tool-call",toolCallId:"corrected",toolName:name,input:'{"text":"corrected"}'}]);
   default:return response([{type:"text",text:"Done"}],true);
  }
 }});
 try{
  const engine=new Engine(storage.sessions,[{...definition,permission:"files.write",execute:async args=>{const text=(args as {text:string}).text;writes.push(text);return "saved:"+text;}}]);
  const result=await engine.run({sessionId:"qa",workspace:directory,displayName:"QA",prompt:"Write first, then corrected.",provider:new AiSdkProvider(model),permissions:new Set(["files.write"]),maxSteps:4});
  assert.equal(result.text,"Done");assert.deepEqual(writes,["first","corrected"]);assert.equal(model.doGenerateCalls.length,4);
  const events=await storage.sessions.read("qa");assert.equal(events.filter(e=>e.type==="tool.started").length,2);
  assert.equal(events.filter(e=>e.type==="run.failed").length,0);
  assert.equal(events.filter(e=>e.type==="run.progress"&&(e.data as {kind?:string}).kind==="tool-validation").length,1);
  assert.doesNotMatch(JSON.stringify(events),/do-not-persist|not-executed/);
 }finally{await storage.close();await rm(directory,{recursive:true,force:true});}
});

test("tool correction respects the run step budget and never grants a missing permission",async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),"heart-tool-budget-"));const storage=await openJsonStorage(directory);let executed=0;
 const model=new MockLanguageModelV4({doGenerate:response([{type:"tool-call",toolCallId:"unknown",toolName:"files.write",input:'{"text":"unauthorized"}'}])});
 try{
  const engine=new Engine(storage.sessions,[{...definition,permission:"files.write",execute:async()=>{executed++;return "bad";}}]);
  await assert.rejects(engine.run({sessionId:"qa",workspace:directory,displayName:"QA",prompt:"Work",provider:new AiSdkProvider(model),permissions:new Set(),maxSteps:2}),/Budget de 2 étapes atteint/);
  assert.equal(model.doGenerateCalls.length,2);assert.equal(executed,0);
 }finally{await storage.close();await rm(directory,{recursive:true,force:true});}
});
