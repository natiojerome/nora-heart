import assert from "node:assert/strict";
import { test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { ModelRequest } from "../src/contracts/models.ts";
import type { Event, SessionStore } from "../src/contracts/storage.ts";
import { Engine } from "../src/core/engine.ts";
import { AiSdkProvider } from "../src/modules/models/ai-sdk/index.ts";
import { ChatGptProvider } from "../src/modules/models/chatgpt/index.ts";

const request: ModelRequest = { instructions: "Be useful", messages: [{ role: "user", content: "Hello" }], tools: [] };
const definition = { name: "memory.search", description: "Search memories", parameters: {
  type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false,
} };
const message = (text: string) => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] });
function sse(events: unknown[], split = false): Response {
  const data = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < data.length; offset += split ? 7 : data.length) controller.enqueue(data.slice(offset, offset + (split ? 7 : data.length)));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
const complete = (output: unknown[]) => ({ type: "response.completed", response: { status: "completed", output } });

test("ChatGPT streams to completion with explicit context and subscription-compatible fields", async () => {
  let calls = 0;
  const model = new ChatGptProvider({ modelId: "selected-model", accessToken: async () => "fake-token", fetch: async (url, init) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init!.headers).get("authorization"), "Bearer fake-token");
    assert.equal(init!.redirect, "error");
    const body = JSON.parse(String(init!.body));
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.equal(body.instructions, request.instructions);
    assert.deepEqual(body.input, [{ role: "user", content: "Hello" }]);
    assert.equal(body.tools[0].type, "namespace");
    assert.deepEqual(body.tools[0].tools[0].parameters, definition.parameters);
    assert.match(body.tools[0].tools[0].description,/memory.search/);
    for (const field of ["max_output_tokens", "previous_response_id", "conversation", "temperature", "background", "metadata"]) assert.equal(field in body, false);
    return sse([{ type: "response.output_text.delta", delta: "unconfirmed partial" }, complete([message("Bonjour 🌴")])], true);
  } });
  assert.deepEqual(await model.generate({ ...request, tools: [definition] }), { content: "Bonjour 🌴", toolCalls: [] });
  assert.equal(calls, 1);
});

test("ChatGPT accepts a valid stream without Content-Type but still requires completed inference", async () => {
  for (const completed of [true, false]) {
    const model = new ChatGptProvider({ modelId: "test", accessToken: async () => "fake", fetch: async () => {
      const response = sse(completed ? [complete([message("Complete response")])] : [{ type: "response.output_text.delta", delta: "partial" }]);
      response.headers.delete("content-type");
      return response;
    } });
    if (completed) assert.deepEqual(await model.generate(request), { content: "Complete response", toolCalls: [] });
    else await assert.rejects(model.generate(request));
  }
  const incompatible = new ChatGptProvider({ modelId: "test", accessToken: async () => "fake", fetch: async () => {
    const response = sse([complete([message("Wrong MIME")])]);
    response.headers.set("content-type", "application/json");
    return response;
  } });
  await assert.rejects(incompatible.generate(request));
});

