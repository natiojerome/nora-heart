import type { Json } from "../../../contracts/json.ts";
import type {
  WalletService,
  WalletSignRequest,
  WalletSignature,
  WalletAssets,
} from "../../../contracts/wallets.ts";
export class WalletClient implements WalletService {
  constructor(
    socket?: string,
    options?: { timeoutMs?: number; maxSockets?: number },
  );
  call(method: string, params?: unknown): Promise<unknown>;
  create(
    request: import("../../../contracts/wallets.ts").WalletCreateRequest,
  ): ReturnType<WalletService["create"]>;
  rename(walletId: string, label: string): ReturnType<WalletService["rename"]>;
  requestBackup(): ReturnType<WalletService["requestBackup"]>;
  backupStatus(): ReturnType<WalletService["backupStatus"]>;
  list(): ReturnType<WalletService["list"]>;
  assets(
    walletId: string,
    networkId: string,
    refresh?: boolean,
  ): Promise<WalletAssets>;
  sign(request: WalletSignRequest): Promise<WalletSignature>;
  signMessage(
    walletId: string,
    networkId: string,
    message: string,
  ): Promise<WalletSignature>;
  signTransaction(
    walletId: string,
    networkId: string,
    transaction: Json,
  ): Promise<WalletSignature>;
  signTypedData(
    walletId: string,
    networkId: string,
    data: Json,
  ): Promise<WalletSignature>;
  signBytes(
    walletId: string,
    networkId: string,
    hexBytes: string,
  ): Promise<WalletSignature>;
  close(): void;
}
