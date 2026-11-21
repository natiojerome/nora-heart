# Wallets locaux

Service indépendant du LLM, de la base de conversations et du serveur MCP.
Il liste les wallets/réseaux, consulte les actifs et signe **sans diffuser** de
transaction. Heart et les programmes JavaScript/Python utilisent la même socket
Unix. Aucun port TCP n’est ouvert. Le service actuel est Linux ; le protocole
permet d’ajouter un autre transport sans changer les données.

## Architecture et chemin rapide

`contracts/wallets.ts` définit les données et services neutres.
`modules/wallets/local` charge et vérifie les clés une fois, prépare les comptes,
conserve un cache de soldes et sert JSON-RPC 2.0 sur HTTP/Unix.
`modules/wallets/unix` fournit le client Node autonome ; le client Python est
dans `sdk/wallets/python`. `modules/tools/wallets` adapte ce service aux outils
du modèle. `modules/storage/wallet-vault` réalise la sauvegarde via le MCP officiel.
`app/wallets.ts` assemble le service et les commandes ; `app/web-conversations.ts`
raccorde Heart. Aucun import entre ces implémentations ni changement du core.

La signature utilise les clés préparées en mémoire : aucun LLM, RPC, SQL, fichier,
serveur de sauvegarde ou consultation des soldes sur ce chemin. Les clients
réutilisent leurs connexions ; les créer à chaque signature ajoute un coût inutile.
Le CLI démarre Node à chaque commande : utiliser les SDK pour les boucles rapides.
Ce service n’est pas un ordonnanceur de trading, un allocateur de nonces ou un
système temps réel à délai garanti.

## Couverture livrée

| Famille | Inventaire des actifs | Signature |
| --- | --- | --- |
| EVM | Actif natif et contrats ERC-20 configurés, même numéro de bloc | EIP-191, EIP-712, transactions standard avec chainId |
| Solana | SOL et comptes des programmes Token et Token-2022, agrégés par mint | Signature Ed25519 des octets du message sérialisé |
| XRPL | XRP et trust lines, pagination du ledger validé | Lecture seule dans ce module |
| XPR | Actif natif et contrats configurés | Lecture seule dans ce module |

Un wallet sans clé contrôlée est explicitement en lecture seule. La liste retourne
les capacités réellement disponibles, jamais une promesse de signature pour tous
les réseaux. Les chaînes EVM avec format de transaction spécifique demandent leur
adaptateur/serializer : le format spécial Tempo n’est pas implémenté ici.

Les clés publiques ne révèlent pas universellement tous les ERC-20 détenus.
Sans indexeur, les contrats EVM à lire doivent être configurés. Le champ `coverage`
indique cette portée ; NFTs, prix fiat, valorisation, historique et découverte
universelle ERC-20 ne sont pas livrés. Sur Solana, les tokens inconnus portent
leur mint comme libellé. Ne pas confondre solde brut, liquidité et montant dépensable.

## Utilisation JavaScript

Le client `src/modules/wallets/unix/client.mjs` peut être copié seul dans un autre
projet : il ne dépend que de `node:http`. Pas besoin de lancer Heart ou un modèle.
Le raccourci dans `sdk/wallets/javascript/index.mjs` convient depuis ce dépôt.

```js
import { WalletClient } from './sdk/wallets/javascript/index.mjs';

const client = new WalletClient('/run/nora-wallets/api.sock');
try {
  const { wallets, networks } = await client.list();
  const wallet = wallets.find(w =>
    w.signing.includes('message') &&
    w.addresses.some(a => a.networkId === 'eip155:8453'));
  if (!wallet) throw new Error('Aucun wallet signataire sur Base');
  const cached = await client.assets(wallet.id, 'eip155:8453');
  const fresh = await client.assets(wallet.id, 'eip155:8453', true);
  const signed = await client.signMessage(wallet.id, 'eip155:8453',
    'Neutral application authentication challenge');
  // signed.signature : signature EIP-191, aucune diffusion.
} finally {
  client.close();
}
```

