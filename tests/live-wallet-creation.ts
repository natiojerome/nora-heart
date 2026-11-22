/** Opt-in real daemon + real Vault; synthetic keys, no RPC/funds/broadcast. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";
import {
  initializeWalletState,
  restoreWalletState,
  LocalWallets,
} from "../src/modules/wallets/local/index.ts";
import { WalletClient } from "../src/modules/wallets/unix/index.ts";
import { VaultWalletBackups } from "../src/modules/storage/wallet-vault/index.ts";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";
const { values } = parseArgs({
  options: {
    live: { type: "boolean" },
    "env-file": { type: "string" },
    proof: { type: "string" },
  },
});
assert(
  values.live && values["env-file"],
  "Explicit --live and --env-file required",
);
const privateEnv = parseEnv(await readFile(values["env-file"], "utf8")),
  token = privateEnv.NORA_MCPS_VAULT_TOKEN;
assert(token, "Configured private Vault key required");
const root = await mkdtemp(path.join(tmpdir(), "wallet-create-live-")),
  directory = path.join(root, "state"),
  socket = path.join(root, "wallets.sock"),
  key = randomBytes(32),
  revisions = new Set<string>();
const endpoint =
    privateEnv.NORA_WALLETS_BACKUP_URL ?? "https://mcps.natio.re/vault",
  store = new VaultWalletBackups(endpoint, token),
  client = new WalletClient(socket, { timeoutMs: 60000 });
let daemon: ChildProcess | undefined;
const report: Record<string, unknown> = {
  passed: false,
  at: new Date().toISOString(),
  scope:
    "Real daemon, JS client, child-process backup and MCP Vault; synthetic wallets only",
};
const env = {
  ...process.env,
  NORA_WALLETS_STATE: directory,
  NORA_WALLETS_KEY_FILE: path.join(root, "master"),
  HARNESS_WALLETS_SOCKET: socket,
  NORA_WALLETS_BACKUP_ENV_FILE: path.join(root, "backup.env"),
  HARNESS_INSTALL_CONFIG_FILE: "",
};
delete (env as NodeJS.ProcessEnv).NORA_MCPS_VAULT_TOKEN;
async function start() {
  daemon = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      new URL("../src/interfaces/wallets.ts", import.meta.url).pathname,
      "daemon",
    ],
    { env, stdio: ["ignore", "ignore", "ignore"] },
  );
  for (let n = 0; n < 100; n++) {
    try {
      await client.list();
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Isolated daemon unavailable");
}
async function stop() {
  if (daemon && daemon.exitCode === null) {
    const done = new Promise<void>((r) => daemon!.once("exit", () => r()));
    daemon.kill("SIGTERM");
    await done;
  }
  daemon = undefined;
}
try {
  await writeFile(env.NORA_WALLETS_KEY_FILE, key, { mode: 0o600 });
  await writeFile(
    env.NORA_WALLETS_BACKUP_ENV_FILE,
    "NORA_MCPS_VAULT_TOKEN=" +
      JSON.stringify(token) +
      "\nNORA_WALLETS_BACKUP_URL=" +
      JSON.stringify(endpoint) +
      "\n",
    { mode: 0o600 },
  );
  await initializeWalletState(
    directory,
    {
      format: "nora-wallets/v1",
      id: randomUUID(),
      revision: randomUUID(),
      wallets: [],
      networks: [],
    },
    key,
  );
  await start();
  assert(
    !(await readFile("/proc/" + daemon!.pid + "/environ", "utf8")).includes(
      token,
    ),
    "Signer parent must not load the Vault token",
  );
  const evm = await client.create({
    id: randomUUID(),
    label: "QA creation EVM",
    family: "evm",
    networkIds: ["eip155:8453"],
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
  });
  revisions.add(evm.backup.revision);
  const sol = await client.create({
    id: randomUUID(),
    label: "QA creation Solana",
    family: "ed25519",
    networkIds: ["solana:mainnet"],
    networks: [
      {
        id: "solana:mainnet",
        label: "Solana",
        family: "solana",
        rpc: "https://api.mainnet-beta.solana.com",
        native: { symbol: "SOL", decimals: 9 },
      },
    ],
  });
  revisions.add(sol.backup.revision);
  const renamed = await client.rename(evm.wallet.id, "QA renamed EVM");
  revisions.add(renamed.backup.revision);
  const backup = await client.requestBackup();
  assert.equal(backup.status, "verified");
  assert(backup.id);
  report.backupVerified = true;
  const signature = await client.signMessage(
    evm.wallet.id,
    "eip155:8453",
    "Neutral creation verification",
  );
  assert.equal(
    await recoverMessageAddress({
      message: "Neutral creation verification",
      signature: signature.signature as Hex,
    }),
    evm.wallet.addresses[0].address,
  );
  const ed = await client.signBytes(sol.wallet.id, "solana:mainnet", "010203");
  assert(ed.signature);
  await stop();
  await start();
  const listed = await client.list();
  assert.equal(listed.wallets.length, 2);
  assert.equal(
    listed.wallets.find((w) => w.id === evm.wallet.id)!.label,
    "QA renamed EVM",
  );
  assert.equal((await client.backupStatus()).status, "verified");
  assert.equal(
    (
      await client.signMessage(
        evm.wallet.id,
        "eip155:8453",
        "Neutral creation verification",
      )
    ).signature,
    signature.signature,
  );
  report.restartKeysAndNamesPreserved = true;
  await stop();
  const newKey = randomBytes(32);
  env.NORA_WALLETS_STATE = path.join(root, "new-machine");
  env.NORA_WALLETS_KEY_FILE = path.join(root, "new-master");
  await writeFile(env.NORA_WALLETS_KEY_FILE, newKey, { mode: 0o600 });
  await initializeWalletState(
    env.NORA_WALLETS_STATE,
    {
      format: "nora-wallets/v1",
      id: randomUUID(),
      revision: randomUUID(),
      wallets: [],
      networks: [],
    },
    newKey,
  );
  newKey.fill(0);
  await start();
  assert.equal((await client.list()).wallets.length, 0);
  assert((await client.backups()).items.some((item) => item.id === backup.id));
  const recovered = await client.restore(backup.id);
  revisions.add(recovered.backup.revision);
  assert(recovered.verified);
  assert.equal(recovered.restored, 2);
  assert.deepEqual((await client.list()).wallets, listed.wallets);
  assert.equal(
    (
      await client.signMessage(
        evm.wallet.id,
        "eip155:8453",
        "Neutral creation verification",
      )
    ).signature,
    signature.signature,
  );
  assert.equal(
    (await client.signBytes(sol.wallet.id, "solana:mainnet", "010203"))
      .signature,
    ed.signature,
  );
  assert.equal((await client.restore(backup.id)).restored, 0);
  assert.equal((await client.requestBackup()).status, "verified");
  await stop();
  await start();
  assert.deepEqual((await client.list()).wallets, listed.wallets);
  report.toolRestoreIntoNewActiveStoreWithDifferentMaster = true;
  report.privateRecoveryPipe = true;

  const archive = await store.get(backup.id);
  await restoreWalletState(path.join(root, "restored"), archive);
  const restored = await LocalWallets.open(
    path.join(root, "restored"),
    Buffer.from(archive.recoveryKey, "base64"),
  );
  try {
    assert.deepEqual((await restored.list()).wallets, listed.wallets);
    assert.equal(
      (
        await restored.sign({
          walletId: evm.wallet.id,
          networkId: "eip155:8453",
          kind: "message",
          payload: "Neutral creation verification",
        })
      ).signature,
      signature.signature,
    );
    assert.equal(
      (
        await restored.sign({
          walletId: sol.wallet.id,
          networkId: "solana:mainnet",
          kind: "bytes",
          payload: "010203",
        })
      ).signature,
      ed.signature,
    );
  } finally {
    restored.close();
  }
  report.isolatedRestorationAndSignaturesVerified = true;
  report.walletsCreated = 2;
  report.passed = true;
} finally {
  await stop();
  client.close();
  await store.close();
  const session = await connectMcp(
    {
      id: randomUUID(),
      version: 1,
      label: "QA cleanup",
      url: endpoint,
      auth: { type: "bearer_env", envVar: "PRIVATE_VAULT" },
      enabled: true,
      timeoutMs: 60000,
      allowWrites: true,
      tools: [],
    },
    { env: { PRIVATE_VAULT: token } },
  );
  let removed = 0;
  try {
    for (const revision of revisions) {
      const page = JSON.parse(
        await session.call("vault_search", { query: revision }),
      );
      for (const item of page.items ?? [])
        if (item.uri === "urn:nora-wallets:backup:" + revision) {
          await session.call("vault_delete", {
            id: item.id,
            expectedVersion: item.version,
          });
          removed++;
        }
    }
  } finally {
    await session.close();
  }
  report.syntheticRemoteBackupsRemoved = removed;
  key.fill(0);
  await rm(root, { recursive: true, force: true });
  report.localTemporaryStateRemoved = true;
  if (values.proof)
    await writeFile(values.proof, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
