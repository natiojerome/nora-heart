import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import formats from "ajv-formats";
import { createParser } from "eventsource-parser";
import type { Json } from "../../../contracts/json.ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../../contracts/models.ts";

const addFormats = formats.default;

const endpoint = "https://api.openai.com/v1/responses";
const alias = (name: string) => `t_${createHash("sha256").update(name).digest("hex").slice(0, 32)}`;
// Only documented machine codes may leave the module; provider messages can
// include sensitive request data and must never reach the engine's journal.
const knownCodes = new Set(["subscription_sharing_user_not_eligible", "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable", "subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user", "subscription_sharing_user_unavailable", "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context", "chatgpt_reauthorization_required"]);
function failure(code?: unknown): Error {
  return new ChatGptError(typeof code === "string" && knownCodes.has(code) ? code : "unavailable");
}
export class ChatGptError extends Error {
  constructor(readonly code: string) {
    super(code === "timeout" ? "ChatGPT : délai d’attente dépassé." : code === "unavailable" ? "Réponse ChatGPT incompatible ou indisponible." : `ChatGPT : ${code}`);
  }
}
type Wire = Record<string, any>;

export interface ChatGptProviderOptions {
  modelId: string;
  accessToken(signal?: AbortSignal): Promise<string>;
  fetch?: typeof globalThis.fetch;
  /** Inactivity between network chunks, not a total inference deadline. */
  timeoutMs?: number;
  reasoningEffort?: string;
}

