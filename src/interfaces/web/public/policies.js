/* Owner runtime limits. Versioned catalogue, lazy reads, no provider calls. */
(() => {
  const get = (id) => document.getElementById(id);
  const groups = {
    messages: {
      title: "Messages",
      icon: "conversations",
      help: "Longueur maximale d’un message envoyé. 0 = sans plafond Heart.",
      fields: [["maxCharacters", "Longueur maximale", "caractères"]],
    },
    tools: {
      title: "Outils",
      icon: "tools",
      help: "Nombre d’appels proposés dans une seule réponse du modèle. Les permissions du fil restent inchangées. 0 = sans plafond.",
      fields: [["maxCallsPerBatch", "Appels par lot", "appels"]],
    },
    context: {
      title: "Contexte",
      icon: "brain",
      help: "Le seuil porte sur le contexte utilisable, après réserve de réponse. Le tour courant reste entier.",
      fields: [
        ["compressionPercent", "Déclenchement de la compression", "%", 1, 100],
        ["maxSummaryCalls", "Appels de résumé par compression", "appels"],
      ],
    },
    memory: {
      title: "Mémoire",
      icon: "memories",
      help: "Recherche de l’assistant puis sélection pour son contexte. Une valeur élevée utilise davantage de ressources et de tokens. 0 = sans plafond.",
      fields: [
        ["terms", "Mots-clés par recherche", "mots-clés"],
        ["candidates", "Candidats examinés", "souvenirs"],
        ["results", "Résultats de recherche", "souvenirs"],
        ["injectedItems", "Souvenirs injectés", "souvenirs"],
        ["injectedCharacters", "Texte injecté", "caractères"],
      ],
    },
  };
  let catalog = null,
    active = false,
    loading = false,
    saving = false,
    sequence = 0,
    generation = 0,
    editing = null,
    rendered = "";
  const node = (tag, text, cls) => {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (cls) value.className = cls;
    return value;
  };
  const label = (value, unit) =>
    value === 0
      ? "Sans plafond"
      : new Intl.NumberFormat("fr-FR").format(value) +
        (unit === "%" ? " %" : " " + unit);
  function sync() {
    const maximum = state.assistant?.effectivePolicies?.messages.maxCharacters;
    if (maximum === undefined) return;
    const prompt = get("conversation-prompt"),
      value = maximum > 0 && maximum <= 2147483647 ? String(maximum) : null;
    if (prompt.getAttribute("maxlength") === value) return;
    if (value === null) prompt.removeAttribute("maxlength");
    else prompt.setAttribute("maxlength", value);
  }
  function render() {
    if (!catalog) return;
    const signature = JSON.stringify(catalog.policies);
    if (signature === rendered) return;
    rendered = signature;
    const target = get("policy-cards");
    target.replaceChildren();
    for (const [id, group] of Object.entries(groups)) {
      const button = node("button", undefined, "settings-row");
      button.type = "button";
      button.dataset.policySection = id;
      const icon = node("span", undefined, "settings-row-icon");
      icon.dataset.icon = group.icon;
      icon.setAttribute("aria-hidden", "true");
      const copy = node("span", undefined, "settings-row-copy");
      copy.append(node("strong", group.title));
      const lines = group.fields.map(
        ([key, title, unit]) =>
          title + " : " + label(catalog.policies[id][key], unit),
      );
      copy.append(node("small", lines.join(" · ")));
      const pencil = node("span");
      pencil.dataset.icon = "edit";
      pencil.setAttribute("aria-hidden", "true");
      button.append(icon, copy, pencil);
      button.onclick = () => open(id);
      target.append(button);
    }
    window.heartIcons?.render(target);
  }
  async function load(force = false) {
    if (!active || !state.authenticated || loading) return;
    if (!force && catalog && catalog.version === state.assistant?.version) {
      render();
      return;
    }
    const version = ++sequence;
    loading = true;
    get("policies-refresh").disabled = true;
    get("policies-status").textContent = "Chargement…";
    try {
      const value = await api("/api/policies");
      if (version !== sequence) return;
      if (value.version < (state.assistant?.version ?? 0)) {
        get("policies-status").textContent =
          "Réglages modifiés depuis cette lecture. Actualise pour les retrouver.";
        return;
      }
      catalog = value;
      if (!active) return;
      state.assistant = value.profile;
      window.heartUI?.sync();
      render();
      get("policies-status").textContent = "";
    } catch (error) {
      if (version === sequence)
        get("policies-status").textContent = errorText(error);
    } finally {
      if (version === sequence) {
        loading = false;
        get("policies-refresh").disabled = false;
      }
    }
  }
  function open(section) {
    if (!catalog || saving) return;
    const group = groups[section];
    editing = {
      section,
      version: catalog.version,
      baseValue: structuredClone(catalog.policies[section]),
    };
    get("policy-dialog-title").textContent = group.title;
    get("policy-help").textContent = group.help;
    get("policy-status").textContent = "";
    const fields = get("policy-fields");
    fields.replaceChildren();
    for (const [key, title, unit, min = 0, max] of group.fields) {
      const field = node("div", undefined, "policy-field"),
        labelNode = node("label", title);
      labelNode.htmlFor = "policy-" + key;
      const input = node("input");
      input.id = "policy-" + key;
      input.type = "number";
      input.min = String(min);
      input.step = "1";
      input.required = true;
      if (max) input.max = String(max);
      input.value = String(catalog.policies[section][key]);
      const value = node("div", undefined, "policy-number");
      value.append(input, node("span", unit));
      field.append(labelNode, value);
      fields.append(field);
    }
    message("");
    window.heartUI.openEditor("policy-dialog", "policy-" + group.fields[0][0]);
  }
  get("policy-reset").addEventListener("click", () => {
    if (!editing || saving) return;
    for (const [key] of groups[editing.section].fields)
      get("policy-" + key).value = String(
        catalog.defaults[editing.section][key],
      );
    get("policy-status").textContent =
      "Valeurs par défaut chargées. Enregistre pour les appliquer.";
  });
  get("policy-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editing || saving) return;
    const value = Object.fromEntries(
      groups[editing.section].fields.map(([key]) => [
        key,
        Number(get("policy-" + key).value),
      ]),
    );
    const changed = Object.fromEntries(
      Object.entries(value).filter(([key, n]) => n !== editing.baseValue[key]),
    );
    const dialog = get("policy-dialog");
    if (!Object.keys(changed).length) {
      dialog.close();
      message("Aucune modification à enregistrer.");
      return;
    }
    const owner = generation;
    saving = true;
    dialog.dataset.writes = "1";
    dialog
      .querySelectorAll("input,button")
      .forEach((control) => (control.disabled = true));
    get("policy-status").textContent = "Enregistrement…";
    try {
      const result = await post("/api/policies", {
        section: editing.section,
        version: editing.version,
        baseValue: editing.baseValue,
        value: changed,
      });
      if (owner !== generation || !state.authenticated) return;
      catalog = result;
      state.assistant = result.profile;
      window.heartUI?.sync();
      render();
      dialog.close();
      message("Limites enregistrées. Appliquées au prochain message.");
    } catch (error) {
      if (owner !== generation) return;
      get("policy-status").textContent = errorText(error);
    } finally {
      saving = false;
      dialog.dataset.writes = "0";
      dialog
        .querySelectorAll("input,button")
        .forEach((control) => (control.disabled = false));
    }
  });
  get("policy-dialog").addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  get("policies-refresh").addEventListener("click", () => void load(true));
  window.heartPolicies = {
    sync,
    route(value) {
      active = value === "policies";
      if (!active && !saving) get("policy-dialog").close();
      if (active) void load();
    },
    reset() {
      sequence++;
      generation++;
      get("policies-refresh").disabled = false;
      get("policies-status").textContent = "";
      get("policy-status").textContent = "";
      get("policy-fields").replaceChildren();
      catalog = null;
      editing = null;
      loading = false;
      rendered = "";
      get("policy-cards").replaceChildren();
    },
  };
  sync();
  window.heartConfiguration?.route(location.hash.slice(1));
})();
