import {historyTools} from "../modules/tools/history/index.ts";
import {WalletClient} from '../modules/wallets/unix/index.ts';
import {walletTools} from '../modules/tools/wallets/index.ts';
import {HostFiles} from '../modules/tools/host-files/index.ts';
import type {ProjectRepository} from "../contracts/projects.ts";
import {McpProjectsRepository} from "../modules/storage/mcp-projects/index.ts";
import {McpMemoryRepository} from "../modules/storage/mcp-memory/index.ts";
import {ProjectsWorkspace} from "./projects-workspace.ts";
import {Tasks,ConversationTaskExecution} from "./tasks.ts";
import {Skills} from "./skills.ts";
import {skillTools} from "../modules/tools/skills/index.ts";
import {instructionValue} from "./instruction-defaults.ts";
import { MemoryReview } from "../modules/memory/review/index.ts";
import { ExternalToolError, ExternalTools } from "./external-tools.ts";
import { connectMcp } from "../modules/tools/mcp/index.ts";
import { interactionTools } from "../modules/tools/interactions/index.ts";
import { existsSync,readFileSync } from "node:fs";
import {
  BubblewrapExecution,
  HostExecutionClient,
  terminalTools,
} from "../modules/tools/terminal/index.ts";
import { ChatAssets } from "./chat-assets.ts";
import { Assistant } from "./assistant.ts";
import path from "node:path";
import { openSqlStorage,openSkillCatalog,taskCalendar,taskScheduler,tasksTools } from "./compose.ts";
import type { SqlStorageConfig } from "./config.ts";
import { StructuredMemory } from "../modules/memory/structured/index.ts";
import { BoundedContext } from "../modules/context/bounded/index.ts";
import { structuredMemoryTools } from "../modules/tools/memory-structured/index.ts";
import { fileTools } from "../modules/tools/files/index.ts";
import { Engine } from "../core/engine.ts";
import { Conversations } from "./conversations.ts";
import { Memories } from "./memories.ts";
import type { TestLab } from "./test-lab.ts";