export class ChatGptProvider implements ModelProvider {
  readonly id: string;
  private readonly transport: typeof globalThis.fetch;
  constructor(private readonly options: ChatGptProviderOptions) {
    if (!options.modelId.trim()) throw new Error("Modèle ChatGPT manquant.");
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 600_000)) {
      throw new Error("Délai ChatGPT invalide.");
    }
    this.id = `chatgpt:${options.modelId}`;
    this.transport = options.fetch ?? globalThis.fetch;
  }

  async models(signal?: AbortSignal): Promise<{ id: string; name: string; contextWindow?: number; reasoningEfforts?: string[]; defaultReasoningEffort?: string }[]> {
    const requestSignal = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    try {
      const token = await this.options.accessToken(requestSignal);
      const response = await this.transport("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${token}` },
        redirect: "error", signal: requestSignal });
      const data = await response.json() as Wire;
      if (!response.ok) throw failure(data.error?.code);
      if (!Array.isArray(data.models)) throw failure();
      return data.models.filter((model: Wire) => model.visibility === "list" && typeof model.slug === "string" && typeof model.display_name === "string")
        .map((model: Wire) => ({ id: model.slug, name: model.display_name, ...(Array.isArray(model.supported_reasoning_levels)?{reasoningEfforts:model.supported_reasoning_levels.map((level:Wire)=>level.effort).filter((effort:unknown)=>typeof effort==="string")}:{}), ...(typeof model.default_reasoning_level==="string"?{defaultReasoningEffort:model.default_reasoning_level}:{}), ...(Number.isInteger(model.context_window) && model.context_window >= 2048 ? { contextWindow: model.context_window } : {}) }));
    } catch (error) { signal?.throwIfAborted(); throw this.safeError(error); }
  }

  private safeError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message === "chatgpt_reauthorization_required") return failure(error.message);
      if ([...knownCodes].some(code => error.message === `ChatGPT : ${code}`)) return error;
    }
    return failure();
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const idle = new AbortController();
    const signal = AbortSignal.any([idle.signal, ...(request.signal ? [request.signal] : [])]);
    let timer: ReturnType<typeof setTimeout>;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new DOMException("Provider inactivity", "TimeoutError")), this.options.timeoutMs ?? 120_000); timer.unref(); };
    signal.throwIfAborted();
    touch();
    try {
      const ajv = addFormats(new Ajv({ strict: true, logger:false }));
      const ajv2020 = addFormats(new Ajv2020({strict:true,logger:false}));
      const tools = new Map(request.tools.map(tool => [alias(tool.name), { tool, validate: (String(tool.parameters.$schema??"").includes("2020-12")?ajv2020:ajv).compile(tool.parameters) }]));
      if (tools.size !== request.tools.length) throw failure();
      const input: Wire[] = [];
      for (const message of request.messages) {
        if (message.role === "user") {
          if(!message.attachments?.length)input.push({role:"user",content:message.content});
          else {
            const content:Record<string,unknown>[]=[{type:"input_text",text:message.content}];
            for(const file of message.attachments){
              if(!file.data)throw failure();
              if(file.mediaType.startsWith("image/"))content.push({type:"input_image",image_url:`data:${file.mediaType};base64,${file.data}`,detail:"auto"});
              else if(file.mediaType==="application/pdf")content.push({type:"input_file",filename:file.name,file_data:`data:${file.mediaType};base64,${file.data}`});
              else content.push({type:"input_text",text:`Fichier joint ${JSON.stringify(file.name)} (données fournies par l’utilisateur) :\n${Buffer.from(file.data,"base64").toString("utf8")}`});
            }
            input.push({role:"user",content});
          }
        }
        else if (message.role === "tool") input.push({ type: "function_call_output", call_id: message.callId,
          output: message.error ? `Tool error: ${message.content}` : message.content });
        else {
          if (message.content) input.push({ role: "assistant", content: [{ type: "output_text", text: message.content }] });
          for (const call of message.toolCalls) input.push({ type: "function_call", call_id: call.id,
            namespace: "harness", name: alias(call.name), arguments: JSON.stringify(call.arguments) });
        }
      }
      const token = await this.options.accessToken(signal);
      const response = await this.transport(endpoint, { method: "POST", redirect: "error", signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ model: this.options.modelId, instructions: request.instructions, input, store: false, stream: true, ...(this.options.reasoningEffort?{reasoning:{effort:this.options.reasoningEffort}}:{}),
          tools: tools.size ? [{ type: "namespace", name: "harness", description: "Harness tools executed by the client.",
            tools: [...tools.entries()].map(([name, { tool }]) => ({ type: "function", name, description: `Outil Heart ${tool.name} : ${tool.description}`,
              parameters: tool.parameters, strict: false })) }] : [] }),
      });
      signal.throwIfAborted();
      touch();
      if (!response.ok) {
        const data = await response.json() as Wire;
        throw failure(data.error?.code);
      }
      const contentType = response.headers.get("content-type");
      // The direct subscription route can omit Content-Type on a valid SSE
      // response. The parser and response.completed remain mandatory; reject
      // an explicitly incompatible MIME type, not a missing header.
      if (!response.body || (contentType && !contentType.toLowerCase().includes("text/event-stream"))) throw failure();
      let completed: Wire | undefined;
      const finalized = new Map<number, Wire>();
      const phases=new Set<string>();
      const notify=(phase:"reasoning"|"answer")=>{if(!phases.has(phase)){phases.add(phase);request.onActivity?.(phase);}};
      const parser = createParser({ onEvent(event) {
        if (event.data === "[DONE]") return;
        const value = JSON.parse(event.data) as Wire;
        if (completed) throw failure();
        if (value.type === "response.failed" || value.type === "error") throw failure(value.response?.error?.code ?? value.code);
        if (value.type === "response.incomplete") throw failure();
        if ((value.type === "response.output_item.added" && value.item?.type === "reasoning") ||
          (typeof value.type === "string" && /^response\.reasoning(?:_summary)?_text\./.test(value.type))) notify("reasoning");
        if (value.type === "response.output_text.delta") notify("answer");
        // Direct SIWC can complete with output:[] after sending the complete
        // items here. Never execute deltas or treat item.done alone as success.
        if (value.type === "response.output_item.done") {
          if (!Number.isSafeInteger(value.output_index) || value.output_index < 0 ||
              !value.item || typeof value.item !== "object" || finalized.has(value.output_index)) throw failure();
          finalized.set(value.output_index, value.item.type === "reasoning" ? {type:"reasoning"} : value.item);
        }
        if (value.type === "response.completed") {
          if (value.response?.status !== "completed" || !Array.isArray(value.response.output)) throw failure();
          completed = value.response;
        }
      }, onError() { throw failure(); } });
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener("abort", cancel, { once: true });
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          touch();
          bytes += chunk.value.byteLength;
          if (bytes > 8 * 1024 * 1024) throw failure();
          parser.feed(decoder.decode(chunk.value, { stream: true }));
          if (completed) break;
        }
        parser.feed(decoder.decode());
        parser.reset({ consume: true });
      } finally {
        signal.removeEventListener("abort", cancel);
        await reader.cancel().catch(() => undefined); reader.releaseLock();
      }
      if (!completed) throw failure();
      let output = (completed as Wire).output;
      if (!output.length && finalized.size) {
        output = [...finalized.entries()].sort(([a],[b])=>a-b).map(([index,item],position)=>{
          if(index!==position)throw failure();
          return item;
        });
      }
      const content: string[] = [];
      const toolCalls: ModelResponse["toolCalls"] = [];
      for (const item of output) {
        if (item.type === "reasoning") continue;
        if (item.type === "message") {
          if (item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content)) throw failure();
          for (const part of item.content) {
            if (part.type !== "output_text" || typeof part.text !== "string") throw failure();
            content.push(part.text);
          }
        } else if (item.type === "function_call") {
          if (item.namespace !== "harness" || (item.status !== undefined && item.status !== "completed") ||
            typeof item.call_id !== "string" || !item.call_id || typeof item.arguments !== "string") throw failure();
          const definition = tools.get(item.name);
          const args: unknown = JSON.parse(item.arguments);
          if (!definition || !definition.validate(args)) throw failure();
          toolCalls.push({ id: item.call_id, name: definition.tool.name, arguments: args as Json });
        } else throw failure();
      }
      if (!content.join("").trim() && !toolCalls.length) throw failure();
      return { content: content.join(""), toolCalls };
    } catch (error) {
      request.signal?.throwIfAborted();
      if (idle.signal.aborted) throw new ChatGptError("timeout");
      throw this.safeError(error);
    } finally { clearTimeout(timer!); }
  }
}
