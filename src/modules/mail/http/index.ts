import { Readable } from "node:stream";
import type { MailFileTransfer } from "../../../contracts/mail.ts";
export class HttpMailFiles implements MailFileTransfer {
  constructor(
    private connection: (
      write: boolean,
    ) => Promise<{ url: string; token: string }>,
    private transport: typeof fetch = fetch,
  ) {}
  async upload(
    name: string,
    type: string,
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ) {
    const c = await this.connection(true),
      url = new URL(c.url);
    url.pathname = url.pathname.replace(/\/$/, "") + "/files";
    url.search = new URLSearchParams({ name, type }).toString();
    const response = await this.transport(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + c.token,
        "Content-Type": "application/octet-stream",
      },
      body: Readable.from(body),
      duplex: "half",
      signal,
    } as unknown as RequestInit);
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(
        "Transfert Mail refusé. Vérifie la connexion, les permissions et la taille de requête configurée.",
      );
    }
    return response.json() as Promise<{
      id: string;
      name: string;
      type: string;
      size: number;
      sha256: string;
    }>;
  }
  async download(id: string, signal?: AbortSignal) {
    const c = await this.connection(false);
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw Error("UUID de pièce jointe requis.");
    const url = new URL(c.url);
    url.pathname = url.pathname.replace(/\/$/, "") + "/files/" + id;
    const response = await this.transport(url, {
      redirect: "error",
      headers: { Authorization: "Bearer " + c.token },
      signal,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw Error(
        "Téléchargement Mail refusé. Vérifie la connexion et l’UUID.",
      );
    }
    const stream = response.body;
    return {
      close: async () => {
        await stream.cancel().catch(() => {});
      },
      body: (async function* () {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield value;
          }
        } finally {
          reader.releaseLock();
        }
      })(),
    };
  }
}
