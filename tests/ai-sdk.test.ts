import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import type { ModelRequest } from "../src/contracts/models.ts";
import { ModelToolCallError } from "../src/contracts/models.ts";
import { Engine } from "../src/core/engine.ts";
import { AiSdkProvider, createAiSdkProvider } from "../src/modules/models/ai-sdk/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";

const request: ModelRequest = { instructions: "Be useful", messages: [{ role: "user", content: "Hello" }], tools: [] };
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined } };
function answer(text = "Hello") {
  return { content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] };
}
const definition = { name: "memory.search", description: "Search", parameters: {
  type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false,
} } as const;
// Keep the JSON Schema mutable to match the harness contract.
const tools = [JSON.parse(JSON.stringify(definition))];

test("AI SDK forwards instructions, caps output and returns plain text in one request", async () => {
  const model = new MockLanguageModelV4({ doGenerate: answer() });
  const result = await new AiSdkProvider(model, 128).generate(request);
  assert.deepEqual(result, { content: "Hello", toolCalls: [] });
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(model.doGenerateCalls[0].maxOutputTokens, 128);
  assert.equal(model.doGenerateCalls[0].prompt[0].content, "Be useful");
});

test("AI SDK leaves execution to the engine and replays neutral history across model changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harness-sdk-"));
  const storage = await openJsonStorage(directory);
  let executions = 0;
  const engine = new Engine(storage.sessions, [{ ...tools[0], permission: "memory.read", async execute(args) {
    executions++;
    assert.deepEqual(args, { query: "preferences" });
    return "prefers modularity";
  } }]);
  const first = new MockLanguageModelV4({ doGenerate: async options => {
    if (options.prompt.at(-1)?.role === "tool") return answer("Found preferences");
    const tool = options.tools?.[0];
    assert.equal(tool?.type, "function");
    assert.deepEqual(tool.inputSchema, definition.parameters);
    assert.match(tool.description??'',/memory.search/);
    return { ...answer(), content: [{ type: "tool-call", toolCallId: "call-1", toolName: tool.name,
      input: JSON.stringify({ query: "preferences" }) }], finishReason: { unified: "tool-calls", raw: undefined } };
  } });
  const options = { sessionId: "same", prompt: "Recall", provider: new AiSdkProvider(first),
    displayName: "First name", workspace: directory, permissions: new Set(["memory.read"] as const) };
  try {
    assert.equal((await engine.run(options)).text, "Found preferences");
    assert.equal(executions, 1);
    assert.equal(first.doGenerateCalls.length, 2);
    const second = new MockLanguageModelV4({ modelId: "another-brain", doGenerate: answer("Continued") });
    assert.equal((await engine.run({ ...options, displayName: "Renamed", provider: new AiSdkProvider(second),
      permissions: new Set(), prompt: "Continue" })).text, "Continued");
    assert.equal(second.doGenerateCalls[0].tools?.length ?? 0, 0);
    const history = JSON.stringify(second.doGenerateCalls[0].prompt);
    assert.match(history, /prefers modularity/);
    assert.match(history, /call-1/);
    assert.equal(executions, 1);
    assert.match(JSON.stringify(await storage.sessions.read("same")), /memory.search/);
  } finally { await storage.close(); await rm(directory, { recursive: true, force: true }); }
});

test("AI SDK rejects unknown tools, malformed JSON and invalid arguments before execution", async () => {
  for (const input of ["not-json", '{"query":123}', '{"query":"ok","extra":true}']) {
    const model = new MockLanguageModelV4({ doGenerate: async options => ({ ...answer(),
      content: [{ type: "tool-call", toolCallId: "bad", toolName: options.tools![0].name, input }],
      finishReason: { unified: "tool-calls", raw: undefined },
    }) });
    await assert.rejects(new AiSdkProvider(model).generate({ ...request, tools }), /Échec du modèle/);
    assert.equal(model.doGenerateCalls.length, 1);
  }
  const unknown = new MockLanguageModelV4({ doGenerate: { ...answer(), content: [{ type: "tool-call",
    toolCallId: "bad", toolName: "unauthorized", input: "{}" }], finishReason: { unified: "tool-calls", raw: undefined } } });
  await assert.rejects(new AiSdkProvider(unknown).generate({ ...request, tools }), /Échec du modèle/);
});

test("AI SDK refuses partial results and never retries or exposes a raw provider error", async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("secret-in-provider-error"); } });
  await assert.rejects(new AiSdkProvider(model).generate(request), error => {
    assert.equal((error as Error).message.includes("secret"), false);
    return /Échec du modèle/.test((error as Error).message);
  });
  assert.equal(model.doGenerateCalls.length, 1);
  for (const reason of ["length", "content-filter", "error"] as const) {
    const partial = new MockLanguageModelV4({ doGenerate: { ...answer("Partial"), finishReason: { unified: reason, raw: undefined } } });
    await assert.rejects(new AiSdkProvider(partial).generate(request), /Échec du modèle/);
  }
});

