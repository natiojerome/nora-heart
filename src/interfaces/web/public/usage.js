/* Read-only counters. A missing provider value is never interpreted as zero. */
(() => {
  'use strict';
  const get=id=>document.getElementById(id), dialog=get('usage-dialog');
  let selection={}, conversation=null, usage=null, requestVersion=0, loading=false, detail='credits', fetchedAt=0;
  const integer=value=>new Intl.NumberFormat('fr-FR').format(value);
  const fullDate=value=>new Date(value).toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'});
  const interval=value=>({daily:'Quotidien',weekly:'Hebdo.',monthly:'Mensuel'}[value]|| (value?'Périodique':'—'));
  const duration=mins=>mins<60?integer(mins)+' min':mins<1440?integer(mins/60)+' h':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(mins/1440)+' j';
  const percent=value=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(value)+' %';
  function quotaWindow(){
    const all=usage?.quota?.windows||[];
    const general=all.filter(w=>w.limitId==='codex');
    return [...(general.length?general:all)].sort((a,b)=>a.remainingPercent-b.remainingPercent||a.windowDurationMins-b.windowDurationMins)[0];
  }
  function context(){
    const value=conversation?.contextUsage;
    return conversation?.conversation?.id===selection.conversationId && value?.model?.provider===selection.provider && value?.model?.modelId===selection.modelId && value.inputTokens>=0 && value.contextWindow>0 ? value : null;
  }
  function text(tag,value,cls){const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;}
  function row(title,value){const group=document.createElement('div');group.className='usage-row';group.append(text('dt',title),text('dd',value));get('usage-details').append(group);}
  function quotaCard(w){
    const group=document.createElement('div');group.className='usage-quota-card';
    const title=text('dt',w.limitName);title.append(text('span',duration(w.windowDurationMins),'usage-window'));
    const body=document.createElement('dd');
    const balance=text('div','','usage-quota-balance');balance.append(text('strong',percent(w.remainingPercent)),text('span','restants'));
    const meter=document.createElement('meter');meter.min=0;meter.max=100;meter.value=w.remainingPercent;meter.setAttribute('aria-label',`${w.limitName} · ${duration(w.windowDurationMins)} : quota restant`);
    const renewal=text('div','','usage-renewal');const date=text('time',fullDate(w.resetsAt));date.dateTime=w.resetsAt;renewal.append(text('span','Renouvellement'),date);
    body.append(balance,meter,text('p',percent(w.usedPercent)+' utilisés','usage-used'),renewal);group.append(title,body);get('usage-details').append(group);
  }
  function render(){
    const current=conversation?.conversation?.id===selection.conversationId?conversation:null;
    const count=current?.messageCount ?? (current?.events||[]).filter(event=>event.type==='message'&&['user','assistant'].includes(event.data?.role)&&!event.data?.toolCalls?.length).length;
    const ctx=context(),balance=usage?.balance,reset=usage?.reset,quota=quotaWindow();
    get('status-message-count').textContent=integer(count);
    get('status-context').textContent=ctx?'~'+Math.round(ctx.inputTokens/ctx.contextWindow*100)+' %':'—';
    get('status-credits').closest('.chat-status-bar').dataset.accountQuota=String(selection.provider==='chatgpt');
    get('status-reset').previousElementSibling.textContent=selection.provider==='chatgpt'?'Renouv.':'Reset';
    get('status-balance-label').textContent=selection.provider==='chatgpt'?'Quota compte':balance&&balance.scope!=='account'?'Budget':'Crédits';
    get('status-credits').textContent=loading?'…':quota?percent(quota.remainingPercent)+' · '+duration(quota.windowDurationMins):balance?new Intl.NumberFormat('fr-FR',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(balance.remaining):'—';
    get('status-credits').title=quota?`${quota.limitName} · ${duration(quota.windowDurationMins)} : ${percent(quota.remainingPercent)} restants`:'Compteur non communiqué';
    const resetAt=quota?.resetsAt||reset?.at;
    get('status-reset').textContent=loading?'…':resetAt?new Date(resetAt).toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):interval(reset?.interval);
    get('status-reset').title=resetAt?fullDate(resetAt):'Date non communiquée par le fournisseur';
    if(!dialog.open)return;
    get('usage-heading').textContent=({messages:'Messages',context:'Contexte',credits:selection.provider==='chatgpt'?'Quotas du compte':'Crédits et budgets',reset:'Renouvellement'})[detail];
    get('usage-model').textContent=selection.provider==='demo'?'Simulation':(selection.provider||'')+' · '+(selection.modelId||'Aucun modèle choisi');
    get('usage-details').replaceChildren();
    if(detail==='messages')row('Dans ce fil',integer(count)+' messages utilisateur et réponses finales');
    else if(detail==='context'){
      row('Dernière entrée préparée',ctx?'~'+integer(ctx.inputTokens)+' / '+integer(ctx.contextWindow)+' tokens':'Aucune mesure pour le modèle choisi');
      if(ctx){row('Réserve de sortie',integer(ctx.reserveTokens)+' tokens');row('Préparée le',fullDate(ctx.at));}
    }else if(usage?.quota){
      for(const w of usage.quota.windows){
        quotaCard(w);
      }
      row('Plafond propre à Heart','Non communiqué');
    }else{
      row(balance?.scope==='account'?'Crédits du compte':balance?.scope==='key'?'Budget de la clé':'Budget',balance?new Intl.NumberFormat('fr-FR',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(balance.remaining):'Non communiqué');
      row('Reset du '+(reset?.scope==='key'?'budget de clé':'budget'),reset?.at?fullDate(reset.at):reset?.interval?interval(reset.interval)+' · date non communiquée':'Non communiqué');
      if(usage?.dailyRequests)row('Modèles gratuits · aujourd’hui',integer(usage.dailyRequests.remaining)+' / '+integer(usage.dailyRequests.limit)+' requêtes restantes');
    }
    get('usage-message').textContent=detail==='messages'?'Historique complet, y compris les échanges des jours précédents. Les appels d’outils sont exclus.':detail==='context'?'Estimation des instructions, souvenirs, historique et outils préparés avant le dernier appel. La réponse et le prochain brouillon ne sont pas inclus.':loading?'Lecture des compteurs du fournisseur…':usage?.message||'Sélectionne un fournisseur et un modèle.';
    get('usage-observed').textContent=['credits','reset'].includes(detail)&&usage?'Source : '+usage.source+' · '+fullDate(usage.observedAt):'';
    get('usage-observed').hidden=!get('usage-observed').textContent;
    const link=get('usage-dashboard');link.hidden=!usage?.dashboardUrl||!['credits','reset'].includes(detail);if(usage?.dashboardUrl)link.href=usage.dashboardUrl;
    get('usage-done').hidden=!['context','messages'].includes(detail);
    const button=get('refresh-usage');button.hidden=['context','messages'].includes(detail);button.disabled=loading;button.textContent=loading?'Actualisation…':'Actualiser';
  }
  async function refresh(force=false){
    if(!selection.conversationId||document.hidden)return;
    if(!force&&(loading||Date.now()-fetchedAt<60000))return;
    const version=++requestVersion, target={...selection};loading=true;render();
    try{
      const query=new URLSearchParams({provider:target.provider||'demo',modelId:target.modelId||'',...(force?{refresh:'1'}:{})});
      const response=await fetch('/api/provider-usage?'+query,{credentials:'same-origin'});if(!response.ok)throw new Error('Usage unavailable');
      const value=await response.json();if(version!==requestVersion)return;
      usage=value;fetchedAt=Date.now();
    }catch{if(version===requestVersion){usage={message:'Compteurs indisponibles. Tu peux réessayer.',source:'Connexion Heart',observedAt:new Date().toISOString()};fetchedAt=Date.now();}}
    finally{if(version===requestVersion){loading=false;render();}}
  }
  window.heartUsage={
    selection(value){
      const changed=selection.provider!==value.provider||selection.modelId!==value.modelId||selection.accountKey!==value.accountKey;
      selection=value;
      if(changed){requestVersion++;loading=false;usage=null;fetchedAt=0;}
      render();void refresh();
    },
    conversation(value){
      const previous=conversation?.events?.findLast(event=>event.type==='run.completed')?.id;
      const next=value.events?.findLast(event=>event.type==='run.completed')?.id;
      const same=conversation?.conversation?.id===value.conversation?.id;
      conversation=value;render();void refresh(same&&!!next&&next!==previous);
    }
  };
  document.querySelectorAll('[data-usage-detail]').forEach(button=>button.addEventListener('click',()=>{detail=button.dataset.usageDetail;dialog.showModal();render();void refresh();}));
  get('close-usage').addEventListener('click',()=>dialog.close());
  get('usage-done').addEventListener('click',()=>dialog.close());
  get('refresh-usage').addEventListener('click',()=>void refresh(true));
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  setInterval(()=>{if(document.body.classList.contains('chat-mode'))void refresh();},60000);
})();
