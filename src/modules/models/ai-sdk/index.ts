import {routerReasoning} from "./capabilities.ts";
import { createHash } from "node:crypto";
import { APICallError, InvalidResponseDataError, JSONParseError, TypeValidationError, generateText, jsonSchema, stepCountIs, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import type { Json } from "../../../contracts/json.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../../contracts/models.ts";

const addFormats = formats.default;

// Stable across tool ordering and permission changes. Provider restrictions on
// tool names must never change names in our journal or permission checks.
function alias(name: string): string {
  return `t_${createHash("sha256").update(name).digest("hex").slice(0, 32)}`;
}

export const aiSdkErrorMessages = {
  "provider-unavailable": "Échec du modèle : fournisseur temporairement indisponible.",
  "provider-rejected": "Échec du modèle : requête refusée par le fournisseur.",
  "authentication": "Échec du modèle : connexion API refusée. Vérifie la clé et les droits.",
  "credits": "Échec du modèle : crédits insuffisants chez le fournisseur.",
  "rate-limit": "Échec du modèle : limite d’usage du fournisseur atteinte. Réessaie plus tard.",
  "invalid-response": "Échec du modèle : format de réponse fournisseur invalide.",
  "sdk-failure": "Échec du modèle : fournisseur indisponible ou réponse incompatible.",
  "incomplete-response": "Échec du modèle : réponse incomplète. Aucun appel d’outil partiel exécuté.",
  "output-limit": "Échec du modèle : limite de sortie atteinte. Aucun appel d’outil partiel exécuté.",
  "invalid-tool-call": "Échec du modèle : appel d’outil invalide. Aucun outil de cette réponse exécuté.",
  "empty-response": "Échec du modèle : réponse vide du fournisseur.",
} as const;
export class AiSdkResponseError extends Error {
  constructor(readonly code: keyof typeof aiSdkErrorMessages) {
    super(aiSdkErrorMessages[code]);
    this.name = "AiSdkResponseError";
  }
}

export class AiSdkProvider implements ModelProvider {
  readonly id: string;

  constructor(private readonly model: LanguageModel & { modelId: string; provider: string },
    private readonly maxOutputTokens?: number, private readonly reasoning?:{provider:"openai"|"anthropic";effort:string}) {
    if (maxOutputTokens !== undefined && (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 65536)) {
      throw new Error("Limite de sortie modèle invalide (1 à 65536 tokens).");
    }
    this.id = `ai-sdk:${model.provider}:${model.modelId}`;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    request.signal?.throwIfAborted();
    try {
      const ajv = addFormats(new Ajv({ strict: true, allErrors: false,logger:false }));
      const ajv2020 = addFormats(new Ajv2020({strict:true,allErrors:false,logger:false}));
      const tools: ToolSet = {};
      const names = new Map<string, string>();
      for (const definition of request.tools) {
        const name = alias(definition.name);
        if (names.has(name)) throw new Error("Outil dupliqué.");
        names.set(name, definition.name);
        const validate = (String(definition.parameters.$schema??"").includes("2020-12")?ajv2020:ajv).compile(definition.parameters);
        tools[name] = {
          description: `Outil Heart ${definition.name} : ${definition.description}`,
          inputSchema: jsonSchema<Json>(definition.parameters, {
            validate: value => validate(value)
              ? { success: true, value: value as Json }
              : { success: false, error: new Error("Arguments d’outil invalides.") },
          }),
          // No execute callback: only the harness may execute a tool.
        };
      }
      const messages: ModelMessage[] = request.messages.map(message => {
        if (message.role === "user") {
          if(!message.attachments?.length)return {role:"user",content:message.content};
          const content:Exclude<Extract<ModelMessage,{role:"user"}>["content"],string>=[{type:"text",text:message.content}];
          for(const file of message.attachments){
            if(!file.data)throw new Error("Pièce jointe non résolue.");
            const bytes=Buffer.from(file.data,"base64");
            if(file.mediaType.startsWith("image/"))content.push({type:"image",image:bytes,mediaType:file.mediaType});
            else if(file.mediaType==="application/pdf")content.push({type:"file",data:bytes,mediaType:file.mediaType,filename:file.name});
            else content.push({type:"text",text:`Fichier joint ${JSON.stringify(file.name)} (données fournies par l’utilisateur) :\n${bytes.toString("utf8")}`});
          }
          return {role:"user",content};
        }
        if (message.role === "tool") return { role: "tool", content: [{
          type: "tool-result", toolCallId: message.callId, toolName: alias(message.name),
          output: { type: message.error ? "error-text" : "text", value: message.content },
        }] };
        return { role: "assistant", content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.toolCalls.map(call => ({ type: "tool-call" as const,
            toolCallId: call.id, toolName: alias(call.name), input: call.arguments })),
        ] };
      });
      const result = await generateText({
        model: this.model, instructions: request.instructions, messages, tools,
        maxOutputTokens: this.maxOutputTokens, maxRetries: 0,
        abortSignal: request.signal, stopWhen: stepCountIs(1),
        telemetry: { isEnabled: false },
        providerOptions: { openai: { store: false,...(this.reasoning?.provider==='openai'?{reasoningEffort:this.reasoning.effort}:{}) },...(this.reasoning?.provider==='anthropic'?{anthropic:{effort:this.reasoning.effort}}:{}) },
      });
      request.signal?.throwIfAborted();
      if (result.finishReason === "length") throw new AiSdkResponseError("output-limit");
      if (!["stop", "tool-calls"].includes(result.finishReason)) throw new AiSdkResponseError("incomplete-response");
      const toolCalls = result.toolCalls.map(call => {
        const name = names.get(call.toolName);
        if (!name || call.invalid || call.providerExecuted) throw new AiSdkResponseError("invalid-tool-call");
        return { id: call.toolCallId, name, arguments: call.input as Json };
      });
      if (!result.text && !toolCalls.length) throw new AiSdkResponseError("empty-response");
      return { content: result.text, toolCalls };
    } catch (error) {
      // Raw SDK/API errors can contain headers, prompts or credentials. The
      // engine persists error messages, so expose only this bounded message.
      request.signal?.throwIfAborted();
      if (error instanceof AiSdkResponseError) throw error;
      if (APICallError.isInstance(error)) {
        const status = error.statusCode;
        throw new AiSdkResponseError(status === 401 || status === 403 ? "authentication"
          : status === 402 ? "credits" : status === 429 ? "rate-limit"
          : status !== undefined && status >= 500 ? "provider-unavailable"
          : status !== undefined && status >= 400 ? "provider-rejected" : "invalid-response");
      }
      if (InvalidResponseDataError.isInstance(error) || JSONParseError.isInstance(error) || TypeValidationError.isInstance(error))
        throw new AiSdkResponseError("invalid-response");
      throw new AiSdkResponseError("sdk-failure");
    }
  }
}

