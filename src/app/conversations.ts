import {historyTools} from "../modules/tools/history/index.ts";
import type {WorkspaceFilesFactory} from "../contracts/files.ts";
import type {SkillRun} from "./skills.ts";
import {SkillError} from "../contracts/skills.ts";
import {resolvePolicies} from "./runtime-policies.ts";
import type {RuntimePolicies} from "../contracts/policies.ts";
import {ConversationView} from "./conversation-view.ts";
import {pageSize,type EventWindow} from "../contracts/history.ts";
import {instructionValue} from "./instruction-defaults.ts";
import type {InstructionOverrides} from "../contracts/instructions.ts";
import { recoveryPlan, recoveryEvents } from "../core/recovery.ts";
import { RecoveryError } from "../contracts/recovery.ts";
export { aiSdkErrorMessages } from "../modules/models/ai-sdk/index.ts";
import { AiSdkResponseError } from "../modules/models/ai-sdk/index.ts";
import type { ResumeInput, InputResponse } from "../contracts/interactions.ts";
import { interactionsFrom } from "../core/interactions.ts";
import { interactionTools } from "../modules/tools/interactions/index.ts";
import { imagePreview } from "./image-preview.ts";
import type {ConversationDefaults} from "../contracts/conversation-defaults.ts";
import type { ContextUsage } from "../contracts/usage.ts";
import type { Message } from "../contracts/messages.ts";
import type { ExecutionService } from "../contracts/execution.ts";
import { terminalTools } from "../modules/tools/terminal/index.ts";
import { LocalFiles } from "../modules/tools/files/index.ts";
import { Workspace } from "./workspace.ts";
import { WorkspaceError } from "../modules/tools/files/index.ts";
import type { FileAccess } from "../contracts/files.ts";
import { ChatAssets, ChatInputError } from "./chat-assets.ts";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Conversation, ConversationRepository, ConversationWork, ModelSelection } from "../contracts/conversations.ts";
import type { SessionStore } from "../contracts/storage.ts";
import type { MemoryService } from "../contracts/memory.ts";
import type { ProjectRepository } from "../contracts/projects.ts";
import type { ModelPhase, ModelProvider } from "../contracts/models.ts";
import { Engine } from "../core/engine.ts";
import { BoundedContext } from "../modules/context/bounded/index.ts";
import { fileTools } from "../modules/tools/files/index.ts";
import { memoryTools } from "../modules/tools/memory/index.ts";
import { chatGptErrorMessage } from "./chatgpt.ts";

