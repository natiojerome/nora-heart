/* Owner configuration and explicit catalogue review. No credentials are accepted here. */
(() => {
  const get = (id) => document.getElementById(id),
    node = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
  let records = [],
    preset = null,
    current = null,
    definitions = [],
    generation = 0,
    loaded = false,
    loading = false,
    busy = false,
    reviewed = false;
  function request() {
    return {
      id: current?.id,
      version: current?.version || 0,
      label: get("mcp-label").value.trim(),
      url: get("mcp-url").value.trim(),
      timeoutMs: Number(get("mcp-timeout").value) * 1000,
      enabled: get("mcp-enabled").checked,
      allowWrites: get("mcp-writes").checked,
      transient: get("mcp-transient").checked,
      auth:
        get("mcp-auth").value === "none"
          ? { type: "none" }
          : {
              type: get("mcp-auth").value,
              envVar: get("mcp-env").value.trim(),
              ...(get("mcp-auth").value === "header_env"
                ? { headerName: get("mcp-header").value.trim() }
                : {}),
            },
    };
  }
  function controls() {
    get("mcp-form").querySelector("fieldset").disabled = busy;
    get("mcp-dialog").querySelector("[data-close-mcp]").disabled = busy;
    get("mcp-dialog").querySelector("[data-cancel-mcp]").disabled = busy;
    get("mcp-auth-fields").hidden = get("mcp-auth").value === "none";
    get("mcp-header-box").hidden = get("mcp-auth").value !== "header_env";
    get("mcp-discover").disabled = busy;
    get("mcp-save").disabled = busy;
    get("mcp-save").textContent = busy ? "En cours…" : "Enregistrer";
    window.heartControls?.sync();
  }
  function catalogue(selected = []) {
    const target = get("mcp-tool-choices");
    target.replaceChildren();
    for (const tool of definitions) {
      const item = node("div", null, "mcp-tool-item"),
        row = node("label", null, "mcp-tool-choice"),
        check = document.createElement("input");
      check.type = "checkbox";
      check.value = tool.name;
      check.checked =
        selected.includes(tool.name) &&
        (tool.readOnlyHint !== false || get("mcp-writes").checked);
      check.disabled =
        (tool.readOnlyHint === false && !get("mcp-writes").checked) || busy;
      const copy = node("span");
      copy.append(
        node("strong", tool.displayName || tool.title || tool.name),
        node("small", tool.name),
      );
      if (tool.description)
        copy.append(node("span", tool.description.split("\n")[0]));
      if (tool.readOnlyHint === false)
        copy.append(node("small", "Écriture · autorisation requise"));
      row.append(check, copy);
      const detail = node("details", null, "mcp-tool-description");
      detail.append(
        node("summary", "Description et paramètres"),
        node("p", tool.description),
        node("pre", JSON.stringify(tool.inputSchema, null, 2)),
      );
      item.append(row, detail);
      target.append(item);
    }
    get("mcp-catalogue").hidden = !definitions.length;
  }
  function open(connection) {
    reviewed = false;
    current = connection || {
      version: 0,
      auth: { type: "none" },
      enabled: false,
      timeoutMs: 60000,
      tools: [],
    };
    definitions = current.tools || [];
    get("mcp-dialog-title").textContent = current.version
      ? "Connexion MCP"
      : "Ajouter une connexion MCP";
    get("mcp-label").value = current.displayName || current.label || "";
    get("mcp-url").value = current.url || "";
    get("mcp-auth").value = current.auth.type;
    get("mcp-env").value = current.auth.envVar || "";
    get("mcp-header").value = current.auth.headerName || "x-api-key";
    get("mcp-timeout").value = String(current.timeoutMs / 1000);
    get("mcp-enabled").checked = current.enabled;
    get("mcp-writes").checked = current.allowWrites === true;
    get("mcp-transient").checked = current.transient === true;
    get("mcp-status").textContent = "";
    catalogue(definitions.map((tool) => tool.name));
    controls();
    get("mcp-dialog").showModal();
    get("mcp-label").focus();
  }
  function toolRow(connection, tool, sourceLink) {
    const detail = node("details", null, "mcp-inventory-tool");
    detail.dataset.mcpTool = tool.name;
    const summary = node("summary"),
      copy = node("span", null, "mcp-tool-heading");
    copy.append(
      node("strong", tool.displayName || tool.title || tool.name),
      node(
        "small",
        sourceLink
          ? (connection.displayName || connection.label) +
              " · MCP" +
              (connection.enabled ? "" : " · Désactivée")
          : "MCP · " + tool.name,
      ),
    );
    summary.append(copy);
    const body = node("div", null, "mcp-tool-body");
    body.append(
      node("code", tool.name),
      node("p", tool.description || "Aucune description fournie."),
    );
    body.append(
      node(
        "p",
        connection.enabled
          ? "Connexion activée · accès réseau requis dans la discussion."
          : "Connexion désactivée : cet outil n’est pas proposé au modèle.",
        "field-help",
      ),
    );
    if (sourceLink) {
      const source = node(
        "button",
        "Configurer : " + (connection.displayName || connection.label),
        "text-button",
      );
      source.type = "button";
      source.onclick = () => open(connection);
      body.append(source);
    }
    detail.append(summary, body);
    return detail;
  }
  const ordered = () =>
    [...records].sort(
      (a, b) =>
        Number(b.enabled) - Number(a.enabled) ||
        (a.displayName || a.label).localeCompare(
          b.displayName || b.label,
          "fr",
        ),
    );
  function renderTools() {
    const target = get("mcp-tools-list");
    const previousGroups = [...target.querySelectorAll(".mcp-tool-group")];
    const expanded = new Set(
      previousGroups
        .filter((group) => group.open)
        .map((group) => group.dataset.connectionId),
    );
    target.replaceChildren();
    for (const connection of ordered()) {
      if (!connection.tools.length) continue;
      const group = node("details", null, "mcp-tool-group");
      group.open =
        expanded.has(connection.id) ||
        (!previousGroups.length &&
          records.filter((c) => c.tools.length).length === 1);
      group.dataset.connectionId = connection.id;
      const heading = node("summary", null, "mcp-tool-group-heading"),
        icon = node("span", null, "mcp-connection-icon");
      icon.dataset.icon = connection.icon || "tools";
      const copy = node("div");
      copy.append(
        node("h3", connection.displayName || connection.label),
        node(
          "small",
          connection.tools.length +
            (connection.tools.length === 1 ? " outil · " : " outils · ") +
            (connection.enabled ? "Connexion activée" : "Désactivée"),
        ),
      );
      const arrow = node("span");
      arrow.dataset.icon = "chevron-down";
      heading.append(icon, copy, arrow);
      group.append(heading);
      for (const tool of connection.tools)
        group.append(toolRow(connection, tool, true));
      if (connection.tools.some((tool) => tool.name === "memory_search")) {
        const link = node("a", "Gérer les souvenirs", "text-button");
        link.href = "#memories";
        group.append(link);
      }
      target.append(group);
    }
    window.heartIcons?.render(target);
    if (!target.childElementCount)
      target.append(
        node(
          "p",
          "Aucun outil connecté. Ajoute une connexion MCP pour en fournir.",
          "field-help",
        ),
      );
  }
  function render() {
    const target = get("mcp-connections");
    target.replaceChildren();
    for (const connection of ordered()) {
      const card = node("article", null, "mcp-connection"),
        icon = node("span", null, "mcp-connection-icon");
      icon.dataset.icon = connection.icon || "tools";
      const copy = node("div", null, "mcp-connection-copy");
      copy.append(
        node("strong", connection.displayName || connection.label),
        node(
          "small",
          "MCP · " +
            new URL(connection.url).host +
            new URL(connection.url).pathname,
        ),
      );
      const state = connection.enabled
        ? connection.health?.status === "connected"
          ? "Vérifié"
          : connection.health?.status === "unavailable"
            ? "À vérifier"
            : "Activé · à vérifier"
        : "Désactivé";
      const status = node(
        "span",
        `${state} · ${connection.tools.length} outil${connection.tools.length > 1 ? "s" : ""}`,
        "mcp-connection-state",
      );
      copy.append(status);
      const tools = node("details", null, "mcp-connection-tools");
      tools.append(node("summary", "Voir les outils fournis"));
      for (const tool of connection.tools)
        tools.append(toolRow(connection, tool, false));
      if (!connection.tools.length)
        tools.append(node("p", "Aucun outil sélectionné.", "field-help"));
      copy.append(tools);
      const button = node("button", null, "icon-button");
      button.type = "button";
      button.dataset.icon = "settings";
      button.title =
        "Configurer " + (connection.displayName || connection.label);
      button.setAttribute("aria-label", button.title);
      button.onclick = () => open(connection);
      card.append(icon, copy, button);
      target.append(card);
    }
    get("mcp-empty").hidden = !!records.length;
    get("mcp-local-search").hidden = records.some(
      (item) => item.id === preset?.id,
    );
    renderTools();
    window.heartIcons?.render(target);
  }
  async function load(force = false) {
    if (
      !state.authenticated ||
      !state.externalToolsAvailable ||
      loading ||
      (loaded && !force)
    )
      return;
    const owner = generation;
    loading = true;
    get("mcp-list-status").textContent = "Chargement des connexions…";
    get("mcp-tools-status").textContent = "Chargement des outils…";
    get("mcp-tools-refresh").disabled = true;
    get("mcp-refresh").disabled = true;
    try {
      const result = await api("/api/external-tools", { quiet: true });
      if (owner !== generation || !state.authenticated) return;
      records = result.connections;
      preset = result.preset;
      loaded = true;
      render();
      get("mcp-list-status").textContent = "";
      get("mcp-tools-status").textContent = "";
    } catch (error) {
      if (owner === generation) {
        get("mcp-list-status").textContent = errorText(error);
        get("mcp-tools-status").textContent = errorText(error);
      }
    } finally {
      if (owner === generation) {
        loading = false;
        get("mcp-refresh").disabled = false;
        get("mcp-tools-refresh").disabled = false;
      }
    }
  }
  async function discover() {
    busy = true;
    controls();
    get("mcp-status").textContent = "Connexion et lecture du catalogue…";
    const selected = [
      ...get("mcp-tool-choices").querySelectorAll("input:checked"),
    ].map((input) => input.value);
    try {
      const result = await post("/api/external-tools/discover", request());
      definitions = result.tools;
      reviewed = true;
      catalogue(selected);
      get("mcp-status").textContent =
        `Connexion réussie · ${definitions.length} outil${definitions.length > 1 ? "s" : ""}. Sélectionne ceux à autoriser.`;
    } catch (error) {
      get("mcp-status").textContent = errorText(error);
    } finally {
      busy = false;
      controls();
      for (const input of get("mcp-tool-choices").querySelectorAll("input"))
        input.disabled =
          definitions.find((tool) => tool.name === input.value)
            ?.readOnlyHint === false && !get("mcp-writes").checked;
    }
  }
  get("mcp-add").onclick = () => open();
  get("mcp-local-search").onclick = () => open(preset);
  get("mcp-tools-refresh").onclick = () => void load(true);
  get("mcp-refresh").onclick = () => void load(true);
  get("mcp-discover").onclick = () => void discover();
  get("mcp-writes").onchange = () =>
    catalogue(
      [...get("mcp-tool-choices").querySelectorAll("input:checked")].map(
        (input) => input.value,
      ),
    );
  get("mcp-auth").onchange = controls;
  for (const id of ["mcp-url", "mcp-auth", "mcp-env", "mcp-header"])
    get(id).addEventListener(id === "mcp-auth" ? "change" : "input", () => {
      definitions = [];
      reviewed = false;
      catalogue();
      get("mcp-status").textContent =
        "Teste la connexion pour choisir les outils.";
    });
  get("mcp-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const toolNames = [
      ...get("mcp-tool-choices").querySelectorAll("input:checked"),
    ].map((input) => input.value);
    busy = true;
    controls();
    get("mcp-status").textContent = "Enregistrement…";
    try {
      await post("/api/external-tools", {
        ...request(),
        toolNames,
        refreshDefinitions: reviewed,
      });
      get("mcp-dialog").close();
      message("Connexion MCP enregistrée.");
      await load(true);
    } catch (error) {
      get("mcp-status").textContent = errorText(error);
    } finally {
      busy = false;
      controls();
    }
  });
  get("mcp-dialog").addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  get("mcp-dialog").querySelector("[data-close-mcp]").onclick = () => {
    if (!busy) get("mcp-dialog").close();
  };
  get("mcp-dialog").querySelector("[data-cancel-mcp]").onclick = () => {
    if (!busy) get("mcp-dialog").close();
  };
  function sync() {
    if (!state.authenticated) {
      generation++;
      loading = false;
      loaded = false;
      records = [];
      preset = null;
      get("mcp-connections").replaceChildren();
      get("mcp-tools-list").replaceChildren();
      get("mcp-tools-status").textContent = "";
      return;
    }
    get("mcp-add").disabled = !state.externalToolsAvailable;
    get("mcp-local-search").disabled = !state.externalToolsAvailable;
    get("mcp-refresh").disabled = loading || !state.externalToolsAvailable;
    get("mcp-tools-refresh").disabled =
      loading || !state.externalToolsAvailable;
    if (!state.externalToolsAvailable) {
      get("mcp-list-status").textContent =
        "Connexions MCP indisponibles dans cette instance.";
      get("mcp-tools-status").textContent =
        "Connexions MCP indisponibles dans cette instance.";
    }
    if (["#tools", "#modules", "#tools-connections"].includes(location.hash))
      void load();
  }
  window.addEventListener("hashchange", sync);
  window.heartExternal = { sync };
  sync();
})();
