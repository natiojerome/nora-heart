import {apiModelCapabilities} from "../modules/models/ai-sdk/index.ts";
import type {ProviderUsage} from "../contracts/usage.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelProvider } from "../contracts/models.ts";
import type { Event } from "../contracts/storage.ts";
import { Engine } from "../core/engine.ts";
import { ChatGptAuth, ChatGptProvider, readAccountQuotaSnapshot } from "../modules/models/chatgpt/index.ts";
import { createAiSdkProvider, openRouterModels, veniceModels, readOpenRouterUsage } from "../modules/models/ai-sdk/index.ts";
import { DemoProvider } from "../modules/models/demo/index.ts";
import { BasicMemory } from "../modules/memory/basic/index.ts";
import { openJsonStorage } from "../modules/storage/json/index.ts";
import { fileTools } from "../modules/tools/files/index.ts";
import { memoryTools } from "../modules/tools/memory/index.ts";
import { chatGptErrorMessage } from "./chatgpt.ts";

const exec = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
type Provider = "demo" | "chatgpt" | "openai" | "anthropic" | "openrouter" | "venice";
interface Options { directory: string; authDirectory: string; displayName?: string; oauthPort?: number; quotaSnapshotFile?:string; quotaMaxAgeMs?:number; apiKeys?: { openai?: string; anthropic?: string; openrouter?:string; venice?:string } }
export interface LoginState { status: "idle" | "pending" | "connected" | "error"; url?: string; message?: string }