export interface AiSdkOptions {
  provider: "openai" | "anthropic" | "openrouter" | "venice";
  modelId: string;
  apiKey: string;
  /** Omit to use the selected provider/SDK default; explicit CLI budgets remain supported. */
  maxOutputTokens?: number;
  fetch?: typeof globalThis.fetch;
  freeOnly?: boolean;
  supportsTools?: boolean;
  reasoningEffort?: string;
  /** OpenRouter prices in USD per million tokens; request is USD per call. */
  maxPrice?: { prompt: number; completion: number; request: number };
}

export function createAiSdkProvider(options: AiSdkOptions): ModelProvider {
  if (options.provider === "venice") {
    const transport = options.fetch ?? globalThis.fetch;
    const guarded: typeof fetch = async (input, init) => {
      if (String(input) !== "https://api.venice.ai/api/v1/chat/completions" || typeof init?.body !== "string")
        throw new Error("Requête Venice AI refusée.");
      const body = JSON.parse(init.body);
      if (body.model !== options.modelId || body.models) throw new Error("Modèle Venice AI refusé.");
      if (options.reasoningEffort) body.reasoning_effort = options.reasoningEffort;
      body.store = false;
      body.fallbacks = [];
      body.venice_parameters = {
        include_venice_system_prompt: false,
        enable_web_search: "off",
        enable_web_scraping: false,
        enable_x_search: false,
        strip_thinking_response: true,
      };
      return transport(input, { ...init, redirect: "error", body: JSON.stringify(body) });
    };
    const model = createOpenAI({ name: "venice", apiKey: options.apiKey, baseURL: "https://api.venice.ai/api/v1", fetch: guarded }).chat(options.modelId);
    const provider = new AiSdkProvider(model, options.maxOutputTokens);
    return {
      id: `ai-sdk:venice:${options.modelId}`,
      ...(options.supportsTools === false ? { supportsTools: false } : {}),
      generate: request => provider.generate(options.supportsTools === false ? { ...request, tools: [] } : request),
    };
  }
  if(options.provider === "openrouter"){
    if(options.freeOnly&&!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+:free$/.test(options.modelId))throw new Error("OpenRouter : choisir un identifiant de modèle terminé par :free. Aucun modèle payant autorisé.");
    if(options.maxPrice && Object.values(options.maxPrice).some(value=>!Number.isFinite(value)||value<0))throw new Error("Plafond de prix invalide.");
    const transport=options.fetch??globalThis.fetch;
    const guarded:typeof fetch=async(input,init)=>{
      if(String(input)!=="https://openrouter.ai/api/v1/chat/completions" || typeof init?.body!=="string")throw new Error("Requête OpenRouter refusée.");
      const body=JSON.parse(init.body);
      if(body.model!==options.modelId || body.models)throw new Error("Modèle OpenRouter refusé.");
      if(options.reasoningEffort)body.reasoning={effort:options.reasoningEffort};
      body.provider={...(options.freeOnly||options.modelId.endsWith(":free")?{max_price:{prompt:0,completion:0,request:0}}:options.maxPrice?{max_price:options.maxPrice}:{}),allow_fallbacks:false,require_parameters:true};
      return transport(input,{...init,redirect:"error",body:JSON.stringify(body)});
    };
    const provider=new AiSdkProvider(createOpenAI({apiKey:options.apiKey,baseURL:"https://openrouter.ai/api/v1",fetch:guarded}).chat(options.modelId),options.maxOutputTokens);
    return options.supportsTools===false?{id:provider.id,supportsTools:false,generate:request=>provider.generate({...request,tools:[]})}:provider;
  }
  // Preserve a validated effort even for a model newer than the SDK's own model table.
  const transport=options.fetch??globalThis.fetch;
  const apiFetch:typeof fetch=options.reasoningEffort?async(input,init)=>{
    const endpoint=options.provider==='openai'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages';
    if(String(input)===endpoint&&typeof init?.body==='string'){
      const body=JSON.parse(init.body),field=options.provider==='openai'?'reasoning':'output_config';
      body[field]={...body[field],effort:options.reasoningEffort};
      return transport(input,{...init,body:JSON.stringify(body)});
    }
    return transport(input,init);
  }:transport;
  const model = options.provider === "openai"
    ? createOpenAI({ apiKey: options.apiKey, baseURL: "https://api.openai.com/v1", fetch: apiFetch }).responses(options.modelId)
    : createAnthropic({ apiKey: options.apiKey, baseURL: "https://api.anthropic.com/v1", fetch: apiFetch })(options.modelId);
  return new AiSdkProvider(model, options.maxOutputTokens,options.reasoningEffort?{provider:options.provider,effort:options.reasoningEffort}:undefined);
}


