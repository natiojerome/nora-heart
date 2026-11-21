/** Explicit live qualification: remote Vault, synthetic wallet, isolated restore, no funds. */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { recoverMessageAddress, type Hex } from "viem";
import {
  LocalWallets,
  initializeWalletState,
  restoreWalletState,
  newSecret,
  walletAddress,
} from "../src/modules/wallets/local/index.ts";
import { VaultWalletBackups } from "../src/modules/storage/wallet-vault/index.ts";
const token = process.env.NORA_MCPS_VAULT_TOKEN;
if (!token) throw Error("Configure NORA_MCPS_VAULT_TOKEN");
const root = await mkdtemp(path.join(tmpdir(), "wallets-live-")),
  key = randomBytes(32),
  secret = newSecret("evm"),
  id = randomUUID();
const store = new VaultWalletBackups(
  process.env.NORA_WALLETS_BACKUP_URL ?? "https://mcps.natio.re/vault",
  token,
);
let service: LocalWallets | undefined, clone: LocalWallets | undefined;
try {
  await initializeWalletState(
    path.join(root, "original"),
    {
      format: "nora-wallets/v1",
      id: randomUUID(),
      revision: randomUUID(),
      wallets: [
        {
          info: {
            id,
            label: "Synthetic restoration qualification",
            family: "evm",
            addresses: [
              {
                networkId: "eip155:8453",
                address: walletAddress("evm", secret),
              },
            ],
            signing: [],
          },
          secret,
        },
      ],
      networks: [
        {
          id: "eip155:8453",
          label: "Base",
          family: "evm",
          chainId: 8453,
          rpc: "https://mainnet.base.org",
          native: { symbol: "ETH", decimals: 18 },
        },
      ],
    },
    key,
  );
  service = await LocalWallets.open(path.join(root, "original"), key);
  const receipt = await service.backup(store),
    replayed = await service.backup(store);
  assert.equal(receipt.id, replayed.id);
  const target = path.join(root, "restored");
  await restoreWalletState(target, await store.get(receipt.id));
  clone = await LocalWallets.open(
    target,
    await readFile(path.join(target, "recovery.key")),
  );
  assert.deepEqual(await clone.list(), await service.list());
  const result = await clone.sign({
    walletId: id,
    networkId: "eip155:8453",
    kind: "message",
    payload: "Restored synthetic wallet offline challenge",
  });
  assert.equal(
    await recoverMessageAddress({
      message: "Restored synthetic wallet offline challenge",
      signature: result.signature as Hex,
    }),
    result.address,
  );
  console.log(
    JSON.stringify({
      passed: true,
      remoteBackupVerified: true,
      idempotentReplay: true,
      restoredSigningVerified: true,
      backupId: receipt.id,
      transactionsBroadcast: 0,
    }),
  );
} catch {
  console.error("Live wallet qualification failed; no private values logged.");
  process.exitCode = 1;
} finally {
  clone?.close();
  service?.close();
  key.fill(0);
  await store.close();
  await rm(root, { recursive: true, force: true });
}
