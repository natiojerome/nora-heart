// @ts-check
/** @typedef {import("../../../contracts/tasks.ts").Task} HeartTask */
/** @typedef {import("../../../contracts/tasks.ts").TaskRun} HeartTaskRun */
/** @typedef {HeartTask & {lastRun: HeartTaskRun|null}} HeartTaskRow */
/** @typedef {{tasks:HeartTaskRow[],unread:number,nextCursor:string|null,scheduler?:{running:boolean,error:string|null,concurrency:number}|null}} HeartTaskCatalogue */
/** @typedef {{task:HeartTask,conversation:import("../../../contracts/conversations.ts").Conversation|null,runs:HeartTaskRun[],nextCursor:string|null}} HeartTaskDetail */
/* Durable task owner controls. Definitions never invoke a model; run-now queues an occurrence. */
(() => {
  /** @template {string} K @param {K} id @returns {K extends keyof HeartTaskElements ? HeartTaskElements[K] : HTMLElement} */
  const get = (id) =>
    /** @type {K extends keyof HeartTaskElements ? HeartTaskElements[K] : HTMLElement} */ (
      document.getElementById(id)
    );
  /** @template {keyof HTMLElementTagNameMap} K @param {K} tag @param {string} [text] @param {string} [cls] */
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  /** @param {string} id @param {string} value */
  const text = (id, value) => {
    const element = get(id);
    if (element.textContent !== value) element.textContent = value;
  };
  /** @param {Element} target @param {boolean} value */
  const disabled = (target, value) => {
    const element = /** @type {HTMLButtonElement} */ (target);
    if (element.disabled !== value) element.disabled = value;
  };
  /** @param {string} id @param {boolean} value */
  const hidden = (id, value) => {
    const element = get(id);
    if (element.hidden !== value) element.hidden = value;
  };
  const labels = {
    queued: "En attente",
    running: "En cours",
    waiting: "Réponse attendue",
    succeeded: "Terminée",
    failed: "Échec",
    interrupted: "À vérifier",
    skipped: "Ignorée",
    cancelled: "Annulée",
  };
  const openStates = ["queued", "running", "waiting", "interrupted"];
  /** @type {HeartTaskCatalogue|null} */
  let catalog = null;
  let loading = false,
    saving = false,
    generation = 0,
    sequence = 0,
    detailSequence = 0,
    lastAt = 0,
    rendered = "",
    conversationSequence = 0,
    onTasks = false;
  /** @type {HeartTaskDetail|null} */ let current = null;
  /** @type {HeartTask|null} */ let editing = null;
  /** @type {HeartTaskRun[]} */ let history = [];
  /** @type {string|null} */ let historyCursor = null;
  /** @type {string|null} */ let conversationCursor = null;
  /** @type {import("../../../contracts/conversations.ts").Conversation[]} */ let conversationRows =
    [];
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let searchTimer;
  let moreVisible = false;
  /** @type {Map<string,string>} */
  const manualKeys = new Map(),
    active = () => location.hash === "#automations";
  /** @param {string|null|undefined} value @param {string} [timezone] */
  const date = (value, timezone) =>
    value
      ? new Date(value).toLocaleString("fr-FR", {
          dateStyle: "short",
          timeStyle: "short",
          ...(timezone ? { timeZone: timezone } : {}),
        })
      : "Aucune";
  /** @param {import("../../../contracts/tasks.ts").TaskSchedule} s */
  function scheduleText(s) {
    if (s.kind === "once")
      return (
        "Une fois · " +
        new Date(s.at).toLocaleString("fr-FR", {
          timeZone: s.timezone,
          dateStyle: "short",
          timeStyle: "short",
        }) +
        " · " +
        s.timezone
      );
    return (
      {
        daily: "Chaque jour",
        weekdays: "Lundi–vendredi",
        weekly: [
          "Dimanche",
          "Lundi",
          "Mardi",
          "Mercredi",
          "Jeudi",
          "Vendredi",
          "Samedi",
        ][s.weekday ?? 1],
      }[s.frequency] +
      " · " +
      s.time +
      " · " +
      s.timezone
    );
  }
  function render() {
    if (!catalog) return;
    const badge = get("tasks-badge");
    if (badge) {
      const text = String(catalog.unread);
      if (badge.textContent !== text) badge.textContent = text;
      hidden("tasks-badge", !catalog.unread);
    }
    const worker = catalog.scheduler;
    text(
      "tasks-worker",
      worker?.error ??
        (worker
          ? (worker.running
              ? "Planificateur actif"
              : "Planificateur en veille") +
            " · " +
            (worker.concurrency
              ? worker.concurrency + " exécutions simultanées"
              : "Parallélisme sans plafond")
          : "Planificateur non démarré."),
    );
    const signature = JSON.stringify(catalog.tasks);
    if (signature === rendered) return;
    rendered = signature;
    const list = get("task-cards");
    list.replaceChildren();
    for (const task of catalog.tasks) {
      const button = node("button", undefined, "task-card");
      button.type = "button";
      button.dataset.taskId = task.id;
      const heading = node("div", undefined, "task-card-heading");
      heading.append(
        node("strong", task.title),
        node("span", task.active ? "Active" : "En pause", "tag"),
      );
      button.append(
        heading,
        node("small", scheduleText(task.schedule)),
        node(
          "small",
          "Prochaine : " + date(task.nextAt, task.schedule.timezone),
        ),
        node(
          "span",
          task.lastRun ? labels[task.lastRun.status] : "Jamais exécutée",
          "task-last-state",
        ),
      );
      button.onclick = () => void open(task.id);
      list.append(button);
    }
    if (!catalog.tasks.length)
      list.append(
        node(
          "p",
          "Aucune tâche. Crée un planning lié à une discussion.",
          "panel field-help",
        ),
      );
  }
  async function load(force = false, background = false, more = false) {
    if (!state.authenticated || !state.tasksAvailable || loading) return;
    if (!force && Date.now() - lastAt < pollDelay()) return;
    const request = ++sequence;
    const params = new URLSearchParams();
    if (more && catalog?.nextCursor) params.set("after", catalog.nextCursor);
    else if (catalog && catalog.tasks.length > 20)
      params.set("limit", String(catalog.tasks.length));
    loading = true;
    if (more) text("tasks-more-status", "Chargement…");
    hidden("tasks-more-retry", true);
    if (!background && !more) {
      disabled(get("tasks-refresh"), true);
      if (active()) text("tasks-status", "Chargement…");
    }
    try {
      /** @type {HeartTaskCatalogue} */
      const data = await api("/api/tasks" + (params.size ? "?" + params : ""), {
        quiet: true,
      });
      if (more && catalog) {
        const merged = new Map(catalog.tasks.map((task) => [task.id, task]));
        for (const task of data.tasks) merged.set(task.id, task);
        data.tasks = [...merged.values()];
      }
      if (request !== sequence) return;
      const previousDelay = pollDelay();
      catalog = data;
      if (timer && pollDelay() < previousDelay) {
        clearTimeout(timer);
        timer = setTimeout(poll, pollDelay());
      }
      lastAt = Date.now();
      render();
      text("tasks-status", "");
      text("tasks-more-status", "");
    } catch (e) {
      if (request === sequence) {
        text("tasks-status", errorText(e));
        if (more) hidden("tasks-more-retry", false);
      }
    } finally {
      if (request === sequence) {
        loading = false;
        disabled(get("tasks-refresh"), false);
        if (
          more &&
          moreVisible &&
          catalog?.nextCursor &&
          get("tasks-more-retry").hidden
        )
          queueMicrotask(() => void load(true, true, true));
      }
    }
  }
  function sync() {
    if (!state.authenticated) {
      reset();
      return;
    }
    get("task-create").disabled = !state.tasksAvailable;
    if (!state.tasksAvailable) {
      get("tasks-status").textContent =
        "Planification indisponible dans cette instance.";
      return;
    }
    if (!document.hidden && !saving && !get("task-editor").open)
      void load(false, !!catalog);
    if (!timer || onTasks !== active()) {
      clearTimeout(timer);
      timer = setTimeout(poll, pollDelay());
    }
    onTasks = active();
  }
  function pollDelay() {
    if (!active() && !get("task-detail").open) return 30000;
    return catalog?.tasks.some(
      (task) =>
        ["queued", "running"].includes(task.lastRun?.status ?? "") ||
        (task.active &&
          task.nextAt &&
          new Date(task.nextAt).getTime() - Date.now() < 15000),
    )
      ? 3000
      : 15000;
  }
  async function poll() {
    const owner = generation;
    timer = undefined;
    if (
      state.authenticated &&
      !document.hidden &&
      !saving &&
      !get("task-editor").open
    ) {
      await load(true, true);
      if (owner !== generation) return;
      if (current && get("task-detail").open && !saving)
        await open(current.task.id, true, false, true).catch(() => {});
    }
    if (
      owner === generation &&
      state.authenticated &&
      state.tasksAvailable &&
      !timer
    )
      timer = setTimeout(poll, pollDelay());
  }
  function reset() {
    generation++;
    sequence++;
    detailSequence++;
    conversationSequence++;
    clearTimeout(timer);
    timer = undefined;
    clearTimeout(searchTimer);
    loading = false;
    saving = false;
    disabled(get("tasks-refresh"), false);
    catalog = null;
    current = null;
    editing = null;
    history = [];
    rendered = "";
    lastAt = 0;
    manualKeys.clear();
    get("task-cards").replaceChildren();
    get("task-history").replaceChildren();
    get("task-history").removeAttribute("data-signature");
    get("task-prompt").value = "";
    get("tasks-status").textContent = "";
    get("task-detail-status").textContent = "";
    if (get("tasks-badge")) get("tasks-badge").hidden = true;
  }
  /** @param {string} id */
  async function open(id, refresh = false, more = false, background = false) {
    const owner = generation,
      request = ++detailSequence;
    if (!refresh) {
      current = null;
      get("task-detail")
        .querySelectorAll(".task-detail-actions button")
        .forEach((n) => disabled(n, true));
      history = [];
      historyCursor = null;
      get("task-history").replaceChildren();
      get("task-history").removeAttribute("data-signature");
      get("task-detail-title").textContent = "Tâche";
      get("task-detail-status").textContent = "Chargement…";
      window.heartUI.openEditor("task-detail", "task-run-now");
    }
    try {
      /** @type {HeartTaskDetail} */
      const data = await api(
        "/api/tasks/" +
          id +
          (more && historyCursor
            ? "?before=" + encodeURIComponent(historyCursor)
            : refresh && history.length > 20
              ? "?limit=" + history.length
              : ""),
        { quiet: true },
      );
      if (
        owner !== generation ||
        request !== detailSequence ||
        !get("task-detail").open
      )
        return;
      current = data;
      const prior = more
        ? [...history, ...data.runs]
        : [...data.runs, ...(refresh ? history : [])];
      // Keep fresh rows first and retain every already loaded history page.
      const unique = new Map();
      for (const run of prior) if (!unique.has(run.id)) unique.set(run.id, run);
      history = [...unique.values()];
      historyCursor = data.nextCursor
        ? (history.at(-1)?.sequence ?? null)
        : null;
      text("task-detail-title", data.task.title);
      text(
        "task-detail-summary",
        scheduleText(data.task.schedule) +
          " · Prochaine : " +
          date(data.task.nextAt, data.task.schedule.timezone) +
          "\n" +
          (data.conversation
            ? data.conversation.title +
              " · " +
              (data.conversation.selection?.modelId ?? "Modèle absent")
            : "Discussion liée"),
      );
      if (!background) text("task-detail-status", "");
      if (!saving)
        get("task-detail")
          .querySelectorAll(".task-detail-actions button")
          .forEach((n) =>
            disabled(
              n,
              n.id === "task-run-now" &&
                history.some((r) => openStates.includes(r.status)),
            ),
          );
      text("task-toggle", data.task.active ? "Pause" : "Reprendre");
      const signature = JSON.stringify(history);
      if (get("task-history").dataset.signature !== signature) {
        get("task-history").dataset.signature = signature;
        get("task-history").replaceChildren();
        for (const run of history) {
          const row = node("article", undefined, "task-run");
          row.dataset.runId = run.id;
          row.append(
            node("strong", labels[run.status]),
            node(
              "small",
              date(run.createdAt, run.task.timezone) +
                (run.scheduled ? " · Planifiée" : " · Manuelle"),
            ),
            node("p", run.detail),
          );
          const chat = node("button", "Ouvrir la discussion", "text-button");
          chat.type = "button";
          chat.dataset.conversationId = run.task.conversationId;
          chat.onclick = () => void openChat(run.task.conversationId);
          row.append(chat);
          if (
            run.task.notify &&
            !run.seen &&
            !["queued", "running"].includes(run.status)
          ) {
            const read = node("button", "Marquer comme lu", "text-button");
            read.type = "button";
            read.onclick = () =>
              void action("/api/tasks/" + id + "/runs/" + run.id + "/read", {
                status: run.status,
              });
            row.append(read);
          }
          if (run.status === "interrupted") {
            const close = node(
              "button",
              "Clôturer sans relancer",
              "text-button",
            );
            close.type = "button";
            close.onclick = () =>
              void action(
                "/api/tasks/" + id + "/runs/" + run.id + "/resolve",
                {},
              );
            row.append(close);
          }
          get("task-history").append(row);
        }
      }
      hidden("task-history-more", !historyCursor);
    } catch (e) {
      if (owner === generation && request === detailSequence)
        text("task-detail-status", errorText(e));
    }
  }
  function invalidateReads() {
    sequence++;
    detailSequence++;
    loading = false;
    get("tasks-refresh").disabled = false;
  }
  /** @param {string} url @param {Record<string,unknown>} body */
  async function action(url, body) {
    if (saving || !current) return;
    const owner = generation,
      id = current.task.id;
    saving = true;
    invalidateReads();
    const dialog = get("task-detail");
    dialog.dataset.writes = "1";
    dialog.querySelectorAll("button").forEach((n) => disabled(n, true));
    get("task-detail-status").textContent = "Enregistrement…";
    try {
      await post(url, body);
      if (owner !== generation) return;
      if (url.endsWith("/run")) manualKeys.delete(id);
      saving = false;
      await load(true);
      await open(id, true);
    } catch (e) {
      if (owner === generation)
        get("task-detail-status").textContent = errorText(e);
    } finally {
      if (owner !== generation) return;
      saving = false;
      dialog.dataset.writes = "0";
      dialog.querySelectorAll("button").forEach((n) => disabled(n, false));
      if (history.some((r) => openStates.includes(r.status)))
        get("task-run-now").disabled = true;
    }
  }
  function fields() {
    const frequency = get("task-frequency").value,
      once = frequency === "once";
    get("task-date-field").hidden = !once;
    get("task-date").required = once;
    get("task-time-field").hidden = once;
    get("task-time").required = !once;
    get("task-weekday-field").hidden = frequency !== "weekly";
    window.heartControls?.sync();
  }
  /** @param {string} at @param {string} timezone */
  function localDate(at, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(at)),
      v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
  }
  async function conversations(more = false) {
    const owner = generation,
      request = ++conversationSequence,
      params = new URLSearchParams({
        limit: "20",
        query: get("task-search").value,
      });
    if (more && conversationCursor) params.set("before", conversationCursor);
    try {
      const data = await api("/api/conversations?" + params, { quiet: true });
      if (
        owner !== generation ||
        request !== conversationSequence ||
        !get("task-editor").open
      )
        return;
      conversationRows = more
        ? [...conversationRows, ...data.conversations]
        : data.conversations;
      conversationCursor = data.nextCursor;
      const selected =
          get("task-conversation").value || editing?.conversationId,
        options = conversationRows.map(
          (c) =>
            new Option(
              c.title +
                (c.selection
                  ? " · " + c.selection.modelId
                  : " · Choisir un modèle"),
              c.id,
            ),
        );
      if (
        selected &&
        !conversationRows.some((c) => c.id === selected) &&
        editing
      )
        options.unshift(
          new Option(
            current?.conversation?.title ?? "Discussion sélectionnée",
            selected,
          ),
        );
      get("task-conversation").replaceChildren(
        new Option("Choisir une discussion", ""),
        ...options,
      );
      get("task-conversation").value = selected ?? "";
      get("task-more-conversations").hidden = !conversationCursor;
      window.heartControls?.sync();
    } catch (e) {
      if (
        owner === generation &&
        request === conversationSequence &&
        get("task-editor").open
      )
        text("task-editor-status", errorText(e));
    }
  }
  /** @param {HeartTask|null} [task] */
  function edit(task = null) {
    editing = task ? structuredClone(task) : null;
    get("task-editor-title").textContent = task
      ? "Modifier la tâche"
      : "Nouvelle tâche";
    get("task-title").value = task?.title ?? "";
    get("task-prompt").value = task?.prompt ?? "";
    get("task-search").value = "";
    get("task-conversation").replaceChildren(
      new Option("Choisir une discussion", ""),
    );
    conversationCursor = null;
    conversationRows = [];
    const schedule = task?.schedule;
    get("task-frequency").value =
      schedule?.kind === "recurring" ? schedule.frequency : "once";
    get("task-timezone").value =
      schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    get("task-date").value =
      schedule?.kind === "once"
        ? localDate(schedule.at, schedule.timezone)
        : "";
    get("task-time").value =
      schedule?.kind === "recurring" ? schedule.time : "";
    get("task-weekday").value = String(
      schedule?.kind === "recurring" ? (schedule.weekday ?? 1) : 1,
    );
    get("task-missed").value = task?.missed ?? "catch_up";
    get("task-notify").checked = task?.notify ?? true;
    get("task-active").checked = task?.active ?? true;
    get("task-editor-status").textContent = "";
    if (get("task-detail").open) get("task-detail").close();
    window.heartUI.openEditor("task-editor", "task-title");
    fields();
    void conversations();
  }
  get("task-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    const owner = generation,
      frequency = get("task-frequency").value,
      schedule =
        frequency === "once"
          ? {
              kind: "once",
              at: get("task-date").value,
              timezone: get("task-timezone").value,
            }
          : {
              kind: "recurring",
              frequency,
              time: get("task-time").value,
              timezone: get("task-timezone").value,
              ...(frequency === "weekly"
                ? { weekday: Number(get("task-weekday").value) }
                : {}),
            };
    const body = {
      version: editing?.version ?? 0,
      title: get("task-title").value,
      prompt: get("task-prompt").value,
      conversationId: get("task-conversation").value,
      schedule,
      notify: get("task-notify").checked,
      active: get("task-active").checked,
      missed: get("task-missed").value,
    };
    saving = true;
    invalidateReads();
    const dialog = get("task-editor");
    dialog.dataset.writes = "1";
    dialog
      .querySelectorAll("button,input,select,textarea")
      .forEach((n) => disabled(n, true));
    get("task-editor-status").textContent = "Enregistrement…";
    try {
      await post("/api/tasks" + (editing ? "/" + editing.id : ""), body);
      if (owner !== generation) return;
      dialog.close();
      await load(true);
      message("Tâche enregistrée.");
    } catch (e) {
      if (owner === generation && get("task-editor").open)
        text("task-editor-status", errorText(e));
    } finally {
      if (owner !== generation) return;
      saving = false;
      dialog.dataset.writes = "0";
      dialog
        .querySelectorAll("button,input,select,textarea")
        .forEach((n) => disabled(n, false));
      window.heartControls?.sync();
    }
  });
  get("task-frequency").onchange = fields;
  const moreObserver = new IntersectionObserver(
    (entries) => {
      moreVisible = entries.some((entry) => entry.isIntersecting);
      if (moreVisible && active() && catalog?.nextCursor && !saving)
        void load(true, true, true);
    },
    { rootMargin: "160px" },
  );
  moreObserver.observe(get("tasks-more"));
  get("tasks-more-retry").onclick = () => void load(true, true, true);
  get("task-create").onclick = () => edit();
  get("tasks-refresh").onclick = () => void load(true);
  get("task-edit").onclick = () => current && edit(current.task);
  get("task-toggle").onclick = () =>
    current &&
    void action("/api/tasks/" + current.task.id + "/active", {
      version: current.task.version,
      active: !current.task.active,
    });
  get("task-run-now").onclick = () => {
    if (!current) return;
    const task = current.task;
    if (!manualKeys.has(task.id))
      manualKeys.set(task.id, window.heartPlatform.uuid());
    void action("/api/tasks/" + task.id + "/run", {
      version: task.version,
      executionId: manualKeys.get(task.id),
    });
  };
  /** @param {string} id */
  async function openChat(id) {
    get("task-detail").close();
    location.hash = "conversations";
    try {
      await openConversation(id);
    } catch (e) {
      message(errorText(e), true);
    }
  }
  get("task-open-chat").onclick = () =>
    current && void openChat(current.task.conversationId);
  get("task-history-more").onclick = () =>
    current && void open(current.task.id, true, true);
  get("task-more-conversations").onclick = () => void conversations(true);
  get("task-search").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void conversations(), 200);
  };
  for (const id of ["task-editor", "task-detail"])
    get(id).addEventListener("cancel", (event) => {
      if (saving) event.preventDefault();
    });
  get("task-detail").addEventListener("close", () => {
    detailSequence++;
  });
  get("task-editor").addEventListener("close", () => {
    conversationSequence++;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.authenticated) {
      clearTimeout(timer);
      timer = setTimeout(poll, 0);
    }
  });
  window.heartTasks = { sync, reset, open };
  window.addEventListener("hashchange", sync);
  sync();
})();