`client.signTypedData(walletId, networkId, data)` attend un objet EIP-712 avec
`domain.chainId` correspondant au réseau. `client.signTransaction(...)` attend,
par exemple, `{to, nonce: 0, gas: '21000', value: '0', maxFeePerGas: '2',
maxPriorityFeePerGas: '1'}`. **Le destinataire et les montants réels viennent du
code appelant.** Toutes les quantités monétaires/gas/frais sont des chaînes
d’entiers décimaux dans l’unité minimale ; `nonce` et `chainId` sont des entiers
JSON sûrs. Le résultat est `serializedTransaction`. Les frais, le nonce, la
simulation et la diffusion restent à la charge de l’application appelante.
Pour une transaction legacy, fournir `gasPrice` plutôt que les deux frais EIP-1559.

`client.signBytes(walletId, networkId, hexBytes)` attend de l’hexadécimal **sans
`0x`**, et retourne une signature Ed25519 en hexadécimal. Pour Solana, signer les
octets du message de la transaction, puis insérer la signature avec son SDK Solana.
La reconstruction d’une transaction complète legacy/v0 est du ressort du code
appelant. Une signature peut autoriser une opération financière même sans
diffusion par le service : ne pas traiter son résultat comme une donnée anodine.

## Utilisation Python

Copier `sdk/wallets/python/nora_wallets.py` dans son projet ou ajouter ce dossier
à `PYTHONPATH`. Bibliothèque standard uniquement, aucune installation pip.

```python
from nora_wallets import WalletClient

with WalletClient('/run/nora-wallets/api.sock') as client:
    wallets = client.list()['wallets']
    wallet = next(w for w in wallets
                  if 'message' in w['signing']
                  and any(a['networkId'] == 'eip155:8453'
                          for a in w['addresses']))
    result = client.sign_message(wallet['id'], 'eip155:8453',
                                 'Neutral application authentication challenge')
```

Méthodes : `list`, `assets(wallet_id, network_id, refresh=False)`,
`sign_message`, `sign_typed_data`, `sign_transaction`, `sign_bytes`, `close`.
Un client Python sérialise ses appels par verrou ; utiliser un client par thread
si des appels indépendants doivent progresser simultanément.

## Protocole et soldes

HTTP `POST /rpc`, `Content-Type: application/json`, socket privée. Exemple :
`{"jsonrpc":"2.0","id":1,"method":"wallets.list","params":{}}`.
Méthodes : `wallets.list`, `wallets.assets`, `wallets.sign` ; les paramètres de
signature sont `{walletId, networkId, kind, payload}`. Même contrat dans les SDK.
Les réponses portent `result` ou `error`, avec le même identifiant. Pas de batch
JSON-RPC ni notifications dans cette première version. Les erreurs ne recopient
ni les données signées ni une clé. Pas de réessai automatique des clients.

Les autres langages peuvent utiliser directement HTTP sur socket Unix. Exemple
sans SDK :

```sh
curl --unix-socket /run/nora-wallets/api.sock http://localhost/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"wallets.list","params":{}}'
```

Les UUID des wallets sont persistants ; les noms peuvent changer sans changer
les clés de référence. Pour EVM, `eip155:<chainId>` suit CAIP-2. Les autres réseaux
importés ont un UUID opaque persistant ; ils ne prétendent pas être des CAIP-2.
Ne pas retrouver durablement un wallet par son libellé ou sa position dans la liste.

`assets(..., false)` lit uniquement le cache, sans RPC. `refresh=true` attend
une lecture réelle et regroupe les requêtes simultanées du même wallet/réseau.
Réponse : `status`, `observedAt`, `coverage`, `assets`, éventuel `error`.
Chaque actif a `id`, `symbol`, `raw`, `decimals`, `amount` ; ne jamais convertir
`raw` en flottant pour calculer un montant. Les nombres RPC Solana non exactement
représentables sont rejetés plutôt qu’arrondis.