test("AI SDK cancellation stops before a request and propagates during a request", async () => {
  const controller = new AbortController();
  controller.abort();
  const unused = new MockLanguageModelV4({ doGenerate: answer() });
  await assert.rejects(new AiSdkProvider(unused).generate({ ...request, signal: controller.signal }), { name: "AbortError" });
  assert.equal(unused.doGenerateCalls.length, 0);
  const pending = new AbortController();
  const model = new MockLanguageModelV4({ doGenerate: options => new Promise((_resolve, reject) => {
    options.abortSignal!.addEventListener("abort", () => reject(options.abortSignal!.reason), { once: true });
    pending.abort();
  }) });
  await assert.rejects(new AiSdkProvider(model).generate({ ...request, signal: pending.signal }), { name: "AbortError" });
  assert.equal(model.doGenerateCalls.length, 1);
});

test("direct clients send bounded requests to the selected provider without gateway or HTTP retry", async () => {
  for (const provider of ["openai", "anthropic"] as const) {
    const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    const model = createAiSdkProvider({ provider, modelId: "simulated-model", apiKey: "fake-test-key", maxOutputTokens: 128,
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ error: { type: "server_error", message: "fake-private-error" } }),
          { status: 503, headers: { "content-type": "application/json" } });
      },
    });
    await assert.rejects(model.generate({ ...request, tools }), /Échec du modèle/);
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, provider === "openai" ? "https://api.openai.com/v1/responses" : "https://api.anthropic.com/v1/messages");
    assert.equal(call.body.model, "simulated-model");
    assert.equal(call.body[provider === "openai" ? "max_output_tokens" : "max_tokens"], 128);
    assert.equal(call.headers.get(provider === "openai" ? "authorization" : "x-api-key"),
      provider === "openai" ? "Bearer fake-test-key" : "fake-test-key");
    if (provider === "openai") assert.equal(call.body.store, false);
  }
});

