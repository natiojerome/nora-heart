import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { CredentialStore, type Account } from "./store.ts";

const issuer = "https://auth.openai.com";
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const resource = "https://api.openai.com/v1";
const requiredScopes = ["resource.invoke", "chatgpt.tokens.use.direct"];
const random = () => randomBytes(32).toString("base64url");
export interface ChatGptAuthOptions { directory: string; profile?: string; fetch?: typeof globalThis.fetch }
export interface ChatGptStatus { profile: string; connected: boolean; email?: string; clientId?: string }

export class ChatGptAuth {
  private readonly store: CredentialStore;
  private readonly transport: typeof globalThis.fetch;
  private readonly jwks;

  constructor(options: ChatGptAuthOptions) {
    this.store = new CredentialStore(options.directory, options.profile ?? "default");
    this.transport = options.fetch ?? globalThis.fetch;
    this.jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { [customFetch]: this.transport });
  }

  private async tokens(body: URLSearchParams, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const response = await this.transport(tokenEndpoint, { method: "POST", body, redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      if (data.error === "invalid_grant") throw new Error("chatgpt_reauthorization_required");
      throw new Error("Échange OAuth ChatGPT indisponible.");
    }
    return data;
  }

  private tokenSet(data: Record<string, unknown>, previous?: Account) {
    if (typeof data.access_token !== "string" || !data.access_token || typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
      typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      (data.refresh_token !== undefined && typeof data.refresh_token !== "string")) throw new Error("Réponse OAuth ChatGPT invalide.");
    const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [];
    if (!requiredScopes.every(scope => scopes.includes(scope))) throw new Error("Usage du forfait ChatGPT non autorisé ; reconnecter le compte avec cette permission.");
    return { accessToken: data.access_token, refreshToken: data.refresh_token as string | undefined ?? previous?.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000, scopes };
  }

  async status(): Promise<ChatGptStatus> {
    await this.store.prepare();
    const account = await this.store.account();
    return { profile: this.store.profile, connected: !!account?.accessToken && requiredScopes.every(s => account.scopes.includes(s)),
      email: account?.email, clientId: account?.clientId };
  }

  async accessToken(signal?: AbortSignal): Promise<string> {
    try {
      return await this.store.locked(this.store.profile, async () => {
        const account = await this.store.account();
        if (!account?.accessToken || !requiredScopes.every(scope => account.scopes.includes(scope))) throw new Error("chatgpt_reauthorization_required");
        if ((account.expiresAt ?? 0) > Date.now() + 60_000) return account.accessToken;
        if (!account.refreshToken) throw new Error("chatgpt_reauthorization_required");
        let data;
        try {
          data = await this.tokens(new URLSearchParams({ grant_type: "refresh_token", client_id: account.clientId,
            refresh_token: account.refreshToken, resource }), signal);
        } catch (error) {
          if (error instanceof Error && error.message === "chatgpt_reauthorization_required") {
            await this.store.save({ clientId: account.clientId, subject: account.subject, email: account.email, scopes: [] });
          }
          throw error;
        }
        const next = { ...account, ...this.tokenSet(data, account) };
        if (typeof data.id_token === "string") {
          const { payload } = await jwtVerify(data.id_token, this.jwks, { issuer, audience: account.clientId, requiredClaims: ["sub", "exp", "iat"] });
          if (payload.sub !== account.subject) throw new Error("Identité ChatGPT modifiée.");
          next.idToken = data.id_token;
        }
        signal?.throwIfAborted();
        await this.store.save(next);
        return next.accessToken;
      }, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof Error && error.message === "chatgpt_reauthorization_required") throw error;
      throw new Error("Renouvellement ChatGPT impossible ; credentials conservés, aucun repli API.");
    }
  }

  async login(options: { appName: string; port?: number; signal?: AbortSignal; onReady(url: string): void }): Promise<ChatGptStatus> {
    const hostId = await this.store.hostId();
    try {
      await this.store.locked(this.store.profile, async () => {
        const previous = await this.store.account();
        const registrationFile = `${this.store.profile}.registration.json`;
        const registration = await this.store.read<{ clientId: string }>(registrationFile);
        const clientId = previous?.clientId ?? registration?.clientId;
        if (clientId !== undefined && (typeof clientId !== "string" || !clientId || clientId === "dynamic_agent_client")) throw new Error("Enregistrement ChatGPT invalide.");
        const state = random(), nonce = random(), verifier = random();
        const port = options.port ?? 1455;
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Port de connexion invalide.");
        const redirect = `http://127.0.0.1:${port}/auth/callback`;
        const entry = `http://127.0.0.1:${port}/connect/${random()}`;
        const authorize = new URL(`${issuer}/api/accounts/authorize`);
        authorize.search = new URLSearchParams({ client_id: clientId ?? "dynamic_agent_client", ext_agent_host_id: hostId,
          response_type: "code", redirect_uri: redirect, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
          resource, state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
          ...(!clientId ? { agent_name_hint: options.appName } : {}),
        }).toString();
        // Hints go only to the browser, never into CLI logs or chat output.
        if (previous?.idToken) authorize.searchParams.set("id_token_hint", previous.idToken);
        const signal = AbortSignal.any([AbortSignal.timeout(300_000), ...(options.signal ? [options.signal] : [])]);
        signal.throwIfAborted();
        let busy = false;
        let complete!: () => void, fail!: (error: unknown) => void;
        const completion = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
        const server = createServer((request, response) => {
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Referrer-Policy", "no-referrer");
          response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
          const url = new URL(request.url ?? "/", entry);
          if (request.method !== "GET") { response.writeHead(405).end(); return; }
          if (url.pathname === new URL(entry).pathname) {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(`<a href="${authorize.href.replaceAll("&", "&amp;")}">Continue with ChatGPT</a>`);
            return;
          }
          if (url.pathname !== "/auth/callback") { response.writeHead(404).end(); return; }
          const returned = url.searchParams.get("state") ?? "";
          if (url.searchParams.getAll("state").length !== 1 || Buffer.byteLength(returned) !== Buffer.byteLength(state) ||
            !timingSafeEqual(Buffer.from(returned), Buffer.from(state))) { response.writeHead(400).end("Connexion non vérifiée."); return; }
          if (busy) { response.writeHead(409).end(); return; }
          busy = true;
          void (async () => {
            if (url.searchParams.has("error")) throw new Error("Connexion refusée.");
            const issued = url.searchParams.get("client_id") ?? clientId;
            const code = url.searchParams.get("code");
            if (!issued || issued === "dynamic_agent_client" || (clientId && issued !== clientId) || !code ||
              url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("client_id").length > 1) throw new Error("Retour OAuth invalide.");
            await this.store.write(registrationFile, { clientId: issued });
            const data = await this.tokens(new URLSearchParams({ grant_type: "authorization_code", client_id: issued,
              code, code_verifier: verifier, redirect_uri: redirect, resource }), signal);
            if (typeof data.id_token !== "string") throw new Error("Identité absente.");
            const { payload } = await jwtVerify(data.id_token, this.jwks, { issuer, audience: issued, requiredClaims: ["sub", "exp", "iat"] });
            if (payload.nonce !== nonce || !payload.sub || (previous && previous.subject !== payload.sub)) throw new Error("Identité non vérifiée.");
            signal.throwIfAborted();
            await this.store.save({ clientId: issued, subject: payload.sub,
              ...(typeof payload.email === "string" ? { email: payload.email } : {}),
              ...this.tokenSet(data), idToken: data.id_token });
            response.end("Connexion ChatGPT terminée. Tu peux fermer cette fenêtre.", complete);
          })().catch(error => { response.writeHead(400).end("Connexion ChatGPT impossible. Revenir au terminal."); fail(error); });
        });
        const aborted = () => fail(signal.reason);
        signal.addEventListener("abort", aborted, { once: true });
        server.once("error", fail);
        try {
          server.listen(port, "127.0.0.1", () => { try { options.onReady(entry); } catch (error) { fail(error); } });
          await completion;
        } finally {
          signal.removeEventListener("abort", aborted);
          server.closeAllConnections();
          await new Promise<void>(resolve => server.close(() => resolve()));
        }
      }, options.signal);
      return await this.status();
    } catch {
      options.signal?.throwIfAborted();
      throw new Error("Connexion ChatGPT impossible ou expirée. Vérifier le port, le consentement et l’éligibilité.");
    }
  }

  async logout(): Promise<{ remoteRevoked: boolean }> {
    return this.store.locked(this.store.profile, async () => {
      const account = await this.store.account();
      if (!account) return { remoteRevoked: true };
      let remoteRevoked = false;
      try {
        if (account.refreshToken) {
          const discovery = await this.transport(`${issuer}/.well-known/openid-configuration`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
          if (!discovery.ok) throw new Error("Discovery indisponible.");
          const metadata = await discovery.json() as { revocation_endpoint: string };
          const endpoint = new URL(metadata.revocation_endpoint);
          if (endpoint.origin !== issuer) throw new Error("Endpoint inattendu.");
          const response = await this.transport(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
            body: new URLSearchParams({ token: account.refreshToken, token_type_hint: "refresh_token", client_id: account.clientId }) });
          remoteRevoked = response.status === 200;
        }
      } catch { /* Always clear local credentials; report unconfirmed revocation. */ }
      await this.store.save({ clientId: account.clientId, subject: account.subject, email: account.email, scopes: [] });
      return { remoteRevoked };
    });
  }
}
