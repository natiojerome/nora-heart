/* Owner workspace explorer. File operations use Heart's core and journal, never an LLM. */
(() => {
  const get = (id) => document.getElementById(id);
  const base = id => id === "projects-root" ? "/api/projects-root" : `/api/conversations/${id}`;
  let chatCurrent = null;
  let current = null,
    folder = "",
    documentFile = null,
    menuEntry = null,
    pathAction = "mkdir",
    pendingConfirm = null,
    busy = false,
    generation = 0,
    nextOffset = 0,
    hasMore = false;
  const dialogs = [
    "workspace-dialog",
    "workspace-item-menu",
    "workspace-editor",
    "workspace-path-dialog",
    "workspace-confirm",
  ];
  const modes = { none: "Aucun accès", read: "Lecture seule", write: "Lecture et écriture", develop: "Développement isolé", yolo: "YOLO · serveur root" };
  function prepareSettings() {
    if (!current) return;
    get("permissions-conversation").textContent = current.title;
    get("execution-steps").value = current.maxSteps || 0;
    get("execution-network").checked=current.fileAccess==='yolo'||!!current.networkAccess;
    sync();
  }
  function permissions() {
    window.heartSettings?.open("access");
  }
  function filterFiles() {
    const term = get("workspace-search").value.trim().toLocaleLowerCase("fr");
    const rows = [...get("workspace-list").querySelectorAll(".workspace-row")];
    for (const row of rows) row.hidden = !row.dataset.name.includes(term);
    const visible = rows.filter(row => !row.hidden).length;
    get("workspace-count").textContent = term && !visible ? "Aucun résultat parmi les éléments chargés." : `${visible} élément(s)${hasMore ? " chargés · Afficher la suite pour continuer" : ""}`;
  }
  const size = (bytes) =>
    bytes < 1024
      ? `${bytes} o`
      : `${(bytes / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Kio`;
  function node(tag, text, cls) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  }
  function button(label, action, cls = "text-button") {
    const item = node("button", label, cls);
    item.type = "button";
    item.addEventListener("click", () => void action());
    return item;
  }
  function show(id) {
    const dialog = get(id);
    dialog
      .querySelectorAll(".dialog-feedback")
      .forEach((item) => (item.hidden = true));
    if (!dialog.open) dialog.showModal();
  }
  function fail(error) {
    message(errorText(error), true);
  }
  function sync() {
    const blocked =
      busy ||
      !current ||
      current.busy ||
      (current.id === conversationId && conversationRunning);
    get("chat-workspace").disabled = !chatCurrent;
    get("workspace-access").disabled = !!blocked;
    const mode = chatCurrent?.fileAccess || 'read', yolo = mode === 'yolo';
    get("chat-permissions").disabled = !chatCurrent;
    get("chat-permissions").setAttribute("aria-label",`Autorisations : ${modes[mode]}`);
    get("chat-permissions").title=`Autorisations : ${modes[mode]}`;
    get("chat-permissions").dataset.mode = mode;
    get("chat-permissions").hidden=yolo;
    get("chat-permissions").querySelector("[data-access-label]").textContent=({none:"Aucun accès",read:"Lecture",write:"Écriture",develop:"Développement",yolo:"YOLO root"})[mode];
    get("workspace-access-help").textContent = yolo
      ? 'YOLO actif : serveur entier, root et réseau. Sans confirmation.'
      : `${get("workspace-access").selectedOptions[0]?.dataset.detail || ""}`;
    for (const item of get("context-dialog").querySelectorAll(
      "#execution-policy-form input,#execution-policy-form button,#network-policy-form input,#network-policy-form button",
    ))
      item.disabled = !!blocked;
    get("execution-network").disabled = !!blocked || yolo;
    get("network-policy-form").querySelector("button").disabled=!!blocked||yolo;
    for (const id of [
      "workspace-new-file",
      "workspace-new-folder",
      "workspace-import",
      "workspace-save",
      "workspace-path-submit",
      "workspace-delete",
      "workspace-move",
      "workspace-item-move",
      "workspace-item-delete",
      "workspace-confirm-submit",
    ])
      get(id).disabled = !!blocked;
    get("workspace-save").disabled = !!blocked || documentFile?.text === false;
    get("workspace-dialog").setAttribute("aria-busy", String(busy));
    get("workspace-list")
      .querySelectorAll("[data-workspace-write]")
      .forEach((item) => (item.disabled = !!blocked));
    get("workspace-list")
      .querySelectorAll(".workspace-open")
      .forEach((item) => (item.disabled = busy));
    window.heartControls?.sync();
  }
  async function load(path = folder, append = false) {
    if (!current) return;
    const id = current.id,
      version = ++generation;
    if (!append)
      get("workspace-list").replaceChildren(
        node("p", "Chargement des fichiers…", "field-help"),
      );
    try {
      const data = await api(
        `${base(id)}/workspace?path=${encodeURIComponent(path)}&offset=${append ? nextOffset : 0}`,
      );
      if (current?.id !== id || version !== generation) return;
      if (folder !== path) get("workspace-search").value = "";
      folder = path;
      const crumbs = get("workspace-breadcrumbs");
      crumbs.replaceChildren(button("Racine", () => load("")));
      let parent = "";
      for (const part of path.split("/").filter(Boolean)) {
        parent += (parent ? "/" : "") + part;
        const target = parent;
        crumbs.append(node("span", "›"), button(part, () => load(target)));
      }
      crumbs.lastElementChild?.setAttribute("aria-current", "location");
      get("workspace-path").textContent = path || "Racine";
      get("workspace-up").disabled = !path;
      if (!append) get("workspace-list").replaceChildren();
      get("workspace-more")?.remove();
      nextOffset = data.nextOffset;
      hasMore = !!data.truncated;
      for (const entry of [...data.entries].sort((a, b) => (a.kind === "directory" ? 0 : 1) - (b.kind === "directory" ? 0 : 1) || a.name.localeCompare(b.name, "fr", { numeric: true }))) {
        const row = node("div", undefined, "workspace-row");
        row.dataset.name = entry.name.toLocaleLowerCase("fr");
        const open = button(
          "",
          () =>
            entry.kind === "directory" ? load(entry.path) : edit(entry.path),
          "workspace-open",
        );
        const icon=node('span',undefined,'workspace-file-icon'+(entry.kind==='directory'?' directory':''));
        icon.setAttribute('aria-hidden','true');
        icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">'+(entry.kind==='directory'?'<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9H3z"/>':'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>')+'</svg>';
        open.append(icon);
        const copy = node("span");
        copy.append(
          node("strong", entry.name),
          node(
            "small",
            entry.kind === "directory"
              ? "Dossier"
              : `${size(entry.size)} · ${new Date(entry.updatedAt).toLocaleString("fr-FR")}`,
          ),
        );
        open.append(copy);
        row.append(open);
        const actions=button('',()=>itemMenu(entry));actions.dataset.icon='more';window.heartUI?.renderIcons(actions);
        actions.setAttribute('aria-label',`Actions pour ${entry.name}`);
        row.append(actions);
        get("workspace-list").append(row);
      }
      if (!data.entries.length && !append)
        get("workspace-list").append(
          node(
            "p",
            "Ce dossier est vide. Crée ton premier fichier avec + Fichier.",
            "field-help",
          ),
        );
      filterFiles();
      sync();
      if (data.truncated) {
        const more = button("Afficher la suite", () => load(folder, true));
        more.id = "workspace-more";
        get("workspace-list").append(more);
      }
    } catch (error) {
      if (version === generation)
        get("workspace-list").replaceChildren(
          node("p", errorText(error), "field-help"),
        );
      fail(error);
    }
  }
  async function open(root = false) {
    if (busy) return;
    if (root) {
      const version = ++generation;
      try {
        const data = await api("/api/projects-root");
        if(version !== generation || !state.authenticated) return;
        current = {id:"projects-root",title:data.directory,fileAccess:"develop",networkAccess:true};
        folder = "";
        get("workspace-search").value = "";
      } catch(error) { fail(error); return; }
    } else {
      if(current?.id === "projects-root") { current = chatCurrent; folder = ""; generation++; }
      if (!current) { message("Ouvre une conversation pour accéder à ses fichiers.", true); return; }
    }
    const owner = current.id === "projects-root";
    get("workspace-permissions").hidden = owner;
    get("workspace-conversation").textContent = owner ? "Projets · " + current.title : current.title;
    if (!owner) {
      get("workspace-access").value = current.fileAccess || "read";
      get("execution-network").checked = current.fileAccess==='yolo'||!!current.networkAccess;
      get("execution-steps").value = current.maxSteps || 0;
    }
    show("workspace-dialog");
    sync();
    await load();
  }
  function editor(file) {
    documentFile = file;
    get("workspace-editor-heading").textContent = file
      ? "Modifier le fichier"
      : "Nouveau fichier";
    get("workspace-name").value = file?.path || (folder ? folder + "/" : "");
    get("workspace-name").readOnly = !!file;
    get("workspace-content").value = file?.content || "";
    get("workspace-document-meta").textContent = file
      ? `${size(file.size)} · ${new Date(file.updatedAt).toLocaleString("fr-FR")}`
      : "Texte, Markdown, JSON, code…";
    const binary = file?.text === false;
    if (binary) get("workspace-editor-heading").textContent = "Fichier";
    get("workspace-content").hidden = binary;
    get("workspace-content-label").hidden = binary;
    get("workspace-save").hidden = binary;
    get("workspace-document-actions").hidden = !file;
    get("workspace-editor-help").textContent = binary
      ? "Ce format reste intact. Tu peux le télécharger, le déplacer ou le supprimer."
      : file
        ? "En cas de conflit, ton brouillon est conservé."
        : "Le parent doit exister. Aucun fichier existant ne sera écrasé.";
    show("workspace-editor");
    sync();
    get("workspace-wrap").hidden = binary;
    // Opening an existing document must not summon the phone keyboard.
    (file ? get("workspace-editor").querySelector("[data-workspace-close]") : get("workspace-name")).focus();
  }
  async function itemMenu(entry) {
    try {
      const id=current.id;
      const data=await api(`${base(id)}/workspace?path=${encodeURIComponent(entry.path)}&info=true`);
      if(current?.id!==id)return;
      menuEntry=data.document;
      get('workspace-item-heading').textContent=entry.name;
      get('workspace-item-meta').textContent=entry.kind==='directory'?'Dossier':size(entry.size);
      get('workspace-item-download').hidden=entry.kind==='directory';
      get('workspace-item-move').hidden=entry.kind==='directory';
      show('workspace-item-menu');
    }catch(error){fail(error);}
  }
  function downloadFile(file){
    const link=node('a');link.href=`${base(current.id)}/workspace/raw?path=${encodeURIComponent(file.path)}`;link.download=file.name;link.click();
  }
  get('workspace-item-open').addEventListener('click',()=>{get('workspace-item-menu').close();if(menuEntry.kind==='directory')void load(menuEntry.path);else void edit(menuEntry.path);});
  get('workspace-item-download').addEventListener('click',()=>{downloadFile(menuEntry);get('workspace-item-menu').close();});
  get('workspace-item-move').addEventListener('click',()=>{documentFile=menuEntry;get('workspace-item-menu').close();get('workspace-move').click();});
  get('workspace-item-delete').addEventListener('click',()=>{get('workspace-item-menu').close();confirmDelete(menuEntry);});
  async function edit(path) {
    const id = current.id,
      version = ++generation;
    try {
      const data = await api(
        `${base(id)}/workspace?path=${encodeURIComponent(path)}&info=true`,
      );
      let file = data.document;
      if (file.text) {
        const result = await api(
          `${base(id)}/workspace?path=${encodeURIComponent(path)}&read=true`,
        );
        file = result.document;
        if (file.truncated) {
          const finish = window.heartFeedback.begin("/workspace/raw", "GET");
          try {
            const response = await fetch(
              `${base(id)}/workspace/raw?path=${encodeURIComponent(path)}`,
              { credentials: "same-origin", cache: "no-store" },
            );
            if (!response.ok)
              throw new Error("Lecture du fichier interrompue.");
            file.content = await response.text();
          } finally {
            finish();
          }
        }
      }
      if (current?.id === id && version === generation) editor(file);
    } catch (error) {
      fail(error);
    }
  }
  async function mutate(body, done) {
    if (busy || !current || current.busy) return;
    const id = current.id;
    busy = true;
    sync();
    try {
      if (body.action === "import")
        await api(
          `${base(id)}/workspace/upload?path=${encodeURIComponent(body.path)}${body.revision ? "&revision=" + encodeURIComponent(body.revision) : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: body.file,
          },
        );
      else await post(`${base(id)}/workspace`, body);
      if (current?.id !== id) return;
      done?.();
      await load();
      if (id !== "projects-root") {
        const data = await api(`/api/conversations/${id}`);
        if (current?.id === id) await renderConversation(data);
      }
      message(
        {
          create: "Fichier créé.",
          import: "Fichier enregistré.",
          update: "Fichier enregistré.",
          move: "Fichier déplacé.",
          delete: "Suppression terminée.",
          mkdir: "Dossier créé.",
        }[body.action] || "Modification enregistrée.",
      );
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
      sync();
    }
  }
  function confirmAction(heading, copy, label, action) {
    pendingConfirm = action;
    get("workspace-confirm-heading").textContent = heading;
    get("workspace-confirm-copy").textContent = copy;
    get("workspace-confirm-submit").textContent = label;
    show("workspace-confirm");
  }
  function confirmDelete(file) {
    confirmAction(
      "Supprimer définitivement ?",
      `${file.path}${file.kind === "directory" ? " — seuls les dossiers vides peuvent être supprimés." : " — cette suppression ne peut pas être annulée."}`,
      "Supprimer",
      () =>
        mutate(
          { action: "delete", path: file.path, revision: file.revision },
          () => {
            get("workspace-confirm").close();
            get("workspace-editor").close();
            documentFile = null;
          },
        ),
    );
  }
  get("workspace-page-open").addEventListener("click", async () => {
    try {
      const id = get("workspace-conversation-select").value;
      if (!id) {
        message("Choisis une conversation.", true);
        return;
      }
      if (current?.id !== id) await openConversation(id);
      await open();
    } catch (error) {
      fail(error);
    }
  });
  get("chat-permissions").addEventListener("click", permissions);
  get("workspace-permissions").addEventListener("click", permissions);
  get("workspace-search").addEventListener("input", filterFiles);
  get("workspace-wrap").addEventListener("click", () => {
    const wrap = get("workspace-wrap").getAttribute("aria-pressed") !== "true";
    get("workspace-wrap").setAttribute("aria-pressed", String(wrap));
    get("workspace-content").classList.toggle("wrap", wrap);
  });
  get("chat-workspace").addEventListener("click", () => void open());
  get("capabilities-files").addEventListener("click", () => void open(true));
  get("workspace-root-open").addEventListener("click", () => void open(true));
  get("workspace-refresh").addEventListener("click", () => void load());
  get("workspace-up").addEventListener(
    "click",
    () => void load(folder.split("/").slice(0, -1).join("/")),
  );
  get("workspace-new-file").addEventListener("click", () => editor(null));
  get("workspace-new-folder").addEventListener("click", () => {
    pathAction = "mkdir";
    get("workspace-path-heading").textContent = "Nouveau dossier";
    get("workspace-path-submit").textContent = "Créer";
    get("workspace-destination").value = folder ? folder + "/" : "";
    show("workspace-path-dialog");
    get("workspace-destination").focus();
  });
  get("workspace-move").addEventListener("click", () => {
    pathAction = "move";
    get("workspace-path-heading").textContent = "Renommer / déplacer";
    get("workspace-path-submit").textContent = "Déplacer";
    get("workspace-destination").value = documentFile.path;
    show("workspace-path-dialog");
  });
  get("workspace-delete").addEventListener("click", () =>
    confirmDelete(documentFile),
  );
  get("workspace-confirm-submit").addEventListener("click", () => {
    if (!busy) void pendingConfirm?.();
  });
  get("workspace-editor-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (documentFile?.text === false) return;
    void mutate(
      {
        action: "import",
        path: documentFile?.path || get("workspace-name").value,
        file: new Blob([get("workspace-content").value]),
        ...(documentFile ? { revision: documentFile.revision } : {}),
      },
      () => {
        get("workspace-editor").close();
        documentFile = null;
      },
    );
  });
  get("workspace-path-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void mutate(
      {
        action: pathAction,
        ...(pathAction === "move"
          ? {
              path: documentFile.path,
              revision: documentFile.revision,
              destination: get("workspace-destination").value,
            }
          : { path: get("workspace-destination").value }),
      },
      () => {
        get("workspace-path-dialog").close();
        if (pathAction === "move") {
          get("workspace-editor").close();
          documentFile = null;
        }
      },
    );
  });
  get("workspace-terminal").addEventListener("click", () =>
    window.heartTerminal?.open(current?.id === "projects-root"),
  );
  async function saveExecutionPolicy(event) {
    event.preventDefault();
    if (!current || busy) return;
    const id = current.id, networkOnly=event.currentTarget.id==='network-policy-form';
    busy = true;
    sync();
    try {
      const data = await post(`/api/conversations/${id}/execution-policy`, {
        network: networkOnly?get("execution-network").checked:!!current.networkAccess,
        maxSteps: networkOnly?(current.maxSteps??0):Number(get("execution-steps").value),
      });
      if (current?.id === id) {
        current = data.conversation;
        await renderConversation(data);
        message(networkOnly?"Réseau enregistré.":"Budget enregistré.");
      }
    } catch (error) {
      get("execution-network").checked = !!current?.networkAccess;
      get("execution-steps").value = current?.maxSteps ?? 0;
      fail(error);
    } finally {
      busy = false;
      sync();
    }
  }
  get("execution-policy-form").addEventListener("submit",saveExecutionPolicy);
  get("network-policy-form").addEventListener("submit",saveExecutionPolicy);
  get("workspace-access").addEventListener("change", async () => {
    if (!current || busy) return;
    const id = current.id,
      previous = current.fileAccess || "read";
    busy = true;
    sync();
    try {
      const data = await post(`/api/conversations/${id}/file-access`, {
        access: get("workspace-access").value,
      });
      if (current?.id === id) {
        current = data.conversation;
        await renderConversation(data);
        message("Accès de l’assistant mis à jour.");
      }
    } catch (error) {
      get("workspace-access").value = previous;
      fail(error);
    } finally {
      busy = false;
      sync();
    }
  });
  get("workspace-download").addEventListener("click", () => {
    if (!documentFile) return;
    const link = node("a");
    link.href = `${base(current.id)}/workspace/raw?path=${encodeURIComponent(documentFile.path)}`;
    link.download = documentFile.name;
    link.click();
  });
  get("workspace-import").addEventListener("click", () =>
    get("workspace-import-input").click(),
  );
  get("workspace-import-input").addEventListener("change", async (event) => {
    const selected = [...event.target.files];
    event.target.value = "";
    for (const file of selected) {
      if (!current || busy) break;
      await mutate({
        action: "import",
        path: (folder ? folder + "/" : "") + file.name,
        file,
      });
    }
  });
  function close(dialog) {
    if (busy) return;
    if (
      dialog.id === "workspace-editor" &&
      get("workspace-content").value !== (documentFile?.content || "")
    ) {
      confirmAction(
        "Abandonner les modifications ?",
        "Les modifications non enregistrées seront perdues.",
        "Abandonner",
        () => {
          get("workspace-confirm").close();
          dialog.close();
          documentFile = null;
        },
      );
      return;
    }
    if (dialog.id === "workspace-dialog") {
      generation++;
      if(current?.id === "projects-root") {current = chatCurrent; folder = ""; sync();}
    }
    dialog.close();
  }
  document
    .querySelectorAll("[data-workspace-close]")
    .forEach((item) =>
      item.addEventListener("click", () => close(item.closest("dialog"))),
    );
  dialogs.forEach((id) =>
    get(id).addEventListener("cancel", (event) => {
      event.preventDefault();
      close(get(id));
    }),
  );
  window.heartWorkspace = {
    async openFile(path, owner) {
      if(current?.id === "projects-root") {current = chatCurrent; folder = ""; generation++;}
      if (!current || current.id !== owner) { message("Ouvre la conversation du fichier.", true); return; }
      await edit(path);
    },
    prepareSettings,
    sync,
    catalog(items) {
      const select = get("workspace-conversation-select"),
        selected = select.value || current?.id;
      select.replaceChildren(node("option", "Choisir une conversation"));
      select.firstChild.value = "";
      for (const item of items) {
        const option = node("option", item.title);
        option.value = item.id;
        select.append(option);
      }
      select.value = selected || "";
      window.heartControls?.sync();
    },
    conversation(data) {
      window.heartTerminal?.conversation(data);
      chatCurrent = { ...data.conversation, busy: !!data.busy };
      if(current?.id === "projects-root") { sync(); return; }
      const wasBusy = current?.busy;
      const changed = current?.id !== data.conversation?.id;
      if (changed) {
        get("context-dialog").close();
        generation++;
        folder = "";
        get("workspace-search").value = "";
        documentFile = null;
        dialogs.forEach((id) => get(id).close());
      }
      current = { ...data.conversation, busy: !!data.busy };
      get('workspace-access').querySelector('option[value="yolo"]').disabled=!data.yoloAvailable;
      get('workspace-access').value=current.fileAccess||'read';
      get('execution-network').checked=current.fileAccess==='yolo'||!!current.networkAccess;
      get("workspace-conversation-select").value = current.id;
      sync();
      if (!changed && wasBusy && !current.busy && get("workspace-dialog").open)
        void load();
    },
    reset() {
      window.heartTerminal?.reset();
      generation++;
      current = null;
      chatCurrent = null;
      folder = "";
      documentFile = null;
      dialogs.forEach((id) => get(id).close());
      sync();
    },
  };
  sync();
})();
