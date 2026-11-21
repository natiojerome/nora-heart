import type {
  WalletService,
  WalletSignRequest,
} from "../../../contracts/wallets.ts";
import type { Tool } from "../../../contracts/tools.ts";
export function walletTools(
  service: WalletService,
  allowSign = false,
  allowNetwork = true,
): Tool[] {
  const ids = { walletId: { type: "string" }, networkId: { type: "string" } };
  return [
    {
      name: "wallets.list",
      title: "Wallets locaux",
      description:
        "Liste les UUID, adresses, réseaux et modes de signature des wallets locaux. Ne retourne aucune clé privée.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      permission: "files.read",
      execute: async () => JSON.stringify(await service.list()),
    },
    {
      name: "wallets.assets",
      title: "Actifs du wallet",
      description:
        "Lit le cache des actifs avec date/état/couverture ; refresh=true attend une lecture RPC réelle et exige un accès réseau. Un solde inconnu ne vaut jamais zéro.",
      parameters: {
        type: "object",
        properties: { ...ids, refresh: { type: "boolean" } },
        required: ["walletId", "networkId"],
        additionalProperties: false,
      },
      permission: "files.read",
      execute: async (args) => {
        const p = args as Record<string, any>;
        if (p.refresh && !allowNetwork)
          throw Error(
            "Activer l’accès réseau du fil pour actualiser ; le cache reste accessible.",
          );
        return JSON.stringify(
          await service.assets(p.walletId, p.networkId, p.refresh),
        );
      },
    },
    ...(allowSign
      ? [
          {
            name: "wallets.sign",
            title: "Signer localement",
            description:
              "Signe hors ligne, sans diffusion. EVM: message EIP-191, typedData EIP-712 avec domain.chainId, transaction avec nonce/gas/frais explicites (quantités en chaînes décimales). Solana: bytes du message sérialisé en hex. Clés privées jamais retournées ; résultat transitoire.",
            parameters: {
              type: "object",
              properties: {
                ...ids,
                kind: {
                  type: "string",
                  enum: ["message", "typedData", "transaction", "bytes"],
                },
                payload: {},
              },
              required: ["walletId", "networkId", "kind", "payload"],
              additionalProperties: false,
            },
            permission: "process.execute" as const,
            transient: true,
            execute: async (args: any) =>
              JSON.stringify(await service.sign(args as WalletSignRequest)),
          },
        ]
      : []),
  ];
}
