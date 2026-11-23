(() => {
  const paintIcons=window.heartIcons.render;
  const el = (id) => document.getElementById(id);
  el("toggle-login-token").addEventListener("click", () => {
    const visible = el("password").type === "password";
    el("password").type = visible ? "text" : "password";
    el("toggle-login-token").setAttribute("aria-pressed", String(visible));
    el("toggle-login-token").setAttribute(
      "aria-label",
      visible ? "Masquer le token" : "Afficher le token",
    );
  });
  const defaults = {
    name: "Nora",
    gender: "feminine",
    avatar: "nora",
    theme: "light",
    personality: "warm",
    length: "balanced",
    initiative: "discreet",
    animations: false,
    step: 0,
    completed: false,
  };
  let profile = { settings: { ...defaults }, version: 0 },
    draft = { ...defaults },
    step = 0,
    offered = false,
    route = "home",
    records = [],
    events = [],
    selectedProject = null;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const titles = {
    home: "Aujourd’hui",
    conversations: "Discussions",
    projects: "Projets",
    memories: "Mémoire",
    more: "Plus",
    models: "Fournisseurs",
    tools: "Capacités",
    lab: "Atelier de test",
    settings: "Configuration",
    consumption: "Consommation",
    automations: "Tâches",
    files: "Fichiers",
    backups: "Sauvegardes",
  };
  function text(tag, content, cls) {
    const node = document.createElement(tag);
    node.textContent = content;
    if (cls) node.className = cls;
    return node;
  }
  function theme(value) {
    document.documentElement.dataset.theme =
      value === "system" ? (system.matches ? "night" : "light") : value;
  }
  function presets(){return state.assistantPresets||{avatarPacks:[],personalityTemplates:[]};}
  function selectedPack(id){return presets().avatarPacks.find(pack=>pack.id===id)||presets().avatarPacks[0];}
  let appliedPack = "";
  function applyPack(id){
    const pack=selectedPack(id);if(!pack)return;
    const key=JSON.stringify(pack.assets);if(key===appliedPack)return;appliedPack=key;
    document.documentElement.style.setProperty('--assistant-logo','url("'+pack.assets.logo+'")');
    document.documentElement.style.setProperty('--assistant-portrait','url("'+pack.assets.conversationAvatar+'")');
    document.querySelectorAll('[data-assistant-logo]').forEach(img=>img.src=pack.assets.logo);
    const favicon=document.querySelector('link[rel=icon]');if(favicon)favicon.href=pack.assets.logo;
  }
  function packPreview(target,id){
    const pack=selectedPack(id);target.replaceChildren();if(!pack)return;
    const images=document.createElement('div');images.className='pack-preview-images';
    for(const [key,label] of [['logo','Logo'],['conversationAvatar','Conversation']]){const figure=document.createElement('figure'),img=document.createElement('img');img.src=pack.assets[key];img.alt=label;img.width=40;img.height=40;figure.append(img,text('figcaption',label));images.append(figure);}
    const copy=document.createElement('div');copy.append(text('strong',pack.name),text('p',pack.description,'field-help'));target.append(images,copy);
  }
  function picture() {
    applyPack(profile.settings.avatarPackId);
    window.heartControls?.sync();
    const s = profile.settings,
      busy = conversationRunning || !!window.heartChatTools?.busy() || running;
    const last = events
      .filter((event) => event.type === "message" && event.data.role !== "tool")
      .at(-1);
    const status = busy
      ? "working"
      : route === "conversations" && last?.data.role === "assistant"
        ? "waiting"
        : "idle";
    document
      .querySelectorAll("#discussion-cards button, #home-discussions button")
      .forEach((button) => (button.disabled = conversationLoading));
    const label = busy
      ? `${s.name} travaille…`
      : status === "waiting"
        ? `${s.name} attend ta réponse`
        : `${s.name} · Disponible`;
    if (el("assistant-status").textContent !== label) el("assistant-status").textContent = label;
    if (el("home-presence").textContent !== label) el("home-presence").textContent = label;
    if (el("chat-name").textContent !== s.name) el("chat-name").textContent = s.name;
    el("conversation-prompt").placeholder = `Écrire à ${s.name}`;
    document
      .querySelectorAll("[data-assistant-name]")
      .forEach((node) => { if (node.textContent !== s.name) node.textContent = s.name; });
    window.heartChatTools?.sync();
    el("composer-status").textContent = busy
      ? "Réponse en cours…"
      : window.heartInteractions?.pending()?"Réponds au formulaire":"Prêt à échanger";
  }
  function row(title, subtitle, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item-row";
    const span = document.createElement("span");
    span.append(text("strong", title));
    if (subtitle) span.append(text("small", subtitle));
    button.append(span, text("i", "›"));
    button.addEventListener("click", action);
    return button;
  }
  function empty(target, label) {
    target.append(text("p", label, "field-help"));
  }
  function discussionProjects() {
    const filter=el("discussion-project-filter"), selected=filter.value;
    const projects=new Map(memoryProjects.map(project=>[project.id,project.title]));
    for(const item of records)if(item.projectId&&!projects.has(item.projectId))projects.set(item.projectId,"Projet indisponible");
    const choices=[["","Tous les projets"],["none","Sans projet"],...projects];
    const signature=JSON.stringify(choices);
    if(filter.dataset.choices===signature)return;
    filter.dataset.choices=signature;
    filter.replaceChildren(...choices.map(([value,label])=>new Option(label,value)));
    filter.value=choices.some(([value])=>value===selected)?selected:"";
    window.heartControls?.sync();
  }
  function discussions() {
    discussionProjects();
    const query = el("discussion-search").value.trim().toLocaleLowerCase();
    const projectId=el("discussion-project-filter").value;
    const providers={chatgpt:"ChatGPT",openrouter:"OpenRouter",venice:"Venice AI",openai:"OpenAI",anthropic:"Anthropic",demo:"Simulation"};
    const efforts={low:"faible",medium:"moyen",high:"élevé",xhigh:"très élevé",max:"max",ultra:"ultra"};
    for (const id of ["discussion-cards", "home-discussions"]) {
      const target = el(id);
      target.replaceChildren();
      const items=id==="home-discussions"?records.slice(0,4):records.filter(item=>
        (!projectId||(projectId==="none"?!item.projectId:item.projectId===projectId))&&item.title.toLocaleLowerCase().includes(query));
      for (const item of items) {
        const project = memoryProjects.find((p) => p.id === item.projectId);
        const projectName=project?.title || (item.projectId?"Projet indisponible":"Sans projet");
        const entry = row(item.title, projectName, () => {
          location.hash = "conversations";
          el("conversation-list").value = item.id;
          void openConversation(item.id).catch((e) => message(errorText(e), true));
        });
        entry.dataset.conversationId=item.id;
        if(id==="discussion-cards"){
          const copy=entry.firstElementChild;
          copy.classList.add("discussion-copy");
          const projectLabel=copy.querySelector("small");
          projectLabel.className="discussion-project";projectLabel.title=projectName;
          projectLabel.setAttribute("aria-label","Projet : "+projectName);
          const selection=item.selection;
          const model=selection?(selection.provider==="demo"?"Simulation":(providers[selection.provider]||selection.provider)+" · "+selection.modelId):"Modèle à choisir";
          const effort=selection?.reasoningEffort?(efforts[selection.reasoningEffort]||selection.reasoningEffort):selection?.provider==="chatgpt"?"auto":"—";
          const meta=text("span","","discussion-model-row");
          const modelLabel=text("span",model,"discussion-model");modelLabel.title=model;modelLabel.setAttribute("aria-label","Modèle : "+model);
          const effortLabel=text("span","Effort "+effort,"discussion-effort");effortLabel.title="Effort de raisonnement : "+(effort==="—"?"non configuré pour ce modèle":effort);
          meta.append(modelLabel,effortLabel);copy.append(meta);
        }
        entry.classList.toggle("active", item.id === conversationId);
        if (item.id === conversationId)entry.setAttribute("aria-current", "true");
        target.append(entry);
      }
      if (!items.length)empty(target,records.length?"Aucune discussion ne correspond.":"Tes prochaines discussions apparaîtront ici.");
    }
    window.heartWork?.paint();
  }
  function projectDetails(id) {
    selectedProject = id;
    const p = memoryProjects.find((item) => item.id === id),
      target = el("project-detail");
    if (!p) return;
    el("screen-projects").classList.add("project-open");
    target.hidden = false;
    const heading = document.createElement("header");
    heading.className = "page-heading";
    const copy = document.createElement("div");
    copy.className = "page-heading-copy";
    copy.append(
      text("h1", p.title),
      text("p", "Objectifs, étapes et résultats.", "page-subtitle"),
    );
    const icon = document.createElement("span");
    icon.className = "page-heading-icon";
    icon.dataset.icon = "projects";
    icon.setAttribute("aria-hidden", "true");
    const actions = document.createElement("div");
    actions.className = "page-actions";
    heading.append(icon, copy, actions);
    paintIcons(heading);
    target.replaceChildren(heading);
    const back = text("button", "Tous les projets", "text-button");
    back.addEventListener("click", () => {
      selectedProject = null;
      window.heartProjects?.reset();
      target.hidden = true;
      el("screen-projects").classList.remove("project-open");
    });
    target.prepend(back);
    const button = text("button", "", "page-create");
    button.dataset.icon = "add";
    button.title = "Nouvelle conversation";
    button.setAttribute("aria-label", "Nouvelle conversation");
    paintIcons(button);
    button.addEventListener("click", () => {
      el("screen-conversations").classList.remove("chat-open");
      location.hash = "conversations";
      el("conversation-project").value = id;
      window.heartControls?.sync();
      openEditor("conversation-dialog", "conversation-title");
    });
    actions.append(button);
    const tracking=document.createElement('section');tracking.className='project-tracking';target.append(tracking);window.heartProjects?.open(id,tracking);
    target.append(text('h3','Conversations'));
    const threads = records.filter((item) => item.projectId === id);
    for (const item of threads)
      target.append(
        row(item.title, "Discussion", () => {
          location.hash = "conversations";
          void openConversation(item.id).catch((e) =>
            message(errorText(e), true),
          );
        }),
      );
    const memories = memoryRecords.filter(
      (item) => item.projectId === id && item.status === "active",
    );
    target.append(
      text(
        "h3",
        `${memories.length} souvenir${memories.length !== 1 ? "s" : ""} en mémoire`,
      ),
    );
    for (const item of memories.slice(0, 5))
      target.append(text("p", item.title));
    const showMemory = text(
      "button",
      "Voir les souvenirs du projet",
      "button secondary",
    );
    showMemory.addEventListener("click", () => {
      location.hash = "memories";
      el("memory-filter-scope").value = id;
      renderMemories();
    });
    target.append(showMemory);
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function projects() {
    for (const id of ["project-cards", "home-projects"]) {
      const target = el(id);
      target.replaceChildren();
      for (const p of memoryProjects.slice(
        0,
        id === "home-projects" ? 3 : memoryProjects.length,
      )) {
        target.append(
          row(
            p.title,
            [({planning:"À préparer",active:"En cours",blocked:"Bloqué",paused:"En pause",completed:"Terminé",archived:"Archivé"})[p.status],p.objective].filter(Boolean).join(" · ") || "Objectif à préciser",
            () => {
              location.hash = "projects";
              projectDetails(p.id);
            },
          ),
        );
      }
      if (!memoryProjects.length)
        empty(target, "Crée un projet pour regrouper tes échanges.");
    }
    if (selectedProject && route === "projects")
      projectDetails(selectedProject);
  }
  let navigationHash="";
  function navigate() {
    refreshStaleCatalog();
    const hash = location.hash.slice(1),
      alias = { instructions:"settings","settings-assistant":"settings","settings-conversations":"settings","settings-instructions":"settings","settings-policies":"settings", providers:"models", playground: "lab", modules: "tools", "tools-skills": "tools", "tools-connections": "tools", checks: "lab" };
    const previousRoute=route;
    route = alias[hash] || hash;
    if (!titles[route])
      route = new URLSearchParams(location.search).has("conversation")
        ? "conversations"
        : "home";
    document
      .querySelectorAll("[data-screen]")
      .forEach((node) => {const hidden=node.dataset.screen!==route;if(node.hidden!==hidden)node.hidden=hidden;});
    document.querySelectorAll("[data-nav]").forEach((link) => {
      const active = link.dataset.nav === route;
      link.classList.toggle("active", active);
      if (active&&link.getAttribute("aria-current")!=="page") link.setAttribute("aria-current", "page");
      else if(!active&&link.hasAttribute("aria-current")) link.removeAttribute("aria-current");
    });
    if(previousRoute!==route){el('model-preferences-dialog').close();el('context-dialog').close();if(previousRoute==='settings'&&!assistantSaving)el('assistant-dialog').close();}
    document.body.classList.toggle('memory-list-mode',state.authenticated&&route==='memories');
    window.heartPreferences?.route(route,previousRoute);
    window.heartCapabilities?.route(route === "tools" ? hash : "");
    window.heartConfiguration?.route(route === "settings" ? hash : "");
    el("page-label").textContent = "Espace personnel";
    const title=`${titles[route]} · Nora Heart`;if(document.title!==title)document.title=title;
    el("screen-conversations").querySelector("#conversations").hidden =
      !state.conversationsAvailable;
    el("screen-memories").querySelector("#memories").hidden =
      !state.memoriesAvailable;
    el("navigation-dialog").close();
    el("sessions-dialog").close();
    picture();
    if(previousRoute!==route||navigationHash!==hash)window.scrollTo(0,0);
    navigationHash=hash;
    window.heartChat?.layout();
  }
  function sync() {
    if(state.authenticated&&state.installation?.available&&!el('manage-installation-services')){
      const button=text('button','','icon-button');button.id='manage-installation-services';button.type='button';button.dataset.icon='settings';button.title='Configurer les services partagés';button.setAttribute('aria-label',button.title);
      button.onclick=()=>{let dialog=el('installation-dialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='installation-dialog';dialog.className='editor-dialog';dialog.setAttribute('aria-label','Services partagés');document.body.append(dialog);}dialog.replaceChildren();const content=document.createElement('div');content.className='editor-scroll';renderInstallationServices(content);const close=text('button','Fermer','button secondary');close.type='button';close.onclick=()=>dialog.close();dialog.append(content,close);dialog.showModal();};
      el('mcp-add').parentNode.append(button);paintIcons();
    }
    if (!state.authenticated) {
      window.heartChat?.reset();
      window.heartInstructions?.reset();
      window.heartPolicies?.reset();
      window.heartSkills?.reset();
      window.heartTasks?.reset();
      records = [];
      events = [];
      for (const id of [
        "home-discussions",
        "discussion-cards",
        "project-cards",
        "home-projects",
      ])
        el(id).replaceChildren();
      document
        .querySelectorAll(".editor-dialog[open]")
        .forEach((dialog) => dialog.close());
      el("navigation-dialog").close();
      el("sessions-dialog").close();
      el("setup-dialog").close();
      el("context-dialog").close();
      offered = false;
      profile = { settings: { ...defaults }, version: 0 };
      theme("light");
      appliedPack = "";
      document.documentElement.style.removeProperty("--assistant-logo");document.documentElement.style.removeProperty("--assistant-portrait");
      return;
    }
    if (state.assistant) {
      profile = state.assistant;
      theme(profile.settings.theme);
    }
    el("settings-assistant-name").textContent = profile.settings.name;
    el("settings-summary").textContent = `${{feminine:"Féminin",masculine:"Masculin",neutral:"Neutre"}[profile.settings.gender]} · ${profile.settings.personalityInstructions||"Personnalité libre"}`;
    el("assistant-presentation-preview").textContent = profile.presentationInstructions||"";
    el("theme-choice").value = profile.settings.theme;
    el("appearance-summary").textContent=({light:"Clair",night:"Nocturne",sage:"Sauge",graphite:"Graphite",system:"Selon ton appareil"}[profile.settings.theme]||profile.settings.theme);
    window.heartPolicies?.sync();
    window.heartSkills?.sync();
    window.heartTasks?.sync();
    el("edit-assistant").disabled = !state.assistant;
    el("save-appearance").disabled = !state.assistant;
    navigate();
    if (state.assistant && !profile.settings.completed && !offered) {
      offered = true;
      openSetup();
    }
  }
  let assistantBase=null,assistantTemplateOrigin='warm',assistantSaving=false;
  function openAssistantEditor(){
    assistantBase=structuredClone(profile);
    const s=assistantBase.settings;assistantTemplateOrigin=s.personality;
    el('assistant-editor-name').value=s.name;el('assistant-editor-gender').value=s.gender;
    el('assistant-avatar-pack').replaceChildren(...presets().avatarPacks.map(pack=>new Option(pack.name,pack.id)));el('assistant-avatar-pack').value=s.avatarPackId||presets().avatarPacks[0]?.id;
    el('assistant-personality-text').value=s.personalityInstructions||'';
    el('assistant-personality-template').replaceChildren(...presets().personalityTemplates.map(template=>new Option(template.name,template.id)));el('assistant-personality-template').value=s.personality;
    packPreview(el('assistant-pack-preview'),el('assistant-avatar-pack').value);
    el('assistant-dialog').querySelectorAll('details').forEach(detail=>detail.open=false);
    el('assistant-personality-status').textContent='';
    el('assistant-personality-reset').disabled=typeof assistantBase.personalityDefault!=='string';
    openEditor('assistant-dialog','assistant-editor-name');window.heartControls?.sync();
  }
  el('assistant-avatar-pack').addEventListener('change',()=>packPreview(el('assistant-pack-preview'),el('assistant-avatar-pack').value));
  el('assistant-apply-template').addEventListener('click',()=>{
    const template=presets().personalityTemplates.find(item=>item.id===el('assistant-personality-template').value);if(!template)return;
    el('assistant-personality-text').value=template.instructions;assistantTemplateOrigin=template.id;el('assistant-personality-status').textContent='Modèle chargé. Enregistre pour l’appliquer.';el('assistant-personality-text').focus();
  });
  el('assistant-personality-text').addEventListener('input',()=>{el('assistant-personality-status').textContent='';});
  el('assistant-personality-reset').addEventListener('click',()=>{
    if(!assistantBase||assistantSaving)return;
    el('assistant-personality-text').value=assistantBase.personalityDefault||'';
    assistantTemplateOrigin=assistantBase.settings.personality;
    el('assistant-personality-template').value=assistantTemplateOrigin;
    el('assistant-personality-status').textContent='Personnalité par défaut chargée. Enregistre pour l’appliquer.';
  });
  el('assistant-editor').addEventListener('submit',async event=>{
    event.preventDefault();if(assistantSaving||!assistantBase)return;assistantSaving=true;
    const before=assistantBase.settings,patch={name:el('assistant-editor-name').value.trim(),gender:el('assistant-editor-gender').value,avatarPackId:el('assistant-avatar-pack').value,personality:assistantTemplateOrigin,personalityInstructions:el('assistant-personality-text').value};
    const base=Object.fromEntries(Object.keys(patch).map(key=>[key,before[key]]));
    try{
      const result=await post('/api/assistant',{version:assistantBase.version,patch,base});profile=result;state.assistant=result;
      el('assistant-dialog').close();sync();message('Identité et personnalité enregistrées.');
    }catch(error){message(errorText(error),true);}
    finally{assistantSaving=false;}
  });
  function openSetup() {
    draft = { ...profile.settings };
    step = draft.completed ? 0 : draft.step;
    if (step === 1) step = 2; // Resume past the retired avatar step.
    showStep();
    el("setup-dialog").showModal();
  }
  function choice(name, value, label, checked, swatch) {
    const node = document.createElement("label");
    node.className = "choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = value;
    input.checked = checked;
    input.setAttribute("aria-label", label);
    node.append(input);
    if (swatch) {
      const sample = document.createElement("span");
      sample.className = "theme-swatch";
      sample.style.background = swatch;
      node.append(sample);
    }
    node.append(text("span", label));
    return node;
  }
  function selectField(target, id, label, items, value) {
    const labelNode = text("label", label);
    labelNode.htmlFor = id;
    const select = document.createElement("select");
    select.id = id;
    for (const [key, title] of Object.entries(items)) {
      const option = text("option", title);
      option.value = key;
      select.append(option);
    }
    select.value = value;
    target.append(labelNode, select);
    return select;
  }
  function capture() {
    const target = el("setup-content");
    if (step === 0) {
      draft.name = el("setup-name").value.trim();
      draft.gender = target.querySelector("[name=gender]:checked").value;
      draft.avatarPackId=el("setup-avatar-pack").value;
    }
    if (step === 2) {
      draft.theme = target.querySelector("[name=theme]:checked").value;
      theme(draft.theme);
    }
    if (step === 3) {
      draft.personality = el("setup-personality").value;
      draft.personalityInstructions=el("setup-personality-text").value;
    }
  }
  function showStep() {
    const target = el("setup-content");
    target.replaceChildren();
    el("setup-progress").textContent =
      `${[0, 2, 3, 4, 5].indexOf(step) + 1} / 5`;
    el("setup-back").disabled = step === 0;
    el("setup-next").hidden = step === 4;
    el("setup-next").textContent = step === 5 ? "Commencer" : "Continuer";
    el("setup-error").hidden = true;
    const headings = [
      "Comment s’appelle ton assistant ?",
      null,
      "Quel univers pour ton espace ?",
      "Comment aimerais-tu échanger ?",
      "Connecter un fournisseur",
      state.installation?.available?"Vérifier la configuration":"Tout est prêt.",
    ];
    target.append(text("h1", headings[step]));
    if (step === 0) {
      const label = text("label", "Son nom");
      label.htmlFor = "setup-name";
      const input = document.createElement("input");
      input.id = "setup-name";
      input.value = draft.name;
      input.required = true;
      input.maxLength = 60;
      target.append(
        label,
        input,
        text("label", "Quel genre pour les échanges ?"),
      );
      const grid = document.createElement("div");
      grid.className = "choice-grid";
      for (const [value, label] of Object.entries({
        feminine: "Féminin",
        masculine: "Masculin",
        neutral: "Neutre",
      }))
        grid.append(choice("gender", value, label, draft.gender === value));
      target.append(
        grid,
        text(
          "p",
          "Le genre définit la façon dont ton assistant se présente.",
          "setup-subtitle",
        ),
      );
    }
    if(step===0){
      selectField(target,'setup-avatar-pack','Pack d’avatar',Object.fromEntries(presets().avatarPacks.map(pack=>[pack.id,pack.name])),draft.avatarPackId||presets().avatarPacks[0]?.id);
      const preview=document.createElement('div');preview.className='assistant-pack-preview';packPreview(preview,el('setup-avatar-pack').value);target.append(preview);
      el('setup-avatar-pack').addEventListener('change',()=>packPreview(preview,el('setup-avatar-pack').value));
    }
    if (step === 2) {
      target.append(
        text("p", "Le thème habille toute l’interface.", "setup-subtitle"),
      );
      const grid = document.createElement("div");
      grid.className = "choice-grid";
      for (const [key, label, color] of [
        ["light", "Clair", "#dceee8"],
        ["night", "Nocturne", "#17211f"],
        ["sage", "Sauge", "#e3eddc"],
        ["graphite", "Graphite", "#393535"],
        [
          "system",
          "Système",
          "linear-gradient(120deg,#dceee8 50%,#17211f 50%)",
        ],
      ]) {
        const node = choice("theme", key, label, draft.theme === key, color);
        node
          .querySelector("input")
          .addEventListener("change", () => theme(key));
        grid.append(node);
      }
      target.append(grid);
    }
    if (step === 3) {
      selectField(
        target,
        "setup-personality",
        "Personnalité",
        {
          professional: "Professionnel · clair et structuré",
          warm: "Chaleureux · calme et attentif",
          direct: "Direct · concis et concret",
          creative: "Créatif · ouvert et précis",
        },
        draft.personality,
      );
      const label=text('label','Personnalité et instructions');label.htmlFor='setup-personality-text';const instructions=document.createElement('textarea');instructions.id='setup-personality-text';instructions.rows=7;instructions.value=draft.personalityInstructions??presets().personalityTemplates.find(item=>item.id===draft.personality)?.instructions??'';
      target.append(label,instructions,text('p','Le modèle de départ remplit ce texte. Tu peux ensuite le personnaliser.','field-help'));
      el('setup-personality').addEventListener('change',()=>{instructions.value=presets().personalityTemplates.find(item=>item.id===el('setup-personality').value)?.instructions||'';});
    }
    if (step === 4) {
      target.append(
        text(
          "p",
          "Ton assistant reste le même quand tu changes de modèle. Aucun appel n’est lancé pendant cette configuration.",
          "setup-subtitle",
        ),
      );
      const actions = document.createElement("div");
      actions.className = "setup-actions";
      const connect = text(
        "button",
        "Connecter un fournisseur",
        "button primary",
      );
      connect.type = "button";
      connect.addEventListener("click", async () => {
        try {
          await saveDraft(4, false);
          el("setup-dialog").close();
          location.hash = "models";
          message(
            "Choisis ton modèle ici. Les réglages permettent de reprendre la configuration.",
          );
        } catch (e) {
          setupError(e);
        }
      });
      const demo = text(
        "button",
        "Explorer en simulation locale",
        "button secondary",
      );
      demo.type = "button";
      demo.addEventListener("click", async () => {
        try {
          document.querySelector("[name=provider][value=demo]").checked = true;
          renderProvider();
          await saveDraft(5, false);
          step = 5;
          showStep();
        } catch (e) {
          setupError(e);
        }
      });
      const chosen=profile.settings.conversationDefaults?.selection;
      const provider = chosen?.provider||selectedProvider();
      const available = provider !== "demo" && (chosen?!!(provider==='chatgpt'?state.chatgpt?.connected:state.api?.[provider]):modelAvailable());
      if (available) {
        const use = text(
          "button",
          `Utiliser ${names[provider]}`,
          "button primary",
        );
        use.type = "button";
        use.addEventListener("click", async () => {
          try {
            if(chosen)await applyConversationSelection(chosen);
            await saveDraft(5, false);
            step = 5;
            showStep();
          } catch (e) {
            setupError(e);
          }
        });
        actions.append(use);
      }
      const choose=text('button','Choisir le modèle et l’effort','button secondary');choose.type='button';
      choose.onclick=async()=>{try{await saveDraft(4,false);el('setup-dialog').close();location.hash='settings-conversations';setTimeout(()=>el('edit-conversation-defaults').click(),0);}catch(e){setupError(e);}};
      actions.append(connect, choose, demo);
      target.append(actions);
    }
    if (step === 5) {
      target.append(text("h2", draft.name));
      const summary = document.createElement("div");
      summary.className = "setup-summary";
      summary.append(
        text(
          "p",
          `${{ feminine: "Féminin", masculine: "Masculin", neutral: "Neutre" }[draft.gender]} · ${{ professional: "Professionnel", warm: "Chaleureux", direct: "Direct", creative: "Créatif" }[draft.personality]}`,
        ),
        text(
          "p",
          `Thème : ${{ light: "Clair", night: "Nocturne", sage: "Sauge", graphite: "Graphite", system: "Système" }[draft.theme]}`,
        ),
        text("p", `Cerveau : ${names[draft.conversationDefaults?.selection?.provider||selectedProvider()]}${draft.conversationDefaults?.selection?.modelId?' · '+draft.conversationDefaults.selection.modelId:''}`),
      );
      target.append(
        summary,
        text(
          "p",
          "Tout reste modifiable dans Mon assistant et Apparence.",
          "setup-subtitle",
        ),
      );
      if(state.installation?.available)renderInstallationServices(target);
    }
  }
  function renderInstallationServices(target){
    if(state.installation.account){const section=document.createElement('section');section.className='editor-fields';section.append(text('h2','Compte connecté'),text('p',state.installation.account.email),text('p','Services MCP configurés automatiquement.','field-help'));target.append(section);return;}

    const section=document.createElement('section');section.className='editor-fields';const prefix=target.closest('#setup-dialog')?'':'managed-',inputs={};
    section.append(text('h2','Services partagés'));
    section.append(text('p','Mémoire, projets et coffre restent sur ton serveur MCP. Connecte-les ici ou configure-les plus tard.','field-help'));
    const configured=state.installation.services||[];
    if(configured.length)section.append(text('p','Connectés : '+configured.join(', '),'field-help'));
    const base=document.createElement('input');base.id=prefix+'install-services-url';base.type='url';base.value='https://mcps.natio.re';base.autocomplete='url';
    const label=text('label','Serveur MCP');label.htmlFor=base.id;section.append(label,base);
    for(const [name,title] of [['memory','Clé Mémoire'],['projects','Clé Projets'],['vault','Clé Coffre-fort']]){
      const input=document.createElement('input');input.id=prefix+'install-key-'+name;inputs[name]=input;input.type='password';input.autocomplete='new-password';input.placeholder=configured.includes(name)?'Déjà connecté · laisser vide pour conserver':'Facultatif';
      const label=text('label',title);label.htmlFor=input.id;section.append(label,input);
    }
    const status=text('p','','field-help');status.id=prefix+'install-services-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const connect=text('button','Connecter et vérifier','button secondary');connect.type='button';connect.id=prefix+'install-services-connect';
    connect.onclick=async()=>{
      connect.disabled=true;el('setup-next').disabled=true;el('setup-back').disabled=true;status.textContent='Vérification des connexions…';section.setAttribute('aria-busy','true');
      try{
        const body={};for(const name of ['memory','projects','vault']){const token=inputs[name].value.trim();if(token)body[name]={url:base.value.replace(/\/+$/,'')+'/'+name,token};}
        if(!Object.keys(body).length)throw Error('Saisis au moins une clé.');
        await post('/api/installation/services',body);
        for(const name of ['memory','projects','vault'])inputs[name].value='';
        status.textContent='Connexions vérifiées. Redémarrage de Heart…';
        await new Promise(r=>setTimeout(r,1200));
        const until=Date.now()+45000;let ready=false;
        while(Date.now()<until){try{const next=await api('/api/state');if(next.authenticated&&next.installation?.ready&&Object.keys(body).every(s=>next.installation?.services.includes(s))){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
        if(!ready)throw Error('Configuration enregistrée. Actualise lorsque le service est redémarré.');
        location.reload();
      }catch(e){status.textContent=errorText(e);connect.disabled=false;el('setup-next').disabled=false;el('setup-back').disabled=false;section.removeAttribute('aria-busy');}
    };
    section.append(connect,status);target.append(section);
  }
  function setupError(e) {
    el("setup-error").textContent = errorText(e);
    el("setup-error").hidden = false;
  }
  async function saveDraft(next, completed) {
    if(step===4&&next===5){
      const provider=selectedProvider(),modelId=provider==='demo'?'demo':el('model-id').value.trim();
      if(provider!=='demo'&&!modelAvailable())throw Error('Connecte le fournisseur et choisis un modèle avant de continuer.');
      const catalog=models.find(model=>model.id===modelId),contextWindow=provider==='demo'?32768:Number(el('context-window').value);
      draft.conversationDefaults={...(draft.conversationDefaults||{fileAccess:'read',networkAccess:false}),selection:{provider,modelId,contextWindow,capacitySource:catalog?.contextWindow?'catalog':'configured',...(selectedReasoningEffort()?{reasoningEffort:selectedReasoningEffort()}: {})}};
    }
    const result = await post("/api/assistant", {
      settings: {
        ...draft,
        step: next,
        completed: completed || profile.settings.completed,
      },
      version: profile.version,
    });
    profile = result;
    state.assistant = result;
    draft = { ...result.settings };
    return result;
  }
  el("setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    capture();
    el("setup-next").disabled = true;
    try {
      const last = step === 5;
      const next = last ? 5 : step === 0 ? 2 : step + 1;
      await saveDraft(next, last);
      if (last) {
        el("setup-dialog").close();
        location.hash = "home";
        sync();
      } else {
        step = next;
        showStep();
      }
    } catch (e) {
      setupError(e);
    } finally {
      el("setup-next").disabled = false;
    }
  });
  el("setup-back").addEventListener("click", () => {
    capture();
    step = step === 2 ? 0 : Math.max(0, step - 1);
    showStep();
  });
  el("setup-later").addEventListener("click", () => {
    el("setup-dialog").close();
    theme(profile.settings.theme);
  });
  el("profile-button").addEventListener("click", () => {
    if (state.assistant) {if(profile.settings.completed)location.hash='settings-assistant';else openSetup();}
    else location.hash = "settings";
  });
  el("edit-assistant").addEventListener("click",()=>profile.settings.completed?openAssistantEditor():openSetup());
  el("appearance-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    el("save-appearance").disabled = true;
    try {
      profile = await post("/api/assistant", {
        patch: {theme: el("theme-choice").value},
        base: {theme:profile.settings.theme},
        version: profile.version,
      });
      state.assistant = profile;
      el("appearance-dialog").close();
      sync();
      message("Apparence enregistrée pour cet espace.");
    } catch (e) {
      message(errorText(e), true);
    } finally {
      el("save-appearance").disabled = false;
    }
  });
  el("theme-choice").addEventListener("change", () =>
    theme(el("theme-choice").value),
  );
  function openSettings(section="model") {
    const dialog=el("context-dialog");
    if(!dialog.open){window.heartWorkspace?.prepareSettings();dialog.showModal();refreshStaleCatalog();}
    for(const panel of dialog.querySelectorAll('[role="tabpanel"]'))panel.hidden=panel.id!=="settings-"+section;
    for(const tab of dialog.querySelectorAll('[role="tab"]')){const active=tab.dataset.settingsSection===section;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
    el('context-dialog').querySelector('.settings-scroll').scrollTop=0;
  }
  window.heartSettings={open:openSettings};

  document.querySelectorAll('[data-close-model-preferences]').forEach(button=>button.addEventListener('click',()=>el('model-preferences-dialog').close()));
  el('context-dialog').addEventListener('keydown',event=>{
    const tab=event.target.closest('[role="tab"]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...el('context-dialog').querySelectorAll('[role="tab"]')];let i=tabs.indexOf(tab);
    i=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    event.preventDefault();openSettings(tabs[i].dataset.settingsSection);tabs[i].focus();
  });
  el("choose-brain").addEventListener("click",()=>window.heartConversationModel.open());
  el("edit-conversation-model").addEventListener("click",()=>window.heartConversationModel.open());
  el("use-brain").addEventListener("click",()=>el("context-dialog").close());
  document.querySelectorAll('[data-settings-section]').forEach(button=>button.addEventListener('click',()=>openSettings(button.dataset.settingsSection)));
  function openEditor(id, focusId) {
    const dialog = el(id);
    dialog.querySelectorAll(".dialog-feedback").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    if (!dialog.open) {
      const trigger = document.activeElement;
      dialog.addEventListener(
        "close",
        () => {
          if (document.activeElement !== document.body) return;
          const fallback = {
            "memory-dialog": "new-memory",
            "project-dialog": "new-project",
            "conversation-dialog": document.body.classList.contains("chat-mode")
              ? "chat-back"
              : "new-conversation",
            "appearance-dialog": "edit-appearance",
            "assistant-dialog": "edit-assistant",
            "instruction-dialog": "instructions-refresh",
          }[id];
          const target =
            trigger?.isConnected && trigger.getClientRects().length
              ? trigger
              : el(fallback);
          target?.focus();
        },
        { once: true },
      );
      dialog.showModal();
    }
    window.heartControls?.sync();
    if (focusId) el(focusId).focus();
  }
  el("new-memory").addEventListener("click", () => {
    resetMemoryEditor();
    openEditor("memory-dialog", "memory-title");
  });
  el("memory-cancel").addEventListener("click", () =>
    el("memory-dialog").close(),
  );
  el("new-project").addEventListener("click", () =>
    openEditor("project-dialog", "project-title"),
  );
  function newConversation() {
    el("sessions-dialog").close();
    openEditor("conversation-dialog", "conversation-title");
  }
  el("new-conversation").addEventListener("click", newConversation);
  el("session-new-conversation").addEventListener("click", newConversation);
  el("home-new-conversation").addEventListener("click", newConversation);
  el("edit-appearance").addEventListener("click", () => {
    el("theme-choice").value = profile.settings.theme;
    el("appearance-summary").textContent=({light:"Clair",night:"Nocturne",sage:"Sauge",graphite:"Graphite",system:"Selon ton appareil"}[profile.settings.theme]||profile.settings.theme);
    openEditor("appearance-dialog", "theme-choice");
  });
  el("appearance-dialog").addEventListener("close", () =>
    theme(profile.settings.theme),
  );
  el("api-key-dialog").addEventListener("close", () => {
    el("api-key").value = "";
    el("api-key-editor").hidden = true;
  });
  document
    .querySelectorAll("[data-close-editor]")
    .forEach((button) =>
      button.addEventListener("click", () => button.closest("dialog").close()),
    );
  el("chat-back").addEventListener("click", () => {
    discussions();
    el("sessions-slot").append(el("conversation-controls"));
    el("sessions-dialog").showModal();
  });
  el("close-sessions").addEventListener("click", () =>
    el("sessions-dialog").close(),
  );
  el("sessions-dialog").addEventListener("close", () =>
    el("conversation-controls-slot").append(el("conversation-controls")),
  );
  el("sessions-dialog").addEventListener("click", (event) => {
    if (event.target !== el("sessions-dialog")) return;
    const rect = el("sessions-dialog").getBoundingClientRect();
    if (
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      el("sessions-dialog").close();
  });
  document.querySelectorAll("[data-nav=conversations]").forEach((link) =>
    link.addEventListener("click", () => {
      el("screen-conversations").classList.remove("chat-open");
      window.heartChat?.layout();
    }),
  );
  document.querySelectorAll("[data-list-conversations]").forEach((link) =>
    link.addEventListener("click", () => {
      el("screen-conversations").classList.remove("chat-open");
      window.heartChat?.layout();
    }),
  );
  let discussionTimer;
  function searchDiscussions(){clearTimeout(discussionTimer);discussionTimer=setTimeout(()=>void loadConversations().catch(()=>{}),200);}
  el("discussion-search").addEventListener("input",()=>{discussions();searchDiscussions();});
  el("discussion-project-filter").addEventListener("change",()=>{discussions();searchDiscussions();});
  for (const [key, title, subtitle] of [
    ["providers", "Fournisseurs", "Abonnement ChatGPT et clés API"],
    ["tools", "Capacités", "Outils, skills et connexions"],
    ["automations", "Tâches", "Planning et résultats"],
    ["consumption", "Consommation & budgets", "Fournisseurs connectés"],
    ["files", "Fichiers", "Navigateur à venir"],
    ["settings", "Réglages", "Ton assistant et son apparence"],
    ["backups", "Sauvegardes", "Contrôle à raccorder"],
  ])
    el("more-links").append(row(title, subtitle, () => (location.hash = key)));
  paintIcons();
  document
    .querySelectorAll("[data-open-navigation]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        el("navigation-dialog").showModal(),
      ),
    );
  el("close-navigation").addEventListener("click", () =>
    el("navigation-dialog").close(),
  );
  el("navigation-dialog").addEventListener("click", (event) => {
    if (event.target !== el("navigation-dialog")) return;
    const rect = el("navigation-dialog").getBoundingClientRect();
    if (
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      el("navigation-dialog").close();
  });
  el("navigation-dialog")
    .querySelectorAll("a")
    .forEach((link) =>
      link.addEventListener("click", () => {
        el("navigation-dialog").close();
        // Navigating to the already active route still closes the drawer.
        if (link.hash === location.hash) navigate();
      }),
    );
  el("today").textContent = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  window.addEventListener("hashchange", navigate);
  document.addEventListener("visibilitychange", picture);
  system.addEventListener("change", () => theme(profile.settings.theme));
  window.heartUI = {
    sync,
    resumeOnboarding:()=>{if(state.assistant&&!state.assistant.settings.completed&&state.assistant.settings.step===4){profile=state.assistant;openSetup();}},
    openEditor,
    picture,
    assistantName: () => profile.settings.name,
    renderIcons: paintIcons,
    openMemory: () => {
      openEditor("memory-dialog", "memory-title");
    },
    conversations(data) {
      records = data;
      discussions();
      projects();
    },
    memories() {
      discussions();
      projects();
    },
    conversation(data) {
      el("screen-conversations").classList.add("chat-open");

      events = data.events || [];
      picture();
    },
  };
  navigate();
  sync();
})();
