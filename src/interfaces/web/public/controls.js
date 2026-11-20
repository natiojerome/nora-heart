/* Shared select sheets. Native controls remain the source of form values/events. */
(() => {
  const sheet = document.getElementById("select-sheet");
  const list = document.getElementById("select-sheet-options");
  const search = document.getElementById("select-sheet-search");
  const enhanced = new Map();
  let current = null,
    fingerprint = "",
    typeAhead = "",
    typeTimer,
    modelFilter = "all";
  const chevron =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9 4 4 4-4"/></svg>';
  function labelFor(select) {
    return (
      select.getAttribute("aria-label") ||
      [...(select.labels || [])]
        .map((label) => label.textContent.trim())
        .join(" ") ||
      "Choisir une option"
    );
  }
  function optionsFor(select) {
    return [...select.options].map((option) => ({
      value: option.value,
      label: option.label,
      detail: option.dataset.detail,
      price: option.dataset.price,
      priceHint: option.dataset.priceHint,
      search: option.dataset.search,
      free: option.dataset.free,
      tools: option.dataset.tools,
      disabled: option.disabled || option.parentElement?.disabled,
      hidden: option.hidden,
    }));
  }
  function sync() {
    for (const [select, button] of enhanced) {
      if (!select.isConnected) {
        button.remove();
        enhanced.delete(select);
        continue;
      }
      if (button.hidden !== select.hidden) button.hidden = select.hidden;
      if (button.disabled !== select.disabled) button.disabled = select.disabled;
      const label = labelFor(select);
      if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
      if (button.getAttribute("aria-required") !== String(select.required)) button.setAttribute("aria-required", String(select.required));
      const copy = button.querySelector("span");
      const text = select.selectedOptions[0]?.label || "Choisir…";
      if (copy.textContent !== text) copy.textContent = text;
      if (button.title !== text) button.title = text;
    }
    if (current) {
      if (
        !current.isConnected ||
        current.matches(":disabled") ||
        current.hidden
      ) {
        sheet.close();
        return;
      }
      const key = JSON.stringify([optionsFor(current), current.value]);
      if (key !== fingerprint) {
        fingerprint = key;
        renderOptions();
      }
    }
  }
  // Several controls change in one render: reconcile once after that batch.
  let syncQueued = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => { syncQueued = false; sync(); });
  }
  function enhance(select) {
    if (select.hasAttribute("data-internal") || enhanced.has(select)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-trigger";
    button.id = `${select.id}-trigger`;
    button.dataset.selectId = select.id;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = "<span></span>" + chevron;
    select.classList.add("select-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.after(button);
    enhanced.set(select, button);
    button.addEventListener("click", () => open(select));
    button.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        open(select);
      }
    });
    select.addEventListener("change", sync);
    select.addEventListener("invalid", (event) => {
      event.preventDefault();
      open(select);
    });
    for (const label of select.labels || [])
      label.addEventListener("click", (event) => {
        if (event.target === label) {
          event.preventDefault();
          button.focus();
        }
      });
    new MutationObserver(scheduleSync).observe(select, {
      attributes: true,
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
  function scan(root = document) {
    if (root.matches?.("select")) enhance(root);
    root.querySelectorAll?.("select").forEach(enhance);
    root
      .querySelectorAll?.('input[type="checkbox"][id*="animation"]')
      .forEach((input) => input.setAttribute("role", "switch"));
    sync();
  }
  function open(select) {
    if (select.matches(":disabled") || select.hidden) return;
    current = select;
    fingerprint = "";
    document.getElementById("select-sheet-title").textContent =
      labelFor(select);
    document.getElementById("select-sheet-hint").textContent =
      "La sélection s’applique immédiatement.";
    modelFilter = "all";
    sheet.dataset.kind = select.id === "model-options" ? "models" : "default";
    let filters = document.getElementById("model-picker-filters");
    if (!filters) {
      filters = document.createElement("div");
      filters.id = "model-picker-filters";
      filters.className = "model-picker-filters";
      search.parentElement.after(filters);
      for (const [key, label] of [
        ["all", "Tous"],
        ["free", "Gratuits"],
        ["tools", "Avec outils"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.filter = key;
        button.textContent = label;
        button.addEventListener("click", () => {
          modelFilter = key;
          renderOptions();
        });
        filters.append(button);
      }
    }
    filters.hidden =
      select.id !== "model-options" ||
      select.dataset.catalogProvider === "chatgpt";
    if (select.id === "model-options")
      document.getElementById("select-sheet-hint").textContent =
        select.dataset.catalogProvider === "chatgpt"
          ? "Modèles disponibles avec ta connexion."
          : "Prix entrée / sortie pour 1 million de tokens, en dollars US.";
    search.value = "";
    search.parentElement.hidden = select.options.length < 8;
    enhanced.get(select).setAttribute("aria-expanded", "true");
    sync();
    sheet.showModal();
    const active =
      list.querySelector('[aria-selected="true"]:not(:disabled)') ||
      list.querySelector("button:not(:disabled)");
    active?.focus();
    active?.scrollIntoView({ block: "nearest" });
  }
  function renderOptions() {
    if (!current) return;
    const query = search.value.trim().toLocaleLowerCase("fr");
    list.replaceChildren();
    document
      .querySelectorAll("#model-picker-filters button")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.filter === modelFilter),
        ),
      );
    for (const option of optionsFor(current)) {
      if (
        option.hidden ||
        !(option.search || option.label)
          .toLocaleLowerCase("fr")
          .includes(query) ||
        (current.id === "model-options" &&
          ((modelFilter === "free" && option.free !== "true") ||
            (modelFilter === "tools" && option.tools !== "true")))
      )
        continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sheet-option";
      button.dataset.value = option.value;
      button.setAttribute("role", "option");
      button.setAttribute(
        "aria-selected",
        String(current.value === option.value),
      );
      button.disabled = !!option.disabled;
      button.tabIndex = current.value === option.value ? 0 : -1;
      const text = document.createElement("span");
      text.textContent = option.label;
      if (current.id === "model-options") {
        text.className = "model-option-copy";
        text.textContent = "";
        const name = document.createElement("strong");
        name.textContent = option.label.replace(/^[^:]+:\s*/, "");
        const detail = document.createElement("small");
        detail.textContent = option.detail || option.value;
        text.append(name, detail);
        button.setAttribute("aria-label", option.label);
        button.title = option.search || option.label;
      }
      const check = document.createElement("span");
      check.className = "sheet-option-check";
      check.setAttribute("aria-hidden", "true");
      check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>';
      button.append(text);
      if (current.id === "model-options" && option.price) {
        const price = document.createElement("span");
        price.className = "model-option-price";
        price.dataset.free = option.free;
        const amount = document.createElement("strong");
        amount.textContent = option.price;
        const hint = document.createElement("small");
        hint.textContent = option.priceHint || "";
        price.append(amount, hint);
        button.append(price);
      }
      button.append(check);
      button.addEventListener("click", () => {
        const select = current;
        if (!select || select.matches(":disabled")) return;
        select.value = option.value;
        sheet.close();
        sync();
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      list.append(button);
    }
    if (!list.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "sheet-empty";
      empty.textContent = "Aucune option ne correspond.";
      list.append(empty);
    }
  }
  search.addEventListener("input", renderOptions);
  list.addEventListener("keydown", (event) => {
    const items = [...list.querySelectorAll("button:not(:disabled)")];
    const index = items.indexOf(document.activeElement);
    let target;
    if (event.key === "ArrowDown") target = items[(index + 1) % items.length];
    else if (event.key === "ArrowUp")
      target = items[(index - 1 + items.length) % items.length];
    else if (event.key === "Home") target = items[0];
    else if (event.key === "End") target = items.at(-1);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      clearTimeout(typeTimer);
      typeAhead += event.key.toLocaleLowerCase("fr");
      target = items.find((item) =>
        item.textContent.trim().toLocaleLowerCase("fr").startsWith(typeAhead),
      );
      typeTimer = setTimeout(() => {
        typeAhead = "";
      }, 700);
    }
    if (target) {
      event.preventDefault();
      items.forEach((item) => (item.tabIndex = -1));
      target.tabIndex = 0;
      target.focus();
    }
  });
  document
    .getElementById("cancel-select-sheet")
    .addEventListener("click", () => sheet.close());
  sheet.addEventListener("close", () => {
    const trigger = enhanced.get(current);
    trigger?.setAttribute("aria-expanded", "false");
    current = null;
    fingerprint = "";
    typeAhead = "";
    if (trigger?.isConnected && !trigger.hidden) trigger.focus();
  });
  sheet.addEventListener("click", (event) => {
    if (event.target !== sheet) return;
    const rect = sheet.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      sheet.close();
  });
  function viewport() {
    const vv = window.visualViewport;
    sheet.style.setProperty(
      "--sheet-bottom",
      `${Math.max(0, innerHeight - ((vv?.offsetTop || 0) + (vv?.height || innerHeight)))}px`,
    );
  }
  window.addEventListener("resize", viewport);
  window.visualViewport?.addEventListener("resize", viewport);
  window.visualViewport?.addEventListener("scroll", viewport);
  viewport();
  scan();
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (
          node.nodeType === 1 &&
          (node.matches?.("select") || node.querySelector?.("select"))
        )
          scan(node);
  }).observe(document.body, { subtree: true, childList: true });
  window.heartControls = { sync: scheduleSync, scan };
})();
