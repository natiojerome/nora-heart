import {Engine} from '../src/core/engine.ts';
import {fileTools} from '../src/modules/tools/files/index.ts';
import {memoryTools} from '../src/modules/tools/memory/index.ts';
import {interactionTools} from '../src/modules/tools/interactions/index.ts';
import {BoundedContext} from '../src/modules/context/bounded/index.ts';
import type {Tool} from '../src/contracts/tools.ts';
import type {ConversationDefaults} from "../src/contracts/conversation-defaults.ts";
import type { ExecutionService } from "../src/contracts/execution.ts";
import { chatAssetsFixture } from "./chat-assets.fixture.ts";
import path from "node:path";
import type { Conversation, ConversationRepository, ModelSelection } from "../src/contracts/conversations.ts";
import type { ModelProvider } from "../src/contracts/models.ts";
import { Conversations } from "../src/app/conversations.ts";
import { BasicMemory } from "../src/modules/memory/basic/index.ts";
import { openJsonStorage } from "../src/modules/storage/json/index.ts";
import { DemoProvider } from "../src/modules/models/demo/index.ts";

export async function conversationFixture(directory: string, model?: (selection: ModelSelection) => ModelProvider, assistantInstructions?: () => Promise<string>, execution?: ExecutionService, hostExecution?:ExecutionService, defaults?:()=>Promise<ConversationDefaults>, capabilities?:(provider:ModelSelection["provider"],id:string)=>Promise<import("../src/contracts/models.ts").ModelCapabilities>, catalog?:()=>Promise<{models:import("../src/contracts/models.ts").ModelCapabilities[]}> , extraTools?:(conversation:Conversation)=>Promise<Tool[]>) {
  const records = new Map<string, Conversation>();
  const repository: ConversationRepository = {
    async create(value) { records.set(value.id, structuredClone(value)); },
    async get(id) { return structuredClone(records.get(id) ?? null); },
    async list() { return structuredClone([...records.values()]); },
    async setExecutionPolicy(id,network,maxSteps){Object.assign(records.get(id)!,{networkAccess:network,maxSteps});},
    async setFileAccess(id, access) { records.get(id)!.fileAccess = access; },
    async select(id, selection) { records.get(id)!.selection = structuredClone(selection); },
  };
  const storage = await openJsonStorage(path.join(directory, "storage"));
  const chatAssets=chatAssetsFixture();
  const options = { defaults, capabilities, execution, hostExecution, chatAssets:chatAssets.assets, repository, sessions: storage.sessions, memory: new BasicMemory(storage.memories),
    workspaceDirectory: path.join(directory, "workspaces"), displayName: "Nora", assistantInstructions,
    model: model ?? (() => new DemoProvider()), catalog: catalog??(async () => ({ models: [{ id: "fake-chatgpt", contextWindow: 8192, reasoningEfforts:["low","high"] }] })) };
  if(extraTools)Object.assign(options,{engineFor:async(conversation:Conversation)=>new Engine(storage.sessions,[...fileTools(),...memoryTools(options.memory),...interactionTools(),...await extraTools(conversation)],new BoundedContext(storage.sessions,options.memory))});
  return { chatAssets, service: new Conversations(options), restart: () => new Conversations(options), storage, repository };
}
