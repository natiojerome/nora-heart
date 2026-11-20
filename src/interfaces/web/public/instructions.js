/* Owner instruction editor. No inference, polling, or credentials. */
(() => {
  const get = (id) => document.getElementById(id);
  let route = "",
    loaded = false,
    loading = false,
    sequence = 0,
    generation = 0,
    catalog = null,
    editing = null,
    saving = false,
    rendered = "";
  const node = (tag, text, cls) => {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (cls) value.className = cls;
    return value;
  };
  function render() {
    if (!catalog) return;
    const signature = JSON.stringify(catalog.blocks);
    if (signature === rendered) return;
    rendered = signature;
    const list = get("instruction-list");
    list.replaceChildren();
    for (const block of catalog.blocks) {
      const button = node("button", undefined, "instruction-row");
      button.type = "button";
      button.dataset.instructionId = block.id;
      const copy = node("span", undefined, "instruction-row-copy"),
        title = node("span", undefined, "instruction-row-title");
      title.append(
        node("strong", block.title),
        node(
          "small",
          block.customized ? "Personnalisé" : "Par défaut",
          "instruction-state",
        ),
      );
      copy.append(
        title,
        node("small", block.when, "instruction-when"),
        node(
          "span",
          block.value || "Aucune consigne supplémentaire.",
          "instruction-preview",
        ),
      );
      button.append(copy);
      const icon = node("span");
      icon.dataset.icon = "edit";
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
      button.addEventListener("click", () => open(block));
      list.append(button);
    }
    window.heartIcons?.render(list);
  }
  async function load(force = false) {
    if (!state.authenticated || route !== "instructions" || loading) return;
    if (!force && loaded && catalog?.version === state.assistant?.version) {
      render();
      return;
    }
    const current = ++sequence;
    loading = true;
    get("instructions-refresh").disabled = true;
    get("instruction-list").setAttribute("aria-busy", "true");
    get("instructions-status").textContent = "Chargement des instructions…";
    try {
      const value = await api("/api/instructions");
      if (current !== sequence) return;
      if (value.version < (state.assistant?.version ?? 0)) {
        loaded = false;
        get("instructions-status").textContent =
          "Profil modifié depuis cette lecture. Actualise pour le recharger.";
        return;
      }
      catalog = value;
      loaded = true;
      if (route !== "instructions") return;
      if (value.profile) {
        state.assistant = value.profile;
        window.heartUI?.sync();
      }
      render();
      message("");
      get("instructions-status").textContent = "";
    } catch (error) {
      if (current === sequence)
        get("instructions-status").textContent = errorText(error);
    } finally {
      if (current === sequence) {
        loading = false;
        get("instructions-refresh").disabled = false;
        get("instruction-list").removeAttribute("aria-busy");
      }
    }
  }
  function open(block) {
    editing = {
      ...block,
      version: catalog.version,
      baseValue: block.customized ? block.value : null,
    };
    get("instruction-editor-title").textContent = block.title;
    get("instruction-editor-when").textContent = block.when;
    get("instruction-text").value = block.value;
    get("instruction-default-text").textContent = block.defaultValue;
    get("instruction-editor-status").textContent = "";
    message("");
    window.heartUI.openEditor("instruction-dialog", "instruction-text");
    get("instruction-text").setSelectionRange(0, 0);
    get("instruction-text").scrollTop = 0;
  }
  get("instruction-reset").addEventListener("click", () => {
    if (!editing || saving) return;
    get("instruction-text").value = editing.defaultValue;
    get("instruction-text").setSelectionRange(0, 0);
    get("instruction-text").scrollTop = 0;
    get("instruction-editor-status").textContent =
      "Valeur par défaut chargée. Enregistre pour l’appliquer.";
  });
  get("instruction-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || !editing) return;
    const owner = generation;
    saving = true;
    get("instruction-save").disabled = true;
    get("instruction-reset").disabled = true;
    get("instruction-text").disabled = true;
    get("instruction-editor-status").textContent = "Enregistrement…";
    try {
      const value = get("instruction-text").value;
      const result = await post("/api/instructions", {
        id: editing.id,
        version: editing.version,
        baseValue: editing.baseValue,
        value: value === editing.defaultValue ? null : value,
      });
      if (owner !== generation || !state.authenticated) return;
      catalog = result;
      loaded = true;
      if (result.profile) {
        state.assistant = result.profile;
        window.heartUI?.sync();
      }
      render();
      get("instruction-dialog").close();
      message("Instruction enregistrée. Appliquée aux prochains échanges.");
    } catch (error) {
      if (owner !== generation) return;
      get("instruction-editor-status").textContent = errorText(error);
    } finally {
      saving = false;
      get("instruction-save").disabled = false;
      get("instruction-reset").disabled = false;
      get("instruction-text").disabled = false;
    }
  });
  get("instructions-refresh").addEventListener("click", () => void load(true));
  window.heartInstructions = {
    route(value) {
      if (value !== route && route === "instructions" && !saving)
        get("instruction-dialog").close();
      route = value;
      if (route === "instructions") void load();
    },
    reset() {
      sequence++;
      generation++;
      get("instructions-refresh").disabled = false;
      get("instruction-list").removeAttribute("aria-busy");
      get("instructions-status").textContent = "";
      get("instruction-editor-status").textContent = "";
      get("instruction-text").value = "";
      get("instruction-default-text").textContent = "";
      loaded = false;
      loading = false;
      catalog = null;
      editing = null;
      rendered = "";
      get("instruction-list").replaceChildren();
    },
  };
  window.heartConfiguration?.route(location.hash.slice(1));
})();
