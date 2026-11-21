import { formatUnits } from "viem";
import type {
  WalletAsset,
  WalletAssets,
  WalletNetwork,
} from "../../../contracts/wallets.ts";

export async function collectAssets(
  walletId: string,
  address: string,
  n: WalletNetwork,
  transport: typeof fetch,
  rpcTimeoutMs: number,
): Promise<WalletAssets> {
  const assets: WalletAsset[] = [];
  let id = 0;
  const rpc = async (method: string, params: unknown) => {
    const response = await transport(n.rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(rpcTimeoutMs),
    });
    if (!response.ok) throw Error("RPC unavailable");
    const data = await response.json();
    if (data.error || !("result" in data)) throw Error("RPC rejected read");
    return data.result;
  };
  const add = (
    assetId: string,
    symbol: string,
    raw: string,
    decimals: number,
  ) => {
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255)
      throw Error("Invalid decimals");
    const value = BigInt(raw);
    assets.push({
      id: assetId,
      symbol,
      raw: value.toString(),
      decimals,
      amount: formatUnits(value, decimals),
    });
  };
  let coverage = "";
  if (n.family === "evm") {
    if (BigInt(await rpc("eth_chainId", [])) !== BigInt(n.chainId!))
      throw Error("RPC network mismatch");
    const block = await rpc("eth_blockNumber", []);
    add(
      "native",
      n.native.symbol,
      await rpc("eth_getBalance", [address, block]),
      n.native.decimals,
    );
    await Promise.all(
      (n.tokens ?? []).map(async (t) => {
        const decimals =
          t.decimals ??
          Number(
            BigInt(
              await rpc("eth_call", [
                { to: t.address, data: "0x313ce567" },
                block,
              ]),
            ),
          );
        add(
          t.address,
          t.symbol,
          await rpc("eth_call", [
            {
              to: t.address,
              data:
                "0x70a08231" + address.slice(2).toLowerCase().padStart(64, "0"),
            },
            block,
          ]),
          decimals,
        );
      }),
    );
    coverage =
      "Native asset and explicitly configured ERC-20 contracts; no universal token discovery without an indexer";
  } else if (n.family === "solana") {
    const lamports = (
      await rpc("getBalance", [address, { commitment: "confirmed" }])
    ).value;
    if (!Number.isSafeInteger(lamports) || lamports < 0)
      throw Error("Unsafe RPC lamport number");
    add("native", n.native.symbol, String(lamports), n.native.decimals);
    const totals = new Map<string, { raw: bigint; decimals: number }>();
    await Promise.all(
      [
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ].map(async (programId) => {
        const result = await rpc("getTokenAccountsByOwner", [
          address,
          { programId },
          { encoding: "jsonParsed", commitment: "confirmed" },
        ]);
        for (const item of result.value) {
          const info = item.account.data.parsed.info;
          const prior = totals.get(info.mint);
          totals.set(info.mint, {
            raw: (prior?.raw ?? 0n) + BigInt(info.tokenAmount.amount),
            decimals: info.tokenAmount.decimals,
          });
        }
      }),
    );
    for (const [mint, total] of totals)
      add(mint, mint, total.raw.toString(), total.decimals);
    coverage =
      "SOL and all token accounts returned by Token and Token-2022 programs";
  } else if (n.family === "xrpl") {
    const info = await rpc("account_info", [
      { account: address, ledger_index: "validated" },
    ]);
    add(
      "native",
      n.native.symbol,
      info.account_data.Balance,
      n.native.decimals,
    );
    let marker: unknown;
    do {
      const lines = await rpc("account_lines", [
        {
          account: address,
          ledger_index: "validated",
          ...(marker ? { marker } : {}),
        },
      ]);
      for (const l of lines.lines ?? []) {
        const [whole, fraction = ""] = String(l.balance).split(".");
        const negative = whole.startsWith("-");
        const raw =
          (BigInt(whole.replace("-", "") || "0") *
            10n ** BigInt(fraction.length) +
            BigInt(fraction || "0")) *
          (negative ? -1n : 1n);
        add(
          l.currency + ":" + l.account,
          l.currency,
          raw.toString(),
          fraction.length,
        );
      }
      marker = lines.marker;
    } while (marker);
    coverage = "Validated XRP balance and issued-currency trust lines";
  } else {
    const post = async (path: string, body: unknown) => {
      const r = await transport(n.rpc + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(rpcTimeoutMs),
      });
      if (!r.ok) throw Error("RPC unavailable");
      return r.json();
    };
    for (const token of [
      {
        address: "eosio.token",
        symbol: n.native.symbol,
        decimals: n.native.decimals,
      },
      ...(n.tokens ?? []),
    ]) {
      const balances = await post("/v1/chain/get_currency_balance", {
        code: token.address,
        account: address,
        symbol: token.symbol,
      });
      const entry = balances.find((s: string) =>
        s.endsWith(" " + token.symbol),
      );
      const value = entry?.split(" ")[0] ?? "0";
      const decimals = token.decimals ?? value.split(".")[1]?.length ?? 0;
      if (!/^\d+(\.\d+)?$/.test(value)) throw Error("Invalid XPR balance");
      const [whole, fraction = ""] = value.split(".");
      if (fraction.length > decimals) throw Error("XPR precision mismatch");
      add(
        token.address + ":" + token.symbol,
        token.symbol,
        (
          BigInt(whole) * 10n ** BigInt(decimals) +
          BigInt(fraction.padEnd(decimals, "0") || "0")
        ).toString(),
        decimals,
      );
    }
    coverage = "XPR native and configured token contracts";
  }
  assets.sort((a, b) => a.id.localeCompare(b.id));
  return {
    walletId,
    networkId: n.id,
    status: "available",
    observedAt: new Date().toISOString(),
    assets,
    coverage,
  };
}
