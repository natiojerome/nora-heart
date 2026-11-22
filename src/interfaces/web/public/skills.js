/* Skill catalogue: lazy reads, owner activation, no inference or automatic execution. */
(() => {
  const get = (id) => document.getElementById(id),
    node = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
  let catalog = null,
    loading = false,
    saving = false,
    editing = null,
    generation = 0,
    sequence = 0,
    detailSequence = 0,
    rendered = "";
  const active = () => location.hash === "#tools-skills";
  function render() {
    const signature = JSON.stringify(catalog?.skills);
    if (signature === rendered) return;
    rendered = signature;
    const list = get("skills-list");
    list.replaceChildren();
    for (const skill of catalog?.skills ?? []) {
      const row = node("button", undefined, "settings-row");
      row.type = "button";
      row.dataset.skillId = skill.id;
      row.disabled = !!skill.problem;
      const icon = node("span", undefined, "settings-row-icon");
      icon.dataset.icon = "instructions";
      const copy = node("span", undefined, "settings-row-copy");
      copy.append(
        node("strong", skill.displayName ?? skill.name),
        node(
          "small",
          skill.problem ??
            (skill.enabled ? "Disponible" : "Désactivé") +
              " · " +
              skill.description,
        ),
      );
      const next = node("span");
      next.dataset.icon = "arrow-right";
      row.append(icon, copy, next);
      row.onclick = () => void open(skill);
      list.append(row);
    }
    if (!catalog?.skills.length)
      list.append(node("p", "Aucun skill enregistré.", "field-help"));
    window.heartIcons?.render(list);
  }
  async function load(force = false) {
    if (!state.authenticated || !active() || loading || saving) return;
    if (!force && catalog && catalog.version === state.assistant?.version) {
      render();
      return;
    }
    const request = ++sequence;
    loading = true;
    get("skills-refresh").disabled = true;
    get("skills-status").textContent = "Chargement…";
    try {
      const value = await api("/api/skills");
      if (request !== sequence) return;
      if (value.version < (state.assistant?.version ?? 0)) {
        get("skills-status").textContent =
          "Réglages modifiés. Actualise le catalogue.";
        return;
      }
      catalog = value;
      if (!active()) return;
      render();
      get("skills-status").textContent = "";
    } catch (e) {
      if (request === sequence) get("skills-status").textContent = errorText(e);
    } finally {
      if (request === sequence) {
        loading = false;
        get("skills-refresh").disabled = false;
      }
    }
  }
  async function open(skill) {
    if (saving) return;
    const owner = generation,
      request = ++detailSequence;
    editing = null;
    get("skill-title").textContent = skill.displayName ?? skill.name;
    get("skill-description").textContent = skill.description;
    get("skill-source").textContent = "";
    get("skill-resource-list").replaceChildren();
    get("skill-resources").hidden = true;
    get("skill-enabled").checked = skill.enabled;
    get("skill-enabled").disabled = true;
    get("skill-copy").disabled = true;
    get("skill-status").textContent = "Chargement des instructions…";
    const unambiguous =
      /^[\p{L}\p{N}-]+$/u.test(skill.name) &&
      catalog.skills.filter((s) => s.name === skill.name && !s.problem)
        .length === 1;
    get("skill-invocation").textContent =
      "$" + (unambiguous ? skill.name : skill.id);
    window.heartUI.openEditor("skill-dialog", "skill-enabled");
    window.heartControls?.sync();
    try {
      const value = await api("/api/skills/" + encodeURIComponent(skill.id), {
        quiet: true,
      });
      if (
        owner !== generation ||
        request !== detailSequence ||
        !get("skill-dialog").open
      )
        return;
      editing = {
        ...skill,
        revision: value.revision,
        version: catalog.version,
      };
      get("skill-source").textContent = value.instructions;
      for (const file of value.resources)
        get("skill-resource-list").append(node("li", file));
      get("skill-resources").hidden = !value.resources.length;
      get("skill-status").textContent = "";
      get("skill-enabled").disabled = false;
      get("skill-copy").disabled = false;
    } catch (e) {
      if (owner === generation && request === detailSequence)
        get("skill-status").textContent = errorText(e);
    } finally {
      window.heartControls?.sync();
    }
  }
  get("skill-enabled").addEventListener("change", async () => {
    if (!editing || saving) return;
    const selected = { ...editing },
      owner = generation,
      enabled = get("skill-enabled").checked;
    saving = true;
    const dialog = get("skill-dialog");
    dialog.dataset.writes = "1";
    dialog.querySelectorAll("button,input").forEach((n) => (n.disabled = true));
    get("skill-status").textContent = "Enregistrement…";
    try {
      const value = await post("/api/skills", {
        id: selected.id,
        revision: selected.revision,
        enabled,
        baseEnabled: selected.enabled,
        version: selected.version,
      });
      if (owner !== generation || !state.authenticated) return;
      if (value.version >= (state.assistant?.version ?? 0)) {
        catalog = value;
        state.assistant = value.profile;
        render();
        window.heartUI?.sync();
      }
      editing = { ...selected, enabled, version: value.version };
      get("skill-status").textContent = enabled
        ? "Activé pour les prochains échanges."
        : "Désactivé pour les prochains échanges.";
      message("Skill " + (enabled ? "activé." : "désactivé."));
    } catch (e) {
      if (owner === generation) {
        get("skill-enabled").checked = selected.enabled;
        get("skill-status").textContent = errorText(e);
      }
    } finally {
      saving = false;
      dialog.dataset.writes = "0";
      dialog
        .querySelectorAll("button,input")
        .forEach((n) => (n.disabled = false));
      window.heartControls?.sync();
    }
  });
  get("skill-dialog").addEventListener("cancel", (e) => {
    if (saving) e.preventDefault();
  });
  get("skill-copy").onclick = () =>
    window.heartPlatform.copy(get("skill-invocation").textContent).then(
      () => message("Invocation copiée."),
      () => message("Copie impossible. Sélectionne l’invocation.", true),
    );
  get("skills-refresh").onclick = () => void load(true);
  function reset() {
    generation++;
    sequence++;
    detailSequence++;
    catalog = null;
    loading = false;
    editing = null;
    rendered = "";
    get("skills-list").replaceChildren();
    get("skill-source").textContent = "";
    get("skill-description").textContent = "";
    get("skill-title").textContent = "Skill";
    get("skill-invocation").textContent = "";
    get("skill-enabled").checked = false;
    get("skill-resource-list").replaceChildren();
    get("skills-status").textContent = "";
    get("skill-status").textContent = "";
    get("skills-refresh").disabled = false;
  }
  function sync() {
    if (!state.authenticated) {
      reset();
      return;
    }
    if (!state.skillsAvailable) {
      get("skills-status").textContent =
        "Skills indisponibles dans cette instance.";
      get("skills-refresh").disabled = true;
      return;
    }
    get("skills-refresh").disabled = loading;
    if (active()) void load();
  }
  window.heartSkills = { sync, reset };
  window.addEventListener("hashchange", sync);
  sync();
})();