export class Conversations {
  private readonly views=new Map<string,ConversationView>();
  private view(id:string){
    let view=this.views.get(id);this.views.delete(id);
    if(!view)view=new ConversationView(this.options.sessions,id);
    this.views.set(id,view);
    const capacity=this.options.viewCacheSize??64;
    while(this.views.size>capacity)this.views.delete(this.views.keys().next().value!);
    return view;
  }
  private readonly workspaceFiles: Workspace;
  private readonly busy = new Set<string>();
  private readonly active = new Map<string,{controller:AbortController; done:Promise<void>; startedAt:string; commentary?:string; activity?:{phase:ModelPhase;at:string;modelCalls:number}}>();
  get assetsAvailable(){return !!this.options.chatAssets;}
  private assets(){if(!this.options.chatAssets)throw new ChatInputError("Outils du chat indisponibles.");return this.options.chatAssets;}
  prompts(){return this.assets().prompts();}
  savePrompt(body:Record<string,unknown>){return this.assets().savePrompt(body);}
  deletePrompt(body:Record<string,unknown>){return this.assets().deletePrompt(body.id,body.version);}
  async attachments(id:string){await this.require(id);return this.assets().attachments(id);}
  async upload(id:string,body:Record<string,unknown>){await this.require(id);return this.assets().upload(id,body);}
  async attachment(id:string,fileId:string){await this.require(id);return this.assets().read(id,fileId);}
  async removeAttachment(id:string,fileId:string){await this.require(id);if(this.busy.has(id))throw new ChatInputError("Attends la fin de la réponse avant de retirer un fichier.");await this.assets().remove(id,fileId);}
  async cancel(id:string){
    await this.require(id);const active=this.active.get(id);
    if(active){active.controller.abort(new DOMException("Réponse interrompue à la demande de l’utilisateur.","AbortError"));await active.done;}
    return this.get(id);
  }
  constructor(private readonly options: {
    /** Disposable read projections; 64 entries = 32 main/workspace pairs. */
    viewCacheSize?:number;
    execution?: ExecutionService;
    hostFiles?: WorkspaceFilesFactory;
    hostExecution?: ExecutionService;
    chatAssets?: ChatAssets;
    repository: ConversationRepository;
    sessions: SessionStore;
    memory: MemoryService;
    workspaceDirectory: string;
    displayName: string;
    assistantInstructions?: () => Promise<string>;
    defaults?: () => Promise<ConversationDefaults>;
    model: (selection: ModelSelection) => ModelProvider;
    configuration?:()=>Promise<{instructions:string;overrides:InstructionOverrides;policies:RuntimePolicies;skills?:SkillRun}>;
    engineFor?: (conversation: Conversation, blocks: InstructionOverrides, policies:RuntimePolicies,skills?:SkillRun) => Engine | Promise<Engine>;
    projects?: ProjectRepository;
    capabilities?: (provider:ModelSelection["provider"],modelId:string)=>Promise<import("../contracts/models.ts").ModelCapabilities>;
    catalog: () => Promise<{ models: { id: string; contextWindow?: number; reasoningEfforts?:string[] }[] }>;
  }) {
    if(options.viewCacheSize!==undefined)pageSize(options.viewCacheSize);
    this.workspaceFiles = new Workspace(options.sessions);
  }
  private async workspace(id:string) {
    await this.require(id);
    const directory=path.join(this.options.workspaceDirectory,id);
    await mkdir(directory,{recursive:true,mode:0o700});
    return directory;
  }
  private async fileWorkspace(id:string){
    const conversation=await this.require(id);
    if(conversation.fileAccess!=='yolo')return this.workspaceFiles;
    if(!this.options.hostFiles)throw new WorkspaceError('Fichiers YOLO indisponibles. Aucun repli vers le workspace.');
    return new Workspace(this.options.sessions,this.options.hostFiles);
  }
  async inspectWorkspace(id:string,input:string,read:boolean,offset?:number,count?:number) {
    return (await this.fileWorkspace(id)).inspect(await this.workspace(id),input,read,offset,count);
  }
  async previewWorkspace(id:string,input:string){
    const {entry,body}=await this.downloadWorkspace(id,input);
    const preview=await imagePreview(body,entry.name);
    return {entry,mediaType:preview.mediaType,body:preview.body(),close:preview.close};
  }
  async downloadWorkspace(id:string,input:string){return (await this.fileWorkspace(id)).download(await this.workspace(id),input);}
  async infoWorkspace(id:string,input:string){return (await this.fileWorkspace(id)).info(await this.workspace(id),input);}
  async mutateWorkspace(id:string,body:Record<string,unknown>,source?:AsyncIterable<Uint8Array>) {
    if(this.busy.has(id))throw new WorkspaceError("Attends la fin de la réponse avant de modifier les fichiers.");
    this.busy.add(id);
    try {return await (await this.fileWorkspace(id)).action(id,await this.workspace(id),body,source);}
    finally {this.busy.delete(id);}
  }
  async fileAccess(id:string,body:Record<string,unknown>) {
    await this.require(id);
    if(this.busy.has(id))throw new WorkspaceError("Attends la fin de la réponse avant de changer les permissions.");
    if(typeof body.access!=="string"||!["none","read","write","develop","yolo"].includes(body.access))throw new WorkspaceError("Permission fichier invalide.");
    const previous=await this.require(id);
    if(body.access==='yolo'&&!this.options.hostExecution)throw new WorkspaceError("Worker YOLO indisponible sur cette installation.");
    if(body.access!==previous.fileAccess){
      const execution=previous.fileAccess==='yolo'?this.options.hostExecution:this.options.execution;
      if(execution)for(const command of await execution.list(await this.workspace(id)))if(command.status==='running')await execution.stop(await this.workspace(id),command.id);
    }
    await this.options.repository.setFileAccess(id,body.access as FileAccess);
    return this.get(id);
  }
  async executionPolicy(id:string,body:Record<string,unknown>){
    const conversation=await this.require(id);if(this.busy.has(id))throw new WorkspaceError("Attends la fin de la réponse avant de changer les permissions.");
    if(typeof body.network!=="boolean"||!Number.isSafeInteger(body.maxSteps)||Number(body.maxSteps)<0||Number(body.maxSteps)>2147483647)throw new WorkspaceError("Configuration d’exécution invalide.");
    if(body.network!==(conversation.networkAccess??false)&&this.options.execution&&(await this.options.execution.list(await this.workspace(id))).some(command=>command.status==="running"))throw new WorkspaceError("Arrête les commandes actives avant de changer leur accès réseau.");
    await this.options.repository.setExecutionPolicy(id,body.network,Number(body.maxSteps));return this.get(id);
  }
  private async execution(id:string){
    const conversation=await this.require(id);
    const execution=conversation.fileAccess==='yolo'?this.options.hostExecution:this.options.execution;
    if(!execution)throw new WorkspaceError(conversation.fileAccess==='yolo'?'Worker YOLO indisponible. Aucun repli implicite.':'Terminal indisponible dans cet environnement.');
    return execution;
  }
  async commands(id:string){return {commands:await (await this.execution(id)).list(await this.workspace(id))};}
  async commandOutput(id:string,commandId:string,offset?:number,length?:number){return (await this.execution(id)).read(await this.workspace(id),commandId,offset,length);}
  async commandInput(id:string,commandId:string,body:Record<string,unknown>){if(typeof body.input!=="string")throw new WorkspaceError("Entrée texte requise.");await (await this.execution(id)).write(await this.workspace(id),commandId,body.input,body.close===true);return {ok:true};}
  async stopCommand(id:string,commandId:string){return {command:await (await this.execution(id)).stop(await this.workspace(id),commandId)};}
  async startCommand(id:string,body:Record<string,unknown>){
    const conversation=await this.require(id);if(!['develop','yolo'].includes(conversation.fileAccess??'read'))throw new WorkspaceError("Active le mode Développement ou YOLO pour exécuter des commandes.");
    if(typeof body.command!=="string"||(body.cwd!==undefined&&typeof body.cwd!=="string"))throw new WorkspaceError("Commande ou dossier invalide.");
    return {command:await (await this.execution(id)).start(await this.workspace(id),{command:body.command,cwd:body.cwd as string|undefined,network:conversation.fileAccess==='yolo'||(conversation.networkAccess??false)})};
  }
  private workState(conversation:Conversation,events:import('../contracts/storage.ts').Event[]=[]):ConversationWork {
    const active=this.active.get(conversation.id);
    if(active)return {status:'running',at:active.startedAt,...(active.activity?{phase:active.activity.phase}:{}),...(active.commentary?{commentary:active.commentary}:{})};
    if(conversation.work)return conversation.work;
    const event=events.findLast(e=>['run.completed','run.failed','interaction.requested','interaction.resolved'].includes(e.type));
    const data=event?.data as Record<string,any>|undefined;
    const status=event?.type==='interaction.requested'?'waiting':event?.type==='run.completed'?'completed':event?.type==='run.failed'?(data?.cancelled?'cancelled':'failed'):event?.type==='interaction.resolved'&&data?.response?.status==='cancelled'?'cancelled':'idle';
    return {status,...(event?{at:event.at}:{})};
  }
  async list(input:{before?:string;limit?:number;projectId?:string;query?:string}={}) {
    const limit=pageSize(input.limit,100);
    let before:import('../contracts/conversations.ts').ConversationPosition|undefined;
    if(input.before){
      try{before=JSON.parse(Buffer.from(input.before,'base64url').toString('utf8'));
        if(!before||typeof before.at!=='string'||!Number.isFinite(Date.parse(before.at))||typeof before.id!=='string'||!/^[0-9a-f-]{36}$/.test(before.id))throw new Error();
      }catch{throw new Error('Pagination invalide.');}
    }
    if(input.projectId&&input.projectId!=='none'&&!/^[0-9a-f-]{36}$/.test(input.projectId))throw new Error('Pagination invalide.');
    const rows=await this.options.repository.list({...input,before,limit:limit+1});
    const conversations=rows.slice(0,limit).map(conversation=>({...conversation,work:this.workState(conversation)}));
    return {conversations,nextCursor:rows.length>limit?Buffer.from(JSON.stringify(conversations.at(-1)!.position??{at:conversations.at(-1)!.updatedAt,id:conversations.at(-1)!.id})).toString("base64url"):null};
  }
  async work(){
    const {conversations}=await this.list();
    for(const id of this.active.keys())if(!conversations.some(c=>c.id===id)){const conversation=await this.options.repository.get(id);if(conversation)conversations.push({...conversation,work:this.workState(conversation)});}
    return {conversations:conversations.map(c=>({id:c.id,title:c.title,work:c.work}))};
  }
  async shutdown(){for(const active of this.active.values())active.controller.abort(new DOMException('Arrêt du service.','AbortError'));await Promise.all([...this.active.values()].map(active=>active.done));}
  async create(body: Record<string, unknown>) {
    const title = typeof body.title === "string" ? body.title.trim() : "Nouvelle conversation";
    if (!title || title.length > 160) throw new Error("Titre requis (160 caractères maximum).");
    const projectId = body.projectId ?? null;
    if (projectId !== null) {
      if (typeof projectId !== "string" || !/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("Projet introuvable.");
      const project=await this.options.projects?.get(projectId);
      if(!project) throw new Error("Projet introuvable.");
      if(project.status==='archived') throw new Error("Ce projet est archivé.");
    }
    const at = new Date().toISOString();
    const defaults=await this.options.defaults?.();
    if(defaults?.fileAccess==='yolo'&&!this.options.hostExecution)throw new Error('Worker YOLO indisponible. Aucun repli implicite.');
    const conversation:Conversation = { id: randomUUID(), title, createdAt: at, updatedAt: at, selection: defaults?.selection?structuredClone(defaults.selection):null, projectId,
      ...(defaults?{fileAccess:defaults.fileAccess,networkAccess:defaults.networkAccess}:{}) };
    await this.options.repository.create(conversation);
    return { conversation, events: [], segments: 1, busy: false };
  }
  private async require(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Conversation introuvable.");
    const conversation = await this.options.repository.get(id);
    if (!conversation) throw new Error("Conversation introuvable.");
    return conversation;
  }
  private async recovery(id:string,events:import('../contracts/storage.ts').Event[]){
    const [claim,audit,auditClaim]=await Promise.all([this.options.sessions.recoveryClaim?.(id),this.options.sessions.read('workspace-'+id),this.options.sessions.recoveryClaim?.('workspace-'+id)]);
    const main=recoveryPlan(events,claim),workspace=recoveryPlan(audit,auditClaim);
    return {...main,workspace:workspace.runs.length||workspace.calls.length?workspace:null};
  }
  async reconcile(id:string,body:Record<string,unknown>) {
    await this.require(id);
    if(this.busy.has(id))throw new RecoveryError('Cette conversation travaille déjà.');
    if(!this.options.sessions.reconcile)throw new RecoveryError('Réconciliation indisponible pour ce stockage.');
    if((typeof body.lastEventId!=='string'&&body.lastEventId!==null)||typeof body.note!=='string'||body.note.length>2000||typeof body.acknowledged!=='boolean')throw new RecoveryError('Réconciliation invalide.');
    const plan=await this.recovery(id,await this.options.sessions.read(id));
    if(plan.lastEventId!==body.lastEventId)throw new RecoveryError('Le fil a changé. Actualise avant de réconcilier.');
    if((body.workspaceLastEventId??null)!==(plan.workspace?.lastEventId??null))throw new RecoveryError('Le fil a changé. Actualise avant de réconcilier.');
    const repair=recoveryEvents(plan,body.acknowledged,body.note.trim());
    const auditRepair=plan.workspace?recoveryEvents(plan.workspace,body.acknowledged,body.note.trim()):[];
    if(!repair.length&&!auditRepair.length)throw new RecoveryError('Aucune interruption à réconcilier.');
    // Repair the private owner audit first; never copy its contents to model history.
    if(auditRepair.length)await this.options.sessions.reconcile('workspace-'+id,plan.workspace!.lastEventId,auditRepair);
    if(repair.length)await this.options.sessions.reconcile(id,plan.lastEventId,repair);
    return this.get(id);
  }
  async get(id:string,window:EventWindow={}) {
    const wasBusy=this.busy.has(id);
    const conversation=await this.require(id),view=this.view(id),audit=this.view('workspace-'+id);
    await Promise.all([view.update(),audit.update()]);
    const [page,claim,auditClaim]=await Promise.all([view.page(window),this.options.sessions.recoveryClaim?.(id),this.options.sessions.recoveryClaim?.('workspace-'+id)]);
    const recovery=view.recovery.plan(claim??null),workspace=audit.recovery.plan(auditClaim??null);
    const pendingInput=[...view.interactions.values()].find(item=>item.status==='pending')??null;
    const ids=new Set(page.events.filter(event=>event.type==='interaction.requested').map(event=>event.id));
    for(const event of page.events)if(event.type==='interaction.resolved')ids.add((event.data as {requestId:string}).requestId);
    if(pendingInput)ids.add(pendingInput.id);
    const interactions=[...ids].map(key=>view.interactions.get(key)).filter((item):item is NonNullable<typeof item>=>!!item);
    return {recovery:{...recovery,workspace:workspace.runs.length||workspace.calls.length?workspace:null},recoveryAvailable:!!this.options.sessions.reconcile,
      conversation,work:this.workState(conversation,view.workEvent?[view.workEvent]:[]),interactions,pendingInput,
      workspaceRoot:path.join(this.options.workspaceDirectory,id),messageCount:view.messageCount,contextUsage:view.contextUsage,
      events:page.events,history:{...page,revision:view.revision,events:undefined,mode:window.after!==undefined?'after':window.before?'before':'latest',cursor:page.after??window.after??view.cursor},
      inventory:view.inventory,segments:view.segments,busy:wasBusy||this.busy.has(id),activity:this.active.get(id)?.activity??null,
      executionAvailable:conversation.fileAccess==='yolo'?!!this.options.hostExecution:!!this.options.execution,yoloAvailable:!!this.options.hostExecution};
  }
  private async instructions(workspace:string,conversation:Conversation,blocks:InstructionOverrides,policies:RuntimePolicies,identity:string){
    let instructions=identity+"\n"+instructionValue(blocks,"work");
    const selected=conversation.selection;
    if(selected)instructions+="\nCerveau actuel : "+selected.provider+"/"+selected.modelId+(selected.reasoningEffort?" ; effort="+selected.reasoningEffort:"")+".";
    const access=conversation.fileAccess??'read';
    instructions+="\nDate actuelle du serveur (UTC) : "+new Date().toISOString().slice(0,10)+". Utilise cette date pour les calculs d’âge et les dates relatives, sauf précision de l’utilisateur.";
    instructions+="\n"+instructionValue(blocks,"memory")+"\n"+instructionValue(blocks,"memoryPolicy");
    instructions+="\nDroits actuels de ce fil : "+({none:'aucun accès fichiers ni terminal',read:'lecture seule des fichiers, sans écriture ni terminal',write:'lecture et écriture des fichiers, sans terminal',develop:'lecture/écriture et terminal isolé',yolo:'lecture/écriture et terminal root sur le serveur entier'}[access])+". Seul le propriétaire les change dans Réglages → Accès. Absent ici ne signifie pas inexistant dans Heart.";
    if(["develop","yolo"].includes(conversation.fileAccess??"read"))instructions+="\n"+instructionValue(blocks,"development");
    if(conversation.fileAccess==='yolo')instructions+="\n"+instructionValue(blocks,"yolo");
    if(conversation.fileAccess!=="none"){
      const files=conversation.fileAccess==='yolo'?this.options.hostFiles?.(workspace):new LocalFiles(workspace);
      if(!files)throw new WorkspaceError('Fichiers YOLO indisponibles. Aucun repli vers le workspace.');
      let exists=false;try{await files.info("AGENTS.md");exists=true;}catch(error){if(!(error instanceof WorkspaceError)||error.message!=="Fichier ou dossier introuvable.")throw error;}
      if(exists){let offset=0,content="";for(;;){const page=await files.read("AGENTS.md",offset);content+=page.content;if(!page.truncated)break;offset=page.nextOffset!;}instructions+="\nConsignes du projet à appliquer dans le périmètre demandé et les permissions accordées (AGENTS.md) :\n"+content;}
    }
    instructions+="\n"+instructionValue(blocks,"display");
    instructions+="\n"+instructionValue(blocks,"math");
    instructions+="\n"+instructionValue(blocks,"progress");
    instructions+="\n"+instructionValue(blocks,"interactions");
    instructions+="\n"+instructionValue(blocks,"web");
    instructions+="\n"+instructionValue(blocks,"tasks");
    if(policies.tools.maxCallsPerBatch>0)instructions+=`\nLimite configurée : au plus ${policies.tools.maxCallsPerBatch} appels d’outils dans une même réponse.`;
    return instructions;
  }
  private async selection(body:Record<string,unknown>):Promise<ModelSelection>{
    if(!['demo','chatgpt','openai','anthropic','openrouter','venice'].includes(String(body.provider)))throw new Error('Choisir un modèle.');
    const provider = body.provider as ModelSelection["provider"];
    const modelId = provider === "demo" ? "demo" : typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!modelId || modelId.length > 200) throw new Error("Choisir un modèle.");
    let contextWindow = Number(body.contextWindow);
    let capacitySource: ModelSelection["capacitySource"] = "configured";
    let reasoningEffort:string|undefined;
    if(body.reasoningEffort!==undefined && (provider==="demo"||typeof body.reasoningEffort!=="string"))throw new Error("Choisir un niveau d’effort compatible avec le fournisseur.");
    if (provider === "chatgpt" || provider === "venice" || body.reasoningEffort) {
      const model = provider==='chatgpt'?(await this.options.catalog()).models.find(model => model.id === modelId):await this.options.capabilities?.(provider,modelId);
      if (!model) throw new Error("Choisir un niveau d’effort disponible pour ce modèle.");
      if(body.reasoningEffort){if(!model.reasoningEfforts?.includes(body.reasoningEffort as string))throw new Error("Choisir un niveau d’effort disponible pour ce modèle.");reasoningEffort=body.reasoningEffort as string;}
      if (model.contextWindow) { contextWindow = model.contextWindow; capacitySource = "catalog"; }
    }
    if (!Number.isInteger(contextWindow) || contextWindow < 4096 || contextWindow > 2_000_000) throw new Error("Capacité de contexte requise (4096 à 2000000 tokens).");
    return { provider, modelId, contextWindow, capacitySource, ...(reasoningEffort?{reasoningEffort}:{}) };
  }
  async selectModel(id:string,body:Record<string,unknown>){
    if(this.busy.has(id))throw new Error('Cette conversation travaille déjà.');
    this.busy.add(id);
    try{
      const conversation=await this.require(id);
      const canonical=(value:unknown)=>{if(!value)return null;const s=value as ModelSelection;return JSON.stringify([s.provider,s.modelId,s.contextWindow,s.capacitySource,s.reasoningEffort??'']);};
      if(Object.hasOwn(body,'baseSelection')&&canonical(body.baseSelection)!==canonical(conversation.selection))throw new Error('Modèle du fil modifié ailleurs. Rouvre ses réglages.');
      const selection=await this.selection(body);
      await this.options.repository.select(id,selection,conversation.selection);
      return {...await this.get(id),busy:false};
    }finally{this.busy.delete(id);}
  }
  async respondInteraction(id:string,requestId:string,body:Record<string,unknown>,signal?:AbortSignal){
    if(typeof requestId!=='string'||!requestId.trim()||!['answered','cancelled'].includes(String(body.status))||!body.answers||typeof body.answers!=='object'||Array.isArray(body.answers))throw new Error('Formulaire ou réponse invalide. Vérifie les champs.');
    const conversation=await this.require(id);
    if(!conversation.selection)throw new Error('Choisir un modèle.');
    return this.run(id,{...conversation.selection},signal,{requestId,response:body as unknown as InputResponse});
  }
  async send(id:string,body:Record<string,unknown>,signal?:AbortSignal){return this.run(id,body,signal);}
  isBusy(id:string){return this.busy.has(id);}
  async sendScheduled(id:string,prompt:string,executionId:string){const c=await this.require(id);if(!c.selection)throw new Error('Choisir un modèle.');return this.run(id,{...c.selection,prompt},undefined,undefined,executionId);}
  private async run(id: string, body: Record<string, unknown>, signal?: AbortSignal, resume?:ResumeInput,executionId?:string) {
    const conversation = await this.require(id);
    if (this.busy.has(id)) throw new Error("Cette conversation travaille déjà.");
    const configuration=await this.options.configuration?.(),
      policies=resolvePolicies(configuration?.policies??{}),
      blocks=configuration?.overrides??{},
      identity=configuration?.instructions??await this.options.assistantInstructions?.()??`Tu es ${this.options.displayName}.`,
      maximum=policies.messages.maxCharacters;
    if(!resume&&(typeof body.prompt!=='string'||(!body.prompt.trim()&&!(Array.isArray(body.attachmentIds)&&body.attachmentIds.length))))throw new Error('Message requis.');
    if(!resume&&maximum>0&&(body.prompt as string).length>maximum)throw new Error(`Message trop long : limite configurée de ${maximum} caractères.`);
    if (!["demo", "chatgpt", "openai", "anthropic", "openrouter", "venice"].includes(String(body.provider))) throw new Error("Module inconnu.");
    if(!resume&&interactionsFrom(await this.options.sessions.read(id)).some(item=>item.status==='pending'))throw new Error("Réponds au formulaire en attente ou annule-le avant un nouveau message.");
    if(this.busy.has(id))throw new Error('Cette conversation travaille déjà.');
    this.busy.add(id);
    const controller=new AbortController();
    const runSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    let settled!:()=>void;
    this.active.set(id,{controller,done:new Promise<void>(resolve=>{settled=resolve;}),startedAt:new Date().toISOString()});
    try {
      const cancelling=resume?.response.status==='cancelled';
      const selection=cancelling?conversation.selection!:await this.selection(body);
      const {provider,modelId,contextWindow}=selection;
      const references = await this.options.chatAssets?.references(id,body.attachmentIds) ?? [];
      if(Array.isArray(body.attachmentIds) && body.attachmentIds.length && !this.options.chatAssets)throw new ChatInputError("Outils du chat indisponibles.");
      const rawModel:ModelProvider = cancelling?{id:'cancel-input',async generate(){throw new Error('Aucun modèle requis pour annuler.');}}:this.options.model(selection);
      const model = this.options.chatAssets?.provider(rawModel,id) ?? rawModel;
      const workspace = path.join(this.options.workspaceDirectory, id);
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      if(!resume)await this.options.repository.select(id, selection);
      if(!cancelling&&conversation.fileAccess==='yolo'&&!this.options.hostExecution)throw new WorkspaceError('Worker YOLO indisponible. Aucun repli implicite.');
      const execution=conversation.fileAccess==='yolo'?this.options.hostExecution:this.options.execution;
      if(!resume)await configuration?.skills?.explicit(String(body.prompt??''));
      const engine = await this.options.engineFor?.({...conversation,selection},blocks,policies,configuration?.skills) ?? new Engine(this.options.sessions,[...historyTools(this.options.sessions,id),...fileTools(conversation.fileAccess==='yolo'?(this.options.hostFiles??(()=>{throw new WorkspaceError('Fichiers YOLO indisponibles. Aucun repli vers le workspace.');})):undefined,conversation.fileAccess==='yolo'),...(execution?terminalTools(execution,conversation.fileAccess==='yolo'||(conversation.networkAccess??false),conversation.fileAccess==='yolo'):[]),...memoryTools(this.options.memory),...interactionTools()],new BoundedContext(this.options.sessions,this.options.memory,instructionValue(blocks,'compression'),policies));
      if(!resume)await this.options.chatAssets?.claim(id,references.map(file=>file.id));
      runSignal.throwIfAborted();
      await engine.run({ sessionId: id, runId:executionId, resume, prompt: typeof body.prompt==='string'?body.prompt.trim() || "Analyse les pièces jointes.":"", attachments:references, provider: model, modelIdentity:{provider,modelId},
        displayName: this.options.displayName, instructions: await this.instructions(workspace,{...conversation,selection},blocks,policies,identity)+(configuration?.skills?.instructions(rawModel.supportsTools!==false)??''), workspace, maxSteps: conversation.maxSteps ?? 0, maxCallsPerBatch:policies.tools.maxCallsPerBatch, contextWindow,
        reserveTokens: Math.min(4096, Math.floor(contextWindow / 4)),
        permissions: new Set(["history.read" as const,...(configuration?.skills?.entries.length?["skills.read" as const]:[]),...(conversation.fileAccess === "none" ? [] : ["files.read" as const]), ...(["write","develop","yolo"].includes(conversation.fileAccess ?? "read") ? ["files.write" as const] : []), ...(["develop","yolo"].includes(conversation.fileAccess??"read") ? ["process.execute" as const] : []), "memory.read", "memory.write", "tasks.read", "tasks.write", "user.input", ...(conversation.networkAccess||conversation.fileAccess==='yolo'?["external.read" as const,"external.write" as const]:[])]), signal:runSignal,
        onProgress:progress=>{const active=this.active.get(id);if(active?.controller===controller)active.commentary=progress.text;},
        onActivity:phase=>{
          const active=this.active.get(id);if(!active || active.controller!==controller)return;
          active.activity={phase,at:new Date().toISOString(),modelCalls:(active.activity?.modelCalls??0)+(phase==="waiting"?1:0)};
        } });
      return { ...await this.get(id), busy: false };
    } catch (error) {
      if(runSignal.aborted)return {...await this.get(id),busy:false};
      if(error instanceof SkillError)throw error;
      if(error instanceof ChatInputError || error instanceof AiSdkResponseError)throw error;
      const message = error instanceof Error ? error.message : "";
      if(message.startsWith("OpenRouter :") || /^(Formulaire |Demande interactive |Réponds au formulaire |Cette demande |Une autre demande |Historique de la demande |Outil interactif |Reprise interactive )/.test(message))throw error;
      if (/^(Cette |Exécution interrompue|Exécution déjà commencée|Lot d’outils trop grand|Appels d’outils|Échange trop|Historique trop|Compression |Budget de |Capacité de |Choisir un modèle|Choisir un niveau|Configurer d’abord)/u.test(message)) throw error;
      throw new Error(chatGptErrorMessage(error) ?? "Conversation interrompue. Historique conservé ; vérifier la connexion et le modèle avant de continuer.");
    } finally { this.busy.delete(id);this.active.delete(id);settled(); }
  }
}
