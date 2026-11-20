/* Private in-memory history window. No persistence and no provider calls. */
(() => {
  let current = null,
    generation = 0,
    olderLoading = false,
    failed = false,
    previousTop = 0;
  const indicator = document.getElementById("history-loading");
  const retry = document.getElementById("history-retry");
  const timeline = document.getElementById("conversation-history");
  function paint() {
    indicator.hidden = !olderLoading && !failed;
    indicator.setAttribute("aria-busy", String(olderLoading));
    retry.hidden = !failed;
    retry.disabled = olderLoading;
    if (olderLoading) status.textContent = "Chargement des messages…";
    else if (!failed) status.textContent = "";
  }
  const visible = () =>
    !document.hidden && document.body.classList.contains("chat-mode");
  function underfilled() {
    if (
      visible() &&
      !failed &&
      current?.history.hasMoreOlder &&
      timeline.scrollHeight <= timeline.clientHeight + 1
    )
      void older();
  }
  const status = document.getElementById("history-status");
  function merge(base, data, prepend = false) {
    const events = new Map();
    for (const event of prepend
      ? [...(data.events || []), ...base.events]
      : [...base.events, ...(data.events || [])])
      events.set(event.id, event);
    const interactions = new Map(
      (base.interactions || []).map((item) => [item.id, item]),
    );
    const newer =
      (data.history?.revision ?? 0) >= (base.history?.revision ?? 0);
    for (const item of data.interactions || [])
      if (newer || !interactions.has(item.id)) interactions.set(item.id, item);
    const value = {
      ...base,
      ...(newer ? data : {}),
      events: [...events.values()],
      interactions: [...interactions.values()],
    };
    value.history = {
      ...(newer ? data.history : base.history),
      before: prepend ? data.history.before : base.history.before,
      after: prepend
        ? base.history.after
        : data.history.after || base.history.after,
      hasMoreOlder: prepend ? data.history.hasMore : base.history.hasMoreOlder,
    };
    return value;
  }
  async function accept(data) {
    if (!data.history) return data;
    const id = data.conversation.id;
    if (id !== conversationId) return data;
    if (
      !current ||
      current.conversation.id !== id ||
      (!current.events.length && data.history.mode === "latest")
    ) {
      generation++;
      olderLoading = false;
      failed = false;
      previousTop = 0;
      current = {
        ...data,
        history: { ...data.history, hasMoreOlder: data.history.hasMore },
      };
    } else {
      const version = generation;
      // A full mutation response can contain only the latest page. Fill the gap
      // from our last cursor before merging it, even after many tool events.
      if (
        data.history.mode === "latest" &&
        current.history.after &&
        data.history.revision > current.history.revision &&
        !(data.events || []).some((event) => event.id === current.history.after)
      ) {
        let more = true;
        while (more) {
          const delta = await api(
            `/api/conversations/${id}?after=${encodeURIComponent(current.history.after)}`,
            { quiet: true },
          );
          if (version !== generation || conversationId !== id) return data;
          current = merge(current, delta);
          more = delta.history.hasMore;
        }
      }
      if (version !== generation || conversationId !== id) return data;
      if (data.history.mode === "before") current = merge(current, data, true);
      else if ((data.history.revision ?? 0) >= (current.history.revision ?? 0))
        current = merge(current, data);
    }
    paint();
    return current;
  }
  async function older() {
    if (
      !current ||
      olderLoading ||
      !current.history.hasMoreOlder ||
      !current.history.before
    )
      return;
    const id = current.conversation.id,
      version = generation;
    const height = timeline.scrollHeight,
      before = current.history.before;
    let loaded = false;
    olderLoading = true;
    failed = false;
    paint();
    try {
      const data = await api(
        `/api/conversations/${id}?before=${encodeURIComponent(before)}`,
        { quiet: true },
      );
      if (version !== generation || conversationId !== id) return;
      await renderConversation(data);
      loaded = true;
    } catch (error) {
      if (version === generation) {
        failed = true;
        status.textContent = "Chargement impossible.";
        status.title = errorText(error);
      }
    } finally {
      if (version === generation) {
        olderLoading = false;
        paint();
        requestAnimationFrame(() => {
          if (version !== generation || !loaded || !visible()) return;
          previousTop = timeline.scrollTop;
          // Skip pages consisting only of invisible journal events.
          if (
            current.history.before !== before &&
            timeline.scrollHeight <= height + 1 &&
            timeline.scrollTop <= 160
          )
            void older();
          else underfilled();
        });
      }
    }
  }
  retry.addEventListener("click", () => void older());
  timeline.addEventListener(
    "scroll",
    () => {
      const top = timeline.scrollTop,
        up = top < previousTop;
      previousTop = top;
      if (up && top <= 160 && visible() && !failed) void older();
    },
    { passive: true },
  );
  new ResizeObserver(underfilled).observe(timeline);
  document.addEventListener("visibilitychange", underfilled);
  window.heartHistory = {
    accept,
    rendered() {
      previousTop = timeline.scrollTop;
      underfilled();
    },
    after(id) {
      return current?.conversation.id === id ? current.history.after : null;
    },
    reset() {
      generation++;
      current = null;
      olderLoading = false;
      failed = false;
      previousTop = 0;
      paint();
    },
  };
})();
