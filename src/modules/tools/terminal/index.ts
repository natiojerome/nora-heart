import {setTimeout as wait} from 'node:timers/promises';
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  realpath,
  readdir,
  readFile,
  writeFile,
  rename,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import type {
  CommandInput,
  CommandOutput,
  CommandSnapshot,
  ExecutionService,
} from "../../../contracts/execution.ts";
import type { Tool } from "../../../contracts/tools.ts";
import type { Json } from "../../../contracts/json.ts";

export class ExecutionError extends Error {}
type Active = {
  workspace: string;
  command: CommandSnapshot;
  child: ChildProcessWithoutNullStreams;
  done: Promise<void>;
  kill: (signal:"SIGTERM"|"SIGKILL") => void;
};
/** Shared process journal; sandbox and host launch paths are selected explicitly. */
class ProcessExecution implements ExecutionService {
  private readonly active = new Map<string, Active>();
  constructor(
    private readonly directory: string,
    private readonly options: { binary?: string; nodeBinary?: string; host?: {home:string; ownerUnit?:string} } = {},
  ) {}
  private folder(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new ExecutionError("Commande introuvable.");
    return path.join(this.directory, id);
  }
  private async save(command: CommandSnapshot, workspace: string) {
    const target = path.join(this.folder(command.id), "command.json"),
      temporary = target + ".tmp";
    await writeFile(temporary, JSON.stringify({ command, workspace }), {
      mode: 0o600,
    });
    await rename(temporary, target);
  }
  private async record(workspace: string, id: string) {
    const root = await realpath(workspace),
      active = this.active.get(id);
    if (active) {
      if (active.workspace !== root)
        throw new ExecutionError("Commande hors de cette conversation.");
      return { command: active.command, workspace: root };
    }
    let record: { command: CommandSnapshot; workspace: string };
    try {
      record = JSON.parse(
        await readFile(path.join(this.folder(id), "command.json"), "utf8"),
      );
    } catch {
      throw new ExecutionError("Commande introuvable.");
    }
    if (record.workspace !== root)
      throw new ExecutionError("Commande hors de cette conversation.");
    if (record.command.status === "running")
      record.command = {
        ...record.command,
        status: "interrupted",
        signal: "SERVICE_RESTART",
      };
    return record;
  }
  async start(workspace: string, input: CommandInput, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (typeof input.command !== "string" || !input.command.trim())
      throw new ExecutionError("Commande requise.");
    if (
      input.timeoutMs !== undefined &&
      (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1)
    )
      throw new ExecutionError("Durée de commande invalide.");
    const root = await realpath(workspace),
      cwd = await realpath(path.resolve(root, input.cwd ?? ".")),
      relative = path.relative(root, cwd);
    if (
      !this.options.host && (relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative))
    )
      throw new ExecutionError("Dossier hors de l’espace de travail.");
    const id = randomUUID(),
      folder = this.folder(id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const command: CommandSnapshot = {
      id,
      command: input.command,
      cwd: this.options.host ? cwd : relative || ".",
      startedAt: new Date().toISOString(),
      status: "running",
      exitCode: null,
      signal: null,
    };
    await this.save(command, root);
    await writeFile(path.join(folder, "output.log"), "", {
      flag: "wx",
      mode: 0o600,
    });
    const args = [
      "--unshare-all",
      ...(input.network ? ["--share-net"] : []),
      "--die-with-parent",
      "--hostname",
      "heart",
      "--clearenv",
      "--ro-bind",
      "/usr",
      "/usr",
      "--symlink",
      "usr/bin",
      "/bin",
      "--symlink",
      "usr/sbin",
      "/sbin",
      "--symlink",
      "usr/lib",
      "/lib",
      "--symlink",
      "usr/lib64",
      "/lib64",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--dir",
      "/home/heart",
      "--ro-bind",
      "/etc/ssl/certs",
      "/etc/ssl/certs",
      "--ro-bind",
      "/etc/resolv.conf",
      "/etc/resolv.conf",
      "--ro-bind",
      "/etc/hosts",
      "/etc/hosts",
      ...(this.options.nodeBinary
        ? [
            "--dir",
            "/opt/heart/bin",
            "--ro-bind",
            this.options.nodeBinary,
            "/opt/heart/bin/node",
          ]
        : []),
      "--bind",
      root,
      "/workspace",
      "--chdir",
      path.posix.join("/workspace", relative.split(path.sep).join("/")),
      "--setenv",
      "PATH",
      "/opt/heart/bin:/usr/local/bin:/usr/bin:/bin",
      "--setenv",
      "HOME",
      "/home/heart",
      "--setenv",
      "LANG",
      "C.UTF-8",
      "--setenv",
      "TERM",
      "dumb",
      "--",
      "/bin/sh",
      "-c",
      input.command,
    ];
    const unit = `heart-yolo-${id}.service`;
    const hostArgs = this.options.host ? [
      "--quiet", "--wait", "--pipe", "--collect", "--service-type=exec",
      "--expand-environment=no", `--unit=${unit}`, `--working-directory=${cwd}`,
      "--property=ExitType=cgroup", "--property=KillMode=control-group", `--property=Group=${process.getgid?.()??0}`, "--property=UMask=0007",
      ...(this.options.host.ownerUnit ? [`--property=PartOf=${this.options.host.ownerUnit}`] : []),
      "--", "/usr/bin/env", "-i", `HOME=${this.options.host.home}`,
      `PATH=${this.options.nodeBinary ? path.dirname(this.options.nodeBinary)+":" : ""}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
      "LANG=C.UTF-8", "TERM=dumb", "/bin/sh", "-c", input.command,
    ] : args;
    const child = spawn(this.options.host ? "/usr/bin/systemd-run" : this.options.binary ?? "/usr/bin/bwrap", hostArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    });
    child.stdin.on("error", () => {});
    const log = createWriteStream(path.join(folder, "output.log"), {
      flags: "a",
      mode: 0o600,
    });
    log.on("error", () => {});
    const pump = async (stream: AsyncIterable<Buffer>) => {
      for await (const chunk of stream)
        await new Promise<void>((resolve, reject) =>
          log.write(chunk, (error) => (error ? reject(error) : resolve())),
        );
    };
    const streams = Promise.all([pump(child.stdout), pump(child.stderr)]);
    let timer: ReturnType<typeof setTimeout> | undefined,
      killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: "SIGTERM" | "SIGKILL") => {
      if (this.options.host) {
        const request = spawn("/usr/bin/systemctl", ["kill", "--kill-whom=all", `--signal=${signal}`, unit], {stdio:"ignore", env:{PATH:"/usr/bin:/bin"}});
        request.on("error", () => {});
      } else if (child.pid) {try { process.kill(-child.pid, signal); } catch {}}
    };
    const terminate = () => {
      if (child.pid) {
        kill("SIGTERM");
        killTimer = setTimeout(() => {
          kill("SIGKILL");
        }, 1000);
        killTimer.unref();
      }
    };
    void streams.catch(() => {
      command.status = "interrupted";
      terminate();
    });
    const abort = () => {
      command.status = "interrupted";
      terminate();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (input.timeoutMs) timer = setTimeout(abort, input.timeoutMs);
    const closed = new Promise<void>((resolve) => {
      child.once("error", () => {
        command.status = "interrupted";
        command.signal = "SPAWN_ERROR";
        resolve();
      });
      child.once("close", (code, endedSignal) => {
        command.exitCode = code;
        command.signal = endedSignal;
        resolve();
      });
    });
    const done = (async () => {
      await closed;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      try {
        await streams;
      } catch {
        command.status = "interrupted";
        command.signal ??= "OUTPUT_ERROR";
      }
      await new Promise<void>((resolve) => log.end(resolve));
      if (command.status === "running") command.status = "completed";
      await this.save(command, root);
      this.active.delete(id);
    })();
    // Handle a disconnect immediately after spawn as well as one occurring during a run.
    this.active.set(id, { workspace: root, command, child, done, kill });
    void done.catch(() => {
      command.status = "interrupted";
      command.signal = "JOURNAL_ERROR";
    });
    if (signal?.aborted) abort();
    // Yield immediately; output is durable and can be polled without keeping a model request open.
    return structuredClone(command);
  }
  async read(
    workspace: string,
    id: string,
    offset = 0,
    length = 65536,
  ): Promise<CommandOutput> {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(length) ||
      length < 1
    )
      throw new ExecutionError("Plage de sortie invalide.");
    const { command } = await this.record(workspace, id),
      file = await open(path.join(this.folder(id), "output.log"), "r");
    try {
      const size = (await file.stat()).size,
        bytes = Buffer.alloc(Math.min(length, Math.max(0, size - offset)));
      const result = await file.read(bytes, 0, bytes.length, offset);
      return {
        command: structuredClone(command),
        output: bytes.subarray(0, result.bytesRead).toString("utf8"),
        offset,
        nextOffset: offset + result.bytesRead,
        more: offset + result.bytesRead < size,
      };
    } finally {
      await file.close();
    }
  }
  async write(workspace: string, id: string, input: string, close = false) {
    await this.record(workspace, id);
    const active = this.active.get(id);
    if (!active) throw new ExecutionError("Cette commande est terminée.");
    if (typeof input !== "string")
      throw new ExecutionError("Entrée texte requise.");
    await new Promise<void>((resolve, reject) =>
      active.child.stdin.write(input, (error) =>
        error
          ? reject(new ExecutionError("Entrée de commande fermée."))
          : resolve(),
      ),
    );
    if (close) active.child.stdin.end();
  }
  async stop(workspace: string, id: string) {
    await this.record(workspace, id);
    const active = this.active.get(id);
    if (!active) return (await this.record(workspace, id)).command;
    active.command.status = "interrupted";
    active.kill("SIGTERM");
    const timer = setTimeout(() => active.kill("SIGKILL"), 1000);
    timer.unref();
    await active.done;
    clearTimeout(timer);
    return structuredClone(active.command);
  }
  async list(workspace: string) {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return [];
    }
    const results: CommandSnapshot[] = [];
    for (const id of names)
      try {
        results.push(
          structuredClone((await this.record(workspace, id)).command),
        );
      } catch {}
    return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}

/** Workspace-only Linux namespaces. Never falls back to the host. */
export class BubblewrapExecution extends ProcessExecution {
  constructor(directory:string, options:{binary?:string;nodeBinary?:string}={}) {super(directory,options);}
}
/** Unrestricted host commands: construct only in the explicitly installed worker. */
export class HostExecution extends ProcessExecution {
  constructor(directory:string, options:{home:string;nodeBinary?:string;ownerUnit?:string}) {super(directory,{nodeBinary:options.nodeBinary,host:options});}
}

export function terminalTools(
  execution: ExecutionService,
  network: boolean,
  host = false,
): Tool[] {
  const tool = (
    name: string,
    description: string,
    properties: Record<string, Json>,
    required: string[],
    execute: (
      args: Record<string, Json>,
      workspace: string,
      signal?: AbortSignal,
    ) => Promise<unknown>,
  ): Tool => ({
    name,
    description,
    permission: "process.execute",
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    async execute(args, context) {
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new ExecutionError("Arguments de commande invalides.");
      return JSON.stringify(
        (await execute(args, context.workspace, context.signal)) ?? {
          ok: true,
        },
      );
    },
  });
  const string = { type: "string" },
    integer = { type: "integer", minimum: 0 };
  const continuation = (output:Awaited<ReturnType<ExecutionService["read"]>>) => output.more
    ? {notice:"Sortie partielle : continuation permet de lire la suite utile.",continuation:{tool:"terminal.read",arguments:{id:output.command.id,offset:output.nextOffset}}}
    : {};
  return [
    tool(
      "terminal.exec",
      host ? "Mode YOLO autorisé : commande sur le serveur entier en root, réseau disponible, cwd absolu accepté. Aucune confirmation d’outil supplémentaire requise pour la tâche demandée. Ne demande pas les permissions déjà accordées. Vérifie les résultats. Retourne id, état et première sortie ; terminal.read seulement si running ou more. yieldTimeMs règle l’attente de retour (500 ms par défaut, 0 immédiat), sans arrêter la commande. Aucun timeout imposé." : "Lancer une commande shell dans le projet isolé (Git, recherche rg, tests, scripts, installations). Retourne id, état et première sortie ; terminal.read seulement si running ou more. yieldTimeMs règle l’attente de retour (500 ms par défaut, 0 immédiat). Réseau selon le réglage du propriétaire. Aucun timeout imposé ; timeoutMs facultatif.",
      {
        command: string,
        cwd: {type:"string",description:host?"Facultatif : répertoire courant sur l’hôte ; chemins absolus acceptés.":"Facultatif : racine de l’espace du fil par défaut. Utiliser '.' ou un sous-dossier ; le dossier d’installation Heart est distinct."},
        timeoutMs: { type: "integer", minimum: 1 },
        yieldTimeMs: integer,
      },
      ["command"],
      async (args, workspace, signal) => {
        const yieldTimeMs=args.yieldTimeMs??500;
        if(typeof yieldTimeMs!=='number'||!Number.isSafeInteger(yieldTimeMs)||yieldTimeMs<0)throw new ExecutionError('Attente de retour invalide.');
        const command=await execution.start(workspace,{
          command:args.command as string,cwd:args.cwd as string|undefined,
          timeoutMs:args.timeoutMs as number|undefined,network,
        },signal);
        const deadline=performance.now()+yieldTimeMs;
        let output=await execution.read(workspace,command.id);
        while(output.command.status==='running'&&performance.now()<deadline){
          await wait(Math.min(25,Math.max(0,deadline-performance.now())),undefined,{signal});
          output=await execution.read(workspace,command.id);
        }
        return {...output.command,offset:output.offset,nextOffset:output.nextOffset,more:output.more,...continuation(output),output:output.output};
      },
    ),
    tool(
      "terminal.read",
      "Lire stdout/stderr et l’état d’une commande ; continuer avec nextOffset. offset/length sont configurables, aucune sortie totale supprimée.",
      { id: string, offset: integer, length: { type: "integer", minimum: 1 } },
      ["id"],
      async (args, workspace) => {
        const output=await execution.read(workspace,args.id as string,args.offset as number|undefined,args.length as number|undefined);
        return {command:output.command,offset:output.offset,nextOffset:output.nextOffset,more:output.more,...continuation(output),output:output.output};
      },
    ),
    tool(
      "terminal.write",
      "Envoyer du texte à stdin d’une commande active, avec saut de ligne si nécessaire. close=true ferme stdin.",
      { id: string, input: string, close: { type: "boolean" } },
      ["id", "input"],
      (args, workspace) =>
        execution.write(
          workspace,
          args.id as string,
          args.input as string,
          args.close as boolean | undefined,
        ),
    ),
    tool(
      "terminal.stop",
      "Arrêter une commande et ses descendants.",
      { id: string },
      ["id"],
      (args, workspace) => execution.stop(workspace, args.id as string),
    ),
    tool(
      "terminal.list",
      "Retrouver les commandes de ce projet, y compris après un rechargement.",
      {},
      [],
      (_args, workspace) => execution.list(workspace),
    ),
  ];
}

/** Private Unix socket transport; the web process keeps its own restricted UID. */
export class HostExecutionClient implements ExecutionService {
  constructor(private readonly socketPath:string) {}
  private readonly signals=new Map<string,{signal:AbortSignal;stop:()=>void}>();
  private release(id:string){const item=this.signals.get(id);if(item)item.signal.removeEventListener('abort',item.stop);this.signals.delete(id);}
  private async call<T>(action:string,workspace:string,args:unknown[]=[]):Promise<T>{
    const {request}=await import('node:http');
    return new Promise<T>((resolve,reject)=>{
      const req=request({socketPath:this.socketPath,path:'/'+action,method:'POST',headers:{'content-type':'application/json'}},res=>{
        const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',()=>reject(new ExecutionError('Connexion au worker YOLO interrompue.')));
        res.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode!==200)reject(new ExecutionError(body.error??'Commande YOLO indisponible.'));else resolve(body);}catch{reject(new ExecutionError('Réponse du worker YOLO invalide.'));}});
      });
      req.on('error',()=>reject(new ExecutionError('Worker YOLO indisponible. Aucun repli vers le terminal isolé.')));
      req.end(JSON.stringify({workspace,args}));
    });
  }
  async start(workspace:string,input:CommandInput,signal?:AbortSignal){
    signal?.throwIfAborted();
    const command=await this.call<CommandSnapshot>('start',workspace,[input]);
    const stop=()=>{void this.stop(workspace,command.id).catch(()=>{});};
    if(signal?.aborted)await this.stop(workspace,command.id);
    else if(signal){this.signals.set(command.id,{signal,stop});signal.addEventListener('abort',stop,{once:true});}
    // Listener lifecycle is tied to the run signal; no polling/model call needed.
    return command;
  }
  async read(workspace:string,id:string,offset?:number,length?:number){const result=await this.call<CommandOutput>('read',workspace,[id,offset,length]);if(result.command.status!=='running')this.release(id);return result;}
  async write(workspace:string,id:string,input:string,close=false){await this.call('write',workspace,[id,input,close]);}
  async stop(workspace:string,id:string){try{return await this.call<CommandSnapshot>('stop',workspace,[id]);}finally{this.release(id);}}
  async list(workspace:string){const result=await this.call<CommandSnapshot[]>('list',workspace);for(const command of result)if(command.status!=='running')this.release(command.id);return result;}
}
