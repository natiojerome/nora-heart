// @ts-check
/** @typedef {import('../../../contracts/project-tracking.ts').ProjectOverview} Overview */
/** @typedef {import('../../../contracts/project-tracking.ts').ProjectItem} Item */
/** @typedef {import('../../../contracts/project-tracking.ts').ProjectItemKind} Kind */
/** Project plans are remote data. No polling, optimistic completion or local plan mirror. */
(() => {
  const labels = /** @type {Record<string,string>} */ ({
    planning: "À préparer",
    active: "En cours",
    blocked: "Bloqué",
    paused: "En pause",
    completed: "Terminé",
    archived: "Archivé",
    proposed: "Proposé",
    cancelled: "Annulé",
    todo: "À faire",
    in_progress: "En cours",
    done: "Terminé",
    open: "Ouvert",
    resolved: "Résolu",
    current: "Actuelle",
    superseded: "Remplacée",
    linked: "Liée",
    removed: "Retirée",
  });
  const kinds = /** @type {Record<Kind,string>} */ ({
    goal: "Objectif",
    task: "Étape",
    blocker: "Blocage",
    decision: "Décision",
    reference: "Référence",
  });
  const statuses = {
    project: [
      "planning",
      "active",
      "blocked",
      "paused",
      "completed",
      "archived",
    ],
    goal: ["proposed", "active", "blocked", "completed", "cancelled"],
    task: ["todo", "in_progress", "blocked", "done", "cancelled"],
    blocker: ["open", "resolved"],
  };
  /** @template {keyof HTMLElementTagNameMap} T @param {T} tag @param {string} [text] @param {string} [cls] */
  function node(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  /** @param {string} title @param {()=>void} action @param {string} [icon] */
  function button(title, action, icon) {
    const b = node("button", title, "button secondary");
    b.type = "button";
    if (icon) {
      const mark = node("span", undefined, "project-button-icon");
      mark.dataset.icon = icon;
      mark.setAttribute("aria-hidden", "true");
      b.prepend(mark);
    }
    b.addEventListener("click", action);
    return b;
  }
  /** @param {HTMLElement} target @param {string} title @param {string|undefined} value */
  function field(target, title, value) {
    if (!value?.trim()) return;
    const d = node("div", undefined, "project-field");
    d.append(node("span", title), node("p", value));
    target.append(d);
  }
  /** @type {{id:string,target:HTMLElement,data:Overview|null,items:Item[],generation:number}|null} */
  let current = null;
  let sequence = 0;
  const dialog = node("dialog", undefined, "editor-dialog");
  dialog.id = "project-plan-editor";
  dialog.setAttribute("aria-labelledby", "project-plan-heading");
  document.body.append(dialog);
  let saving = false;
  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  /** @param {boolean} [more] */
  async function refresh(more = false) {
    const owner = current;
    if (!owner || !owner.target.isConnected || !state.authenticated) return;
    const ticket = ++sequence;
    owner.generation = ticket;
    const cursor = more ? owner.data?.nextCursor : null;
    if (more && !cursor) return;
    owner.target.setAttribute("aria-busy", "true");
    const loading = node(
      "p",
      more ? "Chargement des étapes…" : "Chargement du suivi…",
      "field-help",
    );
    loading.setAttribute("role", "status");
    owner.target.append(loading);
    for (const b of owner.target.querySelectorAll("button")) b.disabled = true;
    try {
      const data = /** @type {Overview & {available:boolean}} */ (
        await api(
          `/api/projects/${owner.id}${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
        )
      );
      if (
        current !== owner ||
        owner.generation !== ticket ||
        !owner.target.isConnected ||
        !state.authenticated
      )
        return;
      if (!data.available) {
        owner.target.replaceChildren(
          node(
            "p",
            "Connecte le service Projets pour gérer les objectifs.",
            "field-help",
          ),
        );
        return;
      }
      owner.items = more
        ? [
            ...new Map(
              [...owner.items, ...data.items].map((item) => [item.id, item]),
            ).values(),
          ]
        : data.items;
      owner.data = data;
      render(owner);
    } catch (error) {
      if (
        current !== owner ||
        owner.generation !== ticket ||
        !owner.target.isConnected
      )
        return;
      loading.remove();
      const problem = node("div", undefined, "project-plan-error");
      problem.setAttribute("role", "alert");
      problem.append(
        node("p", errorText(error)),
        button("Réessayer", () => void refresh(more)),
      );
      owner.target.append(problem);
    } finally {
      if (current === owner && owner.generation === ticket) {
        owner.target.removeAttribute("aria-busy");
        for (const b of owner.target.querySelectorAll("button"))
          b.disabled = false;
        loading.remove();
      }
    }
  }
  /** @param {NonNullable<typeof current>} owner */
  function render(owner) {
    const data = owner.data;
    if (!data) return;
    const p = data.project,
      target = owner.target;
    target.replaceChildren();
    const toolbar = node("div", undefined, "project-plan-toolbar");
    const title = node("h2", "Objectif global");
    toolbar.append(
      title,
      button("Modifier", () => edit(), "edit"),
      button("Actualiser", () => void refresh(), "refresh"),
    );
    target.append(toolbar);
    const global = node("div", undefined, "project-global");
    global.append(
      node("span", labels[p.status || "planning"] || p.status, "project-state"),
    );
    field(global, "Résultat attendu", p.objective);
    field(global, "Réussite mesurable", p.successCriteria);
    field(global, "Résultat / preuve", p.evidence);
    field(global, "Prochaine action", p.nextAction);
    target.append(global);
    const stats = node("div", undefined, "project-statistics");
    stats.setAttribute("aria-label", "Avancement du projet");
    for (const kind of ["goal", "task", "blocker"]) {
      const rows = data.statistics.filter((s) => s.kind === kind),
        total = rows.reduce((n, s) => n + s.count, 0);
      const closed = rows.filter((s) =>
          ["completed", "done", "resolved"].includes(s.status),
        ),
        done = closed.reduce((n, s) => n + s.count, 0),
        documented = closed.reduce((n, s) => n + s.documented, 0),
        cancelled = rows
          .filter((s) => s.status === "cancelled")
          .reduce((n, s) => n + s.count, 0);
      const stat = node("div");
      stat.append(
        node(
          "strong",
          kind === "blocker"
            ? `${total - done} ouverts`
            : `${documented} / ${total - cancelled}`,
        ),
        node(
          "span",
          kind === "goal"
            ? "Objectifs"
            : kind === "task"
              ? "Étapes"
              : "Blocages",
        ),
      );
      if (kind !== "blocker") stat.append(node("small", "documentés"));
      if (kind !== "blocker" && done > documented)
        stat.append(
          node(
            "small",
            `${done - documented} terminé(s) sans preuve renseignée`,
          ),
        );
      if (cancelled) stat.append(node("small", `${cancelled} annulé(s)`));
      stats.append(stat);
    }
    target.append(stats);
    const tools = node("div", undefined, "project-plan-toolbar");
    tools.append(
      node("h2", "Objectifs et étapes"),
      button("Ajouter", () => edit(null), "add"),
    );
    target.append(tools);
    const list = node("div", undefined, "project-plan-list");
    const work = owner.items.filter((i) =>
        ["goal", "task", "blocker"].includes(i.kind),
      ),
      byId = new Map(work.map((i) => [i.id, i]));
    /** @type {Map<string|null,Item[]>} */ const children = new Map();
    for (const item of work) {
      const parent = byId.has(item.parentId || "") ? item.parentId : null;
      children.set(parent, [...(children.get(parent) || []), item]);
    }
    const stack = (children.get(null) || [])
        .map((item) => ({ item, depth: 0 }))
        .reverse(),
      seen = new Set();
    while (stack.length) {
      const { item, depth } = /** @type {{item:Item,depth:number}} */ (
        stack.pop()
      );
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      list.append(itemCard(item, depth));
      for (const child of [...(children.get(item.id) || [])].reverse())
        stack.push({ item: child, depth: depth + 1 });
    }
    // Preserve visibility even if a page is partial or a stale relationship forms a cycle.
    for (const item of work)
      if (!seen.has(item.id)) list.append(itemCard(item, 0));
    if (!work.length)
      list.append(
        node(
          "p",
          "Ajoute une étape à l’objectif global, ou crée plusieurs objectifs.",
          "field-help",
        ),
      );
    target.append(list);
    const journal = owner.items.filter((i) =>
      ["decision", "reference"].includes(i.kind),
    );
    if (journal.length) {
      const details = node("details", undefined, "project-journal");
      details.append(
        node("summary", `Décisions et références (${journal.length})`),
      );
      for (const item of journal) {
        const r = node("div");
        r.append(node("strong", item.title));
        field(r, kinds[item.kind], item.details);
        details.append(r);
      }
      target.append(details);
    }
    if (data.nextCursor)
      target.append(button("Charger la suite", () => void refresh(true)));
    const stamp = node(
      "p",
      `État lu le ${new Date(data.asOf).toLocaleString("fr-FR")}. Compteurs sur tout le projet.`,
      "field-help",
    );
    target.append(stamp);
    window.heartIcons.render(target);
  }
  /** @param {Item} item @param {number} depth */
  function itemCard(item, depth) {
    const card = node("article", undefined, "project-plan-item");
    card.dataset.itemId = item.id;
    card.style.setProperty("--project-depth", String(Math.min(depth, 6)));
    const heading = node("div", undefined, "project-item-heading"),
      copy = node("div");
    copy.append(
      node("span", kinds[item.kind], "project-item-kind"),
      node("h3", item.title),
    );
    heading.append(
      copy,
      node("span", labels[item.status] || item.status, "project-state"),
    );
    card.append(heading);
    if (item.parentId && !current?.items.some((i) => i.id === item.parentId))
      card.append(
        node("small", "Objectif parent sur une autre page.", "field-help"),
      );
    if (
      ["done", "completed"].includes(item.status) &&
      (!item.successCriteria.trim() || !item.evidence.trim())
    )
      card.append(node("p", "Terminé sans preuve renseignée.", "field-help"));
    if (item.details || item.successCriteria || item.evidence) {
      const details = node("details");
      details.append(node("summary", "Détails et résultat"));
      field(details, "Détails", item.details);
      field(details, "Réussite mesurable", item.successCriteria);
      field(details, "Résultat / preuve", item.evidence);
      card.append(details);
    }
    const actions = node("div", undefined, "project-item-actions");
    actions.append(button("Modifier", () => edit(item), "edit"));
    if (item.kind === "goal")
      actions.append(
        button("Ajouter une étape", () => edit(null, item.id), "add"),
      );
    card.append(actions);
    return card;
  }
  /** undefined edits project, null creates an item. @param {Item|null} [item] @param {string} [parentId] */
  function edit(item, parentId) {
    const owner = current;
    if (!owner?.data) return;
    const p = owner.data.project,
      isProject = item === undefined;
    const heading = node("header", undefined, "editor-heading"),
      title = node(
        "h2",
        isProject
          ? "Objectif global"
          : item
            ? "Modifier " + kinds[item.kind].toLowerCase()
            : "Ajouter au projet",
      );
    title.id = "project-plan-heading";
    const close = button("Fermer", () => dialog.close());
    heading.append(title, close);
    const form = node("form"),
      body = node("div", undefined, "editor-scroll"),
      fields = node("fieldset", undefined, "editor-fields");
    body.append(fields);
    /** @type {Map<string,HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>} */ const inputs =
      new Map();
    /** @param {string} name @param {string} label @param {string} value @param {string[]|null} [choices] @param {boolean} [required] */
    function input(name, label, value, choices = null, required = false) {
      const labelEl = node("label", label);
      labelEl.htmlFor = "project-plan-" + name;
      const control = choices
        ? node("select")
        : name === "title"
          ? node("input")
          : node("textarea");
      control.id = labelEl.htmlFor;
      control.name = name;
      control.required = required;
      if (control instanceof HTMLTextAreaElement) control.rows = 2;
      if (choices && control instanceof HTMLSelectElement)
        for (const option of choices) {
          const o = node("option", labels[option] || option);
          o.value = option;
          control.append(o);
        }
      control.value = value;
      fields.append(labelEl, control);
      inputs.set(name, control);
      return control;
    }
    if (!isProject) {
      input("kind", "Type", item?.kind || "task", ["goal", "task", "blocker"]);
      const k = /** @type {HTMLSelectElement} */ (inputs.get("kind"));
      for (const o of k.options)
        o.textContent = kinds[/** @type {Kind} */ (o.value)];
      k.disabled = !!item;
    }
    input(
      "title",
      isProject ? "Nom du projet" : "Nom",
      isProject ? p.title : item?.title || "",
      null,
      true,
    );
    if (isProject)
      input("objective", "Résultat attendu", p.objective || "", null, true);
    const kind = /** @type {'goal'|'task'|'blocker'} */ (item?.kind || "task");
    input(
      "status",
      "État",
      isProject ? p.status || "planning" : item?.status || "todo",
      isProject ? statuses.project : statuses[kind],
    );
    if (!isProject) {
      const parent = /** @type {HTMLSelectElement} */ (
        input("parentId", "Objectif parent", "", [])
      );
      const empty = node("option", "Objectif global");
      empty.value = "";
      parent.append(empty);
      for (const goal of owner.items.filter(
        (g) => g.kind === "goal" && g.id !== item?.id,
      )) {
        const option = node("option", goal.title);
        option.value = goal.id;
        parent.append(option);
      }
      const selected = item?.parentId || parentId || "";
      if (selected && ![...parent.options].some((o) => o.value === selected)) {
        const missing = node("option", "Objectif sur une autre page");
        missing.value = selected;
        parent.append(missing);
      }
      parent.value = selected;
      if (owner.data.nextCursor)
        fields.append(
          node(
            "p",
            "Charge les autres pages du suivi pour proposer aussi leurs objectifs.",
            "field-help",
          ),
        );
    }
    input(
      "successCriteria",
      "Réussite mesurable",
      isProject ? p.successCriteria || "" : item?.successCriteria || "",
    );
    input(
      "evidence",
      "Résultat / preuve",
      isProject ? p.evidence || "" : item?.evidence || "",
    );
    fields.append(
      node(
        "p",
        "Pour terminer un objectif ou une étape : critère et résultat constaté. Termine ses étapes et résous ses blocages d’abord.",
        "field-help",
      ),
    );
    input(
      isProject ? "nextAction" : "details",
      isProject ? "Prochaine action" : "Détails",
      isProject ? p.nextAction || "" : item?.details || "",
    );
    const status = node("p", "", "field-help");
    status.id = "project-plan-editor-status";
    status.setAttribute("role", "status");
    body.append(status);
    const actions = node("div", undefined, "editor-actions"),
      cancel = button("Annuler", () => dialog.close()),
      save = node("button", "Enregistrer", "button primary");
    save.type = "submit";
    actions.append(cancel, save);
    form.append(body, actions);
    dialog.replaceChildren(heading, form);
    if (!isProject && !item) {
      inputs.get("kind")?.addEventListener("change", () => {
        const selected = /** @type {'goal'|'task'|'blocker'} */ (
          inputs.get("kind")?.value
        );
        const select = /** @type {HTMLSelectElement} */ (inputs.get("status"));
        select.replaceChildren(
          ...statuses[selected].map((value) => {
            const option = node("option", labels[value]);
            option.value = value;
            return option;
          }),
        );
        window.heartControls?.sync();
      });
    }
    let operationId = window.heartPlatform.uuid();
    form.addEventListener("input", () => {
      if (!saving) operationId = window.heartPlatform.uuid();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving || !form.reportValidity()) return;
      if (current?.id !== owner.id || !state.authenticated) {
        status.textContent = "Rouvre ce projet avant de modifier son suivi.";
        return;
      }
      saving = true;
      fields.disabled = true;
      save.disabled = true;
      cancel.disabled = true;
      close.disabled = true;
      status.textContent = "Enregistrement…";
      /** @type {Record<string,unknown>} */ const body = {};
      for (const [name, control] of inputs) body[name] = control.value;
      if (!isProject) {
        body.parentId = body.parentId || null;
        if (item) {
          body.id = item.id;
          body.version = item.version;
        } else body.operationId = operationId;
      } else body.version = p.version;
      try {
        await post(
          `/api/projects/${owner.id}${isProject ? "" : "/items"}`,
          body,
        );
        if (!state.authenticated) return;
        dialog.close();
        message("Suivi enregistré.");
        if (isProject) await loadProjects();
        else if (current?.id === owner.id) await refresh();
      } catch (error) {
        status.textContent = errorText(error);
        message(errorText(error), true);
      } finally {
        saving = false;
        fields.disabled = false;
        save.disabled = false;
        cancel.disabled = false;
        close.disabled = false;
      }
    });
    window.heartControls?.sync();
    dialog.showModal();
    inputs.get("title")?.focus();
  }
  window.heartProjects = {
    open(id, target) {
      if (dialog.open && !saving && current?.id !== id) dialog.close();
      current = { id, target, data: null, items: [], generation: ++sequence };
      void refresh();
    },
    reset() {
      current = null;
      sequence++;
      if (dialog.open) dialog.close();
    },
  };
  window.addEventListener("focus", () => {
    if (
      location.hash === "#projects" &&
      !dialog.open &&
      current?.target.isConnected
    )
      void refresh();
  });
})();
