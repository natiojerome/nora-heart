import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface Account {
  clientId: string;
  subject: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  scopes: string[];
}

// Credentials are deliberately separate from session and memory repositories.
// One lock per registration also serializes rotating refreshes across processes.
export class CredentialStore {
  constructor(readonly directory: string, readonly profile: string) {
    if (!path.isAbsolute(directory) || !/^[a-zA-Z0-9_-]{1,64}$/.test(profile)) throw new Error("Emplacement de connexion ChatGPT invalide.");
  }

  async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) {
      throw new Error("Le dossier de connexion ChatGPT doit appartenir à l’utilisateur et être privé (0700).");
    }
  }

  private file(name: string): string { return path.join(this.directory, name); }

  async read<T>(name: string): Promise<T | undefined> {
    let handle;
    try {
      handle = await open(this.file(name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) {
        throw new Error("Fichier de connexion ChatGPT non protégé (0600 requis).");
      }
      return JSON.parse(await handle.readFile("utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    } finally { await handle?.close(); }
  }

  async write(name: string, value: unknown): Promise<void> {
    const temporary = this.file(`.${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, this.file(name));
      const parent = await open(this.directory, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    } finally { await rm(temporary, { force: true }); }
  }

  async locked<T>(name: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.prepare();
    const lock = this.file(`${name}.lock`);
    const deadline = Date.now() + 10_000;
    let handle;
    while (!handle) {
      signal?.throwIfAborted();
      try { handle = await open(lock, "wx", 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new Error("Connexion ChatGPT occupée ; vérifier les autres processus ou un verrou interrompu.");
        await delay(50, undefined, { signal });
      }
    }
    try { return await work(); }
    finally { await handle.close(); await rm(lock, { force: true }); }
  }

  async hostId(): Promise<string> {
    return this.locked("host", async () => {
      const saved = await this.read<{ id: string }>("host.json");
      if (saved) {
        if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved.id)) throw new Error("Identifiant d’installation ChatGPT invalide.");
        return saved.id;
      }
      const id = `urn:uuid:${randomUUID()}`;
      await this.write("host.json", { id });
      return id;
    });
  }

  async account(): Promise<Account | undefined> {
    const value = await this.read<Account>(`${this.profile}.json`);
    if (value && (typeof value.clientId !== "string" || !value.clientId || typeof value.subject !== "string" || !value.subject ||
      !Array.isArray(value.scopes) || value.scopes.some(scope => typeof scope !== "string") ||
      [value.accessToken, value.refreshToken, value.idToken].some(token => token !== undefined && typeof token !== "string") ||
      (value.expiresAt !== undefined && !Number.isFinite(value.expiresAt)))) throw new Error("Connexion ChatGPT endommagée.");
    return value;
  }

  async save(account: Account): Promise<void> { await this.write(`${this.profile}.json`, account); }
}
