import { randomBytes } from "node:crypto";
import type { Installation, InstallationAccount } from "./installation.ts";
export class AccountLoginError extends Error {}
interface Pending {
  device: string;
  expires: number;
  next: number;
  interval: number;
}
/** Device flow keeps portal passwords, device codes and service keys out of browser/model state. */
export class AccountLogin {
  private pending = new Map<string, Pending>();
  private account: InstallationAccount | null | undefined;
  readonly server: string;
  constructor(
    private installation: Installation,
    private installationId: string,
    server = "https://mcps.natio.re",
    private transport: typeof fetch = fetch,
    private maxPending = 64,
  ) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(installationId))
      throw new AccountLoginError("Identifiant d’installation invalide.");
    if (!Number.isSafeInteger(maxPending) || maxPending < 1)
      throw new AccountLoginError("Limite de connexions invalide.");
    const url = new URL(server);
    if (
      url.protocol !== "https:" &&
      !(
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.protocol === "http:"
      )
    )
      throw new AccountLoginError("HTTPS account authority required.");
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new AccountLoginError("Account server origin required.");
    this.server = url.origin;
  }
  async status() {
    if (this.account === undefined)
      this.account = (await this.installation.status()).account;
    return { available: true, account: this.account, server: this.server };
  }
  private async request(endpoint: string, body: unknown, bearer?: string) {
    const r = await this.transport(this.server + endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": endpoint.startsWith("/oauth/")
          ? "application/x-www-form-urlencoded"
          : "application/json",
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
      },
      body: endpoint.startsWith("/oauth/")
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    if (
      !r.ok &&
      ![
        "authorization_pending",
        "slow_down",
        "access_denied",
        "expired_token",
      ].includes(data.error)
    )
      throw new AccountLoginError("Connexion au compte MCP indisponible.");
    return data;
  }
  async start() {
    for (const [id, p] of this.pending)
      if (p.expires < Date.now()) this.pending.delete(id);
    if (this.pending.size >= this.maxPending)
      throw new AccountLoginError("Trop de connexions en attente.");
    const data = await this.request("/oauth/device_authorization", {
      client_id: "nora-heart",
      installation_id: this.installationId,
    });
    if (
      typeof data.device_code !== "string" ||
      typeof data.user_code !== "string" ||
      typeof data.verification_uri_complete !== "string" ||
      new URL(data.verification_uri_complete).origin !== this.server ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    )
      throw new AccountLoginError("Réponse de connexion incompatible.");
    const id = randomBytes(32).toString("base64url"),
      interval = Math.max(5, Number(data.interval) || 5);
    this.pending.set(id, {
      device: data.device_code,
      expires: Date.now() + data.expires_in * 1000,
      next: 0,
      interval,
    });
    return {
      flowId: id,
      userCode: data.user_code,
      url: data.verification_uri_complete,
      interval,
      expiresIn: data.expires_in,
    };
  }
  async poll(id: unknown, beforeSave?: () => void) {
    if (typeof id !== "string")
      throw new AccountLoginError("Connexion invalide.");
    const p = this.pending.get(id);
    if (!p || p.expires < Date.now()) {
      this.pending.delete(id);
      throw new AccountLoginError("Connexion expirée. Recommence.");
    }
    if (p.next > Date.now()) return { pending: true, interval: p.interval };
    p.next = Date.now() + p.interval * 1000;
    const data = await this.request("/oauth/token", {
      client_id: "nora-heart",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: p.device,
    });
    if (data.error === "authorization_pending")
      return { pending: true, interval: p.interval };
    if (data.error === "slow_down") {
      p.interval += 5;
      return { pending: true, interval: p.interval };
    }
    this.pending.delete(id);
    if (
      data.error ||
      typeof data.access_token !== "string" ||
      typeof data.account?.id !== "string" ||
      typeof data.account?.email !== "string"
    )
      throw new AccountLoginError("Connexion refusée ou expirée.");
    const current = await this.installation.status();
    if (
      current.account &&
      (current.account.id !== data.account.id ||
        current.account.server !== this.server)
    )
      throw new AccountLoginError(
        "Utilise le compte propriétaire de cette installation.",
      );
    if (current.account && current.services.length === 3)
      return {
        pending: false,
        account: current.account,
        restartRequired: false,
      };
    const bundle = await this.request(
      "/api/heart/bootstrap",
      {},
      data.access_token,
    );
    if (
      bundle.account?.id !== data.account.id ||
      typeof bundle.account?.email !== "string"
    )
      throw new AccountLoginError("Identité du compte incohérente.");
    const account: InstallationAccount = {
      id: bundle.account.id,
      email: bundle.account.email,
      server: this.server,
    };
    beforeSave?.();
    await this.installation.configure(bundle.services, account);
    this.account = account;
    return { pending: false, account, restartRequired: true };
  }
}
