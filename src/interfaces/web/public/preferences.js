/* App preferences and provider metadata; never changes an existing thread. */
(() => {
  'use strict';
  const get=id=>document.getElementById(id);
  const providers={chatgpt:'ChatGPT',openrouter:'OpenRouter',venice:'Venice AI',openai:'OpenAI API',anthropic:'Anthropic API',demo:'Simulation'};
  const efforts={none:'Aucun',minimal:'Minimal',low:'Faible',medium:'Moyen',high:'Élevé',xhigh:'Très élevé',max:'Max',ultra:'Ultra'};
  let route='',settingsVersion=0,saved=null,catalog=[],catalogVersion=0,catalogReady=false,defaultsVersion=0,defaultsSaving=false;
  let consumptionVersion=0,consumptionLoading=false,consumptionAt=0,connectionSignature='';
  const money=value=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(value);
  const duration=mins=>mins%1440===0?mins/1440+' j':mins%60===0?mins/60+' h':mins+' min';
  const date=value=>new Date(value).toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'});
  function node(tag,text,cls){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(cls)value.className=cls;return value;}
  function connected(){return Object.keys(providers).filter(provider=>provider==='chatgpt'?state.chatgpt?.connected:!!state.api?.[provider]);}
  function details(list,label,value){list.append(node('dt',label),node('dd',value));}
  function consumptionCard(provider,value){
    const card=node('article',undefined,'consumption-card');
    const heading=node('header');heading.append(node('h2',providers[provider]),node('span',value.status==='available'?'Disponible':'Non communiqué','consumption-state'));card.append(heading);
    if(value.balance){const metric=node('div',undefined,'consumption-primary');metric.append(node('span',value.balance.scope==='account'?'Crédits du compte':value.balance.scope==='key'?'Budget de clé restant':'Budget restant'),node('strong',money(value.balance.remaining)));card.append(metric);}
    const windows=node('div',undefined,'consumption-windows');
    for(const quota of value.quota?.windows||[]){const row=node('div',undefined,'consumption-window');const line=node('div');line.append(node('span',quota.limitName+' · '+duration(quota.windowDurationMins)),node('strong',quota.remainingPercent+' % restants'));const progress=node('progress');progress.max=100;progress.value=quota.remainingPercent;progress.setAttribute('aria-label',quota.limitName+' : '+quota.remainingPercent+' % restants');row.append(line,progress,node('small','Renouvellement · '+date(quota.resetsAt)));windows.append(row);}
    if(windows.children.length)card.append(windows);
    if(value.spend){const periods=node('dl',undefined,'consumption-periods');for(const [key,label] of [['daily','Jour'],['weekly','Semaine'],['monthly','Mois'],['total','Total de la clé']])if(typeof value.spend[key]==='number'){const metric=node('div');details(metric,label,money(value.spend[key]));periods.append(metric);}card.append(periods);}
    if(value.reset)card.append(node('p','Reset du budget · '+(value.reset.at?date(value.reset.at):({daily:'Quotidien',weekly:'Hebdomadaire',monthly:'Mensuel'}[value.reset.interval]||'Non communiqué')),'field-help'));
    if(!value.balance&&!value.spend&&!windows.children.length)card.append(node('p','Ce fournisseur ne communique pas de consommation via cette connexion.','field-help'));
    const source=node('details',undefined,'consumption-source');source.append(node('summary','Source et périmètre'),node('p',value.message,'field-help'),node('p',value.source,'field-help'));card.append(source);
    const footer=node('footer');footer.append(node('small','Relevé · '+date(value.observedAt)));
    if(value.dashboardUrl){const link=node('a','Voir le compte');link.href=value.dashboardUrl;link.target='_blank';link.rel='noopener noreferrer';footer.append(link);}card.append(footer);
    return card;
  }
  async function loadConsumption(force=false){
    if(!state.authenticated||route!=='consumption')return;
    if(!force&&(consumptionLoading||Date.now()-consumptionAt<60000))return;
    const version=++consumptionVersion,list=connected();consumptionLoading=true;get('consumption-refresh').disabled=true;get('consumption-status').textContent='Actualisation des fournisseurs…';
    const target=get('consumption-providers');target.setAttribute('aria-busy','true');
    const cards=await Promise.all(list.map(async provider=>{
      try{const value=await api('/api/provider-usage?'+new URLSearchParams({provider,modelId:'',...(force?{refresh:'1'}:{})}));return consumptionCard(provider,value);}
      catch{const card=node('article',undefined,'panel consumption-card');card.append(node('h2',providers[provider]),node('p','Lecture impossible. Actualise pour réessayer.','field-help'));return card;}
    }));
    if(version!==consumptionVersion)return;
    target.replaceChildren(...cards);if(!cards.length){const empty=node('p','Aucun fournisseur connecté. Configure une connexion dans Modèles.','field-help');target.append(empty);}
    target.removeAttribute('aria-busy');consumptionAt=Date.now();consumptionLoading=false;get('consumption-refresh').disabled=false;get('consumption-status').textContent=cards.length?'Mis à jour · '+date(new Date()):'Aucun fournisseur connecté';
  }
  function defaultModel(){return ['chatgpt','openrouter','venice','demo'].includes(get('defaults-provider').value)?get('defaults-model').value:get('defaults-model-id').value.trim();}
  function effortOptions(preferred=''){
    const provider=get('defaults-provider').value,model=catalog.find(item=>item.id===defaultModel()),select=get('defaults-effort');
    select.replaceChildren(new Option('Automatique'+(model?.defaultReasoningEffort?' · '+(efforts[model.defaultReasoningEffort]||model.defaultReasoningEffort):''),''));
    for(const value of model?.reasoningEfforts||[])select.append(new Option(efforts[value]||value,value));
    select.value=[...select.options].some(option=>option.value===preferred)?preferred:'';
    select.hidden=get('defaults-effort-label').hidden=!model?.reasoningEfforts?.length;
    window.heartControls?.sync();
  }
  async function loadDefaultsCatalog(preferredModel='',preferredEffort=''){
    const version=++catalogVersion,provider=get('defaults-provider').value,remote=['chatgpt','openrouter','venice'].includes(provider);
    catalog=[];catalogReady=false;get('save-defaults').disabled=true;get('defaults-model-status').textContent=remote?'Chargement des modèles…':preferredModel?'Vérification des capacités…':'';
    get('defaults-model').hidden=!remote&&provider!=='demo';get('defaults-model-id').hidden=remote||provider==='demo';get('defaults-reload-models').hidden=provider==='demo';get('defaults-reload-models').textContent=remote?'Actualiser la liste':'Vérifier le modèle';
    get('defaults-capacity-field').hidden=remote||provider==='demo';get('defaults-capacity').disabled=remote||provider==='demo';get('defaults-model-id').value=preferredModel;
    get('defaults-model').replaceChildren(new Option(provider==='demo'?'Simulation':'Choisir un modèle',''));
    effortOptions();
    try{
      if(remote){const result=await api('/api/models?provider='+provider);if(version!==catalogVersion)return;catalog=result.models||[];get('defaults-model').append(...catalog.map(model=>new Option(model.name||model.id,model.id)));get('defaults-model').value=catalog.some(model=>model.id===preferredModel)?preferredModel:'';get('defaults-model-status').textContent=catalog.length?'':'Aucun modèle disponible. Vérifie la connexion.';}
      if(!remote&&provider!=='demo'&&preferredModel){const model=await api('/api/model-capabilities?'+new URLSearchParams({provider,modelId:preferredModel}));if(version!==catalogVersion)return;catalog=[model];}
      if(version!==catalogVersion)return;
      catalogReady=true;get('defaults-model-status').textContent='';effortOptions(preferredEffort);get('save-defaults').disabled=false;
    }catch{if(version===catalogVersion)get('defaults-model-status').textContent='Catalogue indisponible. Vérifie la connexion puis actualise.';}
    finally{if(version===catalogVersion)window.heartControls?.sync();}
  }
  function access(){const yolo=get('defaults-access').value==='yolo';get('defaults-network').disabled=yolo;if(yolo)get('defaults-network').checked=true;}
  async function openDefaults(){
    const version=++defaultsVersion;
    get('defaults-dialog').showModal();get('defaults-effort').hidden=get('defaults-effort-label').hidden=true;get('defaults-form').querySelector('.editor-scroll').inert=true;window.heartControls?.sync();get('save-defaults').disabled=true;get('defaults-model-status').textContent='Chargement…';
    try{
      const result=await api('/api/conversation-defaults');if(version!==defaultsVersion)return;settingsVersion=result.version;saved=result.defaults;
      const selection=saved.selection;get('defaults-provider').value=selection?.provider||'demo';get('defaults-access').value=saved.fileAccess;get('defaults-network').checked=saved.networkAccess;get('defaults-capacity').value=String(selection?.contextWindow||32768);access();
      await loadDefaultsCatalog(selection?.modelId||'',selection?.reasoningEffort||'');
    }catch(error){if(version===defaultsVersion)get('defaults-model-status').textContent=errorText(error);}
    finally{if(version===defaultsVersion)get('defaults-form').querySelector('.editor-scroll').inert=false;}
  }
  get('edit-conversation-defaults').addEventListener('click',()=>void openDefaults());
  get('defaults-dialog').addEventListener('close',()=>{clearTimeout(manualTimer);defaultsVersion++;catalogVersion++;catalogReady=false;});
  get('close-defaults').addEventListener('click',()=>get('defaults-dialog').close());
  get('defaults-provider').addEventListener('change',()=>{clearTimeout(manualTimer);void loadDefaultsCatalog();});
  get('defaults-reload-models').addEventListener('click',()=>void loadDefaultsCatalog(defaultModel(),get('defaults-effort').value));
  let manualTimer;
  get('defaults-model-id').addEventListener('input',()=>{clearTimeout(manualTimer);catalogReady=false;get('save-defaults').disabled=true;manualTimer=setTimeout(()=>void loadDefaultsCatalog(get('defaults-model-id').value.trim()),350);});
  get('defaults-model').addEventListener('change',()=>effortOptions());get('defaults-access').addEventListener('change',access);
  get('defaults-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!catalogReady||defaultsSaving)return;
    const provider=get('defaults-provider').value,modelId=defaultModel(),model=catalog.find(item=>item.id===modelId);
    if(provider!=='demo'&&!modelId){message('Choisis un modèle.',true);return;}
    const defaults={selection:{provider,modelId,contextWindow:Math.min(model?.contextWindow||Number(get('defaults-capacity').value)||32768,2000000),capacitySource:model?.contextWindow?'catalog':'configured',...(get('defaults-effort').value?{reasoningEffort:get('defaults-effort').value}:{})},fileAccess:get('defaults-access').value,networkAccess:get('defaults-network').checked};
    defaultsSaving=true;
    try{const result=await post('/api/conversation-defaults',{version:settingsVersion,baseDefaults:saved,defaults});settingsVersion=result.version;saved=result.defaults;if(result.profile)state.assistant=result.profile;else state.assistant={...state.assistant,version:result.version,settings:{...state.assistant.settings,conversationDefaults:result.defaults}};window.heartUI?.sync();window.heartPreferences.sync();get('defaults-dialog').close();message('Valeurs par défaut enregistrées.');}
    catch(error){message(errorText(error),true);if(String(error.message).includes('ailleurs'))get('defaults-model-status').textContent='Réglages modifiés ailleurs. Ferme puis rouvre cette fenêtre avant de réessayer.';}
    finally{defaultsSaving=false;}
  });
  get('consumption-refresh').addEventListener('click',()=>void loadConsumption(true));
  get('memory-create-project')?.addEventListener('click',()=>get('memory-dialog').close());
  window.heartPreferences={
    route(value,previous){
      route=value;void loadConsumption();
    },
    sync(){
      const signature=JSON.stringify([state.chatgpt?.email,state.chatgpt?.connected,state.api]);if(signature!==connectionSignature){connectionSignature=signature;consumptionVersion++;consumptionLoading=false;consumptionAt=0;get('consumption-providers').replaceChildren();void loadConsumption();}
      const defaults=state.assistant?.settings?.conversationDefaults,s=defaults?.selection;
      get('defaults-summary').textContent=defaults?(s?providers[s.provider]+' · '+(s.modelId||'Simulation')+' · effort '+(s.reasoningEffort||'auto'):'Modèle à choisir')+' · '+({none:'Sans outils fichiers',read:'Lecture',write:'Écriture',develop:'Développement',yolo:'YOLO'}[defaults.fileAccess])+' · réseau '+(defaults.networkAccess?'actif':'désactivé'):'Lecture seule · réseau désactivé. Choisis le modèle des nouveaux fils.';
      get('edit-conversation-defaults').disabled=!state.assistant;
    }
  };
  setInterval(()=>{if(!document.hidden)void loadConsumption();},60000);
  window.heartPreferences.route(location.hash.slice(1),'');
})();
