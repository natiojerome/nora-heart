import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { readFile } from "node:fs/promises";
import { loadInstallation } from "./installation.ts";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  LocalWallets,
  initializeWalletState,
  restoreWalletState,
  walletAddress,
  walletSocket,
  type WalletState,
} from "../modules/wallets/local/index.ts";
import { VaultWalletBackups } from "../modules/storage/wallet-vault/index.ts";
import { WalletClient } from "../modules/wallets/unix/index.ts";
import type { WalletNetwork, WalletInfo } from "../contracts/wallets.ts";

const stateDirectory = () =>
  process.env.NORA_WALLETS_STATE ?? "/var/lib/nora-wallets";
const socketPath = () =>
  process.env.HARNESS_WALLETS_SOCKET ?? "/run/nora-wallets/api.sock";
async function master() {
  const file =
    process.env.NORA_WALLETS_KEY_FILE ??
    (process.env.CREDENTIALS_DIRECTORY
      ? path.join(process.env.CREDENTIALS_DIRECTORY, "master")
      : undefined);
  if (!file)
    throw Error(
      "Configure NORA_WALLETS_KEY_FILE or the systemd master credential",
    );
  const key = await readFile(file);
  if (key.length !== 32)
    throw Error("Master credential must contain exactly 32 raw bytes");
  return key;
}
async function open(managed = false) {
  const key = await master();
  try {
    const cacheMs = Number(process.env.NORA_WALLETS_CACHE_MS ?? 30000),
      rpcTimeoutMs = Number(process.env.NORA_WALLETS_RPC_TIMEOUT_MS ?? 10000);
    if (
      !Number.isSafeInteger(cacheMs) ||
      cacheMs < 0 ||
      !Number.isSafeInteger(rpcTimeoutMs) ||
      rpcTimeoutMs <= 0
    )
      throw Error("Invalid cache/RPC timing configuration");
    return await LocalWallets.open(stateDirectory(), key, {
      cacheMs,
      rpcTimeoutMs,
      ...(managed
        ? {
            runBackup: async () => {
              const result = await promisify(execFile)(
                process.execPath,
                [
                  "--import",
                  "tsx",
                  fileURLToPath(
                    new URL("../interfaces/wallets.ts", import.meta.url),
                  ),
                  "backup-if-configured",
                ],
                {},
              );
              const status = JSON.parse(result.stdout);
              return status.skipped !== true;
            },
          }
        : {}),
    });
  } finally {
    key.fill(0);
  }
}
function backups() {
  const token = process.env.NORA_MCPS_VAULT_TOKEN;
  if (!token) throw Error("NORA_MCPS_VAULT_TOKEN required");
  return new VaultWalletBackups(
    process.env.NORA_WALLETS_BACKUP_URL ?? "https://mcps.natio.re/vault",
    token,
  );
}

