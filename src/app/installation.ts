import { readFile, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ExternalToolRepository,
  ConnectExternalTools,
} from "../contracts/external-tools.ts";
import { ExternalTools } from "./external-tools.ts";
import { connectMcp } from "../modules/tools/mcp/index.ts";
const services = ["memory", "projects", "vault", "mail"] as const;
const tokenName = (name: string) =>
  "HEART_MCP_" + name.toUpperCase() + "_TOKEN";
const bindingName = (name: string) =>
  "HARNESS_" + name.toUpperCase() + "_MCP_CONNECTION_ID";
const allowed = new Set(
  services.flatMap((s) => [tokenName(s), bindingName(s)]),
);
allowed.add("HEART_MCP_VAULT_URL");
export interface InstallationAccount {
  id: string;
  email: string;
  server: string;
}
interface Saved {
  account?: InstallationAccount;
  version: 1;
  revision?: string;
  env: Record<string, string>;
}
export async function loadInstallation(file: string): Promise<Saved> {
  let saved: Saved;
  try {
    saved = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, env: {} };
    throw Error("Configuration privée de l’installation illisible.");
  }
  if (
    (saved.account !== undefined &&
      (!saved.account ||
        typeof saved.account.id !== "string" ||
        typeof saved.account.email !== "string" ||
        typeof saved.account.server !== "string")) ||
    saved.version !== 1 ||
    !saved.env ||
    Object.entries(saved.env).some(
      ([k, v]) => !allowed.has(k) || typeof v !== "string",
    )
  )
    throw Error("Configuration privée de l’installation invalide.");
  return saved;
}
export class Installation {
  private saving = false;
  constructor(
    private readonly file: string,
    private readonly repository: ExternalToolRepository,
    private readonly connect?: ConnectExternalTools,
  ) {}
  async status() {
    const saved = await loadInstallation(this.file);
    return {
      available: true,
      ready:
        !!saved.revision &&
        process.env.HARNESS_INSTALL_REVISION === saved.revision,
      account: saved.account ?? null,
      services: services.filter((s) => saved.env[bindingName(s)]),
    };
  }
  async configure(
    body: Record<string, unknown>,
    account?: InstallationAccount,
  ) {
    if (this.saving) throw Error("Configuration déjà en cours.");
    this.saving = true;
    try {
      if (Object.keys(body).some((k) => !services.includes(k as any)))
        throw Error("Services invalides.");
      const saved = await loadInstallation(this.file),
        env = { ...process.env, ...saved.env },
        drafts = [];
      if (account && saved.account && saved.account.id !== account.id)
        throw Error("Cette installation appartient à un autre compte.");
      if (account) saved.account = account;
      for (const s of services) {
        if (body[s] === undefined) continue;
        const value = body[s] as { url?: unknown; token?: unknown };
        if (
          !value ||
          typeof value.url !== "string" ||
          typeof value.token !== "string" ||
          !value.token.trim() ||
          /[\r\n\0]/u.test(value.token)
        )
          throw Error("URL et clé du service requises.");
        const id = saved.env[bindingName(s)] ?? randomUUID(),
          old = await this.repository.get(id);
        env[tokenName(s)] = value.token.trim();
        drafts.push({
          id,
          version: old?.version ?? 0,
          label: "Services · " + s,
          url: value.url,
          auth: { type: "bearer_env" as const, envVar: tokenName(s) },
          enabled: true,
          allowWrites: true,
          transient: s === "vault",
          timeoutMs: 60000,
          service: s,
        });
      }
      if (!drafts.length) throw Error("Choisir au moins un service.");
      const manager = new ExternalTools(
        this.repository,
        this.connect ??
          ((connection, signal) => connectMcp(connection, { env, signal })),
      );
      const expected = {
        memory: [
          "memory_search",
          "memory_get",
          "memory_create",
          "memory_update",
          "memory_forget",
          "memory_revisions",
        ],
        projects: ["projects_search", "projects_get", "projects_create"],
        vault: ["vault_create", "vault_read"],
        mail: ["mail_accounts", "mail_search", "mail_draft_save", "mail_send"],
      };
      const verified = await Promise.all(
        drafts.map(async (draft) => {
          const tools = (await manager.discover(draft)).tools;
          if (
            expected[draft.service].some(
              (name) => !tools.some((t) => t.name === name),
            )
          )
            throw Error("Service MCP incompatible.");
          return { draft, tools };
        }),
      );
      for (const { draft, tools } of verified) {
        await manager.save({
          ...draft,
          toolNames: tools.map((t) => t.name),
          refreshDefinitions: true,
        });
        saved.env[tokenName(draft.service)] = env[tokenName(draft.service)]!;
        saved.env[bindingName(draft.service)] = draft.id;
        if (draft.service === "vault")
          saved.env.HEART_MCP_VAULT_URL = draft.url;
      }
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      saved.revision = randomUUID();
      const tmp = this.file + "." + randomUUID() + ".tmp";
      try {
        const file = await open(tmp, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(saved));
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(tmp, this.file);
      } finally {
        await rm(tmp, { force: true });
      }
      return {
        restartRequired: true,
        services: services.filter((s) => saved.env[bindingName(s)]),
      };
    } finally {
      this.saving = false;
    }
  }
}
