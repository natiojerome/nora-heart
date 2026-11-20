// @ts-check
/* Three persistent panels. Catalogues remain owned by their lazy controllers. */
(() => {
  const tabs = [
    .../** @type {NodeListOf<HTMLButtonElement>} */ (
      document.querySelectorAll("[data-capabilities-tab]")
    ),
  ];
  /** @type {Record<string, string>} */
  const hashes = {
    tools: "tools",
    skills: "tools-skills",
    connections: "tools-connections",
  };
  let displayed = "";
  /** @param {string} hash */
  function route(hash) {
    const current =
      hash === "modules"
        ? "tools"
        : Object.keys(hashes).find((key) => hashes[key] === hash);
    if (!current || current === displayed) return;
    displayed = current;
    for (const tab of tabs) {
      const selected = tab.dataset.capabilitiesTab === current;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(
        tab.getAttribute("aria-controls") || "",
      );
      if (panel) panel.hidden = !selected;
    }
    const add = document.getElementById("mcp-add");
    if (add) add.hidden = current !== "connections";
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      location.hash = hashes[tab.dataset.capabilitiesTab || ""];
    });
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    });
  });
  window.heartCapabilities = { route };
  window.addEventListener("hashchange", () => route(location.hash.slice(1)));
  route(location.hash.slice(1));
})();
