// @ts-check
/* One configuration route, persistent DOM panels, no API calls here. */
(() => {
  const tabs = [
    .../** @type {NodeListOf<HTMLButtonElement>} */ (
      document.querySelectorAll("[data-settings-tab]")
    ),
  ];
  /** @type {Record<string,string>} */
  const hashes = {
    appearance: "settings",
    assistant: "settings-assistant",
    conversations: "settings-conversations",
    instructions: "settings-instructions",
    policies: "settings-policies",
  };
  let current = "";
  // Keep the selected tab visible when the compact bar changes width.
  const bar = tabs[0]?.parentElement;
  function revealTab() {
    const selected = tabs.find(
      (button) => button.dataset.settingsTab === current,
    );
    if (!bar || !selected || !bar.clientWidth) return;
    const area = bar.getBoundingClientRect(),
      item = selected.getBoundingClientRect();
    if (item.left < area.left) bar.scrollLeft += item.left - area.left;
    else if (item.right > area.right) bar.scrollLeft += item.right - area.right;
  }
  if (bar) new ResizeObserver(revealTab).observe(bar);
  /** @param {string} hash */
  function route(hash) {
    const tab =
      hash === "instructions"
        ? "instructions"
        : Object.keys(hashes).find((key) => hashes[key] === hash) || "";
    if (!tab) {
      window.heartInstructions?.route("");
      window.heartPolicies?.route("");
      return;
    }
    const changed = current !== tab;
    if (changed) {
      current = tab;
      for (const button of tabs) {
        const selected = button.dataset.settingsTab === tab;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        /** @type {HTMLElement} */ (
          document.getElementById(button.getAttribute("aria-controls") || "")
        ).hidden = !selected;
      }
      for (const id of [
        "instruction-dialog",
        "assistant-dialog",
        "appearance-dialog",
        "defaults-dialog",
        "policy-dialog",
      ]) {
        const dialog = /** @type {HTMLDialogElement} */ (
          document.getElementById(id)
        );
        if (Number(dialog.dataset.writes || 0) === 0) dialog.close();
      }
    }
    window.heartPolicies?.route(tab === "policies" ? "policies" : "");
    if (changed) revealTab();
    window.heartInstructions?.route(
      tab === "instructions" ? "instructions" : "",
    );
  }
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => {
      const hash = hashes[button.dataset.settingsTab || ""];
      if (location.hash.slice(1) === hash) route(hash);
      else location.hash = hash;
    });
    button.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
  });
  window.heartConfiguration = { route };
  route(location.hash.slice(1));
})();