test("ChatGPT tool calls run only through the engine and neutral history can switch back to the API adapter", async () => {
  const events: Event[] = [];
  const sessions: SessionStore = { async read() { return [...events]; }, async append(_id, event) { events.push(event); } };
  let executions = 0, calls = 0;
  const engine = new Engine(sessions, [{ ...definition, permission: "memory.read", async execute(args) {
    executions++;
    assert.deepEqual(args, { query: "preferences" });
    return "prefers modularity";
  } }]);
  const provider = new ChatGptProvider({ modelId: "test-model", accessToken: async () => "fake", fetch: async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init!.body));
    const result = body.input.find((item: { type: string }) => item.type === "function_call_output");
    if (result) {
      assert.equal(result.call_id, "call-chatgpt");
      assert.equal(result.output, "prefers modularity");
      const replay = body.input.find((item: { type: string }) => item.type === "function_call");
      assert.equal(replay.namespace, "harness");
      return sse([complete([message("Found preferences")])]);
    }
    const tool = body.tools[0].tools[0];
    return sse([complete([{ type: "function_call", call_id: "call-chatgpt", namespace: "harness", name: tool.name,
      arguments: '{"query":"preferences"}' }])]);
  } });
  const options = { sessionId: "switch", prompt: "Recall", provider, displayName: "Nora", workspace: ".",
    permissions: new Set(["memory.read"] as const) };
  assert.equal((await engine.run(options)).text, "Found preferences");
  assert.equal(executions, 1);
  assert.equal(calls, 2);
  const api = new MockLanguageModelV4({ doGenerate: { content: [{ type: "text", text: "Continued via API" }],
    finishReason: { unified: "stop", raw: undefined }, warnings: [], usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    } } });
  assert.equal((await engine.run({ ...options, provider: new AiSdkProvider(api), prompt: "Continue", permissions: new Set() })).text, "Continued via API");
  assert.match(JSON.stringify(api.doGenerateCalls[0].prompt), /prefers modularity/);
  assert.equal(executions, 1);
  assert.match(JSON.stringify(events), /memory.search/);
  assert.equal(JSON.stringify(events).includes("fake-token"), false);
});

test("ChatGPT rejects incomplete streams, failed responses and invalid tool arguments without retry", async () => {
  const responses = [
    () => sse([{ type: "response.output_text.delta", delta: "partial" }]),
    () => sse([{ type: "response.incomplete", response: { status: "incomplete" } }]),
    () => sse([{ type: "response.output_text.delta", delta: "partial" },
      { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "private-token-in-error" } } }]),
    () => sse([complete([{ type: "function_call", call_id: "bad", namespace: "harness", name: "unknown", arguments: "{}" }])]),
    () => Response.json({ error: { code: "private-error-code", message: "private-token-in-error" } }, { status: 503 }),
    () => sse([complete([message("")])]),
  ];
  for (const response of responses) {
    let calls = 0;
    const model = new ChatGptProvider({ modelId: "test", accessToken: async () => "fake", fetch: async () => { calls++; return response(); } });
    await assert.rejects(model.generate(request), error => {
      assert.equal((error as Error).message.includes("private"), false);
      return true;
    });
    assert.equal(calls, 1);
  }
  const invalid = new ChatGptProvider({ modelId: "test", accessToken: async () => "fake", fetch: async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    return sse([complete([{ type: "function_call", namespace: "harness", call_id: "bad",
      name: body.tools[0].tools[0].name, arguments: '{"query":123}' }])]);
  } });
  await assert.rejects(invalid.generate({ ...request, tools: [definition] }));
});

