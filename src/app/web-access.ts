import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface WebSession { id: string; expiresAt: number; accountId?:string }

// Browser access is separate from harness sessions, model credentials and memory.
export class WebAccess {
  private revoked = new Map<string, number>();
  private attempts = new Map<string, { count: number; expiresAt: number }>();
  private consumingInvite = false;
  constructor(private readonly options: { secret: string; password?: string; inviteFile?: string }) {
    if (options.secret.length < 32) throw new Error("Clé de session web trop courte.");
  }
  private mac(value: string) { return createHmac("sha256", this.options.secret).update(value).digest("base64url"); }

  async login(body: { password?: unknown; invite?: unknown }, address: string): Promise<{ token: string; csrf: string }> {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.expiresAt < now) this.attempts.delete(key);
    if (this.attempts.size > 1024) this.attempts.clear();
    const attempts = this.attempts.get(address) ?? { count: 0, expiresAt: now + 15 * 60_000 };
    this.attempts.set(address, attempts);
    if (++attempts.count > 10) throw new Error("Trop de tentatives. Réessayer dans quelques minutes.");
    let accepted = typeof body.password === "string" && !!this.options.password && equal(hash(body.password), hash(this.options.password));
    if (!accepted && typeof body.invite === "string" && this.options.inviteFile && !this.consumingInvite) {
      this.consumingInvite = true;
      try {
        const invite = JSON.parse(await readFile(this.options.inviteFile, "utf8")) as { hash: string; expiresAt: number };
        if (invite.expiresAt > now && equal(hash(body.invite), invite.hash)) {
          // Consume on disk before granting access, including across restarts.
          await rename(this.options.inviteFile, `${this.options.inviteFile}.used`);
          await unlink(`${this.options.inviteFile}.used`);
          accepted = true;
        }
      } catch { /* Invalid or already consumed invitation. */ }
      finally { this.consumingInvite = false; }
    }
    if (!accepted) throw new Error("Accès refusé ou invitation expirée.");
    this.attempts.delete(address);
    return this.issue();
  }
  issue(accountId?:string):{token:string;csrf:string}{
    const data=Buffer.from(JSON.stringify({id:randomBytes(32).toString('base64url'),expiresAt:Date.now()+24*3600_000,...(accountId?{accountId}:{})})).toString('base64url');
    const token=data+'.'+this.mac(data);return {token,csrf:this.csrf(token)};
  }
  session(token: string): WebSession | undefined {
    try {
      const [data, signature, extra] = token.split(".");
      if (extra || !data || !signature || !equal(this.mac(data), signature)) return;
      const session = JSON.parse(Buffer.from(data, "base64url").toString()) as WebSession;
      if (typeof session.id !== "string" || !Number.isFinite(session.expiresAt) || session.expiresAt < Date.now() || this.revoked.has(session.id)) return;
      return session;
    } catch { return; }
  }
  csrf(token: string): string { return this.mac(`csrf:${token}`); }
  checkCsrf(token: string, csrf: string): boolean { return equal(this.csrf(token), csrf); }
  logout(token: string): void {
    const session = this.session(token);
    if (session) this.revoked.set(session.id, session.expiresAt);
    for (const [id, expires] of this.revoked) if (expires < Date.now()) this.revoked.delete(id);
  }
}

export async function writeWebInvitation(file: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await writeFile(file, JSON.stringify({ hash: hash(token), expiresAt: Date.now() + 24 * 3600_000 }), { mode: 0o600 });
  return token;
}
