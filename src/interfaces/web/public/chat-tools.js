/* Nora-like chat controls, backed by Heart APIs rather than a second harness. */
(() => {
  const get = (id) => document.getElementById(id);
  let current = null,
    files = [],
    selected = new Set(),
    uploading = false,
    prompts = [],
    editing = null,
    deleting = null,
    cancelling = false,
    remoteBusy = false,
    pollTimer = null,
    lastRevision = "";
  let pendingFilesKey = "";
  const fileUrl = (conversation, id) =>
    `/api/conversations/${conversation}/attachments/${id}/raw`;
  const sizeLabel = (bytes) =>
    bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} Kio`
      : `${(bytes / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mio`;
  function node(tag, text, cls) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  }
  function button(text, action, cls = "text-button") {
    const item = node("button", text, cls);
    item.type = "button";
    item.addEventListener("click", action);
    return item;
  }
  function show(id) {
    const dialog = get(id);
    dialog.querySelectorAll(".dialog-feedback").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    if (!dialog.open) dialog.showModal();
  }
  const notifyError = (error) => message(errorText(error), true);
  const busy = () => conversationRunning || remoteBusy;
  function schedulePoll() {
    if (pollTimer || !busy() || !current) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      const id = current?.id;
      if (!id || !busy()) return;
      if (document.hidden) {
        schedulePoll();
        return;
      }
      try {
        const cursor=window.heartHistory?.after(id);
        const data = await api(`/api/conversations/${id}${cursor?"?after="+encodeURIComponent(cursor):""}`, { quiet: true });
        if (current?.id === id) {
          document.querySelector(".activity-connection")?.remove();
          remoteBusy = data.busy;
          const revision = JSON.stringify([
            data.events?.at(-1)?.id,
            data.busy,
            data.activity?.phase,
            data.activity?.modelCalls,
          ]);
          if (revision !== lastRevision) {
            lastRevision = revision;
            await renderConversation(data);
          }
          sync();
        }
      } catch {
        const panel = document.querySelector(".response-activity");
        if (
          current?.id === id &&
          panel &&
          !panel.querySelector(".activity-connection")
        )
          panel.append(
            node(
              "p",
              "Suivi momentanément indisponible. La réponse peut continuer.",
              "activity-connection activity-note",
            ),
          );
      }
      schedulePoll();
    }, 1000);
  }
  function selectedFiles() {
    return files.filter((file) => selected.has(file.id));
  }
  function sync() {
    const project = memoryProjects.find(
      (project) => project.id === current?.projectId,
    );
    get("chat-project").textContent =
      project?.title || (current?.projectId ? "Projet" : "Aucun projet");
    get("chat-project").title = get("chat-project").textContent;
    schedulePoll();
    window.heartChatActions?.sync();
    get("chat-clear-draft").disabled = !get("conversation-prompt").value;
    get("chat-attachments").disabled =
      !current || !state.chatAssetsAvailable || uploading || busy();
    get("chat-quick-prompts").disabled = !state.chatAssetsAvailable;
    get("chat-stop").hidden = !busy();
    get("chat-stop").disabled = cancelling;
    if (cancelling) {
      const heading = document.querySelector(
        ".response-activity-heading strong",
      );
      if (heading) heading.textContent = "Arrêt en cours";
    }
    get("conversation-submit").hidden = busy();
    get("chat-stop").classList.toggle("spin-request", cancelling);
    const provider = selectedProvider();
    const ready = modelAvailable();
    const runtime = get("chat-runtime");
    runtime.classList.toggle("healthy", !!ready);
    runtime.title = ready
      ? "Modèle configuré"
      : "Choisis ou connecte un modèle";
    runtime.setAttribute("aria-label", runtime.title);
    get("conversation-submit").disabled =
      !current ||
      !!window.heartInteractions?.pending() ||
      !ready ||
      busy() ||
      uploading ||
      conversationLoading ||
      (!get("conversation-prompt").value.trim() && !selected.size);
    if (!runtime.firstElementChild) runtime.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0m-9 4a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1"/></svg>';
    get("chat-attachments").dataset.count = selected.size
      ? String(selected.size)
      : "";
    const target = get("chat-pending-files");
    const filesKey = JSON.stringify([current?.id, selectedFiles()]);
    if (filesKey !== pendingFilesKey) {
      pendingFilesKey = filesKey;
      target.replaceChildren();
      target.hidden = selected.size === 0;
      for (const file of selectedFiles()) {
        const chip = node("span", null, "pending-file-chip");
        chip.append(
          button(file.name, () => preview(file, current.id), "file-chip-open"),
          button(
            "×",
            () => {
              selected.delete(file.id);
              sync();
            },
            "file-chip-remove",
          ),
        );
        chip.lastChild.setAttribute(
          "aria-label",
          `Retirer ${file.name} du prochain message`,
        );
        target.append(chip);
      }
    }
    if (!busy())
      get("composer-status").textContent = uploading
        ? "Envoi de fichier…"
        : selected.size
          ? `${selected.size} pièce${selected.size > 1 ? "s" : ""} jointe${selected.size > 1 ? "s" : ""}`
          : window.heartInteractions?.pending()?"Réponse attendue dans le formulaire":"Prêt à échanger";
  }
  async function loadFiles(id = current?.id) {
    if (!id || !state.chatAssetsAvailable) return;
    const result = await api(`/api/conversations/${id}/attachments`);
    if (current?.id !== id) return;
    files = result.files;
    selected = new Set(
      [...selected].filter((id) => files.some((file) => file.id === id)),
    );
    sync();
    renderFiles();
  }
  async function conversation(data) {
    const changed = current?.id !== data.conversation?.id;
    current = data.conversation;
    remoteBusy = !!data.busy;
    if (changed) {
      clearTimeout(pollTimer);
      pollTimer = null;
      lastRevision = "";
    }
    if (changed) {
      selected.clear();
      files = [];
      sync();
      try {
        await loadFiles();
        if (current?.id === data.conversation.id) {
          files
            .filter((file) => !file.used)
            .slice(0, 5)
            .forEach((file) => selected.add(file.id));
          sync();
        }
      } catch (error) {
        notifyError(error);
      }
    } else sync();
  }
  async function loadPrompts(quiet = false) {
    prompts = (await api("/api/quick-prompts", { quiet })).prompts;
    renderPrompts();
    renderPromptMenu();
  }
  function closePromptMenu() {
    get("quick-prompts-popover").hidden = true;
    get("chat-quick-prompts").setAttribute("aria-expanded", "false");
  }
  function renderPromptMenu() {
    const target = get("quick-prompts-menu");
    target.replaceChildren();
    const context = current?.projectId ? "project" : "general";
    for (const prompt of prompts.filter(
      (item) => item.context === "all" || item.context === context,
    )) {
      const choose = button(
        "",
        () => insertPrompt(prompt),
        "quick-prompt-main",
      );
      choose.setAttribute("role", "menuitem");
      choose.append(
        node("strong", prompt.title),
        node("small", prompt.description),
      );
      target.append(choose);
    }
    if (!target.children.length)
      target.append(
        node(
          "p",
          "Aucun prompt pour cette conversation. Utilise le crayon pour en créer.",
          "chat-tool-empty",
        ),
      );
  }
  function insertPrompt(prompt) {
    const input = get("conversation-prompt"),
      draft = input.value.trim();
    const next =
      !draft || draft === "/"
        ? prompt.content
        : input.value.trimEnd() + "\n" + prompt.content;
    const maximum=state.assistant?.effectivePolicies?.messages.maxCharacters??0;
    if (maximum>0&&next.length>maximum) {
      message("Ce prompt dépasse la taille disponible dans le message.", true);
      return;
    }
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    get("quick-prompts-dialog").close();
    closePromptMenu();
    input.focus();
    sync();
  }
  function renderPrompts() {
    const target = get("quick-prompt-list");
    target.replaceChildren();
    const context = current?.projectId ? "project" : "general";
    for (const prompt of prompts) {
      const available = prompt.context === "all" || prompt.context === context;
      const row = node("article", null, "quick-prompt-row");
      const choose = button(
        "",
        () => insertPrompt(prompt),
        "quick-prompt-main",
      );
      choose.disabled = !available;
      choose.append(
        node("strong", prompt.title),
        node(
          "small",
          prompt.description ||
            {
              all: "Toutes les conversations",
              general: "Personnel",
              project: "Projets",
            }[prompt.context],
        ),
      );
      const actions = node("div", null, "quick-prompt-actions");
      actions.append(
        button("Modifier", () => editPrompt(prompt)),
        button("Supprimer", () => {
          deleting = prompt;
          show("quick-prompt-delete-dialog");
        }),
      );
      row.append(choose, actions);
      target.append(row);
    }
    if (!prompts.length)
      target.append(
        node(
          "p",
          "Aucun prompt enregistré. Utilise + pour créer tes raccourcis.",
          "chat-tool-empty",
        ),
      );
  }
  function editPrompt(prompt = null) {
    editing = prompt;
    get("quick-prompt-editor-heading").textContent = prompt
      ? "Modifier le prompt"
      : "Nouveau prompt";
    for (const key of ["title", "description", "content"])
      get("quick-prompt-" + key).value = prompt?.[key] || "";
    get("quick-prompt-context").value = prompt?.context || "all";
    window.heartControls?.sync();
    show("quick-prompt-editor-dialog");
    get("quick-prompt-title").focus();
  }
  get("quick-prompt-new").addEventListener("click", () => editPrompt());
  get("quick-prompt-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.saving) return;
    form.dataset.saving = "true";
    try {
      await post("/api/quick-prompts", {
        ...(editing ? { id: editing.id, version: editing.version } : {}),
        title: get("quick-prompt-title").value,
        description: get("quick-prompt-description").value,
        content: get("quick-prompt-content").value,
        context: get("quick-prompt-context").value,
      });
      get("quick-prompt-editor-dialog").close();
      await loadPrompts();
      message("Prompt rapide enregistré.");
    } catch (error) {
      notifyError(error);
    } finally {
      delete form.dataset.saving;
    }
  });
  get("quick-prompt-delete-confirm").addEventListener("click", async () => {
    if (!deleting) return;
    const prompt = deleting;
    get("quick-prompt-delete-confirm").disabled = true;
    try {
      await post("/api/quick-prompts/delete", {
        id: prompt.id,
        version: prompt.version,
      });
      get("quick-prompt-delete-dialog").close();
      deleting = null;
      await loadPrompts();
      message("Prompt supprimé.");
    } catch (error) {
      notifyError(error);
    } finally {
      get("quick-prompt-delete-confirm").disabled = false;
    }
  });
  get("chat-quick-prompts").addEventListener("click", async () => {
    if (!get("quick-prompts-popover").hidden) {
      closePromptMenu();
      return;
    }
    get("quick-prompts-popover").hidden = false;
    get("chat-quick-prompts").setAttribute("aria-expanded", "true");
    get("quick-prompts-menu").replaceChildren(
      node("p", "Chargement…", "chat-tool-empty"),
    );
    try {
      await loadPrompts(true);
    } catch (error) {
      get("quick-prompts-menu").replaceChildren(
        node("p", errorText(error), "chat-tool-empty"),
      );
    }
  });
  get("quick-prompt-manage").addEventListener("click", async () => {
    closePromptMenu();
    show("quick-prompts-dialog");
    renderPrompts();
    try {
      await loadPrompts();
    } catch (error) {
      notifyError(error);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      !get("quick-prompts-popover").hidden &&
      !event.target.closest(".composer-wrap")
    )
      closePromptMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !get("quick-prompts-popover").hidden) {
      event.preventDefault();
      closePromptMenu();
      get("conversation-prompt").focus();
    }
  });
  get("conversation-prompt").addEventListener("input", () => {
    sync();
    if (get("conversation-prompt").value === "/")
      get("chat-quick-prompts").click();
  });
  get("chat-clear-draft").addEventListener("click", () => {
    closePromptMenu();
    get("conversation-prompt").value = "";
    get("conversation-prompt").dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    get("conversation-prompt").focus();
  });
  function renderFiles() {
    const target = get("chat-file-list");
    target.replaceChildren();
    for (const file of files) {
      const row = node("article", null, "chat-file-row");
      const label = node("label", null, "check-label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selected.has(file.id);
      check.disabled = uploading || conversationRunning;
      check.setAttribute("aria-label", `Joindre ${file.name}`);
      check.addEventListener("change", () => {
        if (check.checked) {
          if (selected.size >= 5) {
            check.checked = false;
            message("Un message accepte 5 pièces jointes.", true);
            return;
          }
          selected.add(file.id);
        } else selected.delete(file.id);
        sync();
      });
      label.append(check);
      const open = button(
        "",
        () => preview(file, current.id),
        "chat-file-open",
      );
      open.append(
        node("strong", file.name),
        node(
          "small",
          `${sizeLabel(file.size)} · ${file.used ? "Dans l’historique" : "Non envoyé"}`,
        ),
      );
      const remove = button("Retirer", async () => {
        if (uploading || conversationRunning) return;
        try {
          await post(
            `/api/conversations/${current.id}/attachments/${file.id}/delete`,
          );
          selected.delete(file.id);
          await loadFiles();
          message("Fichier retiré.");
        } catch (error) {
          notifyError(error);
        }
      });
      remove.disabled = file.used || uploading || conversationRunning;
      remove.title = file.used
        ? "Déjà envoyé : conservé avec son historique"
        : "Supprimer ce fichier non envoyé";
      row.append(label, open, remove);
      target.append(row);
    }
    if (!files.length)
      target.append(
        node(
          "p",
          "Ajoute une image, un PDF ou un document texte.",
          "chat-tool-empty",
        ),
      );
    get("chat-add-files").disabled = uploading || conversationRunning;
  }
  get("chat-attachments").addEventListener("click", async () => {
    if (!current) return;
    show("chat-files-dialog");
    renderFiles();
    try {
      await loadFiles();
    } catch (error) {
      notifyError(error);
    }
  });
  get("chat-add-files").addEventListener("click", () =>
    get("chat-file-input").click(),
  );
  function mediaType(file) {
    const ext = file.name.split(".").at(-1).toLowerCase();
    return (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        pdf: "application/pdf",
        md: "text/markdown",
        csv: "text/csv",
        json: "application/json",
        xml: "application/xml",
        yaml: "application/yaml",
        yml: "application/yaml",
        txt: "text/plain",
        jsonl: "text/plain",
      }[ext] ||
      file.type ||
      "text/plain"
    );
  }
  const readBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () =>
        reject(new Error("Lecture du fichier impossible."));
      reader.readAsDataURL(file);
    });
  function upload(file, conversationId) {
    return new Promise(async (resolve, reject) => {
      let finish;
      try {
        const data = await readBase64(file);
        finish = window.heartFeedback.begin(
          `/api/conversations/${conversationId}/attachments`,
          "POST",
        );
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/conversations/${conversationId}/attachments`);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("X-CSRF-Token", csrf);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            get("attachment-upload-label").textContent =
              `${file.name} · ${percent < 100 ? percent + " %" : "enregistrement…"}`;
            get("attachment-upload-progress").value = percent;
          }
        };
        xhr.onload = () => {
          let result = {};
          try {
            result = JSON.parse(xhr.responseText);
          } catch {}
          if (xhr.status >= 200 && xhr.status < 300) {
            finish();
            resolve(result.file);
          } else {
            const error = new Error(
              result.error || "Ajout du fichier impossible.",
            );
            finish(error);
            reject(error);
          }
        };
        xhr.onerror = () => {
          const error = new Error(
            "Connexion interrompue. Actualise les fichiers avant de recommencer.",
          );
          finish(error);
          reject(error);
        };
        xhr.send(
          JSON.stringify({ name: file.name, mediaType: mediaType(file), data }),
        );
      } catch (error) {
        finish?.(error);
        reject(error);
      }
    });
  }
  get("chat-file-input").addEventListener("change", async (event) => {
    const incoming = [...event.target.files];
    event.target.value = "";
    if (!incoming.length || !current || uploading) return;
    if (selected.size + incoming.length > 5) {
      message("Un message accepte au maximum 5 pièces jointes.", true);
      return;
    }
    if (incoming.some((file) => !file.size || file.size > 8 * 1024 * 1024)) {
      message("Un fichier doit faire entre 1 octet et 8 Mio.", true);
      return;
    }
    if (
      incoming.reduce(
        (sum, file) => sum + file.size,
        selectedFiles().reduce((sum, file) => sum + file.size, 0),
      ) >
      20 * 1024 * 1024
    ) {
      message("Le message dépasse 20 Mio de pièces jointes.", true);
      return;
    }
    uploading = true;
    const id = current.id;
    get("attachment-upload").hidden = false;
    sync();
    renderFiles();
    renderConversationBrain();
    try {
      for (const file of incoming) {
        get("attachment-upload-label").textContent = `Lecture de ${file.name}…`;
        get("attachment-upload-progress").value = 0;
        const saved = await upload(file, id);
        if (current?.id === id) {
          files.push(saved);
          selected.add(saved.id);
          sync();
          renderFiles();
        }
      }
      message("Pièces jointes prêtes pour le prochain message.");
    } catch (error) {
      notifyError(error);
      try {
        await loadFiles(id);
      } catch {}
    } finally {
      uploading = false;
      get("attachment-upload").hidden = true;
      sync();
      renderFiles();
      renderConversationBrain();
    }
  });
  async function preview(file, conversationId = current?.id) {
    if (!conversationId) return;
    get("chat-file-preview-heading").textContent = file.name;
    const href = fileUrl(conversationId, file.id);
    const download = get("chat-file-download");
    download.href = href;
    download.download = file.name;
    const body = get("chat-file-preview-body");
    body.replaceChildren();
    show("chat-file-preview");
    if (file.mediaType.startsWith("image/")) {
      const image = document.createElement("img");
      image.src = href;
      image.alt = file.name;
      image.onerror = () => {
        body.replaceChildren(
          node("p", "Aperçu indisponible. Le fichier reste téléchargeable."),
        );
      };
      body.append(image);
    } else if (file.mediaType === "application/pdf")
      body.append(node("p", "Document PDF. Télécharge-le pour l’ouvrir."));
    else {
      const finish = window.heartFeedback.begin(href, "GET");
      let error;
      try {
        const response = await fetch(href, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Lecture du fichier impossible.");
        const text = await response.text();
        body.append(node("pre", text.slice(0, 100000)));
        if (text.length > 100000)
          body.append(
            node(
              "p",
              "Aperçu limité à 100 000 caractères. Télécharge le fichier complet.",
            ),
          );
      } catch (cause) {
        error = cause;
        notifyError(cause);
      } finally {
        finish(error);
      }
    }
  }
  get("chat-stop").addEventListener("click", async () => {
    if (!busy() || cancelling || !current) return;
    const id = current.id;
    cancelling = true;
    sync();
    try {
      const data = await post(`/api/conversations/${id}/cancel`);
      if (current?.id === id) renderConversation(data);
      message(
        "Réponse interrompue. Les actions déjà terminées restent conservées.",
      );
    } catch (error) {
      notifyError(error);
    } finally {
      cancelling = false;
      sync();
    }
  });
  document
    .querySelectorAll("[data-close-chat-dialog]")
    .forEach((button) =>
      button.addEventListener("click", () => button.closest("dialog").close()),
    );
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  window.heartChatTools = {
    sync,
    conversation,
    preview,
    busy,
    selected: selectedFiles,
    uploading: () => uploading,
    sent() {
      selected.clear();
      void loadFiles().catch(notifyError);
    },
    reset() {
      closePromptMenu();
      clearTimeout(pollTimer);
      pollTimer = null;
      remoteBusy = false;
      current = null;
      files = [];
      selected.clear();
      prompts = [];
      for (const id of [
        "quick-prompts-dialog",
        "quick-prompt-editor-dialog",
        "quick-prompt-delete-dialog",
        "chat-files-dialog",
        "chat-file-preview",
      ])
        get(id).close();
    },
  };
  sync();
})();