test("ChatGPT cancellation interrupts streaming and a pre-cancelled run never requests a credential", async () => {
  const before = new AbortController(); before.abort();
  let credentials = 0;
  const unused = new ChatGptProvider({ modelId: "test", accessToken: async () => { credentials++; return "fake"; } });
  await assert.rejects(unused.generate({ ...request, signal: before.signal }), { name: "AbortError" });
  assert.equal(credentials, 0);
  const controller = new AbortController();
  let cancelled = false;
  const model = new ChatGptProvider({ modelId: "test", accessToken: async () => "fake", fetch: async () => new Response(new ReadableStream({
    start() { setTimeout(() => controller.abort(), 10); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "text/event-stream" } }) });
  await assert.rejects(model.generate({ ...request, signal: controller.signal }), { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("ChatGPT discovers the authenticated account's catalog without exposing tokens", async () => {
  const model = new ChatGptProvider({ modelId: "unused", accessToken: async () => "fake", fetch: async url => {
    assert.equal(String(url), "https://api.openai.com/v1/models");
    return Response.json({ models: [{ slug: "allowed", display_name: "Allowed", visibility: "list", supported_reasoning_levels:[{effort:"low"},{effort:"ultra"}],default_reasoning_level:"low" },
      { slug: "hidden", display_name: "Hidden", visibility: "hidden" }] });
  } });
  assert.deepEqual(await model.models(), [{ id: "allowed", name: "Allowed", reasoningEfforts:["low","ultra"],defaultReasoningEffort:"low" }]);
});


test("ChatGPT translates attachments into explicit image, PDF and text parts", async () => {
 let calls=0;
 const model=new ChatGptProvider({modelId:'mock',accessToken:async()=>'fake',fetch:async(_url,init)=>{
  calls++;const body=JSON.parse(String(init!.body));const parts=body.input[0].content;
  assert.deepEqual(parts.map((part:{type:string})=>part.type),['input_text','input_image','input_file','input_text']);
  assert.equal(parts[1].image_url,'data:image/png;base64,aW1n');assert.equal(parts[2].filename,'doc.pdf');assert.match(parts[3].text,/note/);
  return sse([complete([message('Lu')])]);
 }});
 await model.generate({...request,messages:[{role:'user',content:'Lis',attachments:[{id:'img',name:'img.png',mediaType:'image/png',size:3,data:'aW1n'},{id:'pdf',name:'doc.pdf',mediaType:'application/pdf',size:3,data:'cGRm'},{id:'txt',name:'note.txt',mediaType:'text/plain',size:4,data:'bm90ZQ=='}]}]});assert.equal(calls,1);
});


test('ChatGPT emits deduplicated activity phases without exposing streamed reasoning text',async()=>{
 const phases:string[]=[];
 const model=new ChatGptProvider({modelId:'fake',accessToken:async()=>'fake',fetch:async()=>sse([
  {type:'response.output_item.added',item:{type:'reasoning'}},
  {type:'response.reasoning_summary_text.delta',delta:'private-test-text'},
  {type:'response.reasoning_summary_text.delta',delta:'second'},
  {type:'response.output_text.delta',delta:'partial'},complete([message('Final')])
 ],true)});
 const result=await model.generate({...request,onActivity:phase=>{phases.push(phase);}});
 assert.deepEqual(phases,['reasoning','answer']);assert.equal(result.content,'Final');assert(!JSON.stringify(result).includes('private-test-text'));
});

test('ChatGPT forwards selected reasoning effort and omits the field for account default',async()=>{
  for(const effort of [undefined,'high']){
    const model=new ChatGptProvider({modelId:'test',reasoningEffort:effort,accessToken:async()=>'fake',fetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));assert.deepEqual(body.reasoning,effort?{effort}:undefined);
      return sse([complete([message('ok')])]);
    }});
    assert.equal((await model.generate(request)).content,'ok');
  }
});

test('ChatGPT reconstructs confirmed empty-output streams from finalized messages and tool calls in output order', async()=>{
  let calls=0;
  const provider=new ChatGptProvider({modelId:'test',accessToken:async()=>'fake',fetch:async(_url,init)=>{
    calls++;const body=JSON.parse(String(init!.body));
    return sse([
      {type:'response.output_item.done',output_index:1,item:{type:'function_call',status:'completed',namespace:'harness',name:body.tools[0].tools[0].name,call_id:'confirmed-call',arguments:'{"query":"affichage"}'}},
      {type:'response.output_item.done',output_index:0,item:message('Je prépare le tableau.')},
      complete([]),
    ],true);
  }});
  assert.deepEqual(await provider.generate({...request,tools:[definition]}),{content:'Je prépare le tableau.',toolCalls:[{id:'confirmed-call',name:'memory.search',arguments:{query:'affichage'}}]});assert.equal(calls,1);
  const text=new ChatGptProvider({modelId:'test',accessToken:async()=>'fake',fetch:async()=>sse([{type:'response.output_item.done',output_index:0,item:{type:'reasoning',summary:[{text:'not collected'}]}},{type:'response.output_item.done',output_index:1,item:message('| Nom | État |\n| --- | --- |\n| Heart | OK |')},complete([])])});
  assert.match((await text.generate(request)).content,/Heart/);
});

test('ChatGPT never accepts finalized items without terminal completion, valid contiguous indices and validated arguments',async()=>{
  const item={type:'response.output_item.done',output_index:0,item:message('Not enough alone')};
  for(const events of [
    [item],
    [item,{type:'response.failed',response:{error:{code:'subscription_sharing_usage_unavailable'}}}],
    [item,{type:'response.incomplete',response:{status:'incomplete'}}],
    [item,item,complete([])],
    [{...item,output_index:1},complete([])],
    [{...item,output_index:-1},complete([])],
    [{...item,item:{type:'function_call',namespace:'harness',status:'completed',call_id:'bad',name:'unknown',arguments:'{}'}},complete([])],
    [complete([])],
  ]){
    let calls=0;const provider=new ChatGptProvider({modelId:'test',accessToken:async()=>'fake',fetch:async()=>{calls++;return sse(events);}});
    await assert.rejects(provider.generate({...request,tools:[definition]}));assert.equal(calls,1);
  }
  const invalid=new ChatGptProvider({modelId:'test',accessToken:async()=>'fake',fetch:async(_url,init)=>{
    const body=JSON.parse(String(init!.body));return sse([{type:'response.output_item.done',output_index:0,item:{type:'function_call',namespace:'harness',status:'completed',call_id:'bad',name:body.tools[0].tools[0].name,arguments:'{"query":123}'}},complete([])]);
  }});
  await assert.rejects(invalid.generate({...request,tools:[definition]}));
});

test('ChatGPT inactivity timeout reports a safe distinct error and cancels an idle stream',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let cancelled=false;
 const model=new ChatGptProvider({modelId:'fake',timeoutMs:1000,accessToken:async()=>'fake',fetch:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}})});
 const result=model.generate(request);const assertion=assert.rejects(result,(e:unknown)=>{assert.equal((e as {code:string}).code,'timeout');assert.match((e as Error).message,/délai/);return true;});
 for(let i=0;i<8;i++)await Promise.resolve();t.mock.timers.tick(1001);await assertion;assert(cancelled);
});

