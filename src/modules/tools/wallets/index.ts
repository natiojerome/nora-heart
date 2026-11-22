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
      name: "wallets.create",
      title: "Créer un wallet local",
      permission: "files.write",
      description:
        "Générer les clés localement, conserver le coffre chiffré et programmer sa sauvegarde distante si configurée. UUID id stable à réutiliser lors d’une reprise ; label modifiable, jamais une identité. Choisir les networkIds de wallets.list ; networks permet de fournir explicitement des réseaux absents. EVM ou Ed25519/Solana. Aucune clé privée renvoyée, aucun financement ni diffusion. Vérifier backup_status avant d’utiliser un wallet pour des fonds réels.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "family", "networkIds"],
        properties: {
          id: { type: "string", format: "uuid" },
          label: { type: "string", minLength: 1 },
          family: { type: "string", enum: ["evm", "ed25519"] },
          networkIds: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string" },
          },
          networks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label", "family", "rpc", "native"],
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                family: { type: "string", enum: ["evm", "solana"] },
                rpc: { type: "string" },
                chainId: { type: "integer", minimum: 1 },
                native: {
                  anyOf: [
                    { type: "null" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["symbol", "decimals"],
                      properties: {
                        symbol: { type: "string" },
                        decimals: { type: "integer", minimum: 0, maximum: 255 },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      execute: async (args) =>
        JSON.stringify(
          await service.create(
            args as unknown as import("../../../contracts/wallets.ts").WalletCreateRequest,
          ),
        ),
    },
    {
      name: "wallets.rename",
      title: "Renommer un wallet",
      permission: "files.write",
      description:
        "Changer uniquement le nom affiché. UUID, clés et adresses inchangés ; nouvelle révision chiffrée et sauvegarde programmée.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["walletId", "label"],
        properties: {
          walletId: { type: "string" },
          label: { type: "string", minLength: 1 },
        },
      },
      execute: async (args) => {
        const p = args as Record<string, any>;
        return JSON.stringify(await service.rename(p.walletId, p.label));
      },
    },
    {
      name: "wallets.backup_status",
      title: "État de sauvegarde des wallets",
      permission: "files.read",
      description:
        "État de la révision courante : verified seulement après relecture/vérification distante, sinon pending/stale/unconfigured/failed. Aucune clé ni archive retournée.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => JSON.stringify(await service.backupStatus()),
    },
    ...(allowNetwork
      ? [
          {
            name: "wallets.backup",
            title: "Sauvegarder les wallets",
            permission: "files.read" as const,
            description:
              "Demander et attendre une sauvegarde chiffrée et sa vérification sur le Vault configuré. Retourne uniquement un reçu/état, aucune clé. Pas de restauration destructive de l’installation.",
            parameters: {
              type: "object" as const,
              properties: {},
              additionalProperties: false,
            },
            execute: async () => JSON.stringify(await service.requestBackup()),
          },
        ]
      : []),
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
