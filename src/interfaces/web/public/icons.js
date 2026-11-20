// @ts-check
/* Shared SVG catalogue. Reconciliation preserves unchanged DOM nodes. */
(() => {
  /** @type {Record<string,string>} */
  const icons = {
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',

    loader: '<path d="M21 12a9 9 0 1 1-9-9"/>',
    brain:
      '<path d="M12 5a3 3 0 0 0-5.7-1.3A4 4 0 0 0 4 11a4 4 0 0 0 1 7.7A3 3 0 0 0 12 20V5Zm0 0a3 3 0 0 1 5.7-1.3A4 4 0 0 1 20 11a4 4 0 0 1-1 7.7A3 3 0 0 1 12 20M8 8c0 2-1 3-3 3m11-3c0 2 1 3 3 3M7 15c2-1 4 0 5 2m5-2c-2-1-4 0-5 2"/>',

    web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18"/>',
    "arrow-right": '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    question:
      '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    table:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>',
    cards:
      '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    conversations:
      '<rect x="3" y="3" width="14" height="12" rx="2"/><path d="m7 15-4 4v-4m5 4h9l4 3V9"/>',
    projects:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 5V3h8v2"/>',
    memories:
      '<path d="M12 4v16M12 5a4 4 0 0 0-7-1 4 4 0 0 0-2 7 4 4 0 0 0 2 7 4 4 0 0 0 7 2m0-15a4 4 0 0 1 7-1 4 4 0 0 1 2 7 4 4 0 0 1-2 7 4 4 0 0 1-7 2M5 8l3 2m11-2-3 2M5 15l3-1m11 1-3-1"/>',
    models:
      '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/>',
    tools: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
    automations:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-9 3v3l2 1"/>',
    files:
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    consumption: '<path d="M4 20V10m8 10V4m8 16v-7"/>',
    instructions:
      '<path d="M4 3h12a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V4a1 1 0 0 1 1-1Zm2 14h13M7 7h8M7 11h6"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    lab: '<path d="M9 3h6m-5 0v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M8 15h8"/>',
    privacy:
      '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    backups: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-4v6l4 2"/>',
    logout: '<path d="M9 3H4v18h5m7-16 5 7-5 7M8 12h13"/>',
    eraser: '<path d="m4 14 9-10 8 7-9 10H8l-4-4zM8 10l8 7M12 21h9"/>',
    wand: '<path d="m4 16 10-10 4 4L8 20zM12 8l4 4M5 2v5M2.5 4.5h5M20 2v5m-2.5-2.5h5"/>',
    paperclip:
      '<path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2m-4 14 8-8"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    edit: '<path d="m15 4 5 5-11 11H4v-5zM13 6l5 5"/>',
    external: '<path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7"/>',
    down: '<path d="m6 14 6 6 6-6M12 20V4"/>',
    back: '<path d="m10 6-6 6 6 6M4 12h16"/>',
    up: '<path d="m6 10 6-6 6 6M12 4v16"/>',
    refresh:
      '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    folder: '<path d="M3 7h7l2 2h9v11H3zM3 7V4h6l3 3"/>',
    terminal:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="m3 3 18 9-18 9 4-9-4-9zM7 12h14"/>',
  };
  /** @type {WeakMap<Element,{name:string,svg:Element|null}>} */
  const painted = new WeakMap();
  /** @param {ParentNode} [root] */
  function render(root = document) {
    const nodes = [...root.querySelectorAll("[data-icon]")];
    if (root instanceof Element && root.matches("[data-icon]"))
      nodes.push(root);
    for (const node of nodes) {
      const name = node.getAttribute("data-icon") || "",
        path = icons[name],
        previous = painted.get(node);
      if (!path) {
        if (previous) {
          node.replaceChildren();
          painted.delete(node);
        }
        continue;
      }
      if (previous?.name === name && previous.svg === node.firstElementChild)
        continue;
      node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
      painted.set(node, { name, svg: node.firstElementChild });
    }
  }
  window.heartIcons = { render };
})();
