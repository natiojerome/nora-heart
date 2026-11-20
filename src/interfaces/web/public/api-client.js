// @ts-check
/* One transport boundary; no credentials persisted and no retry of mutations. */
(() => {
  /** @param {HeartHttpOptions} config */
  function create(config) {
    /** @type {Map<string,{promise:Promise<{response:Response,data:any}>,readers:number}>} */
    const pending = new Map();
    /** @param {string} url @param {RequestInit} options */
    async function request(url, options) {
      const headers = new Headers(options.headers);
      if (!headers.has("Accept")) headers.set("Accept", "application/json");
      if (options.method && options.method !== "GET") {
        if (!headers.has("Content-Type"))
          headers.set("Content-Type", "application/json");
        const token = config.csrf();
        if (token) headers.set("X-CSRF-Token", token);
      }
      const response = await (config.fetch ?? fetch)(url, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        headers,
      });
      const data = await response.json().catch(() => ({}));
      return { response, data };
    }
    /** @param {string} url @param {HeartApiOptions} [options] */
    async function api(url, options = {}) {
      const { quiet = false, ...init } = options,
        method = (init.method ?? "GET").toUpperCase();
      const finish = quiet ? () => {} : config.feedback(url, method);
      let failure;
      try {
        // Only identical, ordinary reads share transport. Signals, custom headers
        // and bodies remain independent. A write invalidates prior pending reads.
        const share =
          method === "GET" &&
          Object.keys(init).every((key) => key === "method");
        if (method !== "GET") pending.clear();
        let entry = share ? pending.get(url) : undefined;
        if (entry) entry.readers++;
        else {
          entry = { promise: request(url, init), readers: 1 };
          if (share) {
            pending.set(url, entry);
            const current = entry;
            void entry.promise
              .finally(() => {
                if (pending.get(url) === current) pending.delete(url);
              })
              .catch(() => {});
          }
        }
        const { response, data } = await entry.promise;
        if (response.status === 401) {
          config.expired();
          pending.clear();
          if (url !== "/api/login")
            throw new Error("Ta session a expiré. Reconnecte-toi à l’atelier.");
        }
        if (!response.ok)
          throw new Error(
            typeof data.message === "string"
              ? data.message
              : typeof data.error === "string"
                ? data.error
                : "L’opération n’a pas pu aboutir. Réessaie dans un instant.",
          );
        if (typeof data.csrf === "string") config.receivedCsrf(data.csrf);
        return entry.readers > 1 ? structuredClone(data) : data;
      } catch (error) {
        failure =
          error instanceof TypeError
            ? new Error(
                "Connexion interrompue. Vérifie le résultat avant de relancer l’action.",
              )
            : error;
        throw failure;
      } finally {
        finish(failure);
      }
    }
    /** @param {string} url @param {unknown} [body] */
    function post(url, body = {}) {
      return api(url, { method: "POST", body: JSON.stringify(body) });
    }
    return { api, post };
  }
  window.heartHttp = { create };
})();