test('ChatGPT keeps a progressing stream past the former total deadline without accepting partial output',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let stream!:ReadableStreamDefaultController<Uint8Array>;
 const encoder=new TextEncoder();const model=new ChatGptProvider({modelId:'fake',timeoutMs:1000,accessToken:async()=>'fake',fetch:async()=>new Response(new ReadableStream({start(controller){stream=controller;}}),{headers:{'content-type':'text/event-stream'}})});
 const result=model.generate(request);for(let i=0;i<8;i++)await Promise.resolve();
 for(let i=0;i<3;i++){t.mock.timers.tick(900);stream.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.reasoning_summary_text.delta',delta:'private-not-returned'})+'\n\n'));for(let n=0;n<8;n++)await Promise.resolve();}
 stream.enqueue(encoder.encode('data: '+JSON.stringify(complete([message('Confirmed after 2700 ms')]))+'\n\n'));stream.close();assert.equal((await result).content,'Confirmed after 2700 ms');
});

test("ChatGPT accepts MCP JSON Schema 2020-12 with formats while rejecting malformed tool arguments", async()=>{
 const parameters={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{id:{type:'string',format:'uuid'},dueAt:{type:'string',format:'date-time'},tags:{type:'array',prefixItems:[{type:'string'}],items:false,minItems:1,maxItems:1}},required:['id','dueAt'],additionalProperties:false};
 for(const valid of [true,false]){
  let sent=0;const model=new ChatGptProvider({modelId:'fixture',accessToken:async()=> 'fake',fetch:async(_url,init)=>{sent++;const body=JSON.parse(String(init!.body));return sse([complete([{type:'function_call',call_id:'mcp-call',namespace:'harness',name:body.tools[0].tools[0].name,arguments:JSON.stringify({id:valid?'051d0bd1-a3c7-437c-ac87-c2181302d59d':'bad-id',dueAt:'2026-11-20T12:00:00Z',tags:['only-one']})}])])}});
  const input={...request,tools:[{name:'mcp_project',description:'MCP fixture',parameters}]};
  if(valid)assert.equal((await model.generate(input)).toolCalls[0].name,'mcp_project');else await assert.rejects(model.generate(input));assert.equal(sent,1);
 }
});
