"use strict";

const $ = (id) => document.getElementById(id);
let state = { authenticated: false, chatgpt: { connected: false }, api: {} };
let csrf = "";
let stateSequence = 0;
let pollTimer;
let running = false;
let checksRunning = false;
let answer = "";
let conversationId = "";
let conversationSelection=null;
let credentialProvider="";
let conversationRunning = false;
const conversationRequests = new Set();
let conversationLoading = false;
let conversationLoaded = false;
let configuredContextWindow = 32768;
let memoryRecords = [];
let memoryProjects = [];
let projectsLoaded = false;
let memoryEditing = null;
let memoryBusy = false;
let memoryLoaded = false;
const rememberedModels = {};
let models = [];
const rememberedEfforts=new Map();
const manualCapabilities=new Map();
let modelsStatus = "idle";
let modelsAccount = "";
let modelsRequest;
let modelsVersion = 0;
let modelsUpdatedAt = "";
function usesCatalog(provider = selectedProvider()) {
  return provider === "chatgpt" || provider === "openrouter" || provider === "venice" || provider === "venice-web";
}
function modelAvailable(provider = selectedProvider()) {
  if (provider === "demo") return true;
  if (
    usesCatalog(provider) &&
    (modelsStatus !== "ready" ||
      modelsAccount !== accountKey() ||
      !$("model-options").value)
  )
    return false;
  return (
    !!(provider === "chatgpt"
      ? state.chatgpt?.connected
      : state.api?.[provider]) && !!$("model-id").value.trim()
  );
}
const names = {
  demo: "Simulation locale",
  chatgpt: "ChatGPT · abonnement",
  openai: "OpenAI · API",
  anthropic: "Claude · API",
  openrouter: "OpenRouter · API",
  venice: "Venice AI · API",
  "venice-web": "Venice · web expérimental",
};