Un cache de plus de 30 secondes est signalé `stale`, sans actualisation implicite.
En cas de panne RPC, le dernier résultat est conservé avec son horodatage ; un
solde inconnu reste `unavailable`, jamais transformé en zéro. Le cache est en
mémoire et repart vide au redémarrage. Aucune boucle de polling permanente.
`NORA_WALLETS_CACHE_MS` règle le seuil de fraîcheur ;
`NORA_WALLETS_RPC_TIMEOUT_MS` règle l’attente par requête RPC (défaut 10 secondes).
Les clients ont une attente de 15 secondes configurable (`timeoutMs` Node,
`timeout` Python). Pour les lectures lentes séquentielles, augmenter cette valeur ;
ce délai client ne change pas le travail de lecture déjà commencé.

## Permissions et raccordement Heart

Le socket appartient au compte/groupe `nora-wallets`, mode 0660 dans un dossier
0750. Seuls les comptes autorisés dans ce groupe peuvent l’utiliser ; ce groupe
donne accès aux signatures, pas seulement aux métadonnées. Il s’agit d’un service
local pour son propriétaire, sans isolation multi-utilisateur au niveau des wallets.
Ne pas exposer cette socket par un proxy public.

Dans Heart, `HARNESS_WALLETS_SOCKET` active `wallets.list` et `wallets.assets`,
sous le droit de lecture du fil. Une actualisation exige le réseau/YOLO du fil.
`wallets.sign` est déclaré uniquement si `HARNESS_WALLETS_SIGN_ENABLED=1` **et**
si le fil est en YOLO ; la permission d’exécution existante s’applique. Le résultat
et les arguments de cet outil sont transitoires dans le journal d’outils.
Le modèle voit les vrais schémas dans son inventaire généré à chaque tour.
Ces règles Heart ne sont pas une restriction du SDK : le code ayant accès au
socket signe directement, sans LLM ni formulaire à chaque signature.

L’outil n’exporte aucune clé. Il n’existe pas de garantie contre un programme root
ou un modèle auquel root/YOLO et les credentials Vault sont accordés. La réponse
finale d’un modèle peut aussi recopier une signature : le caractère transitoire
du journal d’outils n’est pas une suppression de tous les canaux possibles.

## Installation et administration

Runtime qualifié Node 24, dépendances pnpm verrouillées. Le daemon utilise
`NORA_WALLETS_STATE` (défaut `/var/lib/nora-wallets`) et une clé AES de 32 octets
fournie par `CREDENTIALS_DIRECTORY/master` ou `NORA_WALLETS_KEY_FILE` privé.
Créer la clé via `os.urandom(32)`/`crypto.randomBytes(32)` et la transmettre
directement à `systemd-creds encrypt --name=master`, sans affichage ni fichier
intermédiaire dans le workspace. Le coffre local `wallets.enc` est AES-256-GCM,
avec nonce aléatoire et authentification. Les valeurs privées restent en mémoire
du daemon ; JavaScript ne garantit pas l’effacement de toutes les chaînes en RAM.

Les unités dans `deploy/nora-wallets*.service` et `.timer` sont des modèles pour
une installation sous `/projects/nora-heart`. Adapter les chemins à son installation,
créer le compte/groupe système `nora-wallets`, puis installer/activer les unités.
`deploy/heart-wallets.conf` est le drop-in Heart (accès aux signatures YOLO activé).
Le service de sauvegarde reçoit le token Vault privé par `EnvironmentFile`,
aucun secret n’est contenu dans les modèles versionnés.

Commandes `pnpm wallets ...` :

