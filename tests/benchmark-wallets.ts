// Real local IPC benchmark, no RPC or LLM; synthetic keys are deleted afterwards.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";
import {
  LocalWallets,
  initializeWalletState,
  newSecret,
  walletAddress,
  walletSocket,
} from "../src/modules/wallets/local/index.ts";
import { WalletClient } from "../src/modules/wallets/unix/index.ts";
const root = await mkdtemp(path.join(tmpdir(), "wallet-bench-")),
  key = randomBytes(32),
  id = randomUUID(),
  sol = randomUUID(),
  secret = newSecret("evm"),
  ed = newSecret("ed25519"),
  socket = path.join(root, "api.sock");
await initializeWalletState(
  root,
  {
    format: "nora-wallets/v1",
    id: randomUUID(),
    revision: randomUUID(),
    networks: [
      {
        id: "eip155:8453",
        label: "Base",
        family: "evm",
        chainId: 8453,
        rpc: "https://rpc.invalid",
        native: { symbol: "ETH", decimals: 18 },
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
          id,
          label: "Bench",
          family: "evm",
          addresses: [
            { networkId: "eip155:8453", address: walletAddress("evm", secret) },
          ],
          signing: [],
        },
        secret,
      },
      {
        info: {
          id: sol,
          label: "Bench Sol",
          family: "ed25519",
          addresses: [
            { networkId: "solana:test", address: walletAddress("ed25519", ed) },
          ],
          signing: [],
        },
        secret: ed,
      },
    ],
  },
  key,
);
const service = await LocalWallets.open(root, key, {
    fetch: (async () => {
      throw Error("Network forbidden");
    }) as typeof fetch,
  }),
  server = await walletSocket(service, socket),
  client = new WalletClient(socket);
const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return {
    samples: values.length,
    p50_ms: sorted[Math.floor(sorted.length * 0.5)],
    p95_ms: sorted[Math.floor(sorted.length * 0.95)],
    p99_ms: sorted[Math.floor(sorted.length * 0.99)],
  };
};
try {
  const result: Record<string, unknown> = {
    node: process.version,
    transport: "Unix HTTP keep-alive, sequential, warm, no RPC/LLM",
  };
  for (const [label, action] of [
    ["list", () => client.list()],
    [
      "evm_message",
      () =>
        client.signMessage(
          id,
          "eip155:8453",
          "Benchmark neutral local challenge",
        ),
    ],
    ["solana_bytes", () => client.signBytes(sol, "solana:test", "010203")],
    [
      "evm_transaction",
      () =>
        client.signTransaction(id, "eip155:8453", {
          nonce: 0,
          gas: "21000",
          maxFeePerGas: "2",
          maxPriorityFeePerGas: "1",
          value: "0",
          to: walletAddress("evm", secret),
        }),
    ],
  ] as const) {
    for (let i = 0; i < 30; i++) await action();
    const times = [];
    for (let i = 0; i < 1000; i++) {
      const before = performance.now();
      await action();
      times.push(performance.now() - before);
    }
    result["javascript_" + label] = stats(times);
  }
  const code = `from nora_wallets import WalletClient\nimport json,sys,time\nwith WalletClient(sys.argv[1]) as c:\n w=c.list()['wallets'][0]\n for _ in range(30): c.sign_message(w['id'],'eip155:8453','Benchmark neutral local challenge')\n v=[]\n for _ in range(1000):\n  t=time.perf_counter_ns();c.sign_message(w['id'],'eip155:8453','Benchmark neutral local challenge');v.append((time.perf_counter_ns()-t)/1e6)\n v.sort();print(json.dumps({'samples':len(v),'p50_ms':v[500],'p95_ms':v[950],'p99_ms':v[990]}))`;
  result.python_evm_message = JSON.parse(
    (
      await promisify(execFile)("python3", ["-c", code, socket], {
        env: {
          ...process.env,
          PYTHONPATH: path.resolve("sdk/wallets/python"),
          PYTHONDONTWRITEBYTECODE: "1",
        },
      })
    ).stdout,
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  client.close();
  await server.close();
  service.close();
  key.fill(0);
  await rm(root, { recursive: true, force: true });
}