export interface OpenRouterModel {
 id:string;name:string;contextWindow:number;supportsTools:boolean;vision:boolean;reasoningEfforts?:string[];defaultReasoningEffort?:string;
 pricing:{input:number|null;output:number|null;request:number|null};
}
export async function openRouterModels(transport:typeof fetch=globalThis.fetch):Promise<OpenRouterModel[]> {
 try {
  const response=await transport('https://openrouter.ai/api/v1/models',{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error();
  const body=await response.json() as {data?:unknown};if(!Array.isArray(body.data))throw new Error();
  const price=(value:unknown,factor=1)=>{if((typeof value!=='number'&&typeof value!=='string')||value==='')return null;const amount=Number(value);return Number.isFinite(amount)&&amount>=0?amount*factor:null;};
  const unique=new Map<string,OpenRouterModel>();
  for(const item of body.data){
   if(!item||typeof item.id!=='string'||!item.id.includes('/')||typeof item.name!=='string'||!item.name.trim()||!Number.isInteger(item.context_length)||item.context_length<4096)continue;
   if(Array.isArray(item.architecture?.output_modalities)&&!item.architecture.output_modalities.includes('text'))continue;
   unique.set(item.id,{...routerReasoning(item),id:item.id,name:item.name,contextWindow:item.context_length,supportsTools:Array.isArray(item.supported_parameters)&&item.supported_parameters.includes('tools'),vision:Array.isArray(item.architecture?.input_modalities)&&item.architecture.input_modalities.includes('image'),pricing:{input:price(item.pricing?.prompt,1000000),output:price(item.pricing?.completion,1000000),request:price(item.pricing?.request)}});
  }
  return [...unique.values()].sort((a,b)=>a.name.localeCompare(b.name));
 }catch{throw new Error('Catalogue OpenRouter indisponible. Actualise la liste pour réessayer.');}
}

export {readOpenRouterUsage} from './usage.ts';

export {apiModelCapabilities} from "./capabilities.ts";

export {veniceModels} from "./venice.ts";