| Commande | Effet |
| --- | --- |
| `help` | Aide sans charger de clé |
| `init <catalogue> <credentials>` | Import explicite unique dans un coffre absent |
| `daemon` | Serveur Unix ; refuse de remplacer un chemin/socket existant |
| `verify` | Déchiffrement, contrôle adresses/clés et signatures locales |
| `list` | Inventaire public par socket |
| `assets <wallet UUID> <network ID> [--refresh]` | Cache ou lecture RPC |
| `sign` | Requête JSON lue sur stdin, résultat de signature |
| `backup`, `backup-status` | Sauvegarde vérifiée ou dernier reçu |
| `restore <backup UUID> <nouveau dossier>` | Restauration isolée, refuse l’écrasement |

Le format d’import accepte un catalogue `chains`/`wallets` de l’ancien signataire :
réseaux avec `rpc`, `native`, `decimals`, `chainId` numérique pour EVM et éventuels
`tokens: [[symbol, contract, decimals?]]` ; wallets avec `id` source, `name`,
`address`, `chains`. Le fichier privé de credentials est une table par identifiant
source : clé EVM hexadécimale ou tableau Solana de 64 octets. Le chargeur vérifie
chaque clé contre les adresses et signe un challenge avant d’accepter l’import.
De nouveaux UUID sont attribués une seule fois ; les sources restent intactes.
Les credentials doivent être injectés via systemd, hors Git/logs/chat.
Le catalogue/les clés ne sont pas encore éditables depuis l’interface web.

Un crash brutal hors systemd peut laisser un ancien chemin socket : vérifier
que le daemon est arrêté avant de le retirer. Les unités fournies gèrent le
dossier runtime. Un service arrêté ne déclenche aucun repli vers un autre wallet,
un autre serveur ou l’ancien signataire.

## Sauvegarde et restauration sur MCP

`VaultWalletBackups` utilise le MCP Vault existant (`https://mcps.natio.re/vault`)
avec `NORA_MCPS_VAULT_TOKEN`, ou `NORA_WALLETS_BACKUP_URL` pour une autre instance.
Le daemon de signature ne reçoit pas ce token : une commande/process séparé
sauvegarde et vérifie la copie. Une panne du MCP ne bloque donc pas une signature.

Une archive contient le coffre local chiffré **et sa clé de récupération**,
conservés dans le secret Vault du propriétaire et chiffrés au repos par Vault.
**Le serveur Vault est une autorité de confiance capable de récupérer les clés.**
Ce n’est pas un chiffrement empêchant le serveur ou un lecteur Vault autorisé de
les déchiffrer. Cette décision permet de restaurer après perte de la machine,
sans imposer à l’utilisateur de manipuler une seed ou un secret supplémentaire.
L’isolation des utilisateurs et les droits de lecture reposent sur Vault.

Une révision immuable UUID sert de clé d’idempotence ; réessayer la même
sauvegarde ne crée pas une nouvelle entrée. Une nouvelle révision produit une
nouvelle entrée de sauvegarde. L’archive est relue, son SHA-256 contrôlé, son
authentification GCM vérifiée et les clés/adresses/signatures revalidées avant
écriture du reçu `backup.json`. Ce reçu ne contient pas de clé. Le timer fourni
revérifie la copie quotidiennement, sans LLM. Sur une nouvelle importation ou
évolution future du coffre, exécuter `backup` avant de considérer la reprise prête.

Pour restaurer :

1. Retrouver l’UUID du reçu ou rechercher le tag `nora-wallets` dans son Vault.
2. Avec le token Vault configuré, lancer `pnpm wallets restore <UUID> <nouveau dossier>`.
   Un dossier existant est toujours refusé ; aucune installation active n’est remplacée.
3. Le dossier est privé (0700) et contient `wallets.enc` et `recovery.key` (0600).
   Dans cet environnement isolé, définir `NORA_WALLETS_STATE` et
   `NORA_WALLETS_KEY_FILE`, puis lancer `pnpm wallets verify`.
4. Pour une installation restaurée, convertir `recovery.key` en credential
   systemd `master` avec `systemd-creds encrypt`, installer le coffre dans le
   nouveau répertoire d’état et supprimer la clé temporaire privée.
