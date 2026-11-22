import {AccountLoginError,type AccountLogin} from '../../app/account-login.ts';
import type {Installation} from "../../app/installation.ts";
import {ExternalCallError} from "../../contracts/external-tools.ts";
import type {ProjectsWorkspace} from "../../app/projects-workspace.ts";
import {TaskError} from "../../contracts/tasks.ts";
import type {Tasks} from "../../app/tasks.ts";
import {SkillError} from "../../contracts/skills.ts";
import type {Skills} from "../../app/skills.ts";
import { RecoveryError } from "../../contracts/recovery.ts";
import {ExternalToolError} from '../../app/external-tools.ts';
import type {ExternalTools} from '../../app/external-tools.ts';
import { aiSdkErrorMessages } from "../../app/conversations.ts";
import { ExecutionError } from "../../app/execution.ts";
import { WorkspaceError } from "../../app/workspace.ts";
import { ChatInputError } from "../../app/chat-assets.ts";
import type { Assistant } from "../../app/assistant.ts";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Memories } from "../../app/memories.ts";
import type { Conversations } from "../../app/conversations.ts";
import type { TestLab } from "../../app/test-lab.ts";
import { WebAccess } from "../../app/web-access.ts";

type Lab = Pick<TestLab, "state" | "setKey" | "loginStatus" | "startLogin" | "finishLogin" | "logoutChatGpt" | "models" | "usage" | "capabilities" | "test" | "tests">;
interface Options { accountLogin?:AccountLogin;accountRequired?:boolean; memoryConfigured?:boolean;installation?:Installation;restart?:()=>void; projectsWorkspace?:ProjectsWorkspace; origin: string; access: WebAccess; lab: Lab; assistant?: Assistant; skills?:Skills; tasks?:Tasks; scheduler?:{state():{running:boolean;active:number;ticking:boolean;intervalMs:number;concurrency:number};tick():Promise<void>;stop?():void;start?():void}; conversations?: Conversations; memories?: Memories; maintenanceFile?: string; assetsDirectory?: string; externalTools?:ExternalTools }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const safeMessages = new Set(["Réglages de skills invalides.","Limites invalides.","Message requis.","Budget de lot invalide.","Pagination invalide.","Curseur introuvable dans ce fil.",...Object.values(aiSdkErrorMessages),"Formulaire ou réponse invalide. Vérifie les champs.","Demande interactive introuvable.","Réponds au formulaire en attente ou annule-le avant un nouveau message.","Cette demande a déjà reçu une autre réponse.","Une autre demande interactive est en attente.","Historique de la demande interactive incohérent.","Outil interactif indisponible.","Reprise interactive atomique indisponible pour ce stockage.","Modèle du fil modifié ailleurs. Rouvre ses réglages.","Modèle du fil modifié ailleurs ou conversation occupée. Rouvre ses réglages.","Worker YOLO indisponible. Aucun repli implicite.","Réglages par défaut invalides.","Catalogue OpenRouter indisponible. Actualise la liste pour réessayer.","OpenRouter : choisir un identifiant de modèle terminé par :free. Aucun modèle payant autorisé.","Prompt modifié ailleurs ou limite de 100 prompts atteinte. Actualise la liste.","Prompt modifié ailleurs. Actualise la liste.","Une pièce jointe est introuvable. Actualise la liste.","Fichier déjà utilisé ou introuvable. Son historique est conservé.","Profil assistant invalide.", "Profil modifié ailleurs. Actualise avant de réessayer.","Ce fichier ne peut pas être affiché comme image.", "Souvenir invalide : titre, contenu ou type.", "Portée du souvenir invalide.",
  "Souvenir hors du projet courant.", "Ne pas mémoriser de secret.", "Souvenir introuvable.",
  "Version mémoire requise.", "État mémoire invalide.", "Projet introuvable.",
  "Souvenir modifié depuis sa lecture. Actualiser avant de réessayer.", "Un souvenir actif identique existe déjà dans cette portée.","Conversation introuvable.", "Cette conversation travaille déjà.",
  "Titre requis (160 caractères maximum).", "Capacité de contexte requise (4096 à 2000000 tokens).",
  "Cette session travaille déjà ou nécessite une réconciliation.",
  "Exécution interrompue : réconciliation requise avant reprise. Aucun outil rejoué.",
  "Appels d’outils sans résultat : réconciliation requise avant reprise.",
  "Échange trop volumineux pour ce modèle. Choisir un contexte plus grand.",
  "Historique trop volumineux pour la compression avec ce modèle.",
  "Compression trop longue : ancien contexte conservé.", "Compression invalide : ancien contexte conservé.", "Compression insuffisante : ancien contexte conservé.",
  "Conversation interrompue. Historique conservé ; vérifier la connexion et le modèle avant de continuer.","Un test est déjà en cours.", "Module inconnu.", "Message requis (8000 caractères maximum).",
  "Choisir entre 1 et 4 étapes.", "Choisir un modèle.", "Configurer d’abord la clé API de ce fournisseur.",
  "Clé ou fournisseur invalide.", "Aucune connexion en attente.", "Adresse de retour invalide.",
  "Adresse de retour refusée. Vérifier qu’elle est complète et correspond à cette connexion.",
  "Trop de tentatives. Réessayer dans quelques minutes.", "Accès refusé ou invitation expirée.",
  "Test interrompu ou impossible. Vérifier la connexion, le modèle et le budget d’étapes.",
  "Limite d’usage ChatGPT atteinte. Gérer l’usage : https://chatgpt.com/settings/usage. Aucun repli API.",
  "Compte ChatGPT à reconnecter (pnpm chatgpt --action login). Aucun repli API.",
  "Usage du forfait indisponible pour ce compte ou cette application. Vérifier l’éligibilité et le consentement. Aucun repli API.",
  "Réponse ChatGPT indisponible ou incompatible. Aucun repli API."]);