export async function openWebConversations(
  config: SqlStorageConfig,
  directory: string,
  lab: TestLab,
  skillsManifest?: string,
  projectsDirectory = path.join(directory,"projects"),
  projectRepository?: ProjectRepository,
) {
  const storage = await openSqlStorage(config);
  const walletSocket=process.env.HARNESS_WALLETS_SOCKET;
  const wallets=walletSocket?new WalletClient(walletSocket):undefined;
  const externalTools = new ExternalTools(
    storage.externalTools,
    (connection, signal) => connectMcp(connection, { signal }),
  );
  const projectConnectionId=process.env.HARNESS_PROJECTS_MCP_CONNECTION_ID;
  const projects:ProjectRepository=projectConnectionId?new McpProjectsRepository((name,args)=>externalTools.callApproved(projectConnectionId,name,args)):projectRepository??{
    async create(){throw new ExternalToolError("MCP Projects : configure la connexion avant de créer un projet.");},
    async get(){return null;},
    async list(){return [];},
  };
  const assistant = new Assistant(storage.assistant);
  const skills=new Skills(openSkillCatalog(skillsManifest),assistant);
  const memoryConnectionId=process.env.HARNESS_MEMORY_MCP_CONNECTION_ID;
  const aliasFile=process.env.HARNESS_MEMORY_MCP_ALIASES_FILE;
  const aliases:Record<string,string>=aliasFile?JSON.parse(readFileSync(aliasFile,'utf8')):{};
  if(!aliases||Array.isArray(aliases)||Object.entries(aliases).some(([a,b])=>!(/^[a-f0-9-]{36}$/i.test(a)&&typeof b==='string'&&/^[a-f0-9-]{36}$/i.test(b))))throw new Error('Correspondances de mémoire MCP invalides.');
  const memoryRepository=memoryConnectionId?new McpMemoryRepository((name,args)=>externalTools.callApproved(memoryConnectionId,name,args),aliases):storage.structuredMemories;
  const memory = new StructuredMemory(memoryRepository, {
    source: { type: "manual" },
  });
  const execution = existsSync("/usr/bin/bwrap")
    ? new BubblewrapExecution(path.join(directory, "commands"), {
        nodeBinary: process.execPath,
      })
    : undefined;
  const hostSocket = process.env.HARNESS_HOST_SOCKET;
  const hostExecution = hostSocket && existsSync(hostSocket)
    ? new HostExecutionClient(hostSocket) : undefined;
  const hostFiles = (workspace:string,signal?:AbortSignal) => {
    if(!hostExecution || !hostSocket)throw new Error('Worker YOLO indisponible. Aucun repli implicite.');
    return new HostFiles(hostSocket,workspace,signal);
  };
  const projectsWorkspace = new ProjectsWorkspace(projectsDirectory,storage.sessions,execution);
  await projectsWorkspace.prepare();
  let tasks:Tasks;
  const conversations = new Conversations({
    execution,
    hostExecution,
    hostFiles:hostExecution?hostFiles:undefined,
    chatAssets: new ChatAssets(storage.chatAssets),
    repository: storage.conversations,
    sessions: storage.sessions,
    memory,
    projects,
    workspaceDirectory: path.join(directory, "conversations"),
    defaults: async () => (await assistant.defaults()).defaults,
    displayName: lab.displayName,
    configuration: async () => {
      const profile=await assistant.get();
      return {instructions:profile.presentationInstructions+"\nRuntime de CE fil fourni par Heart : instance="+storage.instanceId+" ; conversations locales="+config.driver+" ; mémoire="+(memoryConnectionId?"MCP":config.driver)+" ; projets="+(projectConnectionId?"MCP":projectRepository?"repository injecté":"non configurés")+" ; code="+path.resolve(import.meta.dirname,"../..")+". Prime sur exemples et autres processus.",overrides:profile.settings.instructionOverrides??{},policies:profile.effectivePolicies,skills:await skills.capture(profile.settings.skillOverrides)};
    },
    model: (selection) => lab.model({ ...selection }),
    capabilities: (provider, id) => lab.capabilities(provider, id),
    catalog: () => lab.models("chatgpt"),
    engineFor: async (conversation, blocks, policies,runSkills) => {
      const scoped = new StructuredMemory(memoryRepository, {
        projectId: conversation.projectId ?? null,
        source: { type: "conversation", conversationId: conversation.id },
      },policies.memory);
      const selected =
        conversation.fileAccess === "yolo" ? hostExecution : execution;
      return new Engine(
        storage.sessions,
        [
          ...(await externalTools.toolsFor(conversation,memoryConnectionId?[memoryConnectionId]:[])),
          ...(runSkills?skillTools(runSkills,runSkills.entries):[]),
          ...historyTools(storage.sessions,conversation.id),
          ...(wallets?walletTools(wallets,conversation.fileAccess==='yolo'&&process.env.HARNESS_WALLETS_SIGN_ENABLED==='1',conversation.fileAccess==='yolo'||!!conversation.networkAccess):[]),
          ...fileTools(conversation.fileAccess==='yolo'?hostFiles:undefined,conversation.fileAccess==='yolo'),
          ...(selected
            ? terminalTools(
                selected,
                conversation.fileAccess === "yolo" ||
                  (conversation.networkAccess ?? false),
                conversation.fileAccess === "yolo",
              )
            : []),
          ...structuredMemoryTools(scoped, conversation.projectId ?? null),
          ...interactionTools(),
          ...tasksTools(tasks,conversation.id),
        ],
        runSkills?runSkills.context(new BoundedContext(storage.sessions, scoped,instructionValue(blocks,"compression"),policies)):new BoundedContext(storage.sessions, scoped,instructionValue(blocks,"compression"),policies),
        conversation.selection?.provider === "demo" ? undefined : new MemoryReview(scoped, conversation.projectId ?? null, instructionValue(blocks,"memoryPolicy"),instructionValue(blocks,"memoryReview")),
      );
    },
  });
  const calendar=taskCalendar(),taskExecution=new ConversationTaskExecution(conversations,storage.sessions),
    scheduler=taskScheduler(storage.tasks,calendar,taskExecution,{intervalMs:Number(process.env.HARNESS_SCHEDULER_INTERVAL_MS??5000),concurrency:Number(process.env.HARNESS_SCHEDULER_CONCURRENCY??2),available:async()=>!existsSync(process.env.HARNESS_MAINTENANCE_FILE??'/var/lib/personal-harness/maintenance')});
  tasks=new Tasks(storage.tasks,calendar,storage.conversations,taskExecution,undefined,storage.sessions);
  return {
    conversations,
    projectsWorkspace,
    tasks,
    scheduler,
    assistant,
    skills,
    externalTools,
    memories: new Memories(memory, projects),
    close: async () => {
      wallets?.close();
      scheduler.stop();
      await conversations.shutdown();
      await scheduler.close();
      await projectsWorkspace.close();
      await storage.close();
    },
  };
}