export class TestLab {
  readonly displayName: string;
  private auth: ChatGptAuth;
  private busy = false;
  private usageCache=new Map<string,{key:string;at:number;pending:boolean;value:Promise<ProviderUsage>}>();
  private veniceCatalog?:{at:number;models:Awaited<ReturnType<typeof veniceModels>>};
  private veniceModels=new Map<string,{supportsTools:boolean}>();
  private routerModels=new Map<string,{supportsTools:boolean}>();
  private loginState: LoginState = { status: "idle" };
  private loginController?: AbortController;
  private loginTask?: Promise<unknown>;
  private callbackTarget?: URL;
  private keys: { openai?: string; anthropic?: string; openrouter?:string; venice?:string } = {};
  constructor(private readonly options: Options) {
    this.displayName = options.displayName ?? "Nora Heart";
    this.auth = new ChatGptAuth({ directory: options.authDirectory });
    this.keys = { ...options.apiKeys };
  }
  async prepare(): Promise<void> {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.options.directory);
    if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error("Dossier du laboratoire non privé.");
    try {
      const file = path.join(this.options.directory, "api-keys.json");
      const stat = await lstat(file);
      if (!stat.isFile() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error("Fichier de clés non privé.");
      const saved = JSON.parse(await readFile(file, "utf8")) as typeof this.keys;
      for (const provider of ["openai", "anthropic", "openrouter", "venice"] as const) if (typeof saved[provider] === "string") this.keys[provider] = saved[provider];
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  async state() {
    return { displayName: this.displayName, chatgpt: await this.auth.status(),
      api: { openai: !!this.keys.openai, anthropic: !!this.keys.anthropic, openrouter:!!this.keys.openrouter, venice:!!this.keys.venice }, login: this.loginStatus() };
  }
  async setKey(provider: unknown, apiKey: unknown) {
    if ((provider !== "openai" && provider !== "anthropic" && provider !== "openrouter" && provider !== "venice") || typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 4096 || /\s/.test(apiKey)) throw new Error("Clé ou fournisseur invalide.");
    const next = { ...this.keys, [provider]: apiKey };
    const temporary = path.join(this.options.directory, `.keys-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, path.join(this.options.directory, "api-keys.json"));
      this.keys = next;
    } finally { await rm(temporary, { force: true }); }
    return { configured: true };
  }
  loginStatus(): LoginState { return { ...this.loginState }; }
  async startLogin(): Promise<LoginState> {
    if (this.loginState.status === "pending") return this.loginStatus();
    this.loginController = new AbortController();
    this.loginState = { status: "pending" };
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    this.loginTask = this.auth.login({ appName: this.displayName, port: this.options.oauthPort ?? 1457,
      signal: this.loginController.signal, onReady: localUrl => {
        void (async () => {
          const response = await fetch(localUrl, { signal: AbortSignal.timeout(5000), redirect: "error" });
          const html = await response.text();
          const href = html.match(/href="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
          if (!href) throw new Error("Lien de connexion absent.");
          const authorize = new URL(href);
          if (authorize.origin !== "https://auth.openai.com" || authorize.pathname !== "/api/accounts/authorize") throw new Error("Origine de connexion invalide.");
          const target = new URL(authorize.searchParams.get("redirect_uri")!);
          if (target.hostname !== "127.0.0.1" || target.protocol !== "http:") throw new Error("Retour de connexion invalide.");
          this.callbackTarget = target;
          // Retained ID-token hints must never transit in API JSON or UI logs.
          authorize.searchParams.delete("id_token_hint");
          authorize.searchParams.delete("login_hint");
          this.loginState = { status: "pending", url: authorize.href };
          ready();
        })().catch(() => { this.loginController?.abort(); ready(); });
      } });
    this.loginTask = this.loginTask.then(() => {
      this.loginState = { status: "connected" }; this.callbackTarget = undefined; ready();
    }, () => {
      this.loginState = { status: "error", message: "Connexion refusée, expirée ou indisponible. Tu peux réessayer." };
      this.callbackTarget = undefined; ready();
    });
    await started;
    return this.loginStatus();
  }
  async finishLogin(value: unknown): Promise<LoginState> {
    if (this.loginState.status !== "pending" || !this.callbackTarget || typeof value !== "string" || value.length > 16_000) throw new Error("Aucune connexion en attente.");
    const callback = new URL(value);
    const target = this.callbackTarget;
    if (callback.origin !== target.origin || callback.pathname !== target.pathname || callback.username || callback.password || callback.hash) throw new Error("Adresse de retour invalide.");
    // Only a fixed loopback endpoint from our own pending attempt is reachable.
    const response = await fetch(callback, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Adresse de retour refusée. Vérifier qu’elle est complète et correspond à cette connexion.");
    await this.loginTask;
    return this.loginStatus();
  }
  async logoutChatGpt() {
    this.loginController?.abort(); await this.loginTask;
    this.loginState = { status: "idle" }; this.callbackTarget = undefined;
    const result = await this.auth.logout();
    return { ...result, message: result.remoteRevoked ? "Le compte ChatGPT a été déconnecté." :
      "Compte déconnecté ici. Révocation distante non confirmée : déconnecter aussi l’application dans les réglages ChatGPT." };
  }
  async models(provider: string) {
    if (provider === "venice") {
      const models = await veniceModels();
      this.veniceModels = new Map(models.map(model => [model.id, model]));
      this.veniceCatalog = { at: Date.now(), models };
      return { models, updatedAt: new Date().toISOString() };
    }
    if(provider==="openrouter"){const models=await openRouterModels();this.routerModels=new Map(models.map(model=>[model.id,model]));return {models,updatedAt:new Date().toISOString()};}
    if (provider !== "chatgpt") throw new Error("Catalogue disponible après connexion ChatGPT.");
    return { models: await new ChatGptProvider({ modelId: "catalog", accessToken: signal => this.auth.accessToken(signal) }).models() };
  }
  async capabilities(provider:string,modelId:string){
    if(!modelId.trim()||modelId.length>200)throw new Error('Choisir un modèle.');
    if (provider === "venice") {
      const models = this.veniceCatalog && Date.now() - this.veniceCatalog.at < 300000
        ? this.veniceCatalog.models : (await this.models(provider)).models;
      const selected = models.find(model => model.id === modelId);
      if (!selected) throw new Error('Modèle absent du catalogue Venice AI. Actualise la liste.');
      return selected;
    }
    if(provider==='chatgpt'||provider==='openrouter')return (await this.models(provider)).models.find(model=>model.id===modelId)??{id:modelId,reasoningEfforts:[]};
    if(provider!=='openai'&&provider!=='anthropic')return {id:modelId,reasoningEfforts:[]};
    const key=this.keys[provider];if(!key)throw new Error('Configurer d’abord la clé API de ce fournisseur.');
    return apiModelCapabilities(provider,modelId,key);
  }
  async usage(provider:string,modelId:string,refresh=false):Promise<ProviderUsage>{
    if(modelId.length>200)throw new Error('Modèle invalide.');
    if(!['demo','chatgpt','openai','anthropic','openrouter','venice'].includes(provider))throw new Error('Module inconnu.');
    const base:ProviderUsage={provider:provider as Provider,modelId,status:'unavailable',observedAt:new Date().toISOString(),source:'Connexion Heart',message:'Solde et reset non communiqués par cette connexion.'};
    if(provider==='demo')return {...base,status:'not_applicable',message:'Simulation locale, sans crédits ni quota fournisseur.'};
    if(provider==='chatgpt'){
      const missing={...base,source:'Compte ChatGPT · quotas Codex',message:'Quota du compte indisponible : vérifier sa connexion et le collecteur. Le plafond propre à Heart reste non communiqué.',dashboardUrl:'https://chatgpt.com/settings/usage'};
      if(!this.options.quotaSnapshotFile)return missing;
      try{
        const account=await this.auth.status();if(!account.connected||!account.email)return missing;
        const value=await readAccountQuotaSnapshot(this.options.quotaSnapshotFile,account.email,this.options.quotaMaxAgeMs);
        return {...missing,status:'available',observedAt:value.observedAt,quota:{scope:'account',windows:value.windows,appLimitAvailable:false},message:'Quota général du même compte ChatGPT, côté Codex. Le plafond propre à l’application Heart reste non communiqué. Actualisation chaque minute ; aucune réinitialisation déclenchée.'} as ProviderUsage;
      }catch{return missing;}
    }
    const key=this.keys[provider as keyof typeof this.keys];if(!key)return {...base,status:'unconfigured',message:'Configurer la clé de ce fournisseur.'};
    if(provider==='venice')return {...base,message:'Lecture du solde Venice non raccordée dans Heart ; aucun montant estimé.'};
    if(provider!=='openrouter')return {...base,message:'Cette clé d’inférence ne fournit pas de solde ou de reset de facturation.'};
    const cached=this.usageCache.get(modelId);
    if(cached?.key===key&&(cached.pending||(!refresh&&Date.now()-cached.at<60000)))return cached.value;
    const entry={key,at:Date.now(),pending:true,value:readOpenRouterUsage(key,modelId)};
    this.usageCache.set(modelId,entry);void entry.value.finally(()=>{entry.pending=false;entry.at=Date.now();});return entry.value;
  }
  model(body: Record<string, unknown>): ModelProvider {
    const provider = body.provider as Provider;
    if (!["demo", "chatgpt", "openai", "anthropic", "openrouter", "venice"].includes(provider)) throw new Error("Module inconnu.");
    if (provider !== "demo" && (typeof body.modelId !== "string" || !body.modelId.trim() || body.modelId.length > 200)) throw new Error("Choisir un modèle.");
    let model: ModelProvider;
    if (provider === "demo") model = new DemoProvider();
    else if (provider === "chatgpt") model = new ChatGptProvider({ modelId: body.modelId as string, ...(typeof body.reasoningEffort==="string"&&body.reasoningEffort?{reasoningEffort:body.reasoningEffort}:{}), accessToken: signal => this.auth.accessToken(signal) });
    else {
      const apiKey = this.keys[provider];
      if (!apiKey) throw new Error("Configurer d’abord la clé API de ce fournisseur.");
      model = createAiSdkProvider({ provider, apiKey, modelId: body.modelId as string, ...(typeof body.reasoningEffort==='string'&&body.reasoningEffort?{reasoningEffort:body.reasoningEffort}:{}), ...(["openrouter","venice"].includes(provider)?{supportsTools:(provider==="venice"?this.veniceModels:this.routerModels).get(body.modelId as string)?.supportsTools}:{}) });
    }
    return model;
  }
  async test(body: Record<string, unknown>, signal?: AbortSignal) {
    if (this.busy) throw new Error("Un test est déjà en cours.");
    const provider = body.provider as Provider;
    if (!["demo", "chatgpt", "openai", "anthropic", "openrouter", "venice"].includes(provider)) throw new Error("Module inconnu.");
    if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 8000) throw new Error("Message requis (8000 caractères maximum).");
    const maxSteps = body.maxSteps ?? 4;
    if (!Number.isInteger(maxSteps) || (maxSteps as number) < 1 || (maxSteps as number) > 4) throw new Error("Choisir entre 1 et 4 étapes.");
    if (provider !== "demo" && (typeof body.modelId !== "string" || !body.modelId.trim() || body.modelId.length > 200)) throw new Error("Choisir un modèle.");
    const model = this.model(body);
    this.busy = true;
    const started = Date.now();
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(this.options.directory, "run-"));
      const workspace = path.join(directory, "workspace");
      await mkdir(workspace);
      await writeFile(path.join(workspace, "bienvenue.txt"), "Ce fichier appartient au test isolé de Nora Heart.");
      const storage = await openJsonStorage(path.join(directory, "state"));
      try {
        const memory = new BasicMemory(storage.memories);
        await memory.remember("Les données de ce laboratoire sont temporaires et isolées.");
        const engine = new Engine(storage.sessions, [...fileTools(), ...memoryTools(memory)]);
        const result = await engine.run({ sessionId: "web-test", prompt: body.prompt, provider: model, displayName: this.displayName,
          workspace, maxSteps: maxSteps as number, permissions: new Set(["files.read", "memory.read", "memory.write"]), signal });
        const events: Event[] = await storage.sessions.read("web-test");
        return { text: result.text, events: events.map(({ type, data }) => ({ type, data })), provider: model.id,
          simulated: provider === "demo", durationMs: Date.now() - started };
      } finally { await storage.close(); }
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(chatGptErrorMessage(error) ?? "Test interrompu ou impossible. Vérifier la connexion, le modèle et le budget d’étapes.");
    } finally { if (directory) await rm(directory, { recursive: true, force: true }); this.busy = false; }
  }
  async tests(suite: unknown) {
    if (this.busy) throw new Error("Un test est déjà en cours.");
    const suites: Record<string, string[]> = {
      models: ["ai-sdk.test.ts", "chatgpt.test.ts", "chatgpt-auth.test.ts"], memory: ["memory.test.ts", "structured-memory.test.ts", "context-structured-memory.test.ts"],
      tools: ["tools.test.ts"], "storage-json": ["storage-json.test.ts"],
    };
    if (typeof suite !== "string" || (suite !== "all" && !Object.hasOwn(suites, suite))) throw new Error("Suite de test inconnue.");
    this.busy = true;
    const started = Date.now();
    try {
      const files = suite === "all" ? (await readdir(path.join(projectRoot, "tests"))).filter(file => file.endsWith(".test.ts")) : suites[suite];
      // Allowlisted files, no shell, no model/database credentials in the child.
      const command = [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "--test", ...files.map(file => path.join(projectRoot, "tests", file))];
      try {
        const result = await exec(process.execPath, command, { cwd: projectRoot, timeout: 120_000, maxBuffer: 256 * 1024,
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C.UTF-8" } });
        return { ok: true, output: result.stdout + result.stderr, durationMs: Date.now() - started };
      } catch (error) {
        const result = error as { stdout?: string; stderr?: string };
        return { ok: false, output: (result.stdout ?? "") + (result.stderr ?? "") || "Le test n’a pas pu se terminer.", durationMs: Date.now() - started };
      }
    } finally { this.busy = false; }
  }
  async close(): Promise<void> { this.loginController?.abort(); await this.loginTask; }
}
