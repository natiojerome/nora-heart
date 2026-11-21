import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createPublicKey, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  recoverMessageAddress,
  recoverTypedDataAddress,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { base58 } from "@scure/base";
import {
  LocalWallets,
  newSecret,
  walletAddress,
  initializeWalletState,
  restoreWalletState,
  walletSocket,
  type WalletState,
} from "../src/modules/wallets/local/index.ts";
import { WalletClient } from "../src/modules/wallets/unix/index.ts";
import { walletTools } from "../src/modules/tools/wallets/index.ts";
import { collectAssets } from "../src/modules/wallets/local/assets.ts";
import { Engine } from "../src/core/engine.ts";
import { JsonlSessions } from "../src/modules/storage/json/index.ts";
import type { WalletArchive, WalletNetwork } from "../src/contracts/wallets.ts";

async function fixture(
  t: TestContext,
  networks?: WalletNetwork[],
  transport?: typeof fetch,
) {
  const root = await mkdtemp(path.join(tmpdir(), "heart-wallets-")),
    directory = path.join(root, "state"),
    key = randomBytes(32);
  const evm = newSecret("evm"),
    ed = newSecret("ed25519");
  const state: WalletState = {
    format: "nora-wallets/v1",
    id: randomUUID(),
    revision: randomUUID(),
    networks: networks ?? [
      {
        id: "eip155:8453",
        label: "Base",
        family: "evm",
        chainId: 8453,
        rpc: "https://rpc.invalid",
        native: { symbol: "ETH", decimals: 18 },
        tokens: [
          { address: "0x" + "1".repeat(40), symbol: "USD", decimals: 6 },
        ],
      },
      {
        id: "solana:test",
        label: "Solana",
        family: "solana",
        rpc: "https://rpc.invalid",
        native: { symbol: "SOL", decimals: 9 },
      },
    ],
    wallets: [
      {
        info: {
          id: randomUUID(),
          label: "EVM",
          family: "evm",
          signing: [],
          addresses: [
            { networkId: "eip155:8453", address: walletAddress("evm", evm) },
          ],
        },
        secret: evm,
      },
      {
        info: {
          id: randomUUID(),
          label: "Solana",
          family: "ed25519",
          signing: [],
          addresses: [
            { networkId: "solana:test", address: walletAddress("ed25519", ed) },
          ],
        },
        secret: ed,
      },
      {
        info: {
          id: randomUUID(),
          label: "Watch",
          family: "watch",
          signing: [],
          addresses: [
            { networkId: "eip155:8453", address: "0x" + "2".repeat(40) },
          ],
        },
      },
    ],
  };
  await initializeWalletState(directory, state, key);
  const service = await LocalWallets.open(directory, key, {
    fetch:
      transport ??
      ((async () => {
        throw Error("No network allowed");
      }) as typeof fetch),
  });
  t.after(async () => {
    service.close();
    key.fill(0);
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    directory,
    key,
    state,
    service,
    id: state.wallets[0].info.id,
    sol: state.wallets[1].info.id,
  };
}
const context = { workspace: "/tmp" };
test("Heart engine declares actual wallet tools and can sign through IPC without persisting signing payload/results", async (t) => {
  const f = await fixture(t),
    socket = path.join(f.root, "engine.sock"),
    server = await walletSocket(f.service, socket),
    client = new WalletClient(socket);
  t.after(async () => {
    client.close();
    await server.close();
  });
  const store = new JsonlSessions(path.join(f.root, "journal")),
    engine = new Engine(store, walletTools(client, true));
  let calls = 0,
    signature = "";
  const result = await engine.run({
    sessionId: "wallet-engine",
    prompt: "Sign a neutral challenge",
    displayName: "Test",
    workspace: f.root,
    permissions: new Set(["files.read", "process.execute"]),
    provider: {
      id: "simulated-wallet-provider",
      async generate(request) {
        calls++;
        assert.deepEqual(
          request.tools.map((t) => t.name),
          ["wallets.list", "wallets.assets", "wallets.sign"],
        );
        const last = request.messages.at(-1);
        if (last?.role === "tool") {
          const value = JSON.parse(last.content);
          signature = value.signature;
          assert.equal(
            await recoverMessageAddress({
              message: "Transient wallet challenge",
              signature: value.signature,
            }),
            value.address,
          );
          return { content: "Signature verified.", toolCalls: [] };
        }
        return {
          content: "",
          toolCalls: [
            {
              id: "sign-1",
              name: "wallets.sign",
              arguments: {
                walletId: f.id,
                networkId: "eip155:8453",
                kind: "message",
                payload: "Transient wallet challenge",
              },
            },
          ],
        };
      },
    },
  });
  assert.equal(result.text, "Signature verified.");
  assert.equal(calls, 2);
  const events = JSON.stringify(await store.read("wallet-engine"));
  assert(!events.includes("Transient wallet challenge"));
  assert(!events.includes(signature));
  assert(!events.includes(f.state.wallets[0].secret!));
});
test("asset readers cover Solana Token/2022, XRPL pagination and exact XPR decimals", async () => {
  const transport = (async (url: string | URL | Request, init: any) => {
    const q = JSON.parse(init.body);
    let result: unknown;
    if (String(url).endsWith("/v1/chain/get_currency_balance"))
      return Response.json(["12.3 XPR"]);
    if (q.method === "getBalance") result = { value: 123 };
    if (q.method === "getTokenAccountsByOwner")
      result = {
        value: [
          {
            account: {
              data: {
                parsed: {
                  info: {
                    mint: "mint",
                    tokenAmount: { amount: "9007199254740993", decimals: 6 },
                  },
                },
              },
            },
          },
        ],
      };
    if (q.method === "account_info")
      result = { account_data: { Balance: "1234567" } };
    if (q.method === "account_lines")
      result = q.params[0].marker
        ? { lines: [{ currency: "EUR", account: "issuer", balance: "2.25" }] }
        : {
            marker: "page2",
            lines: [{ currency: "USD", account: "issuer", balance: "-0.25" }],
          };
    return Response.json({ result });
  }) as typeof fetch;
  const network = {
    id: "n",
    label: "Test",
    rpc: "https://rpc.invalid",
    native: { symbol: "SOL", decimals: 9 },
  };
  const sol = await collectAssets(
    "w",
    "address",
    { ...network, family: "solana" },
    transport,
    1000,
  );
  assert.equal(
    sol.assets.find((a) => a.id === "mint")!.raw,
    "18014398509481986",
  );
  const xrpl = await collectAssets(
    "w",
    "address",
    { ...network, family: "xrpl", native: { symbol: "XRP", decimals: 6 } },
    transport,
    1000,
  );
  assert.equal(xrpl.assets.find((a) => a.id === "USD:issuer")!.amount, "-0.25");
  assert.equal(xrpl.assets.length, 3);
  const xpr = await collectAssets(
    "w",
    "address",
    { ...network, family: "xpr", native: { symbol: "XPR", decimals: 4 } },
    transport,
    1000,
  );
  assert.equal(xpr.assets[0].raw, "123000");
  assert.equal(xpr.assets[0].amount, "12.3");
});
test("wallet signing is offline and verifiable: EIP-191, EIP-712, EIP-1559 and Ed25519", async (t) => {
  const f = await fixture(t),
    client = f.service,
    networkId = "eip155:8453";
  const signature = await client.sign({
    walletId: f.id,
    networkId,
    kind: "message",
    payload: "Local challenge",
  });
  assert.equal(
    await recoverMessageAddress({
      message: "Local challenge",
      signature: signature.signature as Hex,
    }),
    signature.address,
  );
  const data = {
    domain: { name: "Demo", version: "1", chainId: 8453 },
    types: { Test: [{ name: "value", type: "string" }] },
    primaryType: "Test",
    message: { value: "No transfer" },
  } as const;
  const typed = await client.sign({
    walletId: f.id,
    networkId,
    kind: "typedData",
    payload: JSON.parse(JSON.stringify(data)),
  });
  assert.equal(
    await recoverTypedDataAddress({
      ...data,
      signature: typed.signature as Hex,
    }),
    signature.address,
  );
  const tx = await client.sign({
    walletId: f.id,
    networkId,
    kind: "transaction",
    payload: {
      to: "0x" + "3".repeat(40),
      nonce: 0,
      gas: "21000",
      value: "0",
      maxFeePerGas: "2000000000",
      maxPriorityFeePerGas: "1000000000",
    },
  });
  assert.equal(
    await recoverTransactionAddress({
      serializedTransaction: tx.serializedTransaction as TransactionSerialized,
    }),
    signature.address,
  );
  const ed = await client.sign({
    walletId: f.sol,
    networkId: "solana:test",
    kind: "bytes",
    payload: "010203",
  });
  const pub = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      base58.decode(ed.address),
    ]),
    format: "der",
    type: "spki",
  });
  assert(
    verify(
      null,
      Buffer.from("010203", "hex"),
      pub,
      Buffer.from(ed.signature!, "hex"),
    ),
  );
  const list = JSON.stringify(await client.list());
  assert(!list.includes(f.state.wallets[0].secret!));
  assert(!list.includes("rpc.invalid"));
  const reopen = await LocalWallets.open(f.directory, f.key);
  assert.deepEqual(await reopen.list(), await client.list());
  reopen.close();
});
test("signing rejects mismatched networks, unsafe quantities, unsupported kinds and watch-only wallets", async (t) => {
  const f = await fixture(t),
    base = { walletId: f.id, networkId: "eip155:8453" };
  for (const request of [
    {
      ...base,
      kind: "transaction",
      payload: { nonce: 0, gas: 21000, gasPrice: "1" },
    },
    {
      ...base,
      kind: "transaction",
      payload: { nonce: 0, gas: "21000", gasPrice: "1", chainId: 1 },
    },
    { ...base, kind: "transaction", payload: { nonce: 0, gas: "21000" } },
    { ...base, kind: "typedData", payload: { domain: { chainId: 1 } } },
    {
      ...base,
      kind: "message",
      payload: "test",
      walletId: f.state.wallets[2].info.id,
    },
    { ...base, kind: "message", payload: "test", networkId: "solana:test" },
  ])
    await assert.rejects(f.service.sign(request as any));
  const tools = walletTools(f.service, false, false);
  assert(!tools.some((t) => t.name === "wallets.sign"));
  await assert.rejects(
    tools
      .find((t) => t.name === "wallets.assets")!
      .execute({ ...base, refresh: true }, context),
    /réseau/,
  );
  assert(
    walletTools(f.service, true).find((t) => t.name === "wallets.sign")!
      .transient,
  );
});
test("asset refresh coalesces, preserves exact amounts and stale values; does not delay offline signing", async (t) => {
  let release!: () => void,
    count = 0,
    fail = false;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const transport = (async (_url: unknown, init: any) => {
    count++;
    await gate;
    if (fail) throw Error("rpc down");
    const q = JSON.parse(init.body);
    const result =
      q.method === "eth_chainId"
        ? "0x2105"
        : q.method === "eth_blockNumber"
          ? "0x123"
          : q.method === "eth_getBalance"
            ? "0xde0b6b3a7640000"
            : "0x12d687";
    return Response.json({ result });
  }) as typeof fetch;
  const f = await fixture(t, undefined, transport);
  assert.equal((await f.service.assets(f.id, "eip155:8453")).observedAt, null);
  assert.equal(count, 0);
  const a = f.service.assets(f.id, "eip155:8453", true),
    b = f.service.assets(f.id, "eip155:8453", true);
  const sig = await f.service.sign({
    walletId: f.id,
    networkId: "eip155:8453",
    kind: "message",
    payload: "While RPC blocked",
  });
  assert(sig.signature);
  assert.equal(count, 1);
  release();
  assert.deepEqual(await a, await b);
  assert.equal(count, 4);
  const assets = await f.service.assets(f.id, "eip155:8453");
  assert.equal(assets.assets.find((a) => a.id === "native")!.amount, "1");
  assert.equal(
    assets.assets.find((a) => a.symbol === "USD")!.amount,
    "1.234567",
  );
  fail = true;
  const stale = await f.service.assets(f.id, "eip155:8453", true);
  assert.equal(stale.status, "stale");
  assert.deepEqual(stale.assets, assets.assets);
});
test("verified backup and isolated restoration preserve keys and UUIDs; tampering/overwrite/wrong key refused", async (t) => {
  const f = await fixture(t);
  let archive: WalletArchive | undefined;
  const store = {
    async put(a: WalletArchive) {
      archive = structuredClone(a);
      return { id: randomUUID(), version: 1 };
    },
    async get() {
      return structuredClone(archive!);
    },
  };
  const receipt = await f.service.backup(store);
  assert.equal(receipt.wallets, 3);
  assert(!JSON.stringify(receipt).includes(f.state.wallets[0].secret!));
  const restored = path.join(f.root, "restored");
  await restoreWalletState(restored, archive!);
  const clone = await LocalWallets.open(
    restored,
    await readFile(path.join(restored, "recovery.key")),
  );
  assert.deepEqual(await clone.list(), await f.service.list());
  assert.equal(
    (
      await clone.sign({
        walletId: f.id,
        networkId: "eip155:8453",
        kind: "message",
        payload: "Recovered",
      })
    ).address,
    f.state.wallets[0].info.addresses[0].address,
  );
  clone.close();
  await assert.rejects(restoreWalletState(restored, archive!));
  await assert.rejects(
    restoreWalletState(path.join(f.root, "tampered"), {
      ...archive!,
      encrypted: archive!.encrypted + "x",
    }),
  );
  await assert.rejects(LocalWallets.open(f.directory, randomBytes(32)));
  await chmod(path.join(f.directory, "wallets.enc"), 0o644);
  await assert.rejects(LocalWallets.open(f.directory, f.key), /Private/);
});
test("persistent JS/Python clients use the real Unix socket; tools return public data only", async (t) => {
  const f = await fixture(t),
    socket = path.join(f.root, "wallet.sock"),
    server = await walletSocket(f.service, socket);
  const client = new WalletClient(socket);
  t.after(async () => {
    client.close();
    await server.close();
  });
  let connections = 0;
  server.server.on("connection", () => connections++);
  assert.equal((await client.list()).wallets.length, 3);
  const sig = await client.signMessage(f.id, "eip155:8453", "SDK");
  assert(sig.signature);
  assert.equal(connections, 1);
  const cached = await client.assets(f.id, "eip155:8453");
  assert.equal(cached.status, "unavailable");
  await assert.rejects(client.call("wallets.exportKeys"));
  await assert.rejects(
    client.signMessage("unknown", "eip155:8453", f.state.wallets[0].secret!),
  );
  const code = `from nora_wallets import WalletClient\nimport json,sys\nwith WalletClient(sys.argv[1]) as c:\n w=c.list()['wallets'][0]\n s=c.sign_message(w['id'],w['addresses'][0]['networkId'],'Python SDK')\n print(json.dumps({'address':s['address'],'signature':s['signature']}))`;
  const result = await promisify(execFile)("python3", ["-c", code, socket], {
    env: {
      ...process.env,
      PYTHONPATH: path.resolve("sdk/wallets/python"),
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });
  const py = JSON.parse(result.stdout);
  assert.equal(
    await recoverMessageAddress({
      message: "Python SDK",
      signature: py.signature,
    }),
    py.address,
  );
  const broken = new WalletClient(path.join(f.root, "missing.sock"));
  await assert.rejects(broken.list(), /no request retried/);
  broken.close();
});