/** Explicit one-time import, leaves the source catalogue and credentials untouched. */
export async function importWalletCatalog(
  catalogFile: string,
  credentialsFile: string,
) {
  const catalog = JSON.parse(await readFile(catalogFile, "utf8")),
    keys = JSON.parse(await readFile(credentialsFile, "utf8"));
  const mappings = new Map<string, string>();
  const networks: WalletNetwork[] = Object.entries(catalog.chains).map(
    ([name, v]: [string, any]) => {
      const family =
        name === "solana"
          ? "solana"
          : name === "xrpl"
            ? "xrpl"
            : name === "xpr"
              ? "xpr"
              : Number.isSafeInteger(v.chainId)
                ? "evm"
                : undefined;
      if (!family) throw Error("Unsupported catalogue network");
      // Numeric EVM IDs are CAIP-2. Other IDs are opaque, stable UUIDs, not labels.
      const id = family === "evm" ? "eip155:" + v.chainId : randomUUID();
      mappings.set(name, id);
      const tokens = v.tokens ?? v.assets ?? [];
      return {
        id,
        label: v.name ?? name,
        family,
        rpc: v.rpc.replace(/\/$/, ""),
        ...(family === "evm" ? { chainId: v.chainId } : {}),
        native: v.native ? { symbol: v.native, decimals: v.decimals } : null,
        tokens: tokens
          .filter(
            ([symbol, address]: [string, string]) =>
              !(
                family === "xpr" &&
                address === "eosio.token" &&
                symbol === v.native
              ),
          )
          .map(([symbol, address, decimals]: [string, string, number?]) => ({
            symbol,
            address,
            ...(decimals !== undefined ? { decimals } : {}),
          })),
      };
    },
  );
  const wallets: WalletState["wallets"] = catalog.wallets.map((w: any) => {
    const legacy = keys[w.id];
    let family: WalletInfo["family"] = "watch",
      secret: string | undefined;
    if (
      legacy !== undefined &&
      w.chains.every((n: string) =>
        Number.isSafeInteger(catalog.chains[n]?.chainId),
      )
    ) {
      family = "evm";
      secret = typeof legacy === "string" ? legacy : legacy.privateKey;
      if (typeof secret !== "string")
        throw Error("Invalid EVM source credential");
    } else if (
      legacy !== undefined &&
      w.chains.every((n: string) => n === "solana")
    ) {
      family = "ed25519";
      const bytes = Array.isArray(legacy) ? legacy : legacy.secretKey;
      if (
        !Array.isArray(bytes) ||
        bytes.length !== 64 ||
        bytes.some(
          (n: unknown) =>
            !Number.isInteger(n) || Number(n) < 0 || Number(n) > 255,
        )
      )
        throw Error("Invalid Ed25519 source credential");
      secret = Buffer.from(bytes.slice(0, 32)).toString("hex");
      if (walletAddress("ed25519", secret) !== w.address)
        throw Error("Source Ed25519 key/address mismatch");
    }
    return {
      info: {
        id: randomUUID(),
        label: w.name ?? w.id,
        family,
        addresses: w.chains.map((n: string) => {
          const networkId = mappings.get(n);
          if (!networkId) throw Error("Unknown source network");
          return { networkId, address: w.address };
        }),
        signing: [],
      },
      ...(secret ? { secret } : {}),
    };
  });
  const key = await master();
  try {
    await initializeWalletState(
      stateDirectory(),
      {
        format: "nora-wallets/v1",
        id: randomUUID(),
        revision: randomUUID(),
        wallets,
        networks,
      },
      key,
    );
  } finally {
    key.fill(0);
  }
  return {
    wallets: wallets.length,
    signable: wallets.filter((w) => w.secret).length,
    networks: networks.length,
  };
}
export async function runWalletCommand(command: string, args: string[]) {
  if (
    ["backup", "backup-if-configured", "restore"].includes(command) &&
    process.env.NORA_WALLETS_BACKUP_ENV_FILE
  ) {
    let contents: string;
    try {
      contents = await readFile(
        process.env.NORA_WALLETS_BACKUP_ENV_FILE,
        "utf8",
      );
    } catch (error) {
      if (
        command === "backup-if-configured" &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return { skipped: true, reason: "Vault non configuré" };
      throw error;
    }
    const saved = parseEnv(contents);
    for (const name of ["NORA_MCPS_VAULT_TOKEN", "NORA_WALLETS_BACKUP_URL"])
      if (saved[name]) process.env[name] = saved[name];
  }
  if (
    ["backup", "backup-if-configured", "restore"].includes(command) &&
    process.env.HARNESS_INSTALL_CONFIG_FILE
  ) {
    const saved = await loadInstallation(
      process.env.HARNESS_INSTALL_CONFIG_FILE,
    );
    if (saved.env.HEART_MCP_VAULT_TOKEN)
      process.env.NORA_MCPS_VAULT_TOKEN = saved.env.HEART_MCP_VAULT_TOKEN;
    if (saved.env.HEART_MCP_VAULT_URL)
      process.env.NORA_WALLETS_BACKUP_URL = saved.env.HEART_MCP_VAULT_URL;
  }
  if (command === "backup-if-configured") {
    if (!process.env.NORA_MCPS_VAULT_TOKEN)
      return { skipped: true, reason: "Vault non configuré" };
    command = "backup";
  }
  if (command === "init-empty") {
    const key = await master();
    try {
      await initializeWalletState(
        stateDirectory(),
        {
          format: "nora-wallets/v1",
          id: randomUUID(),
          revision: randomUUID(),
          wallets: [],
          networks: [],
        },
        key,
      );
      return { initialized: true, wallets: 0 };
    } finally {
      key.fill(0);
    }
  }
  if (command === "help")
    return {
      commands: [
        "init <catalogue JSON> <credential JSON file>",
        "daemon",
        "verify",
        "list",
        "assets <wallet UUID> <network ID> [--refresh]",
        "create (JSON {id,label,family,networkIds,networks?} on stdin)",
        "rename <wallet UUID> <new label>",
        "request-backup",
        "sign (JSON request on stdin)",
        "backup",
        "backup-status",
        "restore <backup UUID> <NEW directory>",
      ],
      documentation: "docs/WALLETS.md",
    };
  if (command === "verify") {
    const service = await open();
    try {
      const { wallets, networks } = await service.list();
      return {
        verified: true,
        wallets: wallets.length,
        signable: wallets.filter((w) => w.signing.length).length,
        networks: networks.length,
      };
    } finally {
      service.close();
    }
  }
  if (command === "init") {
    if (!args[0] || !args[1])
      throw Error("init requires catalogue and credential file paths");
    return importWalletCatalog(args[0], args[1]);
  }
  if (command === "daemon") {
    const service = await open(true),
      server = await walletSocket(service, socketPath(), { mode: 0o660 });
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(signal, () => {
        void server
          .close()
          .catch(() => {})
          .then(() => service.drain())
          .finally(() => {
            service.close();
            process.exit(0);
          });
      });
    return { ready: true, socket: socketPath() };
  }
  if (command === "backup") {
    const service = await open(),
      store = backups();
    try {
      return await service.backup(store);
    } finally {
      service.close();
      await store.close();
    }
  }
  if (command === "restore") {
    if (!args[0] || !args[1])
      throw Error("restore requires backup UUID and a NEW directory");
    const store = backups();
    try {
      return await restoreWalletState(
        path.resolve(args[1]),
        await store.get(args[0]),
      );
    } finally {
      await store.close();
    }
  }
  const client = new WalletClient(socketPath());
  try {
    if (command === "backup-status") return await client.backupStatus();
    if (command === "list") return await client.list();
    if (command === "assets") {
      if (!args[0] || !args[1])
        throw Error("assets requires wallet UUID and network ID");
      return await client.assets(args[0], args[1], args.includes("--refresh"));
    }
    if (command === "rename") {
      if (!args[0] || !args[1]) throw Error("Wallet UUID and label required");
      return await client.rename(args[0], args.slice(1).join(" "));
    }
    if (command === "request-backup") return await client.requestBackup();
    if (command === "sign" || command === "create") {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return command === "create"
        ? await client.create(value)
        : await client.sign(value);
    }
    throw Error(
      "Use help for commands: create/rename/list/assets/sign, request-backup/backup-status, init/daemon/backup/restore",
    );
  } finally {
    client.close();
  }
}
