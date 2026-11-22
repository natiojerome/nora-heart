// @ts-check
/* Browser APIs that also work over direct HTTP/IP. No server or model dependency. */
(() => {
  function uuid() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return (
      h.slice(0, 8) +
      "-" +
      h.slice(8, 12) +
      "-" +
      h.slice(12, 16) +
      "-" +
      h.slice(16, 20) +
      "-" +
      h.slice(20)
    );
  }
  /** @param {string} value */
  async function copy(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {}
    }
    const previous = document.activeElement,
      field = document.createElement("textarea");
    field.value = value;
    field.readOnly = true;
    field.style.cssText =
      "position:fixed;opacity:0;inset:0;pointer-events:none";
    document.body.append(field);
    try {
      field.select();
      if (!document.execCommand("copy")) throw Error("Copie indisponible.");
    } finally {
      field.remove();
      if (previous instanceof HTMLElement)
        previous.focus({ preventScroll: true });
    }
  }
  window.heartPlatform = { uuid, copy };
})();
