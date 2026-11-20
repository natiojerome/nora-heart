/* Presentation feedback shared by HTTP actions. No credentials or persistence. */
(() => {
  const requests = new Map();
  const locks = new WeakMap();
  const get = (id) => document.getElementById(id);
  const topDialog = () => [...document.querySelectorAll("dialog[open]")].at(-1);
  function status(dialog) {
    let node = dialog.querySelector(":scope > .dialog-feedback");
    if (!node) {
      node = document.createElement("div");
      node.className = "dialog-feedback";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      dialog.append(node);
    }
    return node;
  }
  let noticeTimer;
  function notice(text, error = false) {
    clearTimeout(noticeTimer);
    const node = get("global-message");
    node.replaceChildren();
    node.hidden = !text;
    node.classList.toggle("error", error);
    node.setAttribute("role", error ? "alert" : "status");
    if (text) {
      const copy = document.createElement("span");
      copy.textContent = text;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.className = "icon-button";
      close.setAttribute("aria-label", "Fermer la notification");
      close.addEventListener("click", () => {
        node.hidden = true;
      });
      node.append(copy, close);
      if (!error)
        noticeTimer = setTimeout(() => {
          node.hidden = true;
        }, 5000);
    }
    const dialog = topDialog();
    if (dialog) {
      const local = status(dialog);
      local.textContent = text;
      local.hidden = !text;
      local.classList.toggle("error", error);
      local.classList.remove("is-pending");
      local.setAttribute("role", error ? "alert" : "status");
    }
  }
  function labels(url, writing) {
    if (url.endsWith("/cancel"))
      return ["Interruption en cours…", "Réponse interrompue."];
    if (url.includes("/commands")) return [writing ? "Commande en cours…" : "Chargement de la sortie…", ""];
    if (url.includes("/execution-policy")) return ["Enregistrement des réglages…", "Réglages enregistrés."];
    if (url.includes("/workspace")) return [writing ? "Modification du fichier…" : "Chargement des fichiers…", ""];
    if (url.includes("/file-access")) return ["Mise à jour des permissions…", "Permissions enregistrées."];
    if (url.includes("/attachments"))
      return [
        writing ? "Envoi du fichier…" : "Chargement des fichiers…",
        "Fichier enregistré.",
      ];
    if (url.includes("/quick-prompts"))
      return [
        writing ? "Enregistrement du prompt…" : "Chargement des prompts…",
        "Prompt enregistré.",
      ];
    if (/\/conversations\/[^/]+\/interactions\//.test(url)) return ["Réponse en cours…", ""];
    if (url.includes("/messages")) return ["Réponse en cours…", ""];
    if (url === "/api/login")
      return ["Connexion en cours…", "Connexion établie."];
    if (url === "/api/logout") return ["Déconnexion en cours…", "Déconnecté."];
    if (url.includes("/chatgpt/callback"))
      return ["Vérification de la connexion…", "Adresse de retour vérifiée."];
    if (url.includes("/chatgpt/logout"))
      return ["Déconnexion du compte…", "Compte déconnecté."];
    if (url.includes("/chatgpt/login"))
      return ["Connexion OpenAI en cours…", "Connexion démarrée."];
    if (url.includes("/credentials"))
      return ["Enregistrement de la clé…", "Clé enregistrée."];
    if (url.includes("/assistant"))
      return ["Enregistrement des préférences…", "Préférences enregistrées."];
    if (url.includes("/revisions")) return ["Chargement de l’historique…", ""];
    if (url.includes("/memories"))
      return [
        writing ? "Enregistrement du souvenir…" : "Chargement des souvenirs…",
        "Souvenir enregistré.",
      ];
    if (url.includes("/projects"))
      return ["Création du projet…", "Projet créé."];
    if (/\/conversations\/[^/]+\/model$/.test(url))return ["Enregistrement du modèle du fil…","Modèle du fil enregistré."];
    if (url.includes("/conversations"))
      return [
        writing
          ? "Création de la conversation…"
          : "Chargement des conversations…",
        "Conversation créée.",
      ];
    if (url.includes("/tests"))
      return ["Vérifications en cours…", "Vérifications terminées."];
    if (url.includes("/test"))
      return ["Exécution de l’essai…", "Essai terminé."];
    if (url.includes("/models")) return ["Chargement des modèles…", ""];
    return ["Chargement en cours…", "Terminé."];
  }
  function refresh() {
    const items = [...requests.values()].filter(
      (item) => !(item.chat && document.body.classList.contains("chat-mode")),
    );
    const node = get("request-progress");
    node.hidden = items.length === 0;
    if (items.length) node.textContent = items.at(-1).label;
    for (const dialog of document.querySelectorAll("dialog[open]")) {
      const pending = items.filter((item) => item.dialog === dialog);
      dialog.setAttribute("aria-busy", String(pending.length > 0));
      dialog.dataset.writes = String(
        pending.filter((item) => item.writing).length,
      );
      if (pending.length) {
        const local = status(dialog);
        local.hidden = false;
        local.textContent = pending.at(-1).label;
        local.classList.add("is-pending");
        local.classList.remove("error");
      }
    }
  }
  function begin(url, method) {
    const writing = method && method !== "GET";
    const [label, success] = labels(url, writing);
    if (writing) notice("");
    const dialog = topDialog();
    const active = document.activeElement;
    const form = active?.closest("form");
    const controls = new Set();
    if (writing && dialog)
      dialog
        .querySelectorAll("[data-close-editor]")
        .forEach((node) => controls.add(node));
    if (active?.tagName === "BUTTON") controls.add(active);
    // Preserve the ability to type the next chat draft while a reply is pending.
    if (form && form.id !== "conversation-send") {
      form
        .querySelectorAll(
          "fieldset.editor-fields, input, select, textarea, button",
        )
        .forEach((node) => controls.add(node));
    }
    for (const control of controls) {
      const lock = locks.get(control) || {
        count: 0,
        disabled: control.disabled,
      };
      lock.count++;
      locks.set(control, lock);
      control.disabled = true;
    }
    const id = Symbol();
    const item = {
      label,
      success,
      dialog,
      writing,
      chat:
        writing && /^\/api\/conversations\/[^/]+\/(messages|cancel|interactions\/[^/]+)$/.test(url),
    };
    requests.set(id, item);
    refresh();
    const timer = setTimeout(() => {
      item.label =
        label + " Toujours en attente du serveur ; ne relance pas l’action.";
      refresh();
    }, 12000);
    return (error) => {
      clearTimeout(timer);
      requests.delete(id);
      for (const control of controls) {
        const lock = locks.get(control);
        lock.count--;
        if (!lock.count) {
          control.disabled = lock.disabled;
          locks.delete(control);
        }
      }
      if (dialog) {
        dialog.dataset.writes = String(
          [...requests.values()].filter((r) => r.dialog === dialog && r.writing)
            .length,
        );
        dialog.removeAttribute("aria-busy");
      }
      if (error) notice(error.message || "La demande n’a pas abouti.", true);
      else if (writing && success) notice(success);
      else if (
        dialog &&
        ![...requests.values()].some((item) => item.dialog === dialog)
      ) {
        const local = status(dialog);
        local.hidden = true;
        local.classList.remove("is-pending");
      }
      refresh();
    };
  }
  document.addEventListener(
    "cancel",
    (event) => {
      if (Number(event.target.dataset.writes)) {
        event.preventDefault();
        notice("Enregistrement en cours. Attends le résultat avant de fermer.");
      }
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("button");
      const dialog = button?.closest("dialog");
      if (dialog && Number(dialog.dataset.writes) && button.type !== "submit") {
        event.preventDefault();
        event.stopImmediatePropagation();
        notice("Enregistrement en cours. Attends le résultat avant de fermer.");
      }
    },
    true,
  );
  const composer = document.querySelector(".composer-zone");
  if (composer)
    new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--composer-size",
        `${composer.getBoundingClientRect().height}px`,
      ),
    ).observe(composer);
  window.heartFeedback = { begin, notice };
})();
