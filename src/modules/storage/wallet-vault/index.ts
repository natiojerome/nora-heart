import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  WalletArchive,
  WalletBackupStore,
} from "../../../contracts/wallets.ts";

/** Private recovery channel. Only metadata is exposed by wallet tools; Vault is trusted custody. */
export class VaultWalletBackups implements WalletBackupStore {
  private client?: Client;
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {
    if (new URL(url).protocol !== "https:")
      throw Error("HTTPS backup endpoint required");
  }
  private async call(name: string, args: Record<string, unknown>) {
    if (!this.client) {
      const client = new Client({
        name: "nora-wallets-backup",
        version: "1.0.0",
      });
      client.onerror = () => {};
      await client.connect(
        new StreamableHTTPClientTransport(new URL(this.url), {
          requestInit: {
            headers: { Authorization: "Bearer " + this.token },
            redirect: "error",
          },
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 1000,
            maxReconnectionDelay: 1000,
            reconnectionDelayGrowFactor: 1,
          },
        }),
      );
      this.client = client;
    }
    const result = await this.client.callTool({ name, arguments: args });
    if (result.isError) throw Error("Remote wallet backup rejected");
    if (result.structuredContent)
      return result.structuredContent as Record<string, any>;
    const text = result.content as { type: string; text?: string }[];
    return JSON.parse(
      text
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    );
  }
  async put(archive: WalletArchive) {
    const result = await this.call("vault_create", {
      label: "Wallet backup " + archive.revision,
      tags: ["nora-wallets", "machine-recovery"],
      uri: "urn:nora-wallets:backup:" + archive.revision,
      values: { archive },
      operationId: archive.revision,
    });
    if (typeof result.id !== "string" || !Number.isInteger(result.version))
      throw Error("Invalid backup receipt");
    return { id: result.id as string, version: result.version as number };
  }
  async get(id: string): Promise<WalletArchive> {
    const result = await this.call("vault_read", { id });
    const archive = result.values?.archive;
    if (!archive || archive.format !== "nora-wallets-backup/v1")
      throw Error("Invalid wallet backup");
    return archive;
  }
  async list(): Promise<
    import("../../../contracts/wallets.ts").WalletBackupInfo[]
  > {
    const items: import("../../../contracts/wallets.ts").WalletBackupInfo[] =
        [],
      seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.call("vault_search", {
        query: "nora-wallets",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (!Array.isArray(page.items)) throw Error("Invalid backup catalogue");
      for (const item of page.items)
        if (
          typeof item.uri === "string" &&
          item.uri.startsWith("urn:nora-wallets:backup:")
        )
          items.push({
            id: item.id,
            revision: item.uri.slice("urn:nora-wallets:backup:".length),
            label: item.label,
            createdAt: item.createdAt,
          });
      cursor = page.nextCursor ?? undefined;
      if (cursor) {
        if (seen.has(cursor)) throw Error("Invalid backup cursor");
        seen.add(cursor);
      }
    } while (cursor);
    return items;
  }
  async close() {
    await this.client?.close();
    this.client = undefined;
  }
}
