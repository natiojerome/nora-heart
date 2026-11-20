/* Public progress and verifiable operations. Provider private reasoning never enters this view. */
(() => {
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function icon(name, extra = "") {
    const n = node("span", null, "turn-icon" + (extra ? " " + extra : ""));
    n.dataset.icon = name;
    return n;
  }
  function activity(data = {}) {
    const events = data.events || [];
    const start =
      data.inventory ||
      events.findLast((event) => event.type === "run.started");
    const run = events.filter((event) => start && event.runId === start.runId);
    const panel = node("section", null, "response-activity");
    panel.dataset.phase = data.activity?.phase || "preparing";
    const title = `${window.heartUI?.assistantName() || "Nora"} travaille`;
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.setAttribute("aria-label", title);
    const spinner = () => icon("loader", "activity-spinner");
    const heading = node("span", null, "response-activity-heading");
    heading.append(spinner(), node("strong", title));
    const counters = node("span", null, "response-activity-counters");
    const started = new Set(
      run
        .filter((event) => event.type === "tool.started")
        .map((event) => event.data.callId),
    );
    const finished = new Set(
      run
        .filter(
          (event) =>
            event.type === "tool.finished" && started.has(event.data.callId),
        )
        .map((event) => event.data.callId),
    );
    const operations = node("span", `${started.size} op.`);
    operations.title = `${finished.size} opération(s) terminée(s)`;
    counters.append(operations);
    const time = node("time", "0 s", "activity-elapsed");
    time.dataset.startedAt =
      start?.at || data.work?.at || new Date().toISOString();
    time.setAttribute("aria-live", "off");
    counters.append(time);
    const header = node("header");
    header.append(heading, counters);
    panel.append(header);
    const list = node("div", null, "response-activity-list");
    const row = (text, kind, status = "completed") => {
      const item = node("div", null, `response-activity-row ${kind} ${status}`);
      const copy = node("p");
      copy.title = text;
      copy.append(node("strong", text));
      item.append(
        status === "active"
          ? spinner()
          : icon(kind === "commentary" ? "brain" : "check"),
        copy,
      );
      list.append(item);
    };
    // Only provider-authored public commentary; no private reasoning or raw tool output.
    const comments = [];
    for (const event of run) {
      const text =
        event.type === "run.progress"
          ? event.data.text
          : event.type === "message" &&
              event.data.role === "assistant" &&
              event.data.toolCalls?.length
            ? event.data.content
            : "";
      if (
        typeof text === "string" &&
        text.trim() &&
        !comments.includes(text.trim())
      )
        comments.push(text.trim());
    }
    for (const text of comments.slice(-2)) row(text, "commentary");
    const active = run.findLast(
      (event) =>
        event.type === "tool.started" && !finished.has(event.data.callId),
    );
    const phases = {
      context: "Préparation du contexte",
      waiting: "En attente du modèle",
      reasoning: "Analyse de la demande",
      answer: "Rédaction de la réponse",
    };
    let phase = phases[data.activity?.phase] || "Préparation du contexte";
    if (active) {
      const name = active.data.name || "";
      phase = /web_search|web_fetch/.test(name)
        ? "Recherche d’informations"
        : name.startsWith("terminal.")
          ? "Vérifications en cours"
          : /^files\.(create|write|replace|update|delete|move|mkdir|import)$/.test(
                name,
              )
            ? "Mise à jour des fichiers"
            : name.startsWith("files.")
              ? "Consultation des fichiers"
              : name.startsWith("memory.")
                ? "Organisation de la mémoire"
                : "Action en cours";
    }
    row(phase, "phase", "active");
    panel.append(list);
    window.heartIcons?.render(panel);
    return panel;
  }
  function receipt({
    tag = "section",
    className = "",
    symbol,
    label,
    at,
    title,
    content,
    memory = false,
  }) {
    const card = node(
      tag,
      null,
      "chat-receipt conversation-message " + className,
    );
    if (tag === "button") card.type = "button";
    card.append(
      icon(symbol, "chat-receipt-icon" + (memory ? " memory-chat-icon" : "")),
    );
    const copy = node(
      "span",
      null,
      "chat-receipt-copy" + (memory ? " memory-chat-copy" : ""),
    );
    const meta = node(
      "span",
      null,
      "chat-receipt-meta" + (memory ? " memory-chat-meta" : ""),
    );
    const time = node(
      "time",
      new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(at)),
    );
    time.dateTime = at;
    meta.append(node("strong", label), time);
    copy.append(meta, node("b", title));
    if (content) copy.append(node("small", content));
    card.append(copy);
    window.heartIcons?.render(card);
    return card;
  }
  function memory(event) {
    const item = event.data;
    if (
      item.role !== "tool" ||
      item.error ||
      !/^memory\.(remember|update|forget|restore)$/.test(item.name)
    )
      return null;
    let record;
    try {
      record = JSON.parse(item.content);
    } catch {
      return null;
    }
    if (!record?.id || typeof record.content !== "string") return null;
    const kind = {
      "memory.remember": "created",
      "memory.update": "updated",
      "memory.forget": "forgotten",
      "memory.restore": "restored",
    }[item.name];
    const assistant = window.heartUI?.assistantName() || "Nora";
    const labels = {
      created:
        record.source?.type === "manual"
          ? "Mémoire ajoutée"
          : `${assistant} a mémorisé`,
      updated: "Souvenir corrigé",
      forgotten: "Souvenir oublié",
      restored: "Souvenir restauré",
    };
    const button = receipt({
      tag: "button",
      className: `memory-chat-event ${kind}`,
      memory: true,
      symbol:
        kind === "forgotten"
          ? "trash"
          : kind === "updated"
            ? "edit"
            : kind === "restored"
              ? "refresh"
              : "save",
      label: labels[kind],
      at: event.at,
      title: record.title || "Souvenir durable",
      content: record.content,
    });
    button.dataset.eventId = event.id;
    button.onclick = async () => {
      button.disabled = true;
      try {
        await window.heartMemory.open(record.id);
      } catch (error) {
        message(errorText(error), true);
      } finally {
        button.disabled = false;
      }
    };
    window.heartIcons?.render(button);
    return button;
  }
  function task(event) {
    const item = event.data;
    if (item.role !== "tool" || item.error || item.name !== "tasks.write")
      return null;
    let result;
    try {
      result = JSON.parse(item.content);
    } catch {
      return null;
    }
    const kind = result.action;
    const task = result.task,
      run = result.run,
      id = task?.id ?? (kind === "run_now" ? run?.taskId : null);
    if (!id) return null;
    const label =
      kind === "create"
        ? task.active
          ? "Tâche planifiée"
          : "Tâche enregistrée"
        : kind === "update"
          ? "Tâche modifiée"
          : ["pause", "resume"].includes(kind)
            ? task.active
              ? "Tâche reprise"
              : "Tâche en pause"
            : "Lancement demandé";
    const schedule = task?.schedule;
    let detail = run?.detail ?? "";
    if (schedule?.kind === "once")
      detail =
        new Date(schedule.at).toLocaleString("fr-FR", {
          timeZone: schedule.timezone,
          dateStyle: "short",
          timeStyle: "short",
        }) +
        " · " +
        schedule.timezone;
    else if (schedule?.kind === "recurring")
      detail =
        ({
          daily: "Chaque jour",
          weekdays: "Lun–ven",
          weekly: "Chaque semaine",
        }[schedule.frequency] ?? schedule.frequency) +
        " · " +
        schedule.time +
        " · " +
        schedule.timezone;
    const button = receipt({
      tag: "button",
      className: "task-chat-event",
      symbol: "automations",
      label,
      at: event.at,
      title: task?.title ?? run?.title ?? "Exécution d’une tâche",
      content: detail,
    });
    button.dataset.eventId = event.id;
    button.dataset.taskReceiptId = id;
    button.onclick = () => void window.heartTasks?.open(id);
    return button;
  }
  window.heartTurns = { activity, memory, task, receipt };
})();
