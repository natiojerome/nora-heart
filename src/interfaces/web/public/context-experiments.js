/* Opt-in per conversation and browser tab. No polling, owner text or server preference changes. */
(() => {
  const panel = document.getElementById("context-experiments");
  const measure = /** @type {HTMLInputElement} */ (
    document.getElementById("context-measure")
  );
  const compact = /** @type {HTMLInputElement} */ (
    document.getElementById("context-compact-review")
  );
  const status = document.getElementById("context-experiments-status");
  /** @type {Map<string,{measureRequests?:boolean,compactProjectReview?:boolean}>} */
  const choices = new Map();
  let id = "",
    supported = false,
    project = false;
  const prefix = "heart-context-experiment:";
  /** @param {string} key */
  function read(key) {
    if (!choices.has(key)) {
      let value = {};
      try {
        const saved = JSON.parse(sessionStorage.getItem(prefix + key) || "{}");
        value = {
          measureRequests: saved.measureRequests === true,
          compactProjectReview: saved.compactProjectReview === true,
        };
      } catch {
        /* Storage unavailable: keep the in-tab map. */
      }
      choices.set(key, value);
    }
    return choices.get(key) || {};
  }
  function sync() {
    if (!panel || !status) return;
    panel.hidden = !supported || !id;
    const value = read(id);
    measure.checked = !!value.measureRequests;
    compact.checked = !!value.compactProjectReview;
    compact.disabled = !project;
    status.textContent = !project
      ? "La revue projet s’applique aux fils rattachés à un projet."
      : "Mémoire proactive et contrôles conservés.";
  }
  function save() {
    if (!id || !supported || !status) return;
    const value = {
      measureRequests: measure.checked,
      compactProjectReview: compact.checked,
    };
    choices.set(id, value);
    try {
      sessionStorage.setItem(prefix + id, JSON.stringify(value));
    } catch {
      /* Current tab still applies the choice. */
    }
    status.textContent = "Appliqué au prochain envoi de ce fil.";
  }
  measure?.addEventListener("change", save);
  compact?.addEventListener("change", save);
  window.heartContextExperiments = {
    sync,
    /** @param {{contextExperimentsSupported?:boolean,conversation?:{id:string,projectId?:string|null}}} data */
    render(data) {
      id = data.conversation?.id || "";
      supported = data.contextExperimentsSupported === true;
      project = !!data.conversation?.projectId;
      sync();
    },
    /** @param {string} key */
    request(key) {
      if (!supported || key !== id) return {};
      const value = read(key);
      return value.measureRequests || (project && value.compactProjectReview)
        ? {
            contextExperiments: {
              measureRequests: !!value.measureRequests,
              compactProjectReview: project && !!value.compactProjectReview,
            },
          }
        : {};
    },
  };
})();
