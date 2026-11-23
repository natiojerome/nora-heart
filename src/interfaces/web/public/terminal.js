(() => {
  const get = (id) => document.getElementById(id);
  const base = id => id === "projects-root" ? "/api/projects-root" : `/api/conversations/${id}`;
  let chatContext = null, generation = 0;
  let current = null,
    available = false,
    selected = "",
    offset = 0,
    timer = null,
    busy = false,
    polling = false;
  const status = (command) =>
    command.status === "running"
      ? "En cours"
      : command.status === "interrupted"
        ? "Interrompue"
        : `Terminée · code ${command.exitCode}`;
  function sync() {
    get("terminal-interactive-field").hidden = current?.fileAccess !== 'yolo';
    get("terminal-cwd-label").textContent=current?.fileAccess==='yolo'?'Dossier du serveur · chemin absolu ou relatif au fil':'Dossier depuis la racine du projet';
    get("terminal-run").disabled =
      busy || !available || !["develop","yolo"].includes(current?.fileAccess);
    get("terminal-access-help").textContent = !available
      ? "Exécution indisponible sur cette installation."
      : current?.id === "projects-root"
        ? "Développement temporaire · racine des projets · espace isolé · réseau autorisé"
      : !["develop","yolo"].includes(current?.fileAccess)
        ? "Active Développement ou YOLO dans les droits de l’assistant pour lancer des commandes."
        : current?.fileAccess === "yolo" ? "YOLO · root · indépendant de Heart par défaut · saisie interactive temporaire en option"
        : `Espace isolé du fil · réseau ${current.networkAccess ? "autorisé" : "désactivé"}`;
  }
  async function poll() {
    if (polling || !current || !available || !get("terminal-dialog").open)
      return;
    polling = true;
    const id = current.id, mode=current.fileAccess;
    try {
      const data = await api(`${base(id)}/commands`, {
        quiet: true,
      });
      if (current?.id !== id || current.fileAccess!==mode) return;
      const select = get("terminal-sessions");
      select.replaceChildren();
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Choisir une commande";
      select.append(empty);
      for (const command of data.commands) {
        const option = document.createElement("option");
        option.value = command.id;
        option.textContent = `${status(command)} · ${command.command.split("\n")[0].slice(0, 80)}`;
        option.title = command.command;
        select.append(option);
      }
      if (!selected && data.commands.length) selected = data.commands[0].id;
      select.value = selected;
      window.heartControls?.sync();
      if (selected) {
        const result = await api(
          `${base(id)}/commands/${selected}?offset=${offset}`,
          { quiet: true },
        );
        if (current?.id !== id || current.fileAccess!==mode || result.command.id !== selected) return;
        get("terminal-output").textContent += result.output;
        offset = result.nextOffset;
        get("terminal-status").textContent = status(result.command);
        const running = result.command.status === "running";
        for (const name of ["terminal-send", "terminal-eof"])
          get(name).disabled = busy || !running || !!result.command.independent;
        get("terminal-stop").disabled = busy || !running;
      }
    } catch (error) {
      message(errorText(error), true);
    } finally {
      polling = false;
      clearTimeout(timer);
      if (current && get("terminal-dialog").open)
        timer = setTimeout(() => void poll(), 750);
    }
  }
  get("terminal-command-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !current) return;
    const id = current.id;
    busy = true;
    sync();
    try {
      const data = await post(`${base(id)}/commands`, {
        command: get("terminal-command").value,
        cwd: get("terminal-cwd").value || ".",
        ...(current.fileAccess === 'yolo' ? {interactive:get("terminal-interactive").checked} : {}),
      });
      if (current?.id === id) {
        selected = data.command.id;
        offset = 0;
        get("terminal-output").textContent = "";
        await poll();
      }
    } catch (error) {
      message(errorText(error), true);
    } finally {
      busy = false;
      sync();
    }
  });
  get("terminal-sessions").addEventListener("change", () => {
    selected = get("terminal-sessions").value;
    offset = 0;
    get("terminal-output").textContent = "";
    void poll();
  });
  async function input(close = false) {
    if (!current || !selected || busy) return;
    busy = true;
    try {
      await post(
        `${base(current.id)}/commands/${selected}/input`,
        { input: close ? "" : get("terminal-input").value + "\n", close },
      );
      get("terminal-input").value = "";
      await poll();
    } catch (error) {
      message(errorText(error), true);
    } finally {
      busy = false;
      sync();
    }
  }
  get("terminal-input-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void input();
  });
  get("terminal-eof").addEventListener("click", () => void input(true));
  get("terminal-stop").addEventListener("click", async () => {
    if (!current || !selected || busy) return;
    busy = true;
    try {
      await post(`${base(current.id)}/commands/${selected}/stop`);
      await poll();
    } catch (error) {
      message(errorText(error), true);
    } finally {
      busy = false;
      sync();
    }
  });
  get("terminal-dialog")
    .querySelector("[data-terminal-close-footer]")
    .addEventListener("click", () => close());
  const close = () => {
    get("terminal-dialog").close();
    clearTimeout(timer);
  };
  get("terminal-dialog")
    .querySelector("[data-terminal-close]")
    .addEventListener("click", close);
  get("terminal-dialog").addEventListener("cancel", () => clearTimeout(timer));
  window.heartTerminal = {
    async open(root = false) {
      const version = ++generation;
      if(root) {
        try {
          const data = await api("/api/projects-root");
          if(version !== generation || !state.authenticated) return;
          current = {id:"projects-root",title:data.directory,fileAccess:"develop",networkAccess:true};
          available = !!data.executionAvailable;
          selected = ""; offset = 0; get("terminal-output").textContent = "";
          get("terminal-cwd").value = ".";
        } catch(error) {message(errorText(error),true);return;}
      } else if(current?.id === "projects-root") {
        current = chatContext?.conversation || null; available = !!chatContext?.executionAvailable;
        selected = ""; offset = 0; get("terminal-output").textContent = "";
        get("terminal-cwd").value = ".";
      }
      if (!current) {
        message("Ouvre une conversation pour accéder à son terminal.", true);
        return;
      }
      get("terminal-interactive").checked = false;
      get("terminal-context").textContent = current.title;
      get("terminal-dialog").showModal();
      sync();
      void poll();
    },
    conversation(data) {
      chatContext = data;
      if(current?.id === "projects-root") return;
      if (current?.id !== data.conversation?.id || current?.fileAccess !== data.conversation?.fileAccess) {
        close();
        selected = "";
        get("terminal-cwd").value=".";
        offset = 0;
        get("terminal-output").textContent = "";
      }
      current = data.conversation;
      available = !!data.executionAvailable;
      sync();
    },
    reset() {
      generation++;
      chatContext = null;
      close();
      current = null;
      selected = "";
      offset = 0;
      get("terminal-output").textContent = "";
      sync();
    },
  };
  get("capabilities-terminal").addEventListener("click", () =>
    window.heartTerminal.open(true),
  );
  sync();
})();