async function body(request: IncomingMessage, limit = 32 * 1024): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "Requête JSON requise.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new HttpError(413, "Requête trop volumineuse.");
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, "Requête JSON invalide."); }
}

export function createWebServer(options: Options) {
  const origin = new URL(options.origin).origin;
  const host = new URL(origin).host;
  const secure = origin.startsWith("https:");
  const cookieName = secure ? "__Host-harness_session" : "harness_session";
  const cookie = (token: string, expires = false) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires ? 0 : 86400}${secure ? "; Secure" : ""}`;
  const assets = options.assetsDirectory ?? fileURLToPath(new URL("./public/", import.meta.url));
  const staticFiles: Record<string, { name: string; type: string }> = {
    "/": { name: "index.html", type: "text/html; charset=utf-8" },
    "/controls.js": { name: "controls.js", type: "text/javascript; charset=utf-8" },
    "/management.css": {name:"management.css",type:"text/css; charset=utf-8"},
    "/components.css": { name: "components.css", type: "text/css; charset=utf-8" },
    "/feedback.js": { name: "feedback.js", type: "text/javascript; charset=utf-8" },
    "/terminal.js": {name:"terminal.js",type:"text/javascript; charset=utf-8"},
    "/workspace.js": {name:"workspace.js",type:"text/javascript; charset=utf-8"},
    "/workspace.css": {name:"workspace.css",type:"text/css; charset=utf-8"},
    "/chat-tools.js": { name: "chat-tools.js", type: "text/javascript; charset=utf-8" },
    "/history.js":{name:"history.js",type:"text/javascript; charset=utf-8"},
    "/tasks.js":{name:"tasks.js",type:"text/javascript; charset=utf-8"},
    "/tasks.css":{name:"tasks.css",type:"text/css; charset=utf-8"},
    "/capabilities.js":{name:"capabilities.js",type:"text/javascript; charset=utf-8"},
    "/capabilities.css":{name:"capabilities.css",type:"text/css; charset=utf-8"},
    "/skills.js":{name:"skills.js",type:"text/javascript; charset=utf-8"},
    "/skills.css":{name:"skills.css",type:"text/css; charset=utf-8"},
    "/policies.js":{name:"policies.js",type:"text/javascript; charset=utf-8"},
    "/policies.css":{name:"policies.css",type:"text/css; charset=utf-8"},
    "/settings.js":{name:"settings.js",type:"text/javascript; charset=utf-8"},
    "/settings.css":{name:"settings.css",type:"text/css; charset=utf-8"},
    "/instructions.js":{name:"instructions.js",type:"text/javascript; charset=utf-8"},
    "/instructions.css":{name:"instructions.css",type:"text/css; charset=utf-8"},
    "/preferences.js": {name:"preferences.js",type:"text/javascript; charset=utf-8"},
    "/usage.js": { name:"usage.js",type:"text/javascript; charset=utf-8" },
    "/chat-interactions.js": {name:"chat-interactions.js",type:"text/javascript; charset=utf-8"},
    "/chat-interactions.css": {name:"chat-interactions.css",type:"text/css; charset=utf-8"},
    "/chat-content.js": {name:"chat-content.js",type:"text/javascript; charset=utf-8"},
    "/chat-content.css": {name:"chat-content.css",type:"text/css; charset=utf-8"},
    "/chat-math.js": { name:"chat-math.js",type:"text/javascript; charset=utf-8" },
    "/chat-math.css": { name:"chat-math.css",type:"text/css; charset=utf-8" },
    "/vendor/katex/katex.min.js": {name:"vendor/katex/katex.min.js",type:"text/javascript; charset=utf-8"},
    "/vendor/katex/katex.min.css": {name:"vendor/katex/katex.min.css",type:"text/css; charset=utf-8"},
    "/external-tools.js": {name:"external-tools.js",type:"text/javascript; charset=utf-8"},
    "/external-tools.css": {name:"external-tools.css",type:"text/css; charset=utf-8"},
    "/work.js": {name:"work.js",type:"text/javascript; charset=utf-8"},
    "/chat-turns.js": {name:"chat-turns.js",type:"text/javascript; charset=utf-8"},
    "/chat-turns.css": {name:"chat-turns.css",type:"text/css; charset=utf-8"},
    "/chat.js": { name:"chat.js",type:"text/javascript; charset=utf-8" },
    "/chat.css": { name:"chat.css",type:"text/css; charset=utf-8" },
    "/vendor/marked.js": { name:"vendor/marked.js",type:"text/javascript; charset=utf-8" },
    "/vendor/purify.js": { name:"vendor/purify.js",type:"text/javascript; charset=utf-8" },
    "/platform.js": {name:"platform.js",type:"text/javascript; charset=utf-8"},
    "/api-client.js": {name:"api-client.js",type:"text/javascript; charset=utf-8"},
    "/icons.js": {name:"icons.js",type:"text/javascript; charset=utf-8"},
    "/app.js": { name: "app.js", type: "text/javascript; charset=utf-8" },
    "/ui.js": { name: "ui.js", type: "text/javascript; charset=utf-8" },
    "/brand/mark.png": { name: "brand/mark.png", type: "image/png" },
    "/styles.css": { name: "styles.css", type: "text/css; charset=utf-8" },
  };
  for(const family of ["AMS-Regular","Caligraphic-Bold","Caligraphic-Regular","Fraktur-Bold","Fraktur-Regular","Main-Bold","Main-BoldItalic","Main-Italic","Main-Regular","Math-BoldItalic","Math-Italic","SansSerif-Bold","SansSerif-Italic","SansSerif-Regular","Script-Regular","Size1-Regular","Size2-Regular","Size3-Regular","Size4-Regular","Typewriter-Regular"]){
    for(const [extension,type] of [["woff2","font/woff2"],["woff","font/woff"],["ttf","font/ttf"]]){
      const name=`vendor/katex/fonts/KaTeX_${family}.${extension}`;staticFiles["/"+name]={name,type};
    }
  }
  for (const avatarId of ["nora-v1", "masculine-v1", "neutral-v1"]) {
    const avatarRoot = `/avatar-pack/${avatarId}/`;
    for (const [name, type] of Object.entries({ "index.html": "text/html; charset=utf-8", "styles.css": "text/css; charset=utf-8",
      "preview.js": "text/javascript; charset=utf-8", "manifest.js": "text/javascript; charset=utf-8", "manifest.json": "application/json",
      "README.md": "text/plain; charset=utf-8", "symbol.svg": "image/svg+xml", "portraits-only.zip": "application/zip", "nora-avatar-v1.zip": "application/zip" })) {
      staticFiles[avatarRoot + name] = { name: `avatar-pack/${avatarId}/` + name, type };
    }
    staticFiles[avatarRoot] = staticFiles[avatarRoot + "index.html"];
    staticFiles[avatarRoot + avatarId + ".zip"] = { name: `avatar-pack/${avatarId}/${avatarId}.zip`, type: "application/zip" };
    for (const state of ["idle", "working", "waiting"]) {
      for (const [kind, sizes] of [["portrait", [32,48,64,96,128,256]], ["body", [256,512,768]]] as const) {
        for (const size of sizes) for (const extension of ["png", "webp"]) {
          const name = `${kind}/${state}-${size}.${extension}`;
          staticFiles[avatarRoot + name] = { name: `avatar-pack/${avatarId}/` + name, type: `image/${extension}` };
        }
      }
      staticFiles[`${avatarRoot}preview/${state}.gif`] = { name: `avatar-pack/${avatarId}/preview/${state}.gif`, type: "image/gif" };
    }
    for (const transition of ["idle-to-working", "working-to-idle", "working-to-waiting", "waiting-to-working"]) {
      for (const [kind, size] of [["portrait",128],["portrait",256],["body",512]]) {
        const name = `transitions/${transition}-${kind}-${size}.webp`;
        staticFiles[avatarRoot + name] = { name: `avatar-pack/${avatarId}/` + name, type: "image/webp" };
      }
    }
  }
  staticFiles["/avatar-pack/"] = { name: "avatar-pack/index.html", type: "text/html; charset=utf-8" };
  const pilotsRoot = "/avatar-pilots/v2/";
  for (const [name,type] of Object.entries({ "index.html":"text/html; charset=utf-8", "styles.css":"text/css; charset=utf-8", "preview.js":"text/javascript; charset=utf-8", "results.json":"application/json" })) {
    staticFiles[pilotsRoot+name] = { name:"avatar-pilots/v2/"+name, type };
  }
  staticFiles[pilotsRoot] = staticFiles[pilotsRoot+"index.html"];
  for (const identity of ["masculine","neutral"]) {
    staticFiles[`${pilotsRoot}${identity}-original.mp4`] = { name:`avatar-pilots/v2/${identity}-original.mp4`, type:"video/mp4" };
    for (const kind of ["body","portrait"]) for (const extension of ["png","webp","gif"]) {
      const name=`${identity}-${kind}.${extension}`;
      staticFiles[pilotsRoot+name] = { name:"avatar-pilots/v2/"+name, type:`image/${extension}` };
    }
  }
  for (const version of ["v3","v4","v5"]) {
  const portraitsRoot = `/avatar-portraits/${version}/`;
  for (const [name,type] of Object.entries({ "index.html":"text/html; charset=utf-8", "styles.css":"text/css; charset=utf-8", "preview.js":"text/javascript; charset=utf-8", "results.json":"application/json" })) {
    staticFiles[portraitsRoot+name] = { name:`avatar-portraits/${version}/`+name, type };
  }
  staticFiles[portraitsRoot] = staticFiles[portraitsRoot+"index.html"];
  for (const identity of ["orion","prisme"]) for (const state of ["working","idle","waiting"]) {
    const id=identity+"-"+state;
    for (const [name,type] of [[id+"-original.mp4","video/mp4"],[id+".gif","image/gif"]]) {
      staticFiles[portraitsRoot+name] = { name:`avatar-portraits/${version}/`+name, type };
    }
    for (const size of [64,128,256]) for (const extension of ["png","webp"]) {
      const name=`${id}-${size}.${extension}`;
      staticFiles[portraitsRoot+name] = { name:`avatar-portraits/${version}/`+name, type:`image/${extension}` };
    }
  }
  }
  let reconfiguring=false;
  const json = (response: ServerResponse, value: unknown, status = 200) => {
    if(response.destroyed||response.writableEnded)return;
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value));
  };
  let activeMutations=0;
  const server = createServer((request, response) => {
    let mutation=false;
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Robots-Tag", "noindex, nofollow");
    response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self'; connect-src 'self'");
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      if (request.method === "GET" && url.pathname === "/healthz") { json(response, { ok: true, activeMutations:activeMutations+(options.scheduler?.state().active??0)+Number(options.scheduler?.state().ticking??false), maintenance:!!options.maintenanceFile&&existsSync(options.maintenanceFile) }); return; }
      if (request.headers.host !== host) throw new HttpError(403, "Hôte refusé.");
      if (request.method === "GET" && Object.hasOwn(staticFiles, url.pathname)) {
        const asset = staticFiles[url.pathname];
        response.setHeader("content-type", asset.type);
        const file=path.join(assets,asset.name);
        const metadata = await stat(file);
        // Only public application assets may be revalidated. API responses keep
        // their no-store policy; max-age=0 also checks for every new deployment.
        const etag = `W/"${metadata.size.toString(16)}-${metadata.mtimeMs.toString(16)}"`;
        response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        response.setHeader("ETag", etag);
        if (!request.headers.range && request.headers["if-none-match"]?.split(",").map(value => value.trim()).includes(etag)) {
          response.statusCode = 304;
          response.end();
          return;
        }
        if (asset.type === "video/mp4") {
          const total=metadata.size;
          response.setHeader("Accept-Ranges","bytes");
          if (request.headers.range) {
            const match=request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
            let start=0,end=total-1;
            if (match?.[1]) { start=Number(match[1]); if(match[2])end=Math.min(Number(match[2]),total-1); }
            else if(match?.[2])start=Math.max(0,total-Number(match[2]));
            if(!match || (!match[1]&&!match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || start>=total || end<start || (match[1]===""&&Number(match[2])===0)) {
              response.statusCode=416;response.setHeader("Content-Range",`bytes */${total}`);response.end();return;
            }
            response.statusCode=206;response.setHeader("Content-Range",`bytes ${start}-${end}/${total}`);response.setHeader("Content-Length",end-start+1);
            await pipeline(createReadStream(file,{start,end}),response);return;
          }
          response.setHeader("Content-Length",total);
        }
        if (url.pathname.startsWith("/avatar-pack/") || url.pathname.startsWith(pilotsRoot)) await pipeline(createReadStream(file), response);
        else response.end(await readFile(file));
        return;
      }
      if (request.method === "GET" && url.pathname === "/robots.txt") { response.end("User-agent: *\nDisallow: /\n"); return; }
      if (!url.pathname.startsWith("/api/")) throw new HttpError(404, "Page introuvable.");
      if (request.method !== "GET" && request.method !== "POST") throw new HttpError(405, "Méthode refusée.");
      if (request.method === "POST" && request.headers.origin !== origin) throw new HttpError(403, "Origine refusée.");
      if(request.method==='POST'){
        if(reconfiguring)throw new HttpError(503,'Configuration des services en cours. Réessaie dans un instant.');
        if(options.maintenanceFile&&existsSync(options.maintenanceFile))throw new HttpError(503,'Sauvegarde en cours. Réessaie dans un instant.');
        activeMutations++;mutation=true;
      }
      const cookies = (request.headers.cookie ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
      const token = cookies.length === 1 ? cookies[0].slice(cookieName.length + 1) : "";
      const session = options.access.session(token);
      if (url.pathname === "/api/login" && request.method === "POST") {
        const address = String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown").split(",").at(-1)!.trim().slice(0,100);
        const result = await options.access.login(await body(request), address);
        response.setHeader("Set-Cookie", cookie(result.token));
        json(response, { authenticated: true, csrf: result.csrf }); return;
      }
      const accountState = await options.accountLogin?.status();
      const accountAllowed =
        !options.accountRequired ||
        !!(
          session?.accountId && session.accountId === accountState?.account?.id
        );
      if (
        options.accountLogin &&
        url.pathname === "/api/account/start" &&
        request.method === "POST"
      ) {
        if (!accountState?.account && !session)
          throw new HttpError(
            403,
            "Ouvre le lien privé de première connexion fourni par l’installation.",
          );
        json(response, await options.accountLogin.start());
        return;
      }
      if(options.accountLogin&&url.pathname==='/api/account/poll'&&request.method==='POST'){
        let paused=false;const resumeScheduler=options.scheduler?.state().running;
        try{
          const result=await options.accountLogin.poll((await body(request)).flowId,()=>{
            if(activeMutations>1||options.conversations?.hasActiveWork()||(options.scheduler?.state().active??0)>0||options.scheduler?.state().ticking)throw new HttpError(409,'Attends la fin du travail avant de connecter les services.');
            options.scheduler?.stop?.();reconfiguring=true;paused=true;
          });
          if(!result.pending){const issued=options.access.issue(result.account!.id);response.setHeader('Set-Cookie',cookie(issued.token));json(response,{...result,csrf:issued.csrf});if(result.restartRequired&&options.restart)options.restart();else{reconfiguring=false;if(paused&&resumeScheduler)options.scheduler?.start?.();}}
          else json(response,result);return;
        }catch(error){if(paused){reconfiguring=false;if(resumeScheduler)options.scheduler?.start?.();}throw error instanceof AccountLoginError||error instanceof HttpError?error:new HttpError(503,'Connexion aux services indisponible. Recommence la connexion.');}
      }
      if (
        options.accountLogin &&
        url.pathname === "/api/account/self-test" &&
        request.method === "POST"
      ) {
        if (
          !session ||
          !options.access.checkCsrf(
            token,
            String(request.headers["x-csrf-token"] ?? ""),
          )
        )
          throw new HttpError(403, "Accès installation requis.");
        if (!options.projectsWorkspace)
          throw new HttpError(503, "Terminal indisponible.");
        const started = await options.projectsWorkspace.start({
          command: "node --version",
          cwd: ".",
        });
        let output = await options.projectsWorkspace.output(started.command.id);
        const deadline = Date.now() + 30000;
        while (output.command.status === "running" && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
          output = await options.projectsWorkspace.output(started.command.id);
        }
        json(response, {
          ok:
            output.command.exitCode === 0 &&
            /^v24\./.test(output.output.trim()),
        });
        return;
      }
      if (url.pathname === "/api/state" && request.method === "GET") {
        const login = options.accountLogin
          ? {
              ...accountState,
              bootstrapReady: !!session || !!accountState?.account,
            }
          : undefined;
        json(
          response,
          session && accountAllowed
            ? {
                authenticated: true,
                accountLogin: login,
                installation: await options.installation?.status(),
                csrf: options.access.csrf(token),
                ...(await options.lab.state()),
                assistant: options.assistant
                  ? await options.assistant.get()
                  : null,
                assistantPresets: options.assistant?.presets() ?? null,
                tasksAvailable: !!options.tasks,
                skillsAvailable: !!options.skills,
                externalToolsAvailable: !!options.externalTools,
                conversationsAvailable: !!options.conversations,
                memoriesAvailable:
                  !!options.memories && options.memoryConfigured !== false,
                chatAssetsAvailable: !!options.conversations?.assetsAvailable,
              }
            : {
                authenticated: false,
                accountLogin: login,
                ...(session
                  ? {
                      setupReady:
                        !!(await options.assistant?.get()) &&
                        !!options.conversations,
                    }
                  : {}),
              },
        );
        return;
      }
      if (!accountAllowed)
        throw new HttpError(
          401,
          "Connecte ton compte MCP pour accéder à Heart.",
        );
      if (!session) throw new HttpError(401, "Connecte-toi pour accéder au laboratoire.");
      if (request.method === "POST" && !options.access.checkCsrf(token, String(request.headers["x-csrf-token"] ?? ""))) throw new HttpError(403, "Session à actualiser.");
      if(options.installation&&url.pathname==='/api/installation/services'){
        if(request.method==='GET'){json(response,await options.installation.status());return;}
        if(activeMutations>1||options.conversations?.hasActiveWork()||(options.scheduler?.state().active??0)>0||options.scheduler?.state().ticking)throw new HttpError(409,'Attendre la fin du travail en cours avant de reconfigurer les services.');
        const resumeScheduler=options.scheduler?.state().running;options.scheduler?.stop?.();reconfiguring=true;
        try{const result=await options.installation.configure(await body(request));json(response,result);if(options.restart)options.restart();else {reconfiguring=false;if(resumeScheduler)options.scheduler?.start?.();}}
        catch{if(resumeScheduler)options.scheduler?.start?.();reconfiguring=false;throw new HttpError(400,'Connexion aux services impossible. Vérifie les URL et les clés ; aucune clé affichée.');}return;
      }
      if(options.assistant&&url.pathname==='/api/conversation-defaults'){
        if(request.method==='GET'){json(response,await options.assistant.defaults());return;}
        if(request.method!=='POST')throw new HttpError(405,'Méthode non autorisée.');
        try{json(response,await options.assistant.saveDefaults(await body(request)));}
        catch(error){if(error instanceof Error&&error.message==='Profil modifié ailleurs. Actualise avant de réessayer.')throw new HttpError(409,error.message);throw error;}return;
      }
      if(options.tasks){
        if(url.pathname==='/api/tasks'&&request.method==='GET'){json(response,{...await options.tasks.list({...(url.searchParams.has("after")?{after:url.searchParams.get("after")!}:{}),...(url.searchParams.has("limit")?{limit:Number(url.searchParams.get("limit"))}:{})}),scheduler:options.scheduler?.state()??null});return;}
        if(url.pathname==='/api/tasks'&&request.method==='POST'){json(response,await options.tasks.save(await body(request,Number.POSITIVE_INFINITY)),201);return;}
        const match=url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})(?:\/(active|run|runs)(?:\/([0-9a-f-]{36})\/(read|resolve))?)?$/i);
        if(match){
          const [,id,action,runId,operation]=match;
          if(!action&&request.method==='GET'){json(response,await options.tasks.get(id,url.searchParams.get('before')??undefined,Number(url.searchParams.get('limit')??20)));return;}
          if(!action&&request.method==='POST'){json(response,await options.tasks.save({...await body(request,Number.POSITIVE_INFINITY),id}));return;}
          if(action==='active'&&request.method==='POST'){json(response,await options.tasks.active(id,await body(request)));return;}
          if(action==='run'&&request.method==='POST'){json(response,await options.tasks.runNow(id,await body(request)),202);void options.scheduler?.tick().catch(()=>{});return;}
          if(action==='runs'&&runId&&operation&&request.method==='POST'){json(response,operation==='read'?await options.tasks.acknowledge(id,runId,await body(request)):await options.tasks.resolve(id,runId));return;}
        }
      }
      if(options.skills){
        if(url.pathname==='/api/skills'&&request.method==='GET'){json(response,await options.skills.list());return;}
        if(url.pathname==='/api/skills'&&request.method==='POST'){try{json(response,await options.skills.set(await body(request)));}catch(error){if(error instanceof Error&&error.message==='Profil modifié ailleurs. Actualise avant de réessayer.')throw new HttpError(409,error.message);throw error;}return;}
        const skillMatch=url.pathname.match(/^\/api\/skills\/([0-9a-f-]{36})$/i);
        if(skillMatch&&request.method==='GET'){json(response,await options.skills.get(skillMatch[1]));return;}
      }
      if(options.assistant&&url.pathname==='/api/policies'){
        if(request.method==='GET'){json(response,await options.assistant.policyCatalog());return;}
        if(request.method==='POST'){json(response,await options.assistant.savePolicy(await body(request)));return;}
      }
      if(options.assistant && url.pathname==="/api/instructions"){
        try {json(response, request.method==="GET" ? await options.assistant.instructionCatalog() : await options.assistant.saveInstruction(await body(request,Number.POSITIVE_INFINITY)));}
        catch(error){if(error instanceof Error&&error.message==="Profil modifié ailleurs. Actualise avant de réessayer.")throw new HttpError(409,error.message);throw error;}return;
      }
      if (options.assistant && url.pathname === "/api/assistant") {
        try { json(response, request.method === "GET" ? await options.assistant.get() : await (async()=>{const input=await body(request);return input.patch?options.assistant!.patch(input):options.assistant!.save(input);})()); }
        catch (error) { if (error instanceof Error && error.message === "Profil modifié ailleurs. Actualise avant de réessayer.") throw new HttpError(409,error.message); throw error; }
        return;
      }
      if(options.externalTools){
        if(request.method==='GET'&&url.pathname==='/api/external-tools'){json(response,await options.externalTools.list());return;}
        if(request.method==='POST'&&url.pathname==='/api/external-tools/discover'){json(response,await options.externalTools.discover(await body(request,Number.POSITIVE_INFINITY)));return;}
        if(request.method==='POST'&&url.pathname==='/api/external-tools'){json(response,await options.externalTools.save(await body(request,Number.POSITIVE_INFINITY)));return;}
      }
      if(options.memoryConfigured===false&&url.pathname.startsWith('/api/memories'))throw new HttpError(409,'Connecte le service Mémoire dans Capacités → Connexions → Services partagés.');
      if (options.memories) {
        const match = url.pathname.match(/^\/api\/memories\/([0-9a-f-]{36})(\/(status|revisions))?$/i);
        if (request.method === "GET" && url.pathname === "/api/memories") { json(response, await options.memories.list()); return; }
        if (request.method === "GET" && match && !match[2]) {json(response,await options.memories.get(match[1]));return;}
        if (request.method === "GET" && match?.[3] === "revisions") { json(response, await options.memories.revisions(match[1])); return; }
        if (request.method === "POST" && url.pathname === "/api/projects") { json(response, await options.memories.createProject(await body(request)), 201); return; }
        if (request.method === "POST" && url.pathname === "/api/memories") { json(response, await options.memories.create(await body(request)), 201); return; }
        if (request.method === "POST" && match && (!match[2] || match[3] === "status")) {
          json(response, match[3] === "status" ? await options.memories.status(match[1], await body(request)) : await options.memories.update(match[1], await body(request))); return;
        }
      }
      if(options.conversations?.assetsAvailable){
        if(url.pathname==="/api/quick-prompts" && request.method==="GET"){json(response,{prompts:await options.conversations.prompts()});return;}
        if(url.pathname==="/api/quick-prompts" && request.method==="POST"){json(response,{prompt:await options.conversations.savePrompt(await body(request))});return;}
        if(url.pathname==="/api/quick-prompts/delete" && request.method==="POST"){await options.conversations.deletePrompt(await body(request));json(response,{ok:true});return;}
        const fileMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/attachments(?:\/([0-9a-f-]{36})(\/raw|\/delete)?)?$/);
        if(fileMatch){
          const [,conversationId,fileId,action]=fileMatch;
          if(request.method==="GET"&&!fileId){json(response,{files:await options.conversations.attachments(conversationId)});return;}
          if(request.method==="POST"&&!fileId){json(response,{file:await options.conversations.upload(conversationId,await body(request,12*1024*1024))},201);return;}
          if(request.method==="POST"&&fileId&&action==="/delete"){await options.conversations.removeAttachment(conversationId,fileId);json(response,{ok:true});return;}
          if(request.method==="GET"&&fileId&&action==="/raw"){
            const {file,bytes}=await options.conversations.attachment(conversationId,fileId);
            response.setHeader("Content-Type",file.mediaType.startsWith("image/")?file.mediaType:"application/octet-stream");
            response.setHeader("Content-Disposition",`${file.mediaType.startsWith("image/")?"inline":"attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
            response.end(Buffer.from(bytes));return;
          }
        }
      }
      const commandsMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/commands(?:\/([0-9a-f-]{36})(\/input|\/stop)?)?$/);
      const recoveryMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/reconcile$/);
      if(options.conversations&&recoveryMatch&&request.method==='POST'){json(response,await options.conversations.reconcile(recoveryMatch[1],await body(request)));return;}
      const executionMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/execution-policy$/);
      if(options.conversations&&executionMatch&&request.method==="POST"){json(response,await options.conversations.executionPolicy(executionMatch[1],await body(request)));return;}
      if(options.conversations&&commandsMatch){const [,id,commandId,action]=commandsMatch;
        if(request.method==="GET"&&!commandId){json(response,await options.conversations.commands(id));return;}
        if(request.method==="POST"&&!commandId){json(response,await options.conversations.startCommand(id,await body(request,Number.POSITIVE_INFINITY)));return;}
        if(request.method==="GET"&&commandId){json(response,await options.conversations.commandOutput(id,commandId,url.searchParams.has("offset")?Number(url.searchParams.get("offset")):undefined));return;}
        if(request.method==="POST"&&commandId&&action==="/stop"){json(response,await options.conversations.stopCommand(id,commandId));return;}
        if(request.method==="POST"&&commandId&&action==="/input"){json(response,await options.conversations.commandInput(id,commandId,await body(request,Number.POSITIVE_INFINITY)));return;}
      }
      const root = options.projectsWorkspace;
      if(root && url.pathname === "/api/projects-root" && request.method === "GET") { json(response,root.info()); return; }
      const rootCommands = url.pathname.match(/^\/api\/projects-root\/commands(?:\/([0-9a-f-]{36})(\/input|\/stop)?)?$/);
      if(root && rootCommands) {
        const [,commandId,action] = rootCommands;
        if(request.method === "GET" && !commandId) {json(response,await root.commands());return;}
        if(request.method === "POST" && !commandId) {json(response,await root.start(await body(request,Number.POSITIVE_INFINITY)));return;}
        if(request.method === "GET" && commandId && !action) {json(response,await root.output(commandId,url.searchParams.has("offset")?Number(url.searchParams.get("offset")):undefined));return;}
        if(request.method === "POST" && commandId && action === "/input") {json(response,await root.input(commandId,await body(request,Number.POSITIVE_INFINITY)));return;}
        if(request.method === "POST" && commandId && action === "/stop") {json(response,await root.stop(commandId));return;}
      }
      const rootFiles = url.pathname.match(/^\/api\/projects-root\/workspace(?:\/(raw|upload))?$/);
      if(root && rootFiles) {
        const input = url.searchParams.get("path") ?? "", action = rootFiles[1];
        if(request.method === "GET" && action === "raw") {
          const {entry,body:stream} = await root.download(input);
          response.setHeader("Content-Type","application/octet-stream");
          response.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`);
          response.setHeader("Content-Length",entry.size);await pipeline(stream,response);return;
        }
        if(request.method === "POST" && action === "upload") {json(response,await root.mutate({action:"import",path:input,...(url.searchParams.has("revision")?{revision:url.searchParams.get("revision")}: {})},request));return;}
        if(!action && request.method === "GET") {json(response,url.searchParams.get("info")==="true" ? await root.document(input) : await root.inspect(input,url.searchParams.get("read")==="true",url.searchParams.has("offset")?Number(url.searchParams.get("offset")):undefined,url.searchParams.has("count")?Number(url.searchParams.get("count")):undefined));return;}
        if(!action && request.method === "POST") {json(response,await root.mutate(await body(request,Number.POSITIVE_INFINITY)));return;}
      }
      const workspaceStream=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/workspace\/(raw|upload|preview)$/);
      if(options.conversations && workspaceStream){
        const [,id,action]=workspaceStream,input=url.searchParams.get("path")??"";
        if(action==="preview"&&request.method==="GET"){
          const {entry,body:stream,mediaType,close}=await options.conversations.previewWorkspace(id,input);
          response.setHeader("Content-Type",mediaType);
          response.setHeader("Content-Disposition",`inline; filename*=UTF-8''${encodeURIComponent(entry.name)}`);
          response.setHeader("Content-Security-Policy","sandbox; default-src 'none'; style-src 'unsafe-inline'");
          response.setHeader("Content-Length",entry.size);
          try{await pipeline(stream,response);}finally{await close();}return;
        }
        if(action==="raw"&&request.method==="GET"){
          const {entry,body:stream}=await options.conversations.downloadWorkspace(id,input);
          response.setHeader("Content-Type","application/octet-stream");
          response.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`);
          response.setHeader("Content-Length",entry.size);
          await pipeline(stream,response);return;
        }
        if(action==="upload"&&request.method==="POST"){
          json(response,await options.conversations.mutateWorkspace(id,{action:"import",path:input,...(url.searchParams.has("revision")?{revision:url.searchParams.get("revision")}: {})},request));return;
        }
      }
      const workspaceMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/(workspace|file-access)$/);
      if(options.conversations && workspaceMatch){
        const [,id,kind]=workspaceMatch;
        if(kind==="file-access"&&request.method==="POST"){json(response,await options.conversations.fileAccess(id,await body(request)));return;}
        if(kind==="workspace"&&request.method==="GET"&&url.searchParams.get("info")==="true"){json(response,await options.conversations.infoWorkspace(id,url.searchParams.get("path")??""));return;}
        if(kind==="workspace"&&request.method==="GET"){json(response,await options.conversations.inspectWorkspace(id,url.searchParams.get("path")??"",url.searchParams.get("read")==="true",url.searchParams.has("offset")?Number(url.searchParams.get("offset")):undefined,url.searchParams.has("count")?Number(url.searchParams.get("count")):undefined));return;}
        if(kind==="workspace"&&request.method==="POST"){json(response,await options.conversations.mutateWorkspace(id,await body(request,Number.POSITIVE_INFINITY)));return;}
      }
      const interactionMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/interactions\/([0-9a-f-]{36})$/);
      if(options.conversations && interactionMatch && request.method==='POST'){
        json(response,await options.conversations.respondInteraction(interactionMatch[1],interactionMatch[2],await body(request,Number.POSITIVE_INFINITY)));return;
      }
      const cancelMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/cancel$/);
      if(options.conversations && request.method==="POST" && cancelMatch){json(response,await options.conversations.cancel(cancelMatch[1]));return;}
      const modelMatch=url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})\/model$/);
      if(options.conversations&&modelMatch&&request.method==='POST'){json(response,await options.conversations.selectModel(modelMatch[1],await body(request)));return;}
      const conversationMatch = url.pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})(\/messages)?$/);
      if (options.conversations) {
        if (request.method === "GET" && url.pathname === "/api/conversations/work") {json(response,await options.conversations.work());return;}
        if (request.method === "GET" && url.pathname === "/api/conversations") { json(response, await options.conversations.list({...(url.searchParams.has('before')?{before:url.searchParams.get('before')!}:{}),...(url.searchParams.has('limit')?{limit:Number(url.searchParams.get('limit'))}:{}),...(url.searchParams.get('project')?{projectId:url.searchParams.get('project')!}:{}),...(url.searchParams.get('q')?{query:url.searchParams.get('q')!}: {})})); return; }
        if (request.method === "GET" && conversationMatch && !conversationMatch[2]) { json(response, await options.conversations.get(conversationMatch[1],{...(url.searchParams.has('before')?{before:url.searchParams.get('before')!}:{}),...(url.searchParams.has('after')?{after:url.searchParams.get('after')||null}:{}),...(url.searchParams.has('limit')?{limit:Number(url.searchParams.get('limit'))}:{})})); return; }
        if (request.method === "POST" && url.pathname === "/api/conversations") { json(response, await options.conversations.create(await body(request)), 201); return; }
        if (request.method === "POST" && conversationMatch?.[2]) {
          json(response,await options.conversations.send(conversationMatch[1],await body(request,Number.POSITIVE_INFINITY)));
          return;
        }
      }
      if (request.method === "GET") {
        if (url.pathname === "/api/chatgpt/login") { json(response, options.lab.loginStatus()); return; }
        if (url.pathname === "/api/provider-usage") {json(response,await options.lab.usage(url.searchParams.get("provider")??"demo",url.searchParams.get("modelId")??"",url.searchParams.get("refresh")==="1"));return;}
        if(url.pathname==='/api/model-capabilities'){json(response,await options.lab.capabilities(url.searchParams.get('provider')??'demo',url.searchParams.get('modelId')??''));return;}
        if (url.pathname === "/api/models") { json(response, await options.lab.models(url.searchParams.get("provider") ?? "chatgpt")); return; }
      } else {
        const input = await body(request);
        if (url.pathname === "/api/logout") {
          options.access.logout(token); response.setHeader("Set-Cookie", cookie("", true)); json(response, { ok: true }); return;
        }
        if (url.pathname === "/api/credentials") { json(response, await options.lab.setKey(input.provider, input.apiKey)); return; }
        if (url.pathname === "/api/chatgpt/login") { json(response, await options.lab.startLogin()); return; }
        if (url.pathname === "/api/chatgpt/callback") { json(response, await options.lab.finishLogin(input.url)); return; }
        if (url.pathname === "/api/chatgpt/logout") { json(response, await options.lab.logoutChatGpt()); return; }
        if (url.pathname === "/api/test") {
          const controller = new AbortController();
          const cancel = () => { if (!response.writableEnded) controller.abort(); };
          response.once("close", cancel);
          try { json(response, await options.lab.test(input, controller.signal)); }
          finally { response.removeListener("close", cancel); }
          return;
        }
        if (url.pathname === "/api/tests") { json(response, await options.lab.tests(input.suite)); return; }
      }
      throw new HttpError(404, "Action introuvable.");
    })().catch(error => {
      if (response.destroyed || response.writableEnded) return;
      if(error instanceof ExternalCallError){json(response,{error:error.message},error.code==='NOT_FOUND'?404:error.code==='CONFLICT'?409:error.code==='INVALID'?400:503);return;}
      const known = error instanceof Error && (error instanceof AccountLoginError || /^Lot d’outils trop grand \(\d+ maximum\)\.$/.test(error.message) || /^Message trop long : limite configurée de \d+ caractères\.$/.test(error.message) || error instanceof TaskError || error instanceof SkillError || (["Ce projet est archivé.","Objectif requis.","Identifiant de création invalide."].includes(error.message)||safeMessages.has(error.message)) || error instanceof ChatInputError || error instanceof RecoveryError || error instanceof WorkspaceError || error instanceof ExecutionError || error instanceof ExternalToolError);
      json(response, { error: error instanceof HttpError || known ? error.message : "Action impossible. Vérifie la connexion et réessaie." },
        error instanceof HttpError ? error.status : known ? 400 : 500);
    }).finally(()=>{if(mutation)activeMutations--;});
  });
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;
  return server;
}
