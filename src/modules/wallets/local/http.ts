import { createServer } from "node:http";
import { lstat, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import type {
  WalletService,
  WalletSignRequest,
  WalletCreateRequest,
} from "../../../contracts/wallets.ts";

/** JSON-RPC 2.0 over a private Unix socket. No TCP listener and no key export. */
export async function walletSocket(
  service: WalletService,
  socket: string,
  options: { mode?: number; maxBodyBytes?: number } = {},
) {
  await mkdir(path.dirname(socket), { recursive: true, mode: 0o750 });
  try {
    const stat = await lstat(socket);
    if (!stat.isSocket()) throw Error("Socket path is not a socket");
    throw Error(
      "Socket already exists; do not replace a running or unverified socket",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST" || req.url !== "/rpc") {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    let id: unknown = null;
    let errorCode = -32700;
    try {
      const parts: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (options.maxBodyBytes && bytes > options.maxBodyBytes)
          throw Error("Request too large");
        parts.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
      errorCode = -32600;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        body.jsonrpc !== "2.0" ||
        !["string", "number"].includes(typeof body.id) ||
        typeof body.method !== "string"
      )
        throw Error("Invalid JSON-RPC request");
      id = body.id;
      errorCode = -32602;
      const p = body.params ?? {};
      if (typeof p !== "object" || Array.isArray(p))
        throw Error("Object params required");
      let result: unknown;
      if (body.method === "wallets.list") {
        errorCode = -32000;
        result = await service.list();
      } else if (body.method === "wallets.backups") {
        errorCode = -32000;
        result = await service.backups();
      } else if (body.method === "wallets.restore") {
        if (typeof p.backupId !== "string") throw Error("Backup UUID required");
        errorCode = -32000;
        result = await service.restore(p.backupId);
      } else if (body.method === "wallets.create") {
        errorCode = -32000;
        result = await service.create(p as WalletCreateRequest);
      } else if (body.method === "wallets.rename") {
        if (typeof p.walletId !== "string" || typeof p.label !== "string")
          throw Error("Invalid rename request");
        errorCode = -32000;
        result = await service.rename(p.walletId, p.label);
      } else if (body.method === "wallets.backup") {
        errorCode = -32000;
        result = await service.requestBackup();
      } else if (body.method === "wallets.backup_status") {
        errorCode = -32000;
        result = await service.backupStatus();
      } else if (body.method === "wallets.assets") {
        if (
          typeof p.walletId !== "string" ||
          typeof p.networkId !== "string" ||
          (p.refresh !== undefined && typeof p.refresh !== "boolean")
        )
          throw Error("Invalid asset request");
        errorCode = -32000;
        result = await service.assets(p.walletId, p.networkId, p.refresh);
      } else if (body.method === "wallets.sign") {
        if (
          typeof p.walletId !== "string" ||
          typeof p.networkId !== "string" ||
          !["message", "typedData", "transaction", "bytes"].includes(p.kind) ||
          p.payload === undefined
        )
          throw Error("Invalid signature request");
        errorCode = -32000;
        result = await service.sign(p as WalletSignRequest);
      } else {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "Unknown method" },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: errorCode,
            message:
              "Wallet request rejected. Check wallet/network, supported signing kind, explicit transaction nonce/gas/fees and decimal-string quantities. No broadcast performed.",
          },
        }),
      );
    }
  });
  server.requestTimeout = 0;
  server.keepAliveTimeout = 60000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  await chmod(socket, options.mode ?? 0o600);
  return {
    server,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
