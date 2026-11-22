import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  open,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  WalletService,
  WalletInfo,
  WalletNetwork,
  WalletAssets,
  WalletSignRequest,
  WalletArchive,
  WalletBackupStore,
  WalletCreateRequest,
  WalletBackupStatus,
} from "../../../contracts/wallets.ts";
import { walletWriteLock } from "./lock.ts";
import { collectAssets } from "./assets.ts";
import {
  publicInfo,
  prepareSigner,
  verifyWallet,
  walletAddress,
  newSecret,
  type PrivateWallet,
} from "./crypto.ts";
export { walletAddress, newSecret };
export { walletSocket } from "./http.ts";
export interface WalletState {
  format: "nora-wallets/v1";
  id: string;
  revision: string;
  wallets: PrivateWallet[];
  networks: WalletNetwork[];
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const aad = Buffer.from("nora-wallets/v1");
export function sealWalletState(state: WalletState, key: Buffer): string {
  if (key.length !== 32) throw Error("32-byte encryption key required");
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(state), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    format: "nora-wallets-sealed/v1",
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
}
export async function unsealWalletState(
  encrypted: string,
  key: Buffer,
): Promise<WalletState> {
  const e = JSON.parse(encrypted);
  if (e.format !== "nora-wallets-sealed/v1")
    throw Error("Invalid archive format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(e.nonce, "base64"),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(e.tag, "base64"));
  const state = JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(e.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as WalletState;
  if (
    state.format !== "nora-wallets/v1" ||
    !Array.isArray(state.wallets) ||
    !Array.isArray(state.networks) ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(state.id) ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(state.revision)
  )
    throw Error("Invalid wallet state");
  if (
    new Set(state.wallets.map((w) => w.info.id)).size !==
      state.wallets.length ||
    new Set(state.networks.map((n) => n.id)).size !== state.networks.length
  )
    throw Error("Duplicate identifiers");
  for (const n of state.networks) {
    // The first v1 importer encoded absent EVM natives as {} or {symbol:null}.
    // Hydrate as null
    // without rewriting the archive, its revision, or any wallet identity.
    if (
      n.family === "evm" &&
      n.native &&
      typeof n.native === "object" &&
      !Array.isArray(n.native) &&
      n.native.symbol == null &&
      n.native.decimals === undefined &&
      Object.keys(n.native).every((k) => k === "symbol")
    )
      n.native = null;
    const url = new URL(n.rpc);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["evm", "solana", "xrpl", "xpr"].includes(n.family) ||
      (n.family === "evm" &&
        (!Number.isSafeInteger(n.chainId) || Number(n.chainId) <= 0)) ||
      (n.native === null
        ? n.family !== "evm"
        : !n.native ||
          typeof n.native.symbol !== "string" ||
          !n.native.symbol ||
          !Number.isSafeInteger(n.native.decimals) ||
          n.native.decimals < 0 ||
          n.native.decimals > 255)
    )
      throw Error("Invalid network");
  }
  for (const w of state.wallets) await verifyWallet(w, state.networks);
  return state;
}
async function atomic(file: string, text: string) {
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, file);
    const dir = await open(path.dirname(file), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } finally {
    await rm(tmp, { force: true });
  }
}
export async function initializeWalletState(
  directory: string,
  state: WalletState,
  key: Buffer,
) {
  const encrypted = sealWalletState(state, key);
  await unsealWalletState(encrypted, key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "wallets.enc");
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(encrypted);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function restoreWalletState(
  directory: string,
  archive: WalletArchive,
): Promise<{ wallets: number; revision: string }> {
  if (
    archive.format !== "nora-wallets-backup/v1" ||
    hash(archive.encrypted) !== archive.sha256
  )
    throw Error("Backup integrity mismatch");
  const key = Buffer.from(archive.recoveryKey, "base64"),
    state = await unsealWalletState(archive.encrypted, key);
  if (state.revision !== archive.revision)
    throw Error("Backup revision mismatch");
  // Never overwrite an existing installation; a new directory is created atomically.
  await mkdir(directory, { mode: 0o700 });
  try {
    await writeFile(path.join(directory, "recovery.key"), key, {
      mode: 0o600,
      flag: "wx",
    });
    await atomic(path.join(directory, "wallets.enc"), archive.encrypted);
  } catch (e) {
    await rm(directory, { recursive: true, force: true });
    throw e;
  } finally {
    key.fill(0);
  }
  return { wallets: state.wallets.length, revision: state.revision };
}
export class LocalWallets implements WalletService {
  private signers = new Map<string, ReturnType<typeof prepareSigner>>();
  private cache = new Map<
    string,
    { value?: WalletAssets; attempt: number; pending?: Promise<WalletAssets> }
  >();
  private mutations: Promise<unknown> = Promise.resolve();
  private backupTask?: Promise<WalletBackupStatus>;
  private backupError?: string;
  private backupConfigured?: boolean;
  private constructor(
    private readonly directory: string,
    private state: WalletState,
    private readonly key: Buffer,
    private readonly transport: typeof fetch,
    private readonly cacheMs: number,
    private readonly rpcTimeoutMs: number,
    private readonly runBackup?: () => Promise<boolean>,
  ) {
    for (const w of state.wallets)
      this.signers.set(w.info.id, prepareSigner(w));
  }
  static async open(
    directory: string,
    key: Buffer,
    options: {
      fetch?: typeof fetch;
      cacheMs?: number;
      rpcTimeoutMs?: number;
      runBackup?: () => Promise<boolean>;
    } = {},
  ) {
    const file = path.join(directory, "wallets.enc"),
      stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw Error("Private wallet file required");
    const state = await unsealWalletState(await readFile(file, "utf8"), key);
    return new LocalWallets(
      directory,
      state,
      Buffer.from(key),
      options.fetch ?? fetch,
      options.cacheMs ?? 30000,
      options.rpcTimeoutMs ?? 10000,
      options.runBackup,
    );
  }
  private mutate<T>(
    change: (state: WalletState) => Promise<{ value: T; changed: boolean }>,
  ): Promise<T> {
    const task = this.mutations.then(() =>
      walletWriteLock(this.directory, async () => {
        const state = await unsealWalletState(
          await readFile(path.join(this.directory, "wallets.enc"), "utf8"),
          this.key,
        );
        const { value, changed } = await change(state);
        if (changed) {
          state.revision = randomUUID();
          const encrypted = sealWalletState(state, this.key);
          await unsealWalletState(encrypted, this.key);
          await atomic(path.join(this.directory, "wallets.enc"), encrypted);
        }
        this.state = state;
        this.signers = new Map(
          state.wallets.map((w) => [w.info.id, prepareSigner(w)]),
        );
        return value;
      }),
    );
    this.mutations = task.catch(() => {});
    return task;
  }
  async create(request: WalletCreateRequest) {
    if (
      !request ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.id) ||
      typeof request.label !== "string" ||
      !request.label.trim() ||
      !["evm", "ed25519"].includes(request.family) ||
      !Array.isArray(request.networkIds) ||
      !request.networkIds.length ||
      request.networkIds.some((n) => typeof n !== "string") ||
      new Set(request.networkIds).size !== request.networkIds.length
    )
      throw Error(
        "Valid wallet UUID, label, family and distinct network IDs required.",
      );
    if (request.networks !== undefined && !Array.isArray(request.networks))
      throw Error("Invalid network definitions.");
    const definitions = [...(request.networks ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const label = request.label.trim(),
      ids = [...request.networkIds].sort();
    const wallet = await this.mutate(async (state) => {
      const existing = state.wallets.find((w) => w.info.id === request.id);
      if (existing) {
        if (
          !existing.creation ||
          existing.creation.label !== label ||
          existing.info.family !== request.family ||
          JSON.stringify([...existing.creation.networkIds].sort()) !==
            JSON.stringify(ids) ||
          !isDeepStrictEqual(
            [...(existing.creation.networks ?? [])].sort((a, b) =>
              a.id.localeCompare(b.id),
            ),
            definitions,
          )
        )
          throw Error("Wallet creation UUID already used for another request.");
        return { value: publicInfo(existing), changed: false };
      }
      if (request.networks !== undefined && !Array.isArray(request.networks))
        throw Error("Invalid network definitions.");
      for (const network of definitions) {
        if (
          !network ||
          typeof network.id !== "string" ||
          !ids.includes(network.id)
        )
          throw Error("New network must be explicitly selected.");
        const previous = state.networks.find((n) => n.id === network.id);
        if (previous && !isDeepStrictEqual(previous, network))
          throw Error(
            "Existing network configuration differs; no implicit replacement.",
          );
        if (!previous) {
          if (
            network.family === "evm" &&
            network.id !== "eip155:" + network.chainId
          )
            throw Error("Use the CAIP-2 EVM network ID.");
          state.networks.push(structuredClone(network));
        }
      }
      const networks = ids.map((id) => state.networks.find((n) => n.id === id));
      if (
        networks.some(
          (n) =>
            !n ||
            (request.family === "evm"
              ? n.family !== "evm"
              : n.family !== "solana"),
        )
      )
        throw Error(
          "Select configured compatible networks; EVM and Solana creation supported.",
        );
      const secret = newSecret(request.family),
        address = walletAddress(request.family, secret);
      const created = {
        info: {
          id: request.id,
          label,
          family: request.family,
          addresses: ids.map((networkId) => ({ networkId, address })),
          signing: [],
        },
        secret,
        creation: {
          label,
          networkIds: ids,
          networks: structuredClone(definitions),
        },
      };
      state.wallets.push(created);
      return { value: publicInfo(created), changed: true };
    });
    let backup = await this.backupStatus();
    if (backup.status !== "verified") {
      void this.requestBackup();
      backup = await this.backupStatus();
    }
    return { wallet, backup };
  }
  async rename(walletId: string, label: string) {
    if (typeof label !== "string" || !label.trim())
      throw Error("Wallet label required.");
    const wallet = await this.mutate(async (state) => {
      const w = state.wallets.find((w) => w.info.id === walletId);
      if (!w) throw Error("Unknown wallet");
      const changed = w.info.label !== label.trim();
      w.info.label = label.trim();
      return { value: publicInfo(w), changed };
    });
    let backup = await this.backupStatus();
    if (backup.status !== "verified") {
      void this.requestBackup();
      backup = await this.backupStatus();
    }
    return { wallet, backup };
  }
  async requestBackup(): Promise<WalletBackupStatus> {
    if (!this.runBackup) return this.backupStatus();
    if (!this.backupTask) {
      this.backupError = undefined;
      const task = Promise.resolve().then(async () => {
        try {
          for (;;) {
            const revision = this.state.revision;
            this.backupConfigured = await this.runBackup!();
            if (!this.backupConfigured || revision === this.state.revision)
              break;
          }
        } catch {
          this.backupError =
            "Remote backup failed; wallet remains encrypted locally. Retry explicitly.";
        } finally {
          this.backupTask = undefined;
        }
        return this.backupStatus();
      });
      this.backupTask = task;
    }
    return this.backupTask;
  }
  async drain() {
    await this.mutations;
    await this.backupTask;
  }
  async list() {
    return {
      wallets: this.state.wallets.map(publicInfo),
      networks: this.state.networks.map(({ rpc, ...n }) => n),
    };
  }
  async sign(request: WalletSignRequest) {
    const signer = this.signers.get(request.walletId),
      network = this.state.networks.find((n) => n.id === request.networkId);
    if (!signer || !network) throw Error("Unknown wallet or network");
    try {
      return await signer(request, network);
    } catch {
      throw Error(
        "Signing rejected: check wallet capability, payload, network chainId, explicit nonce/gas/fees and quantity formats. No transaction broadcast.",
      );
    }
  }
  async assets(
    walletId: string,
    networkId: string,
    refresh = false,
  ): Promise<WalletAssets> {
    const wallet = this.state.wallets.find((w) => w.info.id === walletId),
      network = this.state.networks.find((n) => n.id === networkId),
      address = wallet?.info.addresses.find(
        (a) => a.networkId === networkId,
      )?.address;
    if (!network || !address) throw Error("Unknown wallet/network");
    const id = walletId + ":" + networkId,
      entry = this.cache.get(id) ?? { attempt: 0 };
    this.cache.set(id, entry);
    if (!entry.pending && refresh) {
      entry.attempt = Date.now();
      entry.pending = collectAssets(
        walletId,
        address,
        network,
        this.transport,
        this.rpcTimeoutMs,
      )
        .then(
          (value) => (entry.value = value),
          () =>
            (entry.value = {
              walletId,
              networkId,
              status: entry.value?.observedAt ? "stale" : "unavailable",
              observedAt: entry.value?.observedAt ?? null,
              assets: entry.value?.assets ?? [],
              coverage: entry.value?.coverage ?? "",
              error:
                "RPC read unavailable or incomplete; previous values retained, never replaced by zero.",
            }),
        )
        .finally(() => {
          entry.pending = undefined;
        });
    }
    if (refresh && entry.pending) await entry.pending;
    const value = entry.value ?? {
      walletId,
      networkId,
      status: "unavailable" as const,
      observedAt: null,
      assets: [],
      coverage: "Use refresh=true to fetch assets from RPC",
    };
    return {
      ...value,
      status:
        value.observedAt &&
        (entry.pending ||
          Date.now() - Date.parse(value.observedAt) > this.cacheMs)
          ? "stale"
          : value.status,
      assets: value.assets.map((a) => ({ ...a })),
    };
  }
  async backup(store: WalletBackupStore) {
    const encrypted = await readFile(
      path.join(this.directory, "wallets.enc"),
      "utf8",
    );
    const snapshot = await unsealWalletState(encrypted, this.key);
    const archive: WalletArchive = {
      format: "nora-wallets-backup/v1",
      revision: snapshot.revision,
      encrypted,
      recoveryKey: this.key.toString("base64"),
      sha256: hash(encrypted),
    };
    const saved = await store.put(archive),
      received = await store.get(saved.id);
    if (
      received.sha256 !== archive.sha256 ||
      hash(received.encrypted) !== archive.sha256
    )
      throw Error("Remote backup verification failed");
    const restored = await unsealWalletState(
      received.encrypted,
      Buffer.from(received.recoveryKey, "base64"),
    );
    if (restored.revision !== snapshot.revision)
      throw Error("Remote backup revision mismatch");
    const receipt = {
      ...saved,
      revision: snapshot.revision,
      wallets: restored.wallets.length,
      verifiedAt: new Date().toISOString(),
      sha256: archive.sha256,
    };
    await atomic(
      path.join(this.directory, "backup.json"),
      JSON.stringify(receipt),
    );
    return receipt;
  }
  async backupStatus(): Promise<WalletBackupStatus> {
    let receipt: any;
    try {
      receipt = JSON.parse(
        await readFile(path.join(this.directory, "backup.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return {
          status: "failed",
          revision: this.state.revision,
          verifiedAt: null,
          error: "Backup receipt unreadable.",
        };
    }
    const verified =
      receipt?.revision === this.state.revision &&
      typeof receipt?.verifiedAt === "string";
    return {
      status: verified
        ? "verified"
        : this.backupTask
          ? "pending"
          : this.backupError
            ? "failed"
            : !this.runBackup || this.backupConfigured === false
              ? "unconfigured"
              : "stale",
      revision: this.state.revision,
      verifiedAt: receipt?.verifiedAt ?? null,
      ...(typeof receipt?.revision === "string"
        ? { backedUpRevision: receipt.revision }
        : {}),
      ...(receipt?.id ? { id: receipt.id } : {}),
      ...(this.backupError ? { error: this.backupError } : {}),
    };
  }
  close() {
    this.key.fill(0);
    this.signers.clear();
  }
}