test("API-key providers still parse successful OpenAI and Anthropic responses", async () => {
  for (const provider of ["openai", "anthropic"] as const) {
    const model = createAiSdkProvider({ provider, modelId: "test-model", apiKey: "fake-api-key", maxOutputTokens: 128,
      fetch: async () => Response.json(provider === "openai" ? {
        id: "resp_test", created_at: 0, model: "test-model", object: "response", status: "completed", error: null, incomplete_details: null,
        output: [{ type: "message", id: "msg_test", status: "completed", role: "assistant",
          content: [{ type: "output_text", text: "API works", annotations: [] }] }],
        usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      } : {
        id: "msg_test", type: "message", role: "assistant", model: "test-model", content: [{ type: "text", text: "API works" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 4, output_tokens: 3 },
      }),
    });
    assert.deepEqual(await model.generate(request), { content: "API works", toolCalls: [] });
  }
});


test("AI SDK translates hydrated attachments without changing the neutral request", async () => {
 const model=new MockLanguageModelV4({doGenerate:answer()});
 const attachments=[{id:'image',name:'image.png',mediaType:'image/png',size:3,data:Buffer.from('img').toString('base64')},{id:'pdf',name:'doc.pdf',mediaType:'application/pdf',size:3,data:Buffer.from('pdf').toString('base64')},{id:'txt',name:'note.txt',mediaType:'text/plain',size:4,data:Buffer.from('note').toString('base64')}];
 const input={...request,messages:[{role:'user' as const,content:'Lis',attachments}]};const before=JSON.stringify(input);
 await new AiSdkProvider(model).generate(input);
 const user=model.doGenerateCalls[0].prompt.find(item=>item.role==='user');assert(user);
 const encoded=JSON.stringify(user);assert.match(encoded,/image/);assert.match(encoded,/application\/pdf/);assert.match(encoded,/note/);assert.equal(JSON.stringify(input),before);
});


test('OpenRouter free qualification accepts explicit free models only and enforces zero-price routing without retries',async()=>{
 let calls=0;const modelId='vendor/free-model:free';
 const provider=createAiSdkProvider({provider:'openrouter',modelId,apiKey:'fake-router-key',maxOutputTokens:128,fetch:async(url,init)=>{
  calls++;assert.equal(String(url),'https://openrouter.ai/api/v1/chat/completions');assert.equal(init?.redirect,'error');
  assert.equal(new Headers(init!.headers).get('authorization'),'Bearer fake-router-key');
  const body=JSON.parse(String(init!.body));assert.equal(body.model,modelId);assert.deepEqual(body.provider,{max_price:{prompt:0,completion:0,request:0},allow_fallbacks:false,require_parameters:true});assert(!body.models);
  return Response.json({id:'test-free',object:'chat.completion',created:1,model:modelId,choices:[{index:0,message:{role:'assistant',content:'Réponse OpenRouter simulée'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
 }});
 assert.equal((await provider.generate(request)).content,'Réponse OpenRouter simulée');assert.equal(calls,1);
 for(const modelId of ['vendor/paid-model','openrouter/auto','openrouter/free','vendor/model:free,paid'])assert.throws(()=>createAiSdkProvider({provider:'openrouter',freeOnly:true,modelId,apiKey:'fake',maxOutputTokens:128}),/:free/);
});


test('OpenRouter catalog includes paid, free and non-tool models with pricing and stays refreshable',async()=>{
 const {openRouterModels}=await import('../src/modules/models/ai-sdk/index.ts');
 const good={id:'vendor/a:free',name:'Alpha',context_length:32768,pricing:{prompt:'0',completion:'0',request:'0'},supported_parameters:['tools']};
 let calls=0;
 const transport:typeof fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://openrouter.ai/api/v1/models');assert(!new Headers(init?.headers).has('authorization'));return Response.json({data:[good,good,{...good,id:'vendor/paid'},{...good,id:'vendor/b:free',pricing:{prompt:'0.1',completion:'0'}},{...good,id:'vendor/c:free',pricing:{prompt:null,completion:'0'}},{...good,id:'vendor/d:free',supported_parameters:[]}]});};
 const entries=await openRouterModels(transport);assert.equal(entries.length,5);assert(entries.some(item=>item.id==='vendor/paid'));assert.equal(entries.find(item=>item.id==='vendor/d:free')?.supportsTools,false);assert.equal(entries.find(item=>item.id==='vendor/b:free')?.pricing.input,100000);assert.equal(entries.find(item=>item.id==='vendor/c:free')?.pricing.input,null);await openRouterModels(transport);assert.equal(calls,2);
 await assert.rejects(openRouterModels(async()=>new Response('private-provider-detail',{status:503})),error=>(error as Error).message==='Catalogue OpenRouter indisponible. Actualise la liste pour réessayer.');
});


test('OpenRouter paid selection is explicit while unsupported tools are not advertised',async()=>{
 let calls=0;const modelId='vendor/paid';
 const model=createAiSdkProvider({provider:'openrouter',modelId,apiKey:'fake',supportsTools:false,maxOutputTokens:128,fetch:async(_url,init)=>{
  calls++;const body=JSON.parse(String(init!.body));assert.equal(body.model,modelId);assert.deepEqual(body.provider,{allow_fallbacks:false,require_parameters:true});assert(!body.tools?.length);assert(!body.models);
  return Response.json({id:'paid-mock',object:'chat.completion',created:1,model:modelId,choices:[{index:0,message:{role:'assistant',content:'Simulated'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
 }});
 assert.equal(model.supportsTools,false);await model.generate({...request,tools});assert.equal(calls,1);
});


test('paid qualification forwards an explicit provider price ceiling',async()=>{
 const maxPrice={prompt:0.06,completion:0.18,request:0};
 const model=createAiSdkProvider({provider:'openrouter',modelId:'deepseek/test',apiKey:'fake',maxOutputTokens:10,maxPrice,fetch:async(_url,init)=>{
  assert.deepEqual(JSON.parse(String(init!.body)).provider.max_price,maxPrice);
  return Response.json({id:'cap',object:'chat.completion',created:1,model:'deepseek/test',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
 }});assert.equal((await model.generate(request)).content,'ok');
});

test("AI SDK diagnoses empty and invalid tool responses without exposing provider data", async () => {
  const { AiSdkResponseError } = await import("../src/modules/models/ai-sdk/index.ts");
  for (const [response, code] of [
    [answer(""), "empty-response"],
    [{ ...answer(), content: [{ type: "tool-call", toolCallId: "bad", toolName: "unrecognized", input: "{}" }] }, "invalid-tool-call"],
  ] as const) {
    const model = new MockLanguageModelV4({ doGenerate: response as ReturnType<typeof answer> });
    await assert.rejects(new AiSdkProvider(model).generate(request), error => {
      assert(error instanceof AiSdkResponseError || error instanceof ModelToolCallError);
      assert.equal(error.code, code);
      assert.equal(error.message, code === "empty-response" ? "Échec du modèle : réponse vide du fournisseur." : "Échec du modèle : appel d’outil invalide. Aucun outil de cette réponse exécuté.");
      return true;
    });
  }
});

test('effort is translated at each API boundary and omitted for provider defaults',async()=>{
 for(const provider of ['openai','anthropic','openrouter'] as const){
  for(const effort of [undefined,'high']){
   let body:any;const model=createAiSdkProvider({provider,modelId:'vendor/test',apiKey:'fake',maxOutputTokens:128,reasoningEffort:effort,fetch:async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response('',{status:503});}});
   await assert.rejects(model.generate(request));
   assert.equal(provider==='anthropic'?body.output_config?.effort:body.reasoning?.effort,effort,provider);
   if(provider==='openrouter')assert.equal(body.provider.require_parameters,true);
  }
 }
});

test('catalogues expose only documented per-model effort capabilities',async()=>{
 const {openRouterModels,apiModelCapabilities}=await import('../src/modules/models/ai-sdk/index.ts');
 const base={id:'vendor/test',name:'Test',context_length:32768,pricing:{}};
 const models=await openRouterModels(async()=>Response.json({data:[{...base,reasoning:{supported_efforts:['high','low','none','invented'],mandatory:true,default_effort:'low'}},{...base,id:'vendor/all',reasoning:{supported_efforts:null}},{...base,id:'vendor/absent'}]}));
 assert.deepEqual(models.find(model=>model.id==='vendor/test')?.reasoningEfforts,['high','low']);assert.equal(models.find(model=>model.id==='vendor/test')?.defaultReasoningEffort,'low');assert.equal(models.find(model=>model.id==='vendor/absent')?.reasoningEfforts,undefined);assert(models.find(model=>model.id==='vendor/all')?.reasoningEfforts?.includes('max'));
 const claude=await apiModelCapabilities('anthropic','test','fake',async()=>Response.json({capabilities:{effort:{supported:true,low:{supported:true},max:{supported:false},high:{supported:true}}},max_input_tokens:200000}));assert.deepEqual(claude.reasoningEfforts,['low','high']);
 const openai=await apiModelCapabilities('openai','gpt-6.1-sol','fake',async()=>Response.json({id:'gpt-6.1-sol'}));assert.deepEqual(openai.reasoningEfforts,['low','medium','high','xhigh','max']);
});


test("AI SDK has no hidden 1024-token cap and diagnoses truncation before any tool execution", async () => {
  const model = new MockLanguageModelV4({ doGenerate: answer("Complete") });
  await new AiSdkProvider(model).generate(request);
  assert.equal(model.doGenerateCalls[0].maxOutputTokens, undefined);
  const partial = new MockLanguageModelV4({ doGenerate: async options => ({ ...answer(),
    content: [{ type: "tool-call", toolCallId: "partial", toolName: options.tools![0].name, input: '{"query":"ok"}' }],
    finishReason: { unified: "length", raw: undefined },
  }) });
  await assert.rejects(new AiSdkProvider(partial).generate({ ...request, tools }), error => {
    assert.equal((error as {code?:string}).code, "output-limit");
    assert.match((error as Error).message, /limite de sortie atteinte/);
    return true;
  });
});


test("API failures have safe actionable codes without raw headers, bodies or retries", async () => {
  for (const [status, code] of [[401,"authentication"],[403,"authentication"],[402,"credits"],[429,"rate-limit"],[503,"provider-unavailable"],[400,"provider-rejected"],[200,"invalid-response"]] as const) {
    let calls = 0;
    const model = createAiSdkProvider({ provider: "openrouter", modelId: "vendor/test", apiKey: "fake-secret-key", fetch: async () => {
      calls++;
      return Response.json({ error: { message: "private-provider-body", type: "server_error" } }, { status });
    } });
    await assert.rejects(model.generate(request), error => {
      assert.equal((error as {code?:string}).code, code);
      assert.doesNotMatch((error as Error).message, /private-provider|fake-secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("API providers accept MCP JSON Schema 2020-12 without weakening argument formats", async()=>{
 const parameters={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{id:{type:'string',format:'uuid'},at:{type:'string',format:'date-time'}},required:['id','at'],additionalProperties:false};
 for(const valid of [true,false]){
  const model=new MockLanguageModelV4({doGenerate:async options=>({...answer(),content:[{type:'tool-call',toolCallId:'mcp-call',toolName:options.tools![0].name,input:JSON.stringify({id:valid?'051d0bd1-a3c7-437c-ac87-c2181302d59d':'invalid',at:'2026-11-20T12:00:00Z'})}],finishReason:{unified:'tool-calls',raw:undefined}})});
  const input={...request,tools:[{name:'mcp_example',description:'MCP fixture',parameters}]};if(valid)assert.equal((await new AiSdkProvider(model).generate(input)).toolCalls[0].name,'mcp_example');else await assert.rejects(new AiSdkProvider(model).generate(input));assert.equal(model.doGenerateCalls.length,1);
 }
});
