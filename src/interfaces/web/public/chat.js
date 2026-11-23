/* Presentation only: no API calls or access to credentials. */
(() => {
  const get = (id) => document.getElementById(id),
    history = get("conversation-history"),
    input = get("conversation-prompt");
  let atBottom = true,
    rendering = false,
    currentId = null,
    workspaceRoot = "";
  const drafts = new Map();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new marked.Renderer();
  renderer.image = ({ href, text }) =>
    `<a data-image-ref="true" href="${escape(href)}">${escape(text || "Ouvrir l’image")}</a>`;
  function escape(value) {
    return String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  }
  async function writeClipboard(text){return window.heartPlatform.copy(text);}
  function rich(node, content) {
    node.className = "markdown-body";
    node.dir = "auto";
    const math = window.heartMath?.create();
    const parser = math ? new marked.Marked({extensions:math.extensions}) : marked;
    const html = parser.parse(String(content), {
      gfm: true,
      breaks: true,
      renderer,
    });
    node.innerHTML = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [
        "img",
        "video",
        "audio",
        "iframe",
        "style",
        "form",
        "input",
        "button",
        "svg",
        "math",
      ],
      FORBID_ATTR: ["style", "id", "name"],
    });
    node.querySelectorAll("a").forEach((link) => {
      try {
        const url = new URL(link.getAttribute("href"), location.href);
        if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
          link.removeAttribute("href");
          return;
        }
        link.rel = "noopener noreferrer";
        link.target = "_blank";
      } catch {
        link.removeAttribute("href");
      }
    });
    math?.render(node);
    node.querySelectorAll("p, li, blockquote, h1, h2, h3, h4, h5, h6, th, td").forEach(block => block.dir = "auto");
    window.heartContent?.enhance(node, {conversationId:currentId, workspaceRoot});
    node.querySelectorAll("pre").forEach((pre) => {
      pre.dir = "ltr";
      const box = document.createElement("div");
      box.className = "code-block";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Copier";
      button.className = "copy-code";
      button.addEventListener("click", async () => {
        try {
          await writeClipboard(pre.textContent);
          button.textContent = "Copié";
        } catch {
          button.textContent = "Copie indisponible";
        }
      });
      pre.replaceWith(box);
      box.append(button, pre);
    });
  }
  function nearBottom() {
    return history.scrollHeight - history.scrollTop - history.clientHeight < 64;
  }
  function jump() {
    atBottom = true;
    history.scrollTo({ top: history.scrollHeight, behavior: "auto" });
    get("jump-latest").hidden = true;
  }
  history.addEventListener(
    "scroll",
    () => {
      if (rendering) return;
      atBottom = nearBottom();
      get("jump-latest").hidden = atBottom;
    },
    { passive: true },
  );
  get("jump-latest").addEventListener("click", jump);
  function viewport() {
    const vv = window.visualViewport;
    document.documentElement.style.setProperty(
      "--viewport-height",
      `${vv?.height || innerHeight}px`,
    );
    document.documentElement.style.setProperty(
      "--viewport-top",
      `${vv?.offsetTop || 0}px`,
    );
    const chat = get("screen-conversations");
    document.body.classList.toggle(
      "chat-mode",
      state.authenticated &&
        !chat.hidden &&
        chat.classList.contains("chat-open"),
    );
    document.body.classList.toggle("conversations-list-mode",state.authenticated&&!chat.hidden&&!chat.classList.contains("chat-open"));
    document.body.classList.toggle(
      "keyboard-open",
      innerHeight - (vv?.height || innerHeight) > 120,
    );
    if (atBottom && document.body.classList.contains("chat-mode"))
      requestAnimationFrame(() => {
        if (atBottom) jump();
      });
  }
  function resizeInput() {
    input.style.height = "auto";
    input.style.height = `${Math.min(140, Math.max(44, input.scrollHeight))}px`;
  }
  input.addEventListener("input", () => {
    resizeInput();
    if (currentId) drafts.set(currentId, input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      !matchMedia("(pointer:coarse)").matches
    ) {
      event.preventDefault();
      if (!get("conversation-submit").disabled && input.value.trim())
        get("conversation-send").requestSubmit();
    }
  });
  const openContext = () => {
    window.heartSettings?.open("model");
  };
  get("chat-context").addEventListener("click", openContext);
  get("close-context").addEventListener("click", () =>
    get("context-dialog").close(),
  );
  window.addEventListener("resize", viewport);
  window.visualViewport?.addEventListener("resize", viewport);
  window.visualViewport?.addEventListener("scroll", viewport);
  function element(tag, text, cls) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  const dateLabel = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const messageDate = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  function dayKey(at) {
    const date = new Date(at);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }
  function dayMarker(at) {
    const date = new Date(at),
      node = element("div", null, "chat-date-separator");
    node.dataset.day = dayKey(at);
    node.setAttribute("role", "separator");
    node.setAttribute("aria-label", dateLabel.format(date));
    const time = element("time", dateLabel.format(date));
    time.dateTime = date.toISOString();
    node.append(time);
    return node;
  }
  function activityPanel(data = {}) {
    return window.heartTurns.activity(data);
  }
  function tickActivity() {
    for (const node of history.querySelectorAll(".activity-elapsed")) {
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(node.dataset.startedAt)) / 1000),
      );
      const label =
        seconds < 60
          ? `${seconds} s`
          : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
      if (node.textContent !== label) node.textContent = label;
    }
  }
  setInterval(() => {
    if (!document.hidden) tickActivity();
  }, 1000);
  function message(role, content, at, attachments = [], eventId) {
    const node = element("article", null, `conversation-message ${role}`);
    if(eventId)node.dataset.eventId=eventId;
    const meta = element("div", null, "message-meta");
    const author = element(
      "span",
      null,
      role === "user" ? "user-message-author" : "assistant-message-author",
    );
    if (role === "assistant") author.append(element("span", null, "nora-logo"));
    else {
      const icon = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML =
        '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>';
      author.append(icon);
    }
    const displayName=element("strong",role === "user" ? "Toi" : window.heartUI?.assistantName() || "Nora");
    if(role==='assistant')displayName.setAttribute('data-assistant-name','');
    author.append(displayName);
    meta.append(author);
    if (at) {
      const time = element("time", messageDate.format(new Date(at)));
      time.title = dateLabel.format(new Date(at));
      time.dateTime = at;
      meta.append(time);
    }
    const body = element("div", null, "message-content");
    const rendered = element("div");
    if (role === "user") {
      rendered.className = "user-message-text";
      rendered.dir = "auto";
      rendered.textContent = content;
    } else rich(rendered, content);
    body.append(rendered);
    {
      const actions=element("span",null,"message-actions");
      const copy = element("button", null, "copy-message");
      const copyIcon =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></svg>';
      copy.innerHTML = copyIcon;
      copy.title = "Copier le message";
      copy.type = "button";
      copy.setAttribute("aria-label", role==="user"?"Copier mon message":"Copier la réponse");
      copy.addEventListener("click", async () => {
        try {
          await writeClipboard(content);
          copy.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
          copy.title = "Copié";
          copy.setAttribute("aria-label", "Message copié");
          setTimeout(() => {
            copy.innerHTML = copyIcon;
            copy.title = "Copier le message";
            copy.setAttribute("aria-label", role==="user"?"Copier mon message":"Copier la réponse");
          }, 1800);
        } catch {
          copy.title = "Copie indisponible";window.message("Copie impossible. Sélectionne le texte pour le copier.",true);
        }
      });
      actions.append(copy);
      if(role==='user'&&eventId){
        const ownerId=currentId;
        const retry=element('button',null,'resend-message');retry.type='button';retry.dataset.resendMessage=eventId;
        retry.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg>';
        retry.disabled=true;
        retry.setAttribute('aria-label','Relancer mon message');retry.title='Renvoyer à la fin du fil avec le modèle actuel';
        retry.addEventListener('click',()=>window.heartChatActions?.resend({conversationId:ownerId,eventId,content,attachments}));actions.append(retry);
      }
      meta.append(actions);
    }
    if (role === "assistant") body.prepend(meta);
    else node.append(meta);
    node.append(body);
    if (attachments.length) {
      const group = element("div", null, "message-attachments");
      const ownerId = currentId;
      for (const file of attachments) {
        const button = element("button", null, "message-attachment");
        button.type = "button";
        if (file.mediaType.startsWith("image/")) {
          const image = document.createElement("img");
          image.src = `/api/conversations/${ownerId}/attachments/${file.id}/raw`;
          image.alt = file.name;
          image.loading = "lazy";
          button.append(image);
        }
        button.append(element("span", file.name));
        button.addEventListener("click", () =>
          window.heartChatTools?.preview(file, ownerId),
        );
        group.append(button);
      }
      node.append(group);
    }
    return node;
  }
  function recoveryPanel(data) {
    const plan = data.recovery;
    const calls = [...(plan?.calls ?? []), ...(plan?.workspace?.calls ?? [])],
      runs = [...(plan?.runs ?? []), ...(plan?.workspace?.runs ?? [])];
    const unlogged = plan?.unloggedClaim || plan?.workspace?.unloggedClaim;
    const revision = JSON.stringify([
      plan?.lastEventId,
      plan?.workspace?.lastEventId,
    ]);
    const old = history.querySelector(".recovery-panel");
    if (
      data.busy ||
      plan?.pendingInput ||
      !data.recoveryAvailable ||
      (!runs.length && !calls.length)
    ) {
      old?.remove();
      return;
    }
    if (old?.dataset.revision === revision) return;
    old?.remove();
    const panel = element("div", null, "recovery-panel chat-error");
    panel.dataset.revision = revision;
    panel.append(
      element("strong", "Travail interrompu"),
      element(
        "p",
        "Historique conservé. Vérifie les actions avant de continuer.",
      ),
    );
    const button = element("button", "Examiner la reprise", "button secondary");
    button.type = "button";
    panel.append(button);
    button.addEventListener("click", () => {
      const dialog = element("dialog", null, "recovery-dialog"),
        form = element("form");
      form.append(
        element("h2", "Reprendre ce fil"),
        element(
          "p",
          "Aucun outil ni message ne sera rejoué. Les résultats déjà enregistrés restent conservés.",
        ),
      );
      const labels = {
        "not-started": "Jamais lancé",
        "result-missing": "Appel terminé, résultat absent",
        uncertain: "Lancé, effet à vérifier",
      };
      const list = element("ul");
      for (const call of calls)
        list.append(element("li", call.name + " · " + labels[call.state]));
      form.append(list);
      if (unlogged)
        form.append(
          element(
            "p",
            "Verrou sans journal associé : vérifie aussi les actions de l’explorateur.",
          ),
        );
      else if (!calls.length)
        form.append(
          element("p", "Aucun appel sans résultat. Le tour sera clôturé."),
        );
      const uncertain =
        unlogged || calls.some((call) => call.state !== "not-started");
      let acknowledged = false;
      const ack = element(
        "button",
        "J’ai vérifié les effets possibles",
        "button secondary",
      );
      ack.type = "button";
      ack.setAttribute("aria-pressed", "false");
      if (uncertain) {
        form.append(
          element(
            "p",
            "Une commande peut encore tourner. Vérifie Fichiers → Terminal et les effets externes avant de continuer. Si le résultat reste inconnu, précise-le ci-dessous.",
          ),
        );
        form.append(ack);
      }
      const label = element("label", "Constat (facultatif)"),
        note = element("textarea");
      note.maxLength = 2000;
      note.rows = 3;
      label.append(note);
      form.append(label);
      const feedback = element("p");
      feedback.setAttribute("role", "status");
      form.append(feedback);
      const actions = element("div", null, "recovery-actions"),
        cancel = element("button", "Fermer", "button secondary"),
        submit = element("button", "Clôturer sans rejouer", "button primary");
      cancel.type = "button";
      submit.type = "submit";
      submit.disabled = uncertain;
      ack.addEventListener("click", () => {
        acknowledged = !acknowledged;
        ack.setAttribute("aria-pressed", String(acknowledged));
        submit.disabled = !acknowledged;
      });
      cancel.addEventListener("click", () => dialog.close());
      actions.append(cancel, submit);
      form.append(actions);
      dialog.append(form);
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
      const id = data.conversation.id;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        cancel.disabled = true;
        ack.disabled = true;
        feedback.textContent = "Réconciliation en cours…";
        try {
          const next = await api("/api/conversations/" + id + "/reconcile", {
            method: "POST",
            body: JSON.stringify({
              lastEventId: plan.lastEventId,
              workspaceLastEventId: plan.workspace?.lastEventId ?? null,
              acknowledged,
              note: note.value,
            }),
          });
          dialog.close();
          if (currentId === id) await renderConversation(next);
        } catch (error) {
          feedback.textContent = error.message;
          submit.disabled = uncertain && !acknowledged;
          cancel.disabled = false;
          ack.disabled = false;
        }
      });
    });
    history.append(panel);
  }
  let renderedEvents = "";
  function render(data) {
    const changed = currentId !== data.conversation?.id,
      previousTop = history.scrollTop,
      previousHeight = history.scrollHeight,
      stick = changed || (data.history?.mode!=='before' && nearBottom());
    if (changed) {
      window.heartContent?.close();
      if (currentId) drafts.set(currentId, input.value);
      input.value = drafts.get(data.conversation?.id) || "";
    }
    currentId = data.conversation?.id;
    workspaceRoot = data.workspaceRoot || "";
    atBottom = stick;
    const opened = changed
      ? new Set()
      : new Set(
          [...history.querySelectorAll("details[open][data-event-id]")].map(
            (node) => node.dataset.eventId,
          ),
        );
    rendering = true;
    // Journal events are immutable. Activity updates must preserve message DOM,
    // open details, text selections and parsed Markdown.
    const eventKey = JSON.stringify([!!data.busy, (data.events || [])
      .filter(event => event.type === "message"
        ? event.data.role === "tool" ? !event.data.error && /^memory\.(remember|update|forget|restore)$/.test(event.data.name) : !event.data.toolCalls?.length
        : ["run.progress", "context.checkpoint", "run.failed", "interaction.requested", "interaction.resolved"].includes(event.type))
      .map(event => event.id)]);
    const historyChanged = changed || eventKey !== renderedEvents;
    renderedEvents = eventKey;
    if (historyChanged) {
      const messages = new Map(changed ? [] : [...history.querySelectorAll(".conversation-message[data-event-id]")]
        .map(node => [node.dataset.eventId, node]));
      const desired=[];
      const timeline={append(...nodes){desired.push(...nodes);}};
      const days=new Map();
      if(!changed)for(const node of history.querySelectorAll('.chat-date-separator')){const group=days.get(node.dataset.day)||[];group.push(node);days.set(node.dataset.day,group);}
      const activeRun = data.busy ? (data.inventory||(data.events || []).findLast(event => event.type === "run.started"))?.runId : null;
      let previousDay = null;
      for (const event of data.events || []) {
        const item = event.data;
        const receipt = event.type === "message" && item.role === "tool" ? (window.heartTurns.memory(event)||window.heartTurns.task(event)) : null;
        const visibleMessage = event.type === "message" && (receipt || (item.role !== "tool" && !item.toolCalls?.length));
        if (visibleMessage && dayKey(event.at) !== previousDay) {
          previousDay = dayKey(event.at);
          timeline.append(days.get(previousDay)?.shift()||dayMarker(event.at));
        }
        if (event.type === "message") {
          if (receipt) timeline.append(messages.get(event.id) || receipt);
          else if (visibleMessage) timeline.append(messages.get(event.id) || message(item.role, item.content || "", event.at, item.attachments || [], event.id));
        } else if(event.type==='run.progress') {
          if (event.runId === activeRun || event.data.kind !== 'commentary' || typeof event.data.text !== 'string' || !event.data.text.trim()) continue;
          const detail=element('p',event.data.text,'conversation-message turn-commentary');detail.dataset.eventId=event.id;timeline.append(messages.get(event.id)||detail);
        } else if(event.type==='interaction.requested'){
          const item=data.interactions?.find(item=>item.id===event.id);if(item)timeline.append(window.heartInteractions.render(item,currentId));
        } else if (event.type === "context.checkpoint") {
          const detail = element(
            "details",
            null,
            "conversation-message checkpoint",
          );
          detail.dataset.eventId = event.id;
          detail.open = opened.has(event.id);
          detail.append(
            element("summary", "Contexte repris · historique conservé"),
            element("p", event.data.summary),
          );
          timeline.append(messages.get(event.id)||detail);
        } else if (event.type === "run.failed") {
          const failure=element(
              "p",
              event.data?.cancelled
                ? "Réponse interrompue. Les actions déjà terminées restent conservées."
                : ([
                    "Échec du modèle : fournisseur temporairement indisponible.",
                    "Échec du modèle : requête refusée par le fournisseur.",
                    "Échec du modèle : connexion API refusée. Vérifie la clé et les droits.",
                    "Échec du modèle : crédits insuffisants chez le fournisseur.",
                    "Échec du modèle : limite d’usage du fournisseur atteinte. Réessaie plus tard.",
                    "Échec du modèle : format de réponse fournisseur invalide.",
                    "Échec du modèle : fournisseur indisponible ou réponse incompatible.",
                    "Échec du modèle : réponse incomplète. Aucun appel d’outil partiel exécuté.",
                    "Échec du modèle : limite de sortie atteinte. Aucun appel d’outil partiel exécuté.",
                    "Échec du modèle : appel d’outil invalide. Aucun outil de cette réponse exécuté.",
                    "Échec du modèle : réponse vide du fournisseur.",
                  ].includes(event.data?.error) ? event.data.error + " Historique conservé ; tu peux demander de continuer."
                    : "Échange interrompu. Ton historique est conservé."),
              "chat-error",
            );failure.dataset.eventId=event.id;failure.classList.add('conversation-message');
          timeline.append(messages.get(event.id)||failure);
        }
      }
      let cursor=history.firstChild;
      for(const node of desired){if(node===cursor)cursor=cursor.nextSibling;else history.insertBefore(node,cursor);}
      while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next;}
    }
    if(data.pendingInput&&!history.querySelector(`[data-event-id="${data.pendingInput.id}"]`))history.append(window.heartInteractions.render(data.pendingInput,currentId));
    recoveryPanel(data);
    const activePanel=history.querySelector('.response-activity');
    const activityKey=JSON.stringify([data.conversation?.id,data.activity?.phase,data.activity?.modelCalls,(data.events||[]).at(-1)?.id]);
    if(!data.busy)activePanel?.remove();
    else {
      if(!activePanel||activePanel.dataset.revision!==activityKey){const next=activityPanel(data);next.dataset.revision=activityKey;if(activePanel)activePanel.replaceWith(next);else history.append(next);}
      history.querySelectorAll('[data-resend-message]').forEach(button=>button.disabled=true);
    }
    tickActivity();
    if (!history.children.length) {
      const empty = element("div", null, "conversation-empty");
      empty.append(
        element("h2", "Qu’aimerais-tu avancer ?"),
        element("p", "Écris un message pour commencer cette discussion."),
      );
      history.append(empty);
    }
    get("chat-message-count").textContent = String(
      data.messageCount ?? (data.events || []).filter(
        (event) =>
          event.type === "message" &&
          ["user", "assistant"].includes(event.data.role) &&
          !event.data.toolCalls?.length,
      ).length,
    );
    get("chat-title").textContent =
      data.conversation?.title || "Nouvelle discussion";
    get("chat-title").title = data.conversation?.title || "";
    get("chat-yolo").hidden=data.conversation?.fileAccess!=="yolo";
    get("conversation-segments").textContent =
      `${data.segments || 1} segment(s) · historique conservé`;
    window.heartUI?.conversation(data);
    void window.heartChatTools?.conversation(data);
    const inventory=data.inventory||(data.events||[]).findLast(event=>event.type==='run.started');
    const toolInventoryList=get('conversation-tools');toolInventoryList.replaceChildren();
    const names=inventory?.data?.tools;
    for(const name of Array.isArray(names)&&names.length?names:[Array.isArray(names)?'Aucun outil déclaré pour cet envoi.':'Inventaire non enregistré pour cet ancien envoi ; disponible au prochain message.']){
      const item=document.createElement('li');item.textContent=inventory?.data?.toolTitles?.[name]||name;item.title=name;toolInventoryList.append(item);
    }
    window.heartWorkspace?.conversation(data);
    viewport();
    if (changed) resizeInput();
    requestAnimationFrame(() => {
      if (stick) {
        const request=data.pendingInput&&history.querySelector(`[data-event-id="${data.pendingInput.id}"]`);
        if(request&&historyChanged){history.scrollTop+=request.getBoundingClientRect().top-history.getBoundingClientRect().top-12;atBottom=nearBottom();get("jump-latest").hidden=atBottom;}
        else jump();
      }
      else {
        history.scrollTop = previousTop+(data.history?.mode==='before'?history.scrollHeight-previousHeight:0);
        get("jump-latest").hidden = false;
      }
      rendering = false;
      window.heartHistory?.rendered();
    });
  }
  window.heartChat = {
    copyText: writeClipboard,
    contentLoaded(){if(atBottom && document.body.classList.contains("chat-mode"))requestAnimationFrame(jump);},
    actionsDisabled(disabled){history.querySelectorAll("[data-resend-message]").forEach(button=>button.disabled=disabled);},
    render,
    rich,
    layout: viewport,
    sending(prompt, files = []) {
      atBottom = true;
      history.querySelector(".conversation-empty")?.remove();
      const at = new Date().toISOString();
      if (
        [...history.querySelectorAll(".chat-date-separator")].at(-1)?.dataset
          .day !== dayKey(at)
      )
        history.append(dayMarker(at));
      history.append(message("user", prompt, at, files), activityPanel());
      requestAnimationFrame(jump);
    },
    restoreDraft(id, prompt) {
      if (currentId === id) {
        if (!input.value) input.value = prompt;
        resizeInput();
      } else if (!drafts.get(id)) drafts.set(id, prompt);
    },
    finish() {
      resizeInput();
      if (currentId) drafts.set(currentId, input.value);
    },
    reset() {
      get("chat-yolo").hidden=true;
      drafts.clear();
      window.heartHistory?.reset();
      currentId = null;
      workspaceRoot = "";
      window.heartContent?.close();
      window.heartInteractions?.reset();
      input.value = "";
    },
  };
  get("chat-effort").addEventListener("click",()=>window.heartConversationModel.open());
  get("chat-yolo").addEventListener("click",()=>window.heartSettings?.open("access"));
  viewport();
  resizeInput();
})();
