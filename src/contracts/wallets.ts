import type { Json } from "./json.ts";

export interface WalletNetwork {
  id: string;
  label: string;
  family: "evm" | "solana" | "xrpl" | "xpr";
  rpc: string;
  chainId?: number;
  native: { symbol: string; decimals: number } | null;
  tokens?: { address: string; symbol: string; decimals?: number }[];
}
export interface WalletInfo {
  id: string;
  label: string;
  family: "evm" | "ed25519" | "watch";
  addresses: { networkId: string; address: string }[];
  signing: string[];
}
export interface WalletAsset {
  id: string;
  symbol: string;
  raw: string;
  decimals: number;
  amount: string;
}
export interface WalletAssets {
  walletId: string;
  networkId: string;
  status: "available" | "stale" | "unavailable";
  observedAt: string | null;
  assets: WalletAsset[];
  coverage: string;
  error?: string;
}
export interface WalletSignRequest {
  walletId: string;
  networkId: string;
  kind: "message" | "typedData" | "transaction" | "bytes";
  payload: Json;
}
/** id is a client-generated UUID: stable identity and idempotent creation key. */
export interface WalletCreateRequest {
  id: string;
  label: string;
  family: "evm" | "ed25519";
  networkIds: string[];
  /** Explicit new network definitions; existing networks are never overwritten. */
  networks?: WalletNetwork[];
}
export interface WalletBackupStatus {
  status: "verified" | "pending" | "stale" | "unconfigured" | "failed";
  revision: string;
  verifiedAt: string | null;
  backedUpRevision?: string;
  id?: string;
  error?: string;
}
export interface WalletSignature {
  walletId: string;
  networkId: string;
  address: string;
  kind: WalletSignRequest["kind"];
  signature?: string;
  serializedTransaction?: string;
}
export interface WalletBackupInfo {
  id: string;
  revision: string;
  label: string;
  createdAt: string;
}
export interface WalletRestoreResult {
  restored: number;
  existing: number;
  walletIds: string[];
  sourceRevision: string;
  verified: true;
  backup: WalletBackupStatus;
}
export interface WalletService {
  backups(): Promise<{ available: boolean; items: WalletBackupInfo[] }>;
  restore(backupId: string): Promise<WalletRestoreResult>;
  create(
    request: WalletCreateRequest,
  ): Promise<{ wallet: WalletInfo; backup: WalletBackupStatus }>;
  rename(
    walletId: string,
    label: string,
  ): Promise<{ wallet: WalletInfo; backup: WalletBackupStatus }>;
  requestBackup(): Promise<WalletBackupStatus>;
  backupStatus(): Promise<WalletBackupStatus>;
  list(): Promise<{
    wallets: WalletInfo[];
    networks: Omit<WalletNetwork, "rpc">[];
  }>;
  assets(
    walletId: string,
    networkId: string,
    refresh?: boolean,
  ): Promise<WalletAssets>;
  sign(request: WalletSignRequest): Promise<WalletSignature>;
}
/** Private machine-to-machine material. Never return this envelope through assistant tools. */
export interface WalletArchive {
  format: "nora-wallets-backup/v1";
  revision: string;
  encrypted: string;
  recoveryKey: string;
  sha256: string;
}
export interface WalletBackupStore {
  put(archive: WalletArchive): Promise<{ id: string; version: number }>;
  get(id: string): Promise<WalletArchive>;
}