5. Démarrer le daemon restauré sur sa propre socket, tester un challenge neutre,
   puis changer explicitement le raccordement de l’application. Ne jamais écraser
   le coffre en service pendant ce contrôle.

Une sauvegarde ne prouve pas la restauration : le scénario de qualification
effectue réellement ces opérations et supprime son clone isolé. Les sauvegardes
distantes de ce module couvrent ses wallets, pas les journaux/intentions de
l’ancien signataire, ni les conversations Heart.

## Qualification et performances

`pnpm test:wallets` utilise des clés synthétiques, RPC simulés et répertoires
temporaires : signatures vérifiables, permissions, cache/échec/coalescence,
clients JS/Python sur vraie socket, chiffrement/intégrité/restauration et moteur
Heart avec modèle simulé. Les signatures/arguments transitoires ne sont pas
conservés dans son journal. Aucun test automatique ne lit une clé propriétaire.

`pnpm qualify:wallets` est opt-in et écrit un wallet synthétique dans le vrai
Vault configuré, relit la sauvegarde, vérifie son idempotence et signe avec un
clone restauré. Ce test laisse son entrée de qualification dans le Vault.
Il ne diffuse aucune transaction et ne consomme aucun crédit LLM.

`pnpm demo:wallets` mesure une vraie socket Unix sur clés synthétiques puis
supprime les fichiers. Mesures du 21 novembre 2026, Node 24.22.3, 1 000 appels
séquentiels par opération après 30 appels de chauffe, machine hôte courante :

| Client / opération | Médiane | p95 | p99 |
| --- | ---: | ---: | ---: |
| JavaScript / liste | 0,156 ms | 0,281 ms | 0,385 ms |
| JavaScript / message EVM | 0,483 ms | 0,808 ms | 1,784 ms |
| JavaScript / bytes Solana | 0,153 ms | 0,202 ms | 0,272 ms |
| JavaScript / transaction EVM | 0,761 ms | 1,152 ms | 2,350 ms |
| Python / message EVM | 1,109 ms | 1,608 ms | 1,877 ms |

Ces chiffres incluent IPC et signature, excluent démarrage du client/processus,
RPC et diffusion, et ne constituent pas un SLA ni une garantie de « zéro délai ».
Charge CPU, GC, tailles de messages, concurrence et parsing de réponses RPC
peuvent augmenter la latence. Les tests prouvent aussi qu’un RPC en attente
n’empêche pas une signature hors ligne de se terminer.

Qualification de déploiement : inventaire réel importé explicitement dans un
nouveau coffre, challenge réel EVM vérifié, lecture Base réussie et sauvegarde
réelle restaurée dans un dossier tmpfs séparé avec vérification de toutes les
clés signataires. Aucun transfert, aucune diffusion ni modification de l’ancien
signataire. La boucle LLM est qualifiée par simulation ; aucune inférence payante
n’est nécessaire pour ces contrôles cryptographiques et de transport.

## Standards et dépendances

- [JSON-RPC 2.0](https://www.jsonrpc.org/specification) pour requêtes/réponses.
- [viem local accounts](https://viem.sh/docs/accounts/local/signTransaction) et
  [EIP-712](https://viem.sh/docs/accounts/local/signTypedData) : viem 2.56.9, MIT,
  dépendances verrouillées ; pas de copie de son code dans le moteur.
- [Node crypto](https://nodejs.org/api/crypto.html) : Ed25519, PKCS#8 et AES-GCM.
- [Solana getTokenAccountsByOwner](https://solana.com/docs/rpc/http/gettokenaccountsbyowner)
  pour l’inventaire Token et Token-2022.
- `@scure/base` 1.2.6, MIT : encodage base58, sans dépendance d’exécution propre.
  Voir aussi [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Pas de protocole MCP dans le chemin rapide. Un MCP supplémentaire pour récupérer
une signature serait inutile ici ; le MCP reste le stockage distant de reprise.