function selectedProvider() {
  return document.querySelector('input[name="provider"]:checked').value;
}
function message(text, error = false) {
  window.heartFeedback.notice(text, error);
}
function errorText(error) {
  return error instanceof Error
    ? error.message
    : "L’opération n’a pas pu aboutir.";
}
const httpClient=window.heartHttp.create({
  csrf:()=>csrf,
  receivedCsrf:token=>{csrf=token;},
  expired:()=>{state.authenticated=false;showAuthenticated(false);},
  feedback:(url,method)=>window.heartFeedback.begin(url,method),
});
function api(url,options={}) {return httpClient.api(url,options);}
function post(url,body={}) {return httpClient.post(url,body);}
function showAuthenticated(authenticated) {
  $("login-view").hidden = authenticated;
  $("app-view").hidden = !authenticated;
  if (!authenticated) {
    stateSequence++;
    state.assistant = null;
    window.heartUI?.sync();
    window.heartPreferences?.sync();
    memoryLoaded = false;
    memoryRecords = [];
    memoryProjects = [];projectsLoaded=false;window.heartProjects?.reset();
    memoryEditing = null;
    $("memory-list").replaceChildren();
    $("memory-editor").reset();
    conversationLoaded = false;
    catalogueVersion++;catalogue=[];catalogueCursor=null;catalogueKey="";catalogueLoading=false;
    conversationId = "";
    window.heartWork?.update([]);
    window.heartChatTools?.reset();
    window.heartWorkspace?.reset();
    $("conversation-history").replaceChildren();
    $("conversation-list").replaceChildren();
    clearTimeout(pollTimer);
    clearModels();
    csrf = "";
    $("api-key").value = "";
    $("callback-url").value = "";
  }
}
let accountConnecting=false;
function renderState() {
  window.heartExternal?.sync();
  showAuthenticated(!!state.authenticated);
  const accountLogin=state.accountLogin;
  $('account-login').hidden=state.authenticated||!accountLogin?.available;
  $('login-form').hidden=!state.authenticated&&!!accountLogin?.available&&accountLogin.bootstrapReady;
  $('account-connect').disabled=accountConnecting||!accountLogin?.bootstrapReady;
  $('account-register').disabled=accountConnecting||!accountLogin?.bootstrapReady;
  $('account-registration').hidden=!!accountLogin?.account;
  if(!state.authenticated&&accountLogin?.available&&!accountLogin.bootstrapReady)$('account-login-status').textContent='Ouvre le lien privé de première connexion fourni à l’installation, ou utilise le token local ci-dessous.';
  if (!state.authenticated) return;
  $("brand-name").firstChild.textContent = state.displayName || "Nora Heart";
  document.title = `${state.displayName || "Nora Heart"}`;
  $("chatgpt-card-status").textContent = state.chatgpt?.connected
    ? "Compte connecté"
    : "À connecter";
  $("openai-card-status").textContent = state.api?.openai
    ? "Clé configurée"
    : "Clé absente";
  $("anthropic-card-status").textContent = state.api?.anthropic
    ? "Clé configurée"
    : "Clé absente";
  $("openrouter-card-status").textContent = state.api?.openrouter
    ? "Clé configurée"
    : "Clé absente";
  $("venice-web-card-status").textContent = state.api?.["venice-web"] ? "Session connectée" : "Session ou pont absent";
  $("venice-card-status").textContent = state.api?.venice ? "Clé configurée" : "Clé absente";
  $("conversations").hidden = !state.conversationsAvailable;
  $("memories").hidden = !state.memoriesAvailable;
  $("conversation-project-box").hidden = !(state.projectsAvailable||state.memoriesAvailable);
  renderProvider();
  if (state.login) renderLogin(state.login);
  window.heartUI?.sync();
  window.heartPreferences?.sync();
}
function accountKey() {
  if (["openrouter","venice","venice-web"].includes(selectedProvider())) return selectedProvider()+"-public";
  return state.chatgpt?.connected
    ? `${state.chatgpt.profile || "default"}:${state.chatgpt.clientId || state.chatgpt.email || ""}`
    : "";
}
function clearModels(dropSelection = true) {
  models = [];
  modelsStatus = "idle";
  modelsAccount = "";
  modelsUpdatedAt = "";
  modelsRequest = undefined;
  modelsVersion++;
  if (dropSelection) {
    delete rememberedModels.chatgpt;
    delete rememberedModels.openrouter;
    delete rememberedModels.venice;
  }
  $("model-options").replaceChildren();
}
async function refreshState() {
  const sequence=++stateSequence, next=await api("/api/state");
  if(sequence!==stateSequence)return state;
  // A slow global read must not undo a profile just saved by this browser.
  if(state.authenticated&&next.authenticated&&(state.assistant?.version??-1)>(next.assistant?.version??-1))next.assistant=state.assistant;
  state=next;
  if (
    !state.authenticated ||
    (selectedProvider() === "chatgpt" && !state.chatgpt?.connected)
  )
    clearModels();
  else if (modelsAccount && modelsAccount !== accountKey()) clearModels(false);
  renderState();
  // Independent local data must not queue behind a remote model catalogue.
  const tasks = [];
  if (state.authenticated && usesCatalog() &&
      (selectedProvider() !== "chatgpt" || state.chatgpt?.connected) && modelsStatus === "idle")
    tasks.push(loadModels());
  if (state.authenticated && state.memoriesAvailable && !memoryLoaded)
    tasks.push(loadMemories());
  if (state.authenticated && state.conversationsAvailable && !conversationLoaded)
    tasks.push(loadConversations().then(() => { conversationLoaded = true; }));
  if(state.authenticated&&state.projectsAvailable&&!projectsLoaded)tasks.push(loadProjects());
  const results = await Promise.allSettled(tasks);
  for (const result of results) if (result.status === "rejected") message(errorText(result.reason), true);
  return state;
}
function renderModelPicker() {
  const provider = selectedProvider(),
    catalog = usesCatalog();
  $("model-options").dataset.catalogProvider = provider;
  $("model-id").hidden = catalog;
  $("model-id").required = !catalog && provider !== "demo";
  $("model-options").hidden = !catalog;
  $("model-options").required = catalog;
  $("model-options").disabled = !catalog || modelsStatus !== "ready";
  $("model-label").htmlFor = catalog ? "model-options" : "model-id";
  if (!catalog) {
    $("model-help").textContent =
      "Indique l’identifiant du modèle. La clé API reste côté serveur.";
    return;
  }
  const selected = rememberedModels[provider] || "";
  $("model-options").value = models.some((model) => model.id === selected)
    ? selected
    : "";
  $("model-id").value = $("model-options").value;
  const source =
    provider !== "chatgpt"
      ? "modèles disponibles"
      : models.length === 1
        ? "modèle disponible dans ton compte"
        : "modèles disponibles dans ton compte";
  $("model-help").textContent =
    provider === "chatgpt" && !state.chatgpt?.connected
      ? "Connecte ton compte pour charger ses modèles."
      : modelsStatus === "loading"
        ? "Chargement du catalogue…"
        : modelsStatus === "error"
          ? "Impossible de charger le catalogue : momentanément indisponible. Actualise la liste pour réessayer. L’envoi est bloqué."
          : modelsStatus === "ready"
            ? models.length
              ? `${models.length} ${source}. Mis à jour à ${new Date(modelsUpdatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`
              : "Aucun modèle compatible disponible actuellement."
            : "Chargement du catalogue…";
}
let reasoningOptionsKey = "";
function renderReasoningOptions(){
  const provider=selectedProvider(),id=$('model-id').value;
  const key=provider+':'+id;
  const selected=usesCatalog(provider)?models.find(model=>model.id===id):manualCapabilities.get(key);
  if(['openai','anthropic'].includes(provider)&&id&&!manualCapabilities.has(key)){
    manualCapabilities.set(key,{id,pending:true,reasoningEfforts:[]});
    void api('/api/model-capabilities?'+new URLSearchParams({provider,modelId:id})).then(model=>{manualCapabilities.set(key,model);if(selectedProvider()===provider&&$('model-id').value===id){renderReasoningOptions();renderConversationBrain();}}).catch(()=>{});
  }
  const efforts=selected?.reasoningEfforts??[];
  if(selected&&!selected.pending&&rememberedEfforts.get(key)&&!efforts.includes(rememberedEfforts.get(key)))rememberedEfforts.set(key,'');
  const effortNames={low:'Faible',medium:'Moyen',high:'Élevé',xhigh:'Très élevé',max:'Maximum',ultra:'Ultra',none:'Aucun',minimal:'Minimal'};
  $('model-reasoning-options').hidden=!efforts.length;
  const select=$('reasoning-effort');
  const optionsKey=JSON.stringify([efforts,selected?.defaultReasoningEffort]);
  if(optionsKey!==reasoningOptionsKey){
  reasoningOptionsKey=optionsKey;select.replaceChildren();
  const defaultOption=document.createElement('option');defaultOption.value='';defaultOption.textContent='Par défaut'+(selected?.defaultReasoningEffort?' · '+(effortNames[selected.defaultReasoningEffort]??selected.defaultReasoningEffort):'');select.append(defaultOption);
  for(const effort of efforts){const option=document.createElement('option');option.value=effort;option.textContent=effortNames[effort]??effort;select.append(option);}
  }
  select.value=rememberedEfforts.get(provider+':'+id)||'';
  $('conversation-model-summary').textContent=provider==='demo'?'Simulation':(selected?.name||id||names[provider]||provider);
  window.heartControls?.sync();
}
$('reasoning-effort').addEventListener('change',()=>{rememberedEfforts.set(selectedProvider()+':'+$('model-id').value,$('reasoning-effort').value);renderConversationBrain();});
function selectedReasoningEffort(){return rememberedEfforts.get(selectedProvider()+':'+$('model-id').value)||undefined;}
function renderProvider() {
  const provider = selectedProvider();
  const connected = !!state.chatgpt?.connected;
  $("connection-box").hidden = false;
  $("model-field").hidden = provider === "demo";
  $("refresh-models").hidden =
    !usesCatalog() || (provider === "chatgpt" && !connected);
  $("connect-chatgpt").hidden = connected;
  $("disconnect-chatgpt").hidden = !connected;
  $("connection-dot").classList.toggle("connected", connected);
  $("connection-title").textContent = connected
    ? "Abonnement connecté"
    : "Connecter ChatGPT";
  $("connection-description").textContent = connected
    ? state.chatgpt.email || `Profil ${state.chatgpt.profile || "personnel"}`
    : "Utilise ton abonnement avec une connexion sécurisée.";
  renderModelPicker();
  renderReasoningOptions();
  const available =
    provider === "demo" ||
    (provider === "chatgpt" ? connected : !!state.api?.[provider]);
  renderConversationBrain();
  $("run-test").disabled = running || !modelAvailable();
  $("cost-note").classList.toggle("paid", provider !== "demo");
  $("cost-note").textContent =
    provider === "demo"
      ? "Simulation locale. Aucun modèle payant n’est appelé."
      : provider === "venice-web"
        ? "Session web Venice, outils émulés. Modèles sans crédits uniquement ; limites du compte Venice applicables."
      : provider === "openrouter"
        ? "Le modèle choisi sera utilisé avec ton compte OpenRouter, au tarif affiché. Aucun autre modèle ne prend le relais."
        : provider === "chatgpt"
          ? "Cet essai utilisera ton forfait ChatGPT ou les crédits que tu as autorisés."
          : available
            ? "Cet essai sera facturé par l’API choisie. Aucun autre fournisseur ne prendra le relais."
            : "La clé de ce fournisseur doit être configurée côté serveur pour lancer un essai.";
}
function setResponseStatus(status, text) {
  $("response-state").className = `response-state ${status}`;
  $("response-state").textContent = text;
  window.heartUI?.picture();
  window.heartWorkspace?.sync();
}
function appendEvent(event, index) {
  const labels = {
    "run.started": "L’essai commence",
    message: "Échange avec le modèle",
    "tool.started": "Le moteur lance un outil",
    "tool.finished": "Résultat de l’outil",
    "run.completed": "Essai terminé",
    "run.failed": "L’essai a rencontré une erreur",
  };
  const li = document.createElement("li");
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = `${String(index + 1).padStart(2, "0")} · ${labels[event.type] || event.type || "Événement"}`;
  content.append(title);
  if (event.data !== undefined) {
    const detail = document.createElement("pre");
    detail.textContent =
      typeof event.data === "string"
        ? event.data
        : JSON.stringify(event.data, null, 2);
    content.append(detail);
  }
  li.append(content);
  $("event-list").append(li);
}
function safeConnectionUrl(value) {
  const url = new URL(value, window.location.origin);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Le lien de connexion n’est pas disponible.");
  return url;
}
function renderLogin(login) {
  if (!login || !state.authenticated) return;
  const pending = login.status === "pending";
  $("connect-chatgpt").disabled = pending;
  $("connect-chatgpt").textContent = pending
    ? "Connexion en cours…"
    : "Connecter";
  const link = $("connection-link");
  link.hidden = true;
  const notice = $("connection-message");
  notice.hidden = true;
  $("callback-box").hidden = !pending;
  if (pending && login.url) {
    try {
      const url = safeConnectionUrl(login.url);
      link.href = url.href;
      link.hidden = false;
      notice.textContent = ["localhost", "127.0.0.1", "[::1]"].includes(
        url.hostname,
      )
        ? "Ce lien utilise une connexion locale. Si le navigateur est sur un autre ordinateur, un tunnel SSH est nécessaire."
        : "Termine l’autorisation dans la fenêtre OpenAI. Si la page de retour ne s’ouvre pas, utilise le champ ci-dessous.";
      notice.hidden = false;
    } catch (error) {
      notice.textContent = errorText(error);
      notice.hidden = false;
    }
  } else if (login.status === "error") {
    notice.textContent =
      login.message || "La connexion n’a pas abouti. Tu peux réessayer.";
    notice.hidden = false;
  }
  clearTimeout(pollTimer);
  if (pending) pollTimer = setTimeout(pollLogin, 1500);
}
async function pollLogin() {
  if (!state.authenticated) return;
  try {
    const result = await api("/api/chatgpt/login");
    renderLogin(result);
    if (result.status === "connected") {
      clearModels();
      await refreshState();
      if (modelsStatus === "ready")
        message(
          "ChatGPT est connecté. Choisis un modèle et lance ton premier essai.",
        );
    }
  } catch (error) {
    message(errorText(error), true);
  }
}
async function loadModels(force = false) {
  const provider = selectedProvider();
  if (
    !state.authenticated ||
    !usesCatalog() ||
    (provider === "chatgpt" && !state.chatgpt?.connected)
  )
    return;
  if (modelsRequest) return modelsRequest;
  if (
    !force &&
    modelsStatus === "ready" &&
    modelsAccount === accountKey() &&
    Date.now() - Date.parse(modelsUpdatedAt) < 5 * 60 * 1000
  )
    return;
  const button = $("refresh-models");
  const version = ++modelsVersion;
  const account = accountKey();
  modelsAccount = account;
  modelsStatus = "loading";
  button.disabled = true;
  button.textContent = "Chargement…";
  renderProvider();
  modelsRequest = (async () => {
    try {
      const data = await api(`/api/models?provider=${provider}`);
      if (version !== modelsVersion || account !== accountKey()) return;
      if (!Array.isArray(data.models))
        throw new Error("Catalogue de modèles invalide.");
      models = data.models.filter(
        (model) =>
          typeof model.id === "string" && typeof model.name === "string",
      );
      modelsStatus = "ready";
      modelsUpdatedAt = new Date().toISOString();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent =
        "Choisir un modèle "+(provider === "venice-web" ? "Venice web" : provider === "venice" ? "Venice AI" : provider === "openrouter" ? "OpenRouter" : "ChatGPT");
      $("model-options").replaceChildren(placeholder);
      for (const model of models) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = model.name;
        const compact = (value) =>
          new Intl.NumberFormat("fr-FR", {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(value);
        const money = (value) =>
          new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 }).format(
            value,
          );
        const price = model.pricing;
        const free =
          price?.input === 0 &&
          price?.output === 0 &&
          (price.request === 0 || model.id.endsWith(":free"));
        option.dataset.detail = [
          provider === "chatgpt"
            ? "ChatGPT"
            : provider === "venice-web" ? "Venice web · outils émulés"
            : provider === "venice" ? "Venice AI"
            : model.name.includes(":")
              ? model.name.split(":")[0]
              : model.id.split("/")[0],
          model.contextWindow ? compact(model.contextWindow) + " contexte" : "",
          model.supportsTools
            ? "Outils"
            : model.supportsTools === false
              ? "Sans outils"
              : "",
          model.vision ? "Vision" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        option.dataset.price =
          provider === "chatgpt"
            ? "Abonnement"
            : free
              ? "Gratuit"
              : price?.input != null && price?.output != null
                ? `${money(price.input)} $ / ${money(price.output)} $`
                : "Tarif non communiqué";
        option.dataset.priceHint =
          provider === "chatgpt"
            ? "Compte ChatGPT"
            : free
              ? ""
              : price?.request > 0
                ? `/1M E/S · +${money(price.request)} $/req`
                : "/1M tokens E/S";
        option.dataset.free = String(free);
        option.dataset.tools = String(!!model.supportsTools);
        option.dataset.search = model.name + " " + model.id;
        $("model-options").append(option);
      }
    } catch (error) {
      if (version !== modelsVersion) return;
      modelsStatus = "error";
      message(errorText(error), true);
    } finally {
      if (version === modelsVersion) {
        modelsRequest = undefined;
        button.disabled = false;
        button.textContent = "Actualiser";
        renderProvider();
      }
    }
  })();
  return modelsRequest;
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("login-submit");
  button.disabled = true;
  $("login-submit-label").textContent = "Ouverture…";
  button.setAttribute("aria-busy", "true");
  $("login-error").hidden = true;
  try {
    await post("/api/login", {
      password: $("password").value,
      invite: $("password").value,
    });
    $("password").value = "";
    await refreshState();
  } catch (error) {
    $("login-error").textContent = errorText(error);
    $("login-error").hidden = false;
  } finally {
    button.disabled = false;
    $("login-submit-label").textContent = "Ouvrir mon espace";
    button.removeAttribute("aria-busy");
  }
});
$("logout-button").addEventListener("click", async () => {
  try {
    await post("/api/logout");
    state.authenticated = false;
    showAuthenticated(false);
  } catch (error) {
    message(errorText(error), true);
  }
});
document.querySelectorAll('input[name="provider"]').forEach((input) =>
  input.addEventListener("change", () => {
    $("api-key").value = "";
    $("api-key-editor").hidden = true;
    if (usesCatalog() && modelsAccount && modelsAccount !== accountKey())
      clearModels(false);
    $("model-id").value = rememberedModels[selectedProvider()] || "";
    message("");
    renderProvider();
    if (
      usesCatalog() &&
      (selectedProvider() !== "chatgpt" || state.chatgpt?.connected)
    )
      void loadModels();
  }),
);
$("model-id").addEventListener("input", () => {
  rememberedModels[selectedProvider()] = $("model-id").value;
  renderConversationBrain();
});
$("model-options").addEventListener("change", () => {
  rememberedModels[selectedProvider()] = $("model-options").value;
  renderProvider();
});
$("refresh-models").addEventListener("click", () => loadModels(true));
document.querySelectorAll('[data-configure-provider]').forEach(button=>button.addEventListener('click',()=>{
  credentialProvider=button.dataset.configureProvider;
  $('api-key-dialog-title').textContent='Configurer '+names[credentialProvider];
  $('api-key-editor').hidden=false;$('api-key-dialog').showModal();$('api-key').focus();
}));
$("api-key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const provider = credentialProvider;
  if (!["openai", "anthropic", "openrouter", "venice"].includes(provider)) return;
  const apiKey = $("api-key").value.trim();
  if (!apiKey) {
    message("Colle la clé du fournisseur choisi avant de l’enregistrer.", true);
    return;
  }
  $("save-api-key").disabled = true;
  try {
    await post("/api/credentials", { provider, apiKey });
    $("api-key").value = "";
    $("api-key-editor").hidden = true;
    $("api-key-dialog").close();
    state.api={...state.api,[provider]:true};renderState();
    message('Connexion '+names[provider]+' enregistrée.');
    window.heartUI?.resumeOnboarding();
  } catch {
    message(
      "La clé n’a pas pu être enregistrée. Vérifie l’accès au serveur et réessaie.",
      true,
    );
  } finally {
    $("save-api-key").disabled = false;
  }
});
$("connect-chatgpt").addEventListener("click", async () => {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  $("connect-chatgpt").disabled = true;
  try {
    const login = await post("/api/chatgpt/login");
    renderLogin(login);
    if (login.url && popup)
      popup.location.replace(safeConnectionUrl(login.url).href);
    else if (popup) popup.close();
  } catch (error) {
    if (popup) popup.close();
    $("connect-chatgpt").disabled = false;
    message(errorText(error), true);
  }
});
$("finish-connection").addEventListener("click", async () => {
  const url = $("callback-url").value.trim();
  $("callback-url").value = "";
  if (!url) {
    message(
      "Copie l’adresse complète de la page de retour OpenAI dans le champ.",
      true,
    );
    return;
  }
  $("finish-connection").disabled = true;
  try {
    await post("/api/chatgpt/callback", { url });
    await pollLogin();
  } catch {
    message(
      "L’adresse de retour n’a pas pu être vérifiée. Recommence la connexion si elle a expiré.",
      true,
    );
  } finally {
    $("finish-connection").disabled = false;
  }
});
$("disconnect-chatgpt").addEventListener("click", async () => {
  $("disconnect-chatgpt").disabled = true;
  try {
    const result = await post("/api/chatgpt/logout");
    await refreshState();
    message(result.message || "Le compte ChatGPT a été déconnecté.");
  } catch (error) {
    message(errorText(error), true);
  } finally {
    $("disconnect-chatgpt").disabled = false;
  }
});
document.querySelectorAll("[data-prompt]").forEach((button) =>
  button.addEventListener("click", () => {
    $("prompt").value = button.dataset.prompt;
    $("prompt").focus();
  }),
);
$("test-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (running) return;
  running = true;
  message("");
  renderProvider();
  $("run-test").textContent = "Essai en cours…";
  $("response-empty").hidden = true;
  $("response-result").hidden = true;
  $("response-error").hidden = true;
  $("response-loading").hidden = false;
  setResponseStatus("running", "EN COURS");
  const provider = selectedProvider();
  try {
    const result = await post("/api/test", {
      provider,
      modelId: $("model-id").value.trim() || undefined,
      reasoningEffort:selectedReasoningEffort(),
      prompt: $("prompt").value.trim(),
      maxSteps: Number($("max-steps").value),
    });
    answer = result.text || "Aucune réponse textuelle.";
    $("answer-text").textContent = answer;
    $("result-provider").textContent =
      names[provider] || result.provider || "Nora";
    $("result-timing").textContent =
      `${result.simulated ? "Essai simulé" : "Essai réel"} · ${(Number(result.durationMs || 0) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
    $("event-list").replaceChildren();
    (result.events || []).forEach(appendEvent);
    $("event-count").textContent = `${result.events?.length || 0} événements`;
    $("response-result").hidden = false;
    setResponseStatus("done", "TERMINÉ");
  } catch (error) {
    $("response-error").textContent = errorText(error);
    $("response-error").hidden = false;
    setResponseStatus("error", "À VÉRIFIER");
  } finally {
    running = false;
    $("response-loading").hidden = true;
    $("run-test").textContent = "Lancer l’essai";
    renderProvider();
  }
});
$("copy-answer").addEventListener("click", async () => {
  try {
    await window.heartPlatform.copy(answer);
    $("copy-answer").textContent = "Copié";
    setTimeout(() => {
      $("copy-answer").textContent = "Copier";
    }, 1800);
  } catch {
    message(
      "La copie n’est pas disponible dans ce navigateur. Tu peux sélectionner le texte.",
    );
  }
});
document.querySelectorAll("[data-suite]").forEach((button) =>
  button.addEventListener("click", async () => {
    if (checksRunning) return;
    checksRunning = true;
    document.querySelectorAll("[data-suite]").forEach((item) => {
      item.disabled = true;
    });
    const title =
      button.dataset.suite === "all"
        ? "Tous les modules"
        : button.textContent.trim();
    $("check-output-wrap").hidden = false;
    $("check-output-title").textContent = `${title} · vérification en cours…`;
    $("check-output-timing").textContent = "";
    $("check-output-title").parentElement.className = "check-output-heading";
    $("check-output").textContent =
      "Les tests tournent dans leur espace temporaire. Ils n’appellent aucun modèle payant.";
    try {
      const result = await post("/api/tests", { suite: button.dataset.suite });
      $("check-output-title").textContent = result.ok
        ? `${title} · vérifications réussies`
        : `${title} · un point à vérifier`;
      $("check-output-title").parentElement.classList.add(
        result.ok ? "success" : "failure",
      );
      $("check-output-timing").textContent =
        `${(Number(result.durationMs || 0) / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`;
      $("check-output").textContent = result.output || "Vérification terminée.";
    } catch (error) {
      $("check-output-title").textContent =
        "La vérification n’a pas pu se terminer";
      $("check-output-title").parentElement.classList.add("failure");
      $("check-output").textContent = errorText(error);
    } finally {
      checksRunning = false;
      document.querySelectorAll("[data-suite]").forEach((item) => {
        item.disabled = false;
      });
    }
  }),
);
async function connectAccount(intent='login'){
  if(accountConnecting)return;accountConnecting=true;const buttons=[$('account-connect'),$('account-register')],status=$('account-login-status'),link=$('account-verification-link');buttons.forEach(button=>button.disabled=true);
  const popup=window.open('about:blank','_blank');let opened=false;if(popup)popup.opener=null;
  try{
    status.textContent='Préparation de la connexion sécurisée…';
    const flow=await post('/api/account/start',{intent});link.href=flow.url;link.hidden=false;if(popup){popup.location=flow.url;opened=true;}
    status.textContent=(intent==='register'?'Crée ton compte sur le portail sécurisé, puis confirme le code ':'Confirme le code ')+flow.userCode+'. Cette page reprendra automatiquement.';
    const expires=Date.now()+flow.expiresIn*1000;let interval=flow.interval;
    while(Date.now()<expires){await new Promise(r=>setTimeout(r,interval*1000));const result=await post('/api/account/poll',{flowId:flow.flowId});if(result.pending){interval=result.interval;continue;}
      status.textContent='Compte connecté. Activation des services…';
      if(result.restartRequired){const until=Date.now()+45000;let ready=false;while(Date.now()<until){try{const s=await api('/api/state');if(s.authenticated&&s.installation?.ready){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Compte enregistré. Actualise lorsque le service est prêt.');}
      location.reload();return;
    }throw Error('Connexion expirée. Recommence.');
  }catch(error){status.textContent=errorText(error);if(popup&&!opened)popup.close();}finally{accountConnecting=false;buttons.forEach(button=>button.disabled=false);}
}
$('account-connect').addEventListener('click',()=>connectAccount());
$('account-register').addEventListener('click',()=>connectAccount('register'));
async function start() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const invite = fragment.get("invite");
  if (invite !== null) {
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    try {
      await post("/api/login", { invite });
    } catch {
      $("login-error").textContent =
        "Cette invitation n’est plus valide. Utilise ton accès privé pour ouvrir l’atelier.";
      $("login-error").hidden = false;
    }
  }
  try {
    await refreshState();
  } catch {
    $("login-error").textContent =
      "L’atelier est momentanément indisponible. Recharge la page dans un instant.";
    $("login-error").hidden = false;
  }
}
window.addEventListener(
  "DOMContentLoaded",
  () => {
    void start();
  },
  { once: true },
);

function syncChatActions(remoteBusy=false){
  window.heartChat?.actionsDisabled(remoteBusy||!!window.heartInteractions?.pending()||!conversationId||!modelAvailable()||conversationRunning||conversationLoading||!!window.heartChatTools?.busy()||!!window.heartChatTools?.uploading());
}
function renderConversationBrain() {
  window.heartUsage?.selection({provider:selectedProvider(),modelId:$("model-id").value,conversationId,accountKey:selectedProvider()==="chatgpt"?[!!state.chatgpt?.connected,state.chatgpt?.email||"",state.chatgpt?.clientId||""].join(":"):""});
  const provider = selectedProvider();
  const selected = models.find((model) => model.id === $("model-id").value);
  const capacity =
    usesCatalog() && selected?.contextWindow
      ? Math.min(selected.contextWindow, 2000000)
      : undefined;
  $("context-window").disabled = !!capacity;
  $("context-window").value = String(capacity || configuredContextWindow);
  $("context-capacity-help").textContent = capacity
    ? `Capacité fournie par le catalogue ${provider === "venice" ? "Venice AI" : provider === "openrouter" ? "OpenRouter" : "ChatGPT"}. Comptage des entrées estimé.`
    : "Valeur configurée à vérifier pour le modèle choisi. Comptage des entrées estimé.";
  $("chat-context-limit").textContent = new Intl.NumberFormat("fr-FR").format(
    Number($("context-window").value),
  );
  $("conversation-brain").textContent =
    `${names[provider]}${provider !== "demo" ? " · " + ($("model-id").value || "choisir un modèle ci-dessous") : ""}`;
  const available = modelAvailable();
  $("conversation-submit").disabled =
    !!window.heartChatTools?.uploading() ||
    !conversationId ||
    !available ||
    conversationRunning ||
    conversationLoading;
  $("conversation-list").disabled = conversationLoading;
  $("conversation-create").querySelector("button[type=submit]").disabled =
    conversationLoading;
  window.heartUI?.picture();
  window.heartWorkspace?.sync();
  const label = document.getElementById("choose-brain");
  label.textContent =
    provider === "demo"
      ? "Simulation"
      : selected?.name || $("model-id").value || names[provider];
  label.title = `${names[provider]} · Choisir un modèle`;
  const effortButton=$('chat-effort'),effort=selectedReasoningEffort();
  effortButton.hidden=!(selected?.reasoningEfforts?.length||manualCapabilities.get(provider+':'+$('model-id').value)?.reasoningEfforts?.length);
  effortButton.textContent='Effort '+({none:'aucun',minimal:'minimal',low:'faible',medium:'moyen',high:'élevé',xhigh:'très élevé',max:'max',ultra:'ultra'}[effort]||effort||'auto');
  effortButton.title='Réglages du modèle · effort de raisonnement';
  if($('model-preferences-dialog').open)$('conversation-model-save').disabled=modelSaving||conversationRunning||!available;
  syncChatActions();
}
async function renderConversation(data) {
  const owner=conversationId;
  data=await window.heartHistory?.accept(data)||data;
  if(owner!==conversationId||data.conversation?.id!==conversationId)return;
  if(data.conversation?.id===conversationId)conversationSelection=data.conversation.selection;
  window.heartInteractions?.update(data);
  window.heartChat?.render(data);
  window.heartUsage?.conversation(data);
  syncChatActions(!!data.busy);
}
let catalogue=[],catalogueCursor=null,catalogueKey='',catalogueVersion=0,catalogueLoading=false;
async function loadConversations(selectId,more=false) {
  if(more&&(!catalogueCursor||catalogueLoading))return;
  const key=JSON.stringify([$('discussion-search').value.trim(),$('discussion-project-filter').value]);
  const version=++catalogueVersion;
  catalogueLoading=true;$('discussion-more').disabled=true;$('discussion-status').textContent='';
  const params=new URLSearchParams();
  if($('discussion-search').value.trim())params.set('q',$('discussion-search').value.trim());
  if($('discussion-project-filter').value)params.set('project',$('discussion-project-filter').value);
  if(more)params.set('before',catalogueCursor);
  let data;
  try{data=await api('/api/conversations'+(params.size?'?'+params:''));}
  catch(error){if(version===catalogueVersion)$('discussion-status').textContent=errorText(error);throw error;}
  finally{if(version===catalogueVersion){catalogueLoading=false;$('discussion-more').disabled=false;}}
  if(version!==catalogueVersion)return;
  const retained=key===catalogueKey?catalogue:[];
  const rows=new Map((more?[...retained,...data.conversations]:[...data.conversations,...retained]).map(item=>[item.id,item]));
  for(const item of data.conversations)rows.set(item.id,item);
  catalogue=[...rows.values()];catalogueKey=key;
  if(more||!retained.length||(!catalogueCursor&&data.nextCursor))catalogueCursor=data.nextCursor;
  data.conversations=catalogue;
  $('discussion-more').hidden=!catalogueCursor;
  window.heartUI?.conversations(data.conversations);
  window.heartWork?.update(data.conversations);
  window.heartWorkspace?.catalog(data.conversations);
  const selected =
    selectId ||
    conversationId ||
    new URLSearchParams(location.search).get("conversation");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choisir une conversation";
  $("conversation-list").replaceChildren(placeholder);
  for (const item of data.conversations) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title;
    $("conversation-list").append(option);
  }
  if (selected) {
    $("conversation-list").value = selected;
    if (selected !== conversationId || !conversationLoaded)
      await openConversation(selected);
  }
  renderConversationBrain();
}
$('discussion-more').addEventListener('click',()=>void loadConversations(undefined,true).catch(()=>{}));
let conversationOpenVersion=0;
async function openConversation(id) {
  const version=++conversationOpenVersion;
  if (!id) {
    conversationLoading = false;
    conversationRunning = false;
    conversationId = "";
    $("conversation-history").textContent =
      "Choisis une conversation pour continuer.";
    renderConversationBrain();
    return;
  }
  conversationLoading = true;
  renderConversationBrain();
  try {
    const data = await api(`/api/conversations/${encodeURIComponent(id)}`);
    if(version!==conversationOpenVersion)return;
    conversationId = id;
    conversationRunning = conversationRequests.has(id);
    $("sessions-dialog").close();
    const url = new URL(location.href);
    url.searchParams.set("conversation", id);
    history.replaceState(null, "", url);
    await renderConversation(data);
    await applyConversationSelection(data.conversation.selection);
  } finally {
    if(version===conversationOpenVersion){conversationLoading = false;renderConversationBrain();}
  }
}
$("conversation-list").addEventListener("change", () => {
  void openConversation($("conversation-list").value).catch((error) =>
    message(errorText(error), true),
  );
});
$("conversation-create").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (conversationLoading) return;
  conversationLoading = true;
  renderConversationBrain();
  try {
    const data = await post("/api/conversations", {
      title: $("conversation-title").value.trim(),
      projectId: $("conversation-project").value || null,
    });
    $("conversation-dialog").close();
    location.hash = "conversations";
    $("conversation-title").value = "";
    await loadConversations(data.conversation.id);
    $("conversation-prompt").focus();
  } catch (error) {
    message(errorText(error), true);
  } finally {
    conversationLoading = false;
    renderConversationBrain();
  }
});
async function sendConversation(sourceMessage) {
  if (
    !conversationId ||
    conversationRunning ||
    window.heartChatTools?.busy() ||
    conversationLoading
  )
    return;
  const sendingId = conversationId;
  conversationRequests.add(sendingId);
  setTimeout(()=>void window.heartWork?.refresh(),200);
  conversationRunning = true;
  renderConversationBrain();
  message("");
  const replay=!!sourceMessage;
  const prompt = replay?sourceMessage.content:$("conversation-prompt").value.trim();
  const files = replay?sourceMessage.attachments:(window.heartChatTools?.selected() ?? []);
  if (!prompt && !files.length) {
    conversationRequests.delete(sendingId);
    conversationRunning = false;
    renderConversationBrain();
    return;
  }
  window.heartChat?.sending(prompt || "Pièces jointes", files);
  if(!replay)$("conversation-prompt").value = "";
  window.heartChat?.finish();
  try {
    const data = await post(`/api/conversations/${sendingId}/messages`, {
      prompt,
      attachmentIds: files.map((file) => file.id),
      provider: selectedProvider(),
      modelId: $("model-id").value.trim(),
      reasoningEffort:selectedReasoningEffort(),
      contextWindow: Number($("context-window").value),
    });
    if (conversationId === sendingId) {
      if(!replay)window.heartChatTools?.sent();
      await renderConversation(data);
    }
    await loadConversations();
    const refreshes=await Promise.allSettled([...(state.memoriesAvailable?[loadMemories()]:[]),...(state.projectsAvailable?[loadProjects()]:[])]);
    for(const result of refreshes)if(result.status==='rejected')message('Réponse terminée. Une liste n’a pas pu être actualisée.',true);
  } catch (error) {
    if(!replay)window.heartChat?.restoreDraft(sendingId, prompt);
    message(conversationId===sendingId?errorText(error):"Un travail en arrière-plan a échoué. Ouvre cette conversation pour voir son état.", true);
    try {
      const data = await api(`/api/conversations/${sendingId}`);
      if (conversationId === sendingId) await renderConversation(data);
    } catch {
      /* Keep the last visible history. */
    }
  } finally {
    conversationRequests.delete(sendingId);
    conversationRunning = conversationRequests.has(conversationId);
    if (conversationId === sendingId) window.heartChat?.finish();
    renderConversationBrain();
  }
}
$("conversation-send").addEventListener("submit",event=>{event.preventDefault();void sendConversation();});
window.heartInteractionActions={async respond(owner,requestId,response){
  if(owner!==conversationId)throw new Error('Ouvre la conversation du formulaire.');
  if(conversationRequests.has(owner))throw new Error('Cette conversation travaille déjà.');
  conversationRequests.add(owner);conversationRunning=true;renderConversationBrain();
  try{
    const data=await post(`/api/conversations/${owner}/interactions/${requestId}`,response);
    if(conversationId===owner)await renderConversation(data);
    void loadConversations().catch(()=>{});
  }catch(error){
    try{const data=await api(`/api/conversations/${owner}`);if(conversationId===owner)await renderConversation(data);}catch{}
    throw error;
  }finally{conversationRequests.delete(owner);conversationRunning=conversationRequests.has(conversationId);renderConversationBrain();}
}};
window.heartChatActions={sync:syncChatActions,resend(source){if(source.conversationId!==conversationId)return;void sendConversation(source);}};

$("context-window").addEventListener("input", () => {
  configuredContextWindow = Number($("context-window").value);
});

async function loadMemories() {
  const owner=stateSequence;
  const data = await api("/api/memories");
  if(owner!==stateSequence||!state.authenticated)return;
  memoryRecords = data.memories;

  const remoteMemory=data.supportsRestore===false;
  const forgotten=$('memory-show-forgotten');if(remoteMemory)forgotten.checked=false;forgotten.disabled=remoteMemory;
  let storageNote=$('memory-storage-note');if(!storageNote){storageNote=document.createElement('p');storageNote.id='memory-storage-note';storageNote.className='field-help';$('memory-list').before(storageNote);}
  storageNote.textContent=remoteMemory?'Mémoire MCP · un oubli supprime aussi les révisions actives.':'Mémoire locale · oubli réversible.';
  memoryLoaded = true;
  if(!state.projectsAvailable)applyProjectCatalog(data.projects);
}
async function loadProjects(){const owner=stateSequence;const data=await api('/api/projects');if(owner!==stateSequence||!state.authenticated)return;applyProjectCatalog(data.projects);}
function applyProjectCatalog(projects){
  memoryProjects=projects;projectsLoaded=true;
  window.heartUI?.memories();
  for (const id of [
    "memory-scope",
    "conversation-project",
    "memory-filter-scope",
  ]) {
    const selected = $(id).value;
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent =
      id === "memory-filter-scope"
        ? "Toutes les portées"
        : id === "memory-scope"
          ? "Personnel · tous les fils"
          : "Aucun projet · souvenirs personnels";
    $(id).replaceChildren(empty);
    if (id === "memory-filter-scope") {
      const personal = document.createElement("option");
      personal.value = "personal";
      personal.textContent = "Personnel";
      $(id).append(personal);
    }
    for (const project of memoryProjects) {
      if(project.status==='archived'&&id==='conversation-project')continue;
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.title;
      $(id).append(option);
    }
    $(id).value = selected;
  }
  if($('memory-create-project'))$('memory-create-project').hidden=memoryProjects.length>0;
  if($('memory-scope-help'))$('memory-scope-help').textContent=memoryProjects.length?'Personnel : tous les fils. Choisis un projet pour limiter le souvenir à ses conversations.':'Personnel : tous les fils. Crée un projet pour disposer aussi de la portée Projet.';
  renderMemories();
  window.heartChatTools?.sync();
}
function resetMemoryEditor() {
  memoryEditing = null;
  $("memory-editor").reset();
  $("memory-save").textContent = "Ajouter le souvenir";
  $("memory-cancel").hidden = false;
  $("memory-dialog-title").textContent = "Ajouter un souvenir";
  window.heartControls?.sync();
}
function renderMemories() {
  window.heartControls?.sync();
  const list = $("memory-list");
  list.replaceChildren();
  const query = $("memory-search").value.toLocaleLowerCase();
  const kinds = {
    fact: "Fait",
    preference: "Préférence",
    constraint: "Contrainte",
    decision: "Décision",
  };
  for (const item of memoryRecords) {
    const scope = $("memory-filter-scope").value;
    if (
      (scope === "personal" && item.scope !== "personal") ||
      (scope && scope !== "personal" && item.projectId !== scope)
    )
      continue;
    if (item.status === "forgotten" && !$("memory-show-forgotten").checked)
      continue;
    if (
      query &&
      !(item.title + " " + item.content).toLocaleLowerCase().includes(query)
    )
      continue;
    const card = document.createElement("article");
    card.className = `memory-card ${item.status}`;
    card.dataset.memoryId = item.id;
    const title = document.createElement("h3");
    title.textContent = item.title;
    const meta = document.createElement("div");
    meta.className = "memory-meta";
    const project = memoryProjects.find(
      (project) => project.id === item.projectId,
    );
    meta.textContent = `${kinds[item.kind]} · ${item.scope === "personal" ? "Personnel" : project?.title || "Projet"} · v${item.version}${item.status === "forgotten" ? " · Oublié" : ""}`;
    const text = document.createElement("p");
    text.textContent = item.content;
    const source = document.createElement("div");
    source.className = "memory-meta";
    if (item.source.type === "conversation" && item.source.conversationId) {
      const link = document.createElement("a");
      link.href = `/?conversation=${encodeURIComponent(item.source.conversationId)}`;
      link.textContent = "Source : conversation";
      source.append(link);
    } else
      source.textContent =
        item.source.type === "legacy"
          ? "Source : mémoire antérieure"
          : "Source : saisie manuelle";
    const actions = document.createElement("div");
    actions.className = "memory-actions";
    const button = (label, action) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "text-button";
      node.textContent = label;
      node.disabled = memoryBusy;
      node.addEventListener("click", action);
      actions.append(node);
    };
    button("Modifier", () => {
      openMemoryEditor(item);
    });
    button(item.status === "forgotten" ? "Restaurer" : "Oublier", () => {
      void mutateMemory(async () => {
        await post(`/api/memories/${item.id}/status`, {
          version: item.version,
          status: item.status === "forgotten" ? "active" : "forgotten",
        });
        if (memoryEditing?.id === item.id) resetMemoryEditor();
      });
    });
    const history = document.createElement("details");
    history.hidden = true;
    button("Historique", async () => {
      try {
        const data = await api(`/api/memories/${item.id}/revisions`);
        history.replaceChildren();
        const summary = document.createElement("summary");
        summary.textContent = `${data.revisions.length} versions conservées`;
        const content = document.createElement("pre");
        content.textContent = data.revisions
          .map(
            (record) =>
              `v${record.version} · ${record.status} · ${record.updatedAt}\n${record.title}\nSource : ${record.source.type}${record.source.conversationId ? " · " + record.source.conversationId : ""}\n${record.content}`,
          )
          .join("\n\n");
        history.append(summary, content);
        history.hidden = false;
        history.open = true;
      } catch (error) {
        message(errorText(error), true);
      }
    });
    card.append(title, meta, text, source, actions, history);
    list.append(card);
  }
  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "field-help";
    empty.textContent = "Aucun souvenir dans cette sélection.";
    list.append(empty);
  }
}
async function mutateMemory(action,projectsChanged=false) {
  if (memoryBusy) return;
  memoryBusy = true;
  renderMemories();
  $("memory-save").disabled = true;
  message("");
  try {
    await action();
    try {
      if(projectsChanged)await loadProjects();else if(state.memoriesAvailable)await loadMemories();
    } catch {
      message(
        "Enregistrement effectué. La liste n’a pas pu être actualisée ; utilise Actualiser.",
        true,
      );
    }
    return true;
  } catch (error) {
    message(errorText(error), true);
    return false;
  } finally {
    memoryBusy = false;
    $("memory-save").disabled = false;
    renderMemories();
  }
}
$("memories-refresh").addEventListener("click", () => {
  void loadMemories().catch((error) => message(errorText(error), true));
});
$("memory-search").addEventListener("input", renderMemories);
$("memory-filter-scope").addEventListener("change", renderMemories);
$("memory-show-forgotten").addEventListener("change", renderMemories);
$("memory-cancel").addEventListener("click", resetMemoryEditor);
$("project-create").addEventListener("input", () => { delete $("project-create").dataset.operationId; });
$("project-create").addEventListener("submit", async (event) => {
  event.preventDefault();
  await mutateMemory(async () => {
    const data = await post("/api/projects", {
      title: $("project-title").value.trim(),
      objective: $("project-objective").value.trim(),
      successCriteria: $("project-criteria").value.trim(),
      operationId: $("project-create").dataset.operationId ||= window.heartPlatform.uuid(),
    });
    $("project-dialog").close();
    $("project-title").value = "";
    $("project-objective").value = "";
    $("project-criteria").value = "";
    delete $("project-create").dataset.operationId;
    // The shared mutation flow refreshes projects after this confirmed write.
  },true);
});
$("memory-editor").addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = $("memory-scope").value || null;
  const input = {
    title: $("memory-title").value.trim(),
    content: $("memory-content").value.trim(),
    kind: $("memory-kind").value,
    scope: projectId ? "project" : "personal",
    projectId,
  };
  await mutateMemory(async () => {
    if (memoryEditing)
      await post(`/api/memories/${memoryEditing.id}`, {
        ...input,
        version: memoryEditing.version,
      });
    else await post("/api/memories", input);
    $("memory-dialog").close();
    resetMemoryEditor();
  });
});

function refreshStaleCatalog() {
  if (
    state.authenticated &&
    !document.hidden &&
    usesCatalog() &&
    modelsStatus === "ready" &&
    Date.now() - Date.parse(modelsUpdatedAt) > 5 * 60 * 1000
  )
    void loadModels(true);
}
window.addEventListener("focus", refreshStaleCatalog);
document.addEventListener("visibilitychange", refreshStaleCatalog);


async function applyConversationSelection(selection){
  const value=selection||{provider:'demo',modelId:'demo',contextWindow:32768,capacitySource:'configured'};
  document.querySelector('input[name="provider"][value="'+value.provider+'"]').checked=true;
  rememberedModels[value.provider]=value.modelId;
  rememberedEfforts.set(value.provider+':'+value.modelId,value.reasoningEffort||'');
  $('model-id').value=value.modelId;
  if(value.capacitySource==='configured')configuredContextWindow=value.contextWindow;
  $('context-window').value=String(value.contextWindow);
  if(usesCatalog()&&modelsAccount!==accountKey())clearModels(false);
  renderProvider();
  if(usesCatalog())await loadModels();
}
let modelOwner='',modelBaseline=null,modelSaving=false,modelCommitted=false,modelResetting=false;
async function openConversationModel(){
  if(!conversationId){message('Ouvre une conversation pour choisir son modèle.',true);return;}
  modelOwner=conversationId;modelBaseline=structuredClone(conversationSelection);modelCommitted=false;
  $('model-preferences-dialog').showModal();$('conversation-model-status').textContent='Chargement du modèle du fil…';$('conversation-model-save').disabled=true;
  try{await applyConversationSelection(modelBaseline);$('conversation-model-status').textContent='Ce choix ne modifie que cette conversation.';}
  catch(error){$('conversation-model-status').textContent=errorText(error);}
  finally{$('conversation-model-save').disabled=conversationRunning||!modelAvailable();}
}
async function saveConversationModel(){
  if(modelSaving||modelOwner!==conversationId||!modelAvailable())return;
  modelSaving=true;const owner=modelOwner;
  $('conversation-model-fields').inert=true;
  $('model-preferences-dialog').querySelectorAll('[data-close-model-preferences],button').forEach(button=>button.disabled=true);
  try{
    const data=await post('/api/conversations/'+encodeURIComponent(owner)+'/model',{provider:selectedProvider(),modelId:$('model-id').value,contextWindow:Number($('context-window').value),...(selectedReasoningEffort()?{reasoningEffort:selectedReasoningEffort()}:{}),baseSelection:modelBaseline});
    modelCommitted=true;
    if(owner===conversationId){await renderConversation(data);void loadConversations(owner).catch(()=>message("Modèle enregistré ; liste à actualiser.",true));}
    $('model-preferences-dialog').close();message('Modèle enregistré pour ce fil.');
  }catch(error){$('conversation-model-status').textContent=errorText(error);message(errorText(error),true);}
  finally{modelSaving=false;$('conversation-model-fields').inert=false;$('model-preferences-dialog').querySelectorAll('[data-close-model-preferences],button').forEach(button=>button.disabled=false);renderConversationBrain();}
}
window.heartConversationModel={open:()=>void openConversationModel()};
$('conversation-model-save').addEventListener('click',()=>void saveConversationModel());
$('conversation-model-default').addEventListener('click',async()=>{
  if(modelSaving||modelResetting)return;
  modelResetting=true;const owner=modelOwner;$('conversation-model-default').disabled=true;
  try{const data=await api('/api/conversation-defaults');if(owner!==conversationId||owner!==modelOwner||!$('model-preferences-dialog').open)return;if(!data.defaults.selection){message('Configure d’abord le modèle par défaut dans Configuration.',true);return;}await applyConversationSelection(data.defaults.selection);await saveConversationModel();}
  catch(error){$('conversation-model-status').textContent=errorText(error);}
  finally{modelResetting=false;$('conversation-model-default').disabled=false;}
});
$('model-preferences-dialog').addEventListener('cancel',event=>{if(modelSaving)event.preventDefault();});
$('model-preferences-dialog').addEventListener('close',()=>{if(!modelCommitted&&modelOwner===conversationId)void applyConversationSelection(conversationSelection).catch(error=>message(errorText(error),true));});
$('model-open-providers').addEventListener('click',()=>$('model-preferences-dialog').close());

function openMemoryEditor(item){
  window.heartUI?.openMemory();
  $("memory-dialog-title").textContent = "Modifier le souvenir";
  memoryEditing = { id: item.id, version: item.version };
  $("memory-title").value = item.title;
  $("memory-content").value = item.content;
  $("memory-kind").value = item.kind;
  $("memory-scope").value = item.projectId || "";
  $("memory-save").textContent =
    `Enregistrer la correction · v${item.version}`;
  $("memory-cancel").hidden = false;
  window.heartControls?.sync();
  $("memory-title").focus();
}
window.heartMemory={async open(id){const data=await api(`/api/memories/${encodeURIComponent(id)}`);openMemoryEditor(data.memory);}};

// Refresh once on entering Memory: changes from chat or another harness can outlive this tab’s cache.
window.addEventListener('hashchange',()=>{
  if(location.hash!=='#memories'||!state.authenticated||!state.memoriesAvailable)return;
  $('memory-list').setAttribute('aria-busy','true');
  void loadMemories().catch(error=>message(errorText(error),true)).finally(()=>$('memory-list').removeAttribute('aria-busy'));
});
