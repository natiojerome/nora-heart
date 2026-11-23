/* One lightweight catalogue for independent conversation runs. No history polling here. */
(() => {
  let records = [],
    timer = null,
    signature = "",
    generation = 0;
  const labels = {
    running: "En cours",
    waiting: "Ta réponse attendue",
    completed: "Terminé",
    failed: "Échec",
    cancelled: "Arrêté",
    interrupted: "Interrompu",
    idle: "",
  };
  function paint() {
    const byId = new Map(records.map((item) => [item.id, item]));
    for (const row of document.querySelectorAll("[data-conversation-id]")) {
      const state = byId.get(row.dataset.conversationId)?.work?.status;
      let badge = row.querySelector(".discussion-work");
      if (!labels[state]) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "discussion-work";
        row.firstElementChild.append(badge);
      }
      if (badge.textContent !== labels[state])
        badge.textContent = labels[state];
      if (badge.dataset.status !== state) badge.dataset.status = state;
    }
    const active = records.filter((item) =>
      ["running", "waiting", "interrupted"].includes(item.work?.status),
    );
    for (const button of document.querySelectorAll(
      "#chat-back,[data-list-conversations]",
    )) {
      if (active.length) {
        const count = String(active.length);
        if (button.dataset.workCount !== count)
          button.dataset.workCount = count;
      } else if (button.dataset.workCount) delete button.dataset.workCount;
    }
    const target = document.getElementById("conversation-work");
    if (!target) return;
    if (target.hidden !== !active.length) target.hidden = !active.length;
    const key = JSON.stringify(
      active.map((item) => [item.id, item.title, item.work.status]),
    );
    if (key === signature) return;
    signature = key;
    target.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = "Travaux en cours";
    target.append(title);
    for (const item of active) {
      const row = document.createElement("div");
      row.className = "work-row";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "work-open";
      const name = document.createElement("strong");
      name.textContent = item.title;
      const state = document.createElement("small");
      state.textContent = labels[item.work.status];
      open.append(name, state);
      open.onclick = () => {
        location.hash = "conversations";
        void openConversation(item.id).catch((error) =>
          message(errorText(error), true),
        );
      };
      row.append(open);
      if (item.work.status === "running") {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "icon-button";
        stop.dataset.icon = "stop";
        stop.title = "Arrêter cette conversation";
        stop.setAttribute("aria-label", stop.title);
        stop.onclick = async () => {
          stop.disabled = true;
          try {
            await post(`/api/conversations/${item.id}/cancel`);
            await refresh();
          } catch (error) {
            message(errorText(error), true);
          } finally {
            stop.disabled = false;
          }
        };
        row.append(stop);
      }
      target.append(row);
    }
    window.heartIcons?.render(target);
  }
  function schedule() {
    clearTimeout(timer);
    if (
      state.authenticated &&
      !document.hidden &&
      (records.some((item) => item.work?.status === "running") ||
        conversationRequests.size > 0)
    )
      timer = setTimeout(refresh, 1800);
  }
  async function refresh() {
    if (!state.authenticated) {
      update([]);
      return;
    }
    const version = generation;
    try {
      const data = await api("/api/conversations/work", { quiet: true });
      if (version === generation && state.authenticated)
        update(data.conversations);
    } catch {
      if (version === generation) schedule();
    }
  }
  function update(value) {
    generation++;
    records = value;
    paint();
    schedule();
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden && records.length) void refresh();
  });
  window.addEventListener("focus", () => {
    if (records.length) void refresh();
  });
  window.heartWork = { update, paint, refresh };
})();
