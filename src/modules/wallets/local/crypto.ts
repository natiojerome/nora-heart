import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  randomBytes,
} from "node:crypto";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  recoverMessageAddress,
  type Hex,
  type TransactionSerializable,
  type TypedDataDefinition,
} from "viem";
import { base58 } from "@scure/base";
import type { Json } from "../../../contracts/json.ts";
import type {
  WalletInfo,
  WalletNetwork,
  WalletSignRequest,
  WalletSignature,
} from "../../../contracts/wallets.ts";

export interface PrivateWallet {
  info: WalletInfo;
  secret?: string;
  creation?: {
    label: string;
    networkIds: string[];
    networks?: WalletNetwork[];
  };
}
export function publicInfo(wallet: PrivateWallet): WalletInfo {
  return {
    ...wallet.info,
    addresses: wallet.info.addresses.map((a) => ({ ...a })),
    signing:
      wallet.info.family === "evm" && wallet.secret
        ? ["message", "typedData", "transaction"]
        : wallet.info.family === "ed25519" && wallet.secret
          ? ["bytes"]
          : [],
  };
}
function edKey(seed: Buffer) {
  if (seed.length !== 32) throw Error("Invalid seed");
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
}
export function walletAddress(
  family: "evm" | "ed25519",
  secret: string,
): string {
  if (family === "evm") return privateKeyToAccount(secret as Hex).address;
  const pub = createPublicKey(edKey(Buffer.from(secret, "hex"))).export({
    format: "der",
    type: "spki",
  });
  return base58.encode(pub.subarray(-32));
}
export function newSecret(family: "evm" | "ed25519") {
  return family === "evm"
    ? generatePrivateKey()
    : randomBytes(32).toString("hex");
}
export async function verifyWallet(
  wallet: PrivateWallet,
  networks: WalletNetwork[],
): Promise<void> {
  const info = wallet.info;
  if (
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(info.id) ||
    !info.label ||
    !Array.isArray(info.addresses) ||
    !["evm", "ed25519", "watch"].includes(info.family)
  )
    throw Error("Invalid wallet");
  for (const a of info.addresses) {
    const n = networks.find((n) => n.id === a.networkId);
    if (
      !n ||
      typeof a.address !== "string" ||
      !a.address ||
      (info.family === "evm" && n.family !== "evm") ||
      (info.family === "ed25519" && n.family !== "solana")
    )
      throw Error("Invalid network/address");
  }
  if (info.family === "watch") {
    if (wallet.secret) throw Error("Unexpected watch key");
    return;
  }
  if (!wallet.secret) throw Error("Missing key");
  const address = walletAddress(info.family, wallet.secret);
  if (
    info.addresses.some((a) =>
      info.family === "evm"
        ? a.address.toLowerCase() !== address.toLowerCase()
        : a.address !== address,
    )
  )
    throw Error("Key/address mismatch");
  const challenge = "Nora local wallet restore verification";
  if (info.family === "evm") {
    const signature = await privateKeyToAccount(
      wallet.secret as Hex,
    ).signMessage({ message: challenge });
    if (
      (
        await recoverMessageAddress({ message: challenge, signature })
      ).toLowerCase() !== address.toLowerCase()
    )
      throw Error("Verification failed");
  } else {
    const key = edKey(Buffer.from(wallet.secret, "hex"));
    const data = Buffer.from(challenge);
    if (!edVerify(null, data, createPublicKey(key), edSign(null, data, key)))
      throw Error("Verification failed");
  }
}
export function prepareSigner(wallet: PrivateWallet) {
  const account =
    wallet.info.family === "evm" && wallet.secret
      ? privateKeyToAccount(wallet.secret as Hex)
      : undefined;
  const ed =
    wallet.info.family === "ed25519" && wallet.secret
      ? edKey(Buffer.from(wallet.secret, "hex"))
      : undefined;
  return async (
    request: WalletSignRequest,
    network: WalletNetwork,
  ): Promise<WalletSignature> => {
    const address = wallet.info.addresses.find(
      (a) => a.networkId === network.id,
    )?.address;
    if (!address) throw Error("Wallet not available on this network");
    const result = {
      walletId: wallet.info.id,
      networkId: network.id,
      address,
      kind: request.kind,
    };
    const p = request.payload;
    if (ed && network.family === "solana" && request.kind === "bytes") {
      if (typeof p !== "string" || !/^([0-9a-fA-F]{2})*$/.test(p))
        throw Error("Hex-encoded message bytes required");
      return {
        ...result,
        signature: edSign(null, Buffer.from(p, "hex"), ed).toString("hex"),
      };
    }
    if (!account || network.family !== "evm" || !network.chainId)
      throw Error("Signing not supported for this wallet/network");
    if (request.kind === "message") {
      if (typeof p !== "string") throw Error("Message must be a string");
      return {
        ...result,
        signature: await account.signMessage({ message: p }),
      };
    }
    if (!p || typeof p !== "object" || Array.isArray(p))
      throw Error("Signing payload must be an object");
    if (request.kind === "typedData") {
      const domain = p.domain as Record<string, Json> | undefined;
      if (
        !domain ||
        domain.chainId === undefined ||
        BigInt(String(domain.chainId)) !== BigInt(network.chainId)
      )
        throw Error("Typed data chainId does not match network");
      return {
        ...result,
        signature: await account.signTypedData(
          p as unknown as TypedDataDefinition,
        ),
      };
    }
    if (request.kind === "transaction") {
      if (p.chainId !== undefined && p.chainId !== network.chainId)
        throw Error("Transaction chainId does not match network");
      if (
        !Number.isSafeInteger(p.nonce) ||
        Number(p.nonce) < 0 ||
        p.gas === undefined
      )
        throw Error("Explicit nonce and gas are required; no RPC is performed");
      if (
        p.gasPrice === undefined &&
        (p.maxFeePerGas === undefined || p.maxPriorityFeePerGas === undefined)
      )
        throw Error("Explicit transaction fees required");
      const tx: Record<string, unknown> = { ...p, chainId: network.chainId };
      for (const field of [
        "value",
        "gas",
        "gasPrice",
        "maxFeePerGas",
        "maxPriorityFeePerGas",
        "maxFeePerBlobGas",
      ])
        if (tx[field] !== undefined) {
          const v = tx[field];
          if (typeof v !== "string" || !/^\d+$/.test(v))
            throw Error("Transaction quantities must be decimal strings");
          tx[field] = BigInt(v);
        }
      return {
        ...result,
        serializedTransaction: await account.signTransaction(
          tx as unknown as TransactionSerializable,
        ),
      };
    }
    throw Error("Unsupported signing operation");
  };
}
