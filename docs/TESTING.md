# Tester les modules

## Inscription depuis Heart — 22 novembre 2026

Bouton « Créer un compte », partage du device flow et accès direct au formulaire
sécurisé ; aucun mot de passe transmis par Heart. Refus côté portail d’un email
non autorisé, inscription autorisée, conservation de la demande puis attribution
des trois clés au nouveau compte vérifiés avec vrai PostgreSQL isolé et navigateur.
Le test mobile Heart couvre connexion et inscription, progression, clés hors
réponses et bouton masqué après liaison ; protocole simulé dans ce seul test UI.
Les parcours onboarding IP/loopback restent valides. Aucun compte de production
créé, aucune nouvelle VM et aucune inférence LLM pour ces contrôles.

## Compte MCP et restauration intégrée — 22 novembre 2026

272 tests (`pnpm check`), démo SDK et les 27 tests navigateur de régression réussis,
dont le nouveau parcours mobile account-login.
Compte/device flow simulé uniquement dans le test navigateur Heart ; le portail
a passé séparément 103 contrôles sur PostgreSQL réel et un parcours navigateur
email/mot de passe, approbation et refus avec compte synthétique.

Installation native jetable, même hôte, PostgreSQL/systemd réels et portail HTTPS
public : trois clés créées automatiquement, trois découvertes MCP validées,
onboarding/reprise, fichiers, terminal protégé/YOLO, restart et accès aux sauvegardes.
Deux reconnexions valident la conservation exacte des clés et le refus de contourner
le compte via mot de passe local. L’opérateur a approuvé exclusivement l’UUID QA ;
pas de mot de passe propriétaire récupéré ni de nouvelle session email réelle
prétendue. Chat de ce scénario simulé ; anciennes qualifications fournisseurs
ci-dessous distinctes. Aucun serveur créé/acheté ni crédit LLM consommé ici.

`pnpm qualify:install -- --root /projects/heart-account-qa-UUID --operator-approve`
reste opt-in et réservé à la fixture explicite. `tests/account-login.e2e.ts` est
intégré à `test:web:e2e`. Preuve privée : qualification/account-install.

Daemon et vrai Vault : deux wallets synthétiques, backup puis reprise dans un
nouveau coffre/une autre clé maître, activation sans restart, signatures EVM/Ed25519
vérifiées, répétition sans doublons, archives et fichiers supprimés. Tests ciblés
additionnels : refus clé/UUID et absence de modification du coffre lors du conflit.
La sauvegarde de production existante est à nouveau vérifiée (format immuable
conservé pour ses reprises), sans restaurer de wallet personnel. Preuve privée :
qualification/wallet-management/restore-live.json. Sauvegarde MCP chiffrée copiée
hors machine et restaurée en environnement réseau isolé avant migration 006.

## Installation indépendante — 22 novembre 2026

266 tests, démo SDK et cinq parcours navigateur réussis. Onboarding testé sur
loopback et IP privée HTTP non loopback : `isSecureContext` faux, UUID natif absent,
1 000 UUID v4 uniques, copie Unicode de secours, initialisation mathématique et
cookies adaptés. Python couvre IPv4/IPv6, modes exclusifs, détection simulée et
maintien des anciens déploiements privés ; IP publique réellement détectée aussi.

Installations jetables sur un hôte existant, sans nouvelle VM Hetzner :
bootstrap GitHub, Node/SHA-256, pnpm verrouillé, vrai PostgreSQL/systemd, chemins
avec espaces, wizard mobile/reprise, fichiers, terminal Node 24 protégé et root
YOLO, recherche déclarée, wallets vides et persistance après redémarrage.
Les essais de chat réussis dans ce périmètre utilisent un fournisseur simulé.
Relance sans changer UUID, credentials ou coffre, réparation après arrêt wallet
et préservation des configurations privées validées. Caddy validé par son binaire ;
OS vierge, DNS/ACME public et ARM64 ne sont pas qualifiés par ces essais.

Essai Venice préalable : clés MCP et Venice existantes réutilisées explicitement pour le
seul test, lues depuis leurs fichiers privés et saisies par navigateur automatisé.
Pas de récupération automatique par l’installateur, de nouveau compte ou de clé
créée. Connexions/authentification réelles, catalogue Venice réel, défaut du modèle
`deepseek-v4-flash-0731` et effort `none` persistés depuis l’onboarding sur IP.
Lecture/création/modification d’un souvenir via l’API Heart, relecture indépendante
par le MCP Memory, recherche Projets et recherche de métadonnées Vault réellement
exécutées. Redémarrage avec bindings/cerveau/souvenir conservés. Souvenirs de
contrôle supprimés après les essais ; aucun projet/secret métier créé ou modifié,
aucune valeur de secret Vault lue. Le timer wallet a ignoré la sauvegarde, Vault
n’étant pas encore configuré à son déclenchement ; aucun artefact distant ajouté.

## Fournisseurs réels sur installation indépendante — 22 novembre 2026

Scénario `tests/qualify-live-installation.ts`, opt-in séparé des tests hors ligne :

| Fournisseur | Parcours observé | Résultat |
| --- | --- | --- |
| ChatGPT abonnement · `gpt-6-luna` · low | Nouvelle installation GitHub sur IP, onboarding, vrais MCP, fichiers, terminal Node 24, recherche Projets, souvenir distant, restart puis recherche dans un nouveau fil. | Réussi ; dernier essai sans erreur d’outil ni JS. |
| OpenRouter · `deepseek/deepseek-v4-flash-0731` | Ajout de la clé par Fournisseurs sur la même installation isolée, nouveau défaut, même parcours complet avec nouveaux fils et restart. | Réussi ; dernier essai sans erreur d’outil ni JS. Baisse du compteur partagé : 0,001644954 USD. |
| Venice · `deepseek-v4-flash-0731` | Onboarding, vrai catalogue/clé, connexions MCP puis premier tour et requête directe minimale `max_tokens: 8`. | Inférence refusée HTTP 402 « Insufficient USD or Diem balance ». |

Le fichier est vérifié sur disque, le terminal doit retourner Node 24 et exit 0,
l’appel Projets est identifié par son nom canonique calculé depuis la connexion.
Le souvenir doit être visible via Heart/MCP, puis son code retrouvé dans un nouveau
fil sans le fournir à nouveau après restart. Les souvenirs synthétiques sont
supprimés dans `finally`, même si une assertion échoue. Pas de faux transport,
de faux catalogue ou de faux résultat d’outil dans ces deux qualifications réussies.

L’autorisation ChatGPT courte durée vient explicitement du compte existant,
transférée par pipe privé au compte système de la QA, sans refresh/id token.
Le compte source reste géré par son propriétaire et aucun logout/révocation n’est
lancé au nettoyage. Le test couvre le forfait existant et sa persistance pendant
la validité du token ; **pas une nouvelle autorisation OAuth ni son renouvellement**.
Clés OpenRouter/MCP lues depuis les fichiers privés existants, saisies par l’UI,
sans nouveau compte/clé. Aucun secret dans le rapport ou Git.

Le premier essai ChatGPT a refusé un cwd hors workspace ; le modèle a corrigé
seul l’appel et la commande a réussi. Le schéma précise désormais le cwd par défaut
et sa différence avec le dossier d’installation, sans élargir les permissions.
Les assertions du script ont été corrigées (`terminal.exec` et alias MCP haché),
ainsi que ses attentes de disponibilité web/authentification après restart : les
échecs du script ne sont pas présentés comme des validations produit. Les deux
parcours réussis ci-dessus sont rejoués après ces corrections utiles à leur cas.
Le scénario accepte `--provider chatgpt|openrouter|venice` ;
`--existing-qa-profile` réutilise exclusivement le profil de cette QA, pour ajouter
un fournisseur sans reprovisionner l’hôte ou rejouer artificiellement le wizard.

Venice conserve un solde déclaré de 0,08653047 USD, zéro DIEM/crédit inclus et
`accessPermitted: false` lors de son essai ; les appels ont été arrêtés. Les
qualifications ChatGPT/OpenRouter ne prouvent pas que Venice fonctionne.
Une nouvelle VM/OS vierge, ACME public, ARM64, le renouvellement OAuth et les
compteurs ChatGPT (collecteur non copié en QA) restent des parcours distincts.
Les ressources locales de test et les souvenirs de contrôle sont supprimés ;
aucun nouveau serveur, achat ou rechargement.

## Création et sauvegarde des wallets — 22 novembre 2026

270 tests après ajout de quatre scénarios : création/renommage et reprise
idempotente par socket JS/Python, clés/adresses/UUID après redémarrage, deux
writers sans perte, installation vide et réseaux explicites, signature EVM/Ed25519,
backup en attente/en panne, regroupement des mutations et restauration vérifiée.
Kill réel du processus sous verrou OS puis nouvelle écriture sans nettoyage PID/TTL.

`pnpm qualify:wallets:create --live --env-file /chemin/prive/vault.env` :
essai réel sur daemon isolé, deux nouveaux wallets synthétiques EVM/Solana, clés
générées localement, renommage, backup par processus enfant sur le vrai Vault,
redémarrage et restauration isolée avec signatures identiques. Le parent signataire
ne contient pas la clé Vault dans son environnement. Coffre/dossiers et archive
Vault de test supprimés. Aucun RPC, fonds, diffusion ou crédit LLM pour cet essai.
Essai distinct avec un vrai DeepSeek Flash via OpenRouter : deux inférences,
`wallets.create` réellement appelé par le moteur via la socket, UUID/nom/fichier
chiffré vérifiés, coffre synthétique supprimé. Aucun faux transport fournisseur.
Benchmark isolé après modification : signature EVM JS p50 0,771 ms, p95 1,239 ms ;
Python p50 1,103 ms, p95 1,722 ms, 1 000 mesures par client, connexions chaudes.
Ce sont des mesures locales sans SLA, pas une promesse de latence nulle.
Sauvegarde du coffre existant relue et vérifiée après déploiement via la nouvelle
commande socket ; révision courante/sauvegardée identiques, token absent de
l’environnement du signataire. Catalogue MCP actif : quatre connexions, ancien
fournisseur commercial absent ; parcours navigateur MCP réussi.

Le timer de sauvegarde du coffre personnel est vérifié avant le déploiement.

## Wallets locaux — 21 novembre 2026

`pnpm test:wallets` : clés synthétiques et dossiers temporaires, signatures EVM
et Ed25519 vérifiées cryptographiquement, quantités exactes, refus des wallets
en lecture seule/réseaux incompatibles, inventaire et droits du modèle,
arguments/résultats de signature transitoires, cache/coalescence/panne RPC,
lecteurs EVM/Solana/XRPL/XPR, intégrité et restauration, clients JS/Python sur
vraie socket Unix. La boucle moteur utilise un fournisseur simulé, sans coût.

`pnpm demo:wallets` mesure le chemin réel SDK → socket → signature, sur clés
synthétiques supprimées après la démo. `pnpm qualify:wallets` est un essai live
opt-in avec token Vault configuré : sauvegarde distante, rejeu idempotent,
restauration isolée et signature vérifiée depuis le clone. Son entrée de test
reste dans le Vault ; aucune diffusion de transaction ni inférence LLM.

Qualification opérateur effectuée aussi sur le coffre déployé : inventaire
existant importé sans modifier ses sources, challenge EVM vérifié, actifs Base
lus réellement puis lectures des dix réseaux réussies sur un wallet représentatif
par réseau ; accès liste/signature sous l’identité système Heart vérifié.
Réseau EVM sans actif natif testé, sans lecture `eth_getBalance` ni solde fictif.
Sauvegarde réelle restaurée en tmpfs, clés/adresses/challenges
revalidés puis clone supprimé. 261 tests et démo SDK, aucune transaction diffusée.
Les détails de couverture et mesures sont dans [WALLETS.md](WALLETS.md).

Un module doit pouvoir être testé via son entrée publique, sans lancer toute
l’application ni dépendre d’un modèle payant. Pas de framework de test maison :
`node:test`, fournisseurs simulés, dépendances injectées et répertoires temporaires.

| Commande | Périmètre |
| --- | --- |
| `pnpm test:models` | AI SDK et ChatGPT : textes, outils, historique, erreurs, annulation, OAuth et renouvellement ; transports simulés. |
| `pnpm test:memory` | Règles de basic avec repository simulé et remplacement du service dans le moteur ; structured et son contexte sont aussi couverts par pnpm check. |
| `pnpm test:tools` | Fichiers, workspace et terminal ; outils mémoire également couverts par pnpm check. |
| `pnpm test:storage:json` | Identité, journal et souvenirs après réouverture, corruption et isolation des chemins. |
| `pnpm test:postgres` | PostgreSQL jetable, tests SQL, migrations, CLI, sauvegarde et restauration. Docker requis. |
| `pnpm test:web` | Accès privé, invitations, CSRF, origine/hôte, essais isolés, clés et relais loopback. |
| `pnpm test:web:e2e` | Chromium et backend réel local ; invitation, simulation, clés factices, tests mémoire et mobile. |
| `pnpm check` | Typage, tests locaux de modules et d’intégration, permissions et frontières d’import. |
| `pnpm demo:sdk` | Parcours complet AI SDK simulé → outil → résultat → réponse, sans réseau. |
| `pnpm demo:chatgpt` | Même parcours avec le module ChatGPT et SSE simulé. |

Les tests locaux ne lisent pas de clés et n’appellent pas une API LLM. Les tests
PostgreSQL créent leur propre service temporaire. Une démo avec le module `demo`
prouve la boucle ; elle ne qualifie pas un fournisseur commercial réel.

## Reprise des appels invalides — 21 novembre 2026

253 tests, dont tests d’alias exact sans appel supplémentaire, JSON/arguments
invalides, lot mixte intégralement retenu, écritures antérieures non répétées,
absence de secrets dans le diagnostic et respect des permissions/budgets.
Démo SDK réussie. Essai réel isolé sur le modèle Venice du fil First try :
`e2ee-deepseek-v4-1-flash-1017-abliterated`, une réponse altérée volontairement
avant validation pour vérifier la reprise. Trois appels réels, un outil exécuté,
marqueur lu/restitué et diagnostic présent ; données temporaires supprimées.
2 300 tokens d’entrée / 483 de sortie. La faute injectée ne prétend pas reproduire
le champ exact de l’incident historique, absent du journal. Un premier essai QA
avait une assertion trop stricte sur le nombre de lectures et n’est pas compté
comme validation. Aucun tour utilisateur relancé automatiquement.

## Qualification Venice AI — 21 novembre 2026

`tests/venice.test.ts` vérifie catalogue, unités de prix, capacités/efforts, boucle
HTTP d’outil via Engine, absence de repli/retry, erreurs sûres et annulation.
Persistance privée de clé et sélection d’effort couvertes aussi par les suites
web/conversations. `tests/venice.e2e.ts` utilise Chromium, HTTP et SQLite jetable :
connexion, défauts/override, effort, rechargement, chat, panne et reprise du
catalogue, largeurs 320/390/820/1440. Transport LLM simulé, pas d’inférence réelle.
246 tests locaux au total et cinq parcours navigateur ciblés validés (Venice,
atelier/connexions existantes, catalogue des conversations, assemblage SQLite).
Deux assertions anciennes de personnalité ont été alignées sur les templates
courants, sans modifier leur comportement. Le catalogue Venice réel est lu sans clé
(148 modèles texte observés).

Qualification réelle après configuration et recharge : endpoint authentifié des
limites HTTP 200 ; `deepseek-v4-1-flash-uncensored` via `createAiSdkProvider` et
`Engine`, stockage JSON temporaire, seul accès fichiers en lecture. Un marqueur
UUID écrit dans `preuve.txt` et absent du prompt est retrouvé par un véritable
appel d’outil puis restitué : deux appels fournisseur, un outil exécuté. Fixture
supprimée et aucune conversation/mémoire propriétaire modifiée. Pas de repli vers
un autre modèle. Cela ne qualifie pas les autres modèles, mémoire ou compression.
`pnpm check` relancé : 246 tests réussis ; `pnpm demo:sdk` relancé et réussi
(cette démo reste simulée, distincte de l’essai Venice réel).

Consommation Venice : 250 tests après ajout des cas solde nul/négatif/inconnu,
renouvellement DIEM distinct, limites par modèle, erreurs privées et cache isolé.
Parcours navigateur Venice relancé : Consommation aux quatre largeurs, erreur et
reprise d’actualisation, crédits/limites du chat ; lectures simulées, aucun appel
Venice d’inférence. Qualification réelle limitée aux GET de métadonnées avec la
clé actuelle : soldes/limites HTTP 200, endpoints Billing HTTP 401 exigeant une clé
administrateur. Aucune dépense LLM supplémentaire pour cette modification.

## Qualification personnalité et rétention — 21 novembre 2026

242 tests locaux couvrent notamment résumés supérieurs à 6000 caractères, plafond
choisi, tours récents, mémoire adaptée, lecture historique isolée et récupération
d’une information absente du résumé. Les parcours navigateur ciblent historique,
instructions, limites (nouveaux champs sauvegardés/reset/rechargés) et assemblage
SQLite à 8192 tokens.

`tests/live-execution.ts --retention` utilise GPT‑6 Luna medium réellement, une
base temporaire et des données fictives : deux compressions, rappel exact d’un
code/date/heure/montant, lecture de la référence originale avec sa date puis
brouillon externe cordial/professionnel, sans envoi. Dernier parcours : 15 appels.
Fenêtre QA 32768, capacité du catalogue 272000 ; historique de charge synthétique,
résumés et réponses LLM réels. Les originaux restent présents. Les rapports privés
sont sous docs/qualification/execution. Une première recherche s’arrêtait trop
tôt et citait seulement le résumé : correction du parcours serveur des pages et
exclusion du run courant, puis nouvelle qualification réussie. Une première
configuration QA n’avait pas réduit le catalogue et n’avait pas comprimé : exclue
des preuves. Ces essais ne garantissent pas toute nuance ni tous les modèles.

## État de validation courant

Interactions : 114 tests, sept E2E et 20 tests PostgreSQL avec dump/restauration.
Qualification réelle GPT-6.1 Sol medium : demande/formulaire/pause/rechargement/
réponse/reprise, deux appels ; [rapport](qualification/interactions/2026-11-17.json).
Unitaires : validation, lot suspendu sans rejeu, annulation, requêtes successives.
SQL : transaction de réponse annulée sans état partiel, concurrence, reprise du
claim après pause durable. UI : validation et champs personnalisés, un toucher,
rechargement, réponse idempotente, annulation et autre fil.


Correctif du flux ChatGPT : 110 tests et six parcours navigateur passent. Items
finalisés avec output terminal vide, ordre, indices invalides/dupliqués, absence
de confirmation, erreurs et arguments invalides couverts. Qualification réelle
GPT-6.1 Sol medium : deux appels, outil files.create puis tableau/SVG effectivement
affichés en navigateur sur données jetables ; [rapport](qualification/chatgpt-display/2026-11-17.json).


Depuis les affichages enrichis : 108 tests et six parcours navigateur avec
`tests/chat-content.e2e.ts`. Signatures/flux image, CSP de preview, erreurs/refus,
tableaux/cartes/copie, images locales et chargement externe manuel, fichiers et
rechargement. Aucun appel modèle réel dans ces tests.


La revue du 17 novembre 2026 a relancé typage/106 tests, les deux démos simulées
et 19 tests PostgreSQL avec CLI/dump/restauration. Les cinq parcours navigateur
ont passé sur le dernier changement applicatif ec5794c ; aucune inférence
nouvelle pendant la revue. [STATUS.md](STATUS.md) centralise les preuves réelles
et leurs limites ; les comptes de la revue sont datés et distincts de cette extension.

## Depuis le navigateur

L’[atelier privé](https://heart.natio.re) permet d’exécuter les essais et les
suites locales. Aucun compte réel n’est nécessaire pour la simulation. Chaque
essai utilise un espace temporaire neuf ; les données PostgreSQL existantes
restent indépendantes. [WEB.md](WEB.md) décrit l’accès, les limites et le retour
de connexion ChatGPT sans tunnel SSH.

## Tests réels et ChatGPT Pro

Il faut distinguer trois parcours :

1. **Simulations automatiques** : restent reproductibles et sans coût, même après
   ajout de nouveaux fournisseurs.
2. **API classique** : le module `ai-sdk` actuel utilise une clé API. Certains
   abonnements Pro éligibles permettent de réclamer des crédits API, à activer
   en liant une organisation API dont on est propriétaire. Leur montant et leur
   activation ne sont pas vérifiés pour ce compte. Ce sont des crédits limités,
   pas un accès API illimité ; des crédits achetés peuvent prendre le relais.
3. **Usage direct du forfait** : l’intégration officielle Sign in with ChatGPT
   propose OAuth et l’usage du forfait pour les applications éligibles. Elle
   permet de conserver notre moteur sans embarquer le harness Codex. Ce module
   est implémenté dans `modules/models/chatgpt` et qualifié en simulation.

Pour cette dernière voie, [CHATGPT.md](CHATGPT.md) donne les commandes de
connexion, découverte de modèles et test réel. Le module utilise le même
`ModelProvider`, une connexion navigateur, un identifiant d’installation stable
et un stockage protégé hors sessions/mémoire. Il ne réutilise aucun jeton d’un
autre Nora/Codex. Le core garde l’exécution des outils et les permissions ;
aucun basculement automatique sur une API payante.

La préversion impose notamment `stream: true`, `store: false`, un historique
explicite et des outils function/custom regroupés ; elle refuse
`max_output_tokens`. Le module API actuel ne peut donc pas être converti en
module abonnement en remplaçant simplement sa clé. Le module ChatGPT attend
`response.completed` et traite les fins de flux et limites de forfait comme
des résultats distincts.

Sur une VM, OpenAI documente une connexion locale puis le transfert sécurisé
des credentials, en conservant l’identifiant propre à la VM. Une URL de callback
`127.0.0.1` ouverte dans le navigateur de l’utilisateur ne rejoint pas ce serveur.
L’éligibilité de l’application et le consentement doivent être vérifiés avant
de déclarer toute l’intégration opérationnelle. Connexion du compte et catalogue
réel sont vérifiés. Les tests automatiques d’inférence restent simulés ;
un parcours GPT-6.1-Sol avec outil a aussi été qualifié manuellement contre
le compte connecté et depuis le navigateur HTTPS.

Sources officielles consultées le 13 novembre 2026 :
[Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source),
[limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
[VM auto-hébergée](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms),
[crédits API des abonnements](https://developers.openai.com/api/docs/guides/chatgpt-api-credits).

## Conversations et contexte

`tests/conversations.test.ts` utilise un catalogue simulé et un journal dans un
répertoire temporaire ; aucune base réelle ou clé LLM. Il vérifie isolation,
reprise applicative, changement de cerveau et refus d’envoi concurrent par fil.
`tests/context.test.ts` force une petite fenêtre : compression en morceaux,
relecture du checkpoint par une nouvelle instance, préservation des décisions
simulées et absence de réexécution d’outil. Une sauvegarde refusée n’active aucun
nouveau segment. Le comptage reste estimé et la qualité d’un vrai résumé n’est
pas démontrée par ces fournisseurs simulés.

La suite PostgreSQL qualifie aussi le catalogue, le claim exclusif et le type
checkpoint. Le dump/restauration compare maintenant le catalogue en plus du
journal, de la mémoire et de l’identité. Le navigateur teste création, envoi,
rechargement et changement de fil en utilisant le même serveur HTTP et moteur.

## Mémoire structurée

`structured-memory.test.ts` vérifie portées, provenance, versions, conflits et
oubli/restauration, ainsi que les outils sans stockage SQL.
`context-structured-memory.test.ts` vérifie référence longue sans troncature,
absence de fuite entre projets et actualisation après correction/oubli.
La suite SQL teste aussi une montée de v2 peuplée vers v3, une course d’UPDATE
et la déduplication par portée. Le dump/restauration compare projets/révisions.
Le parcours Chromium couvre ajout, correction, rechargement, oubli, restauration
et quatre versions conservées, en plus des conversations et du catalogue.

## Aperçus et ressources visuelles

Les suites suivantes conservent les vérifications des expérimentations visuelles
isolées. Elles ne signifient pas que ces animations sont actives dans le produit :
le setup et le chat utilisent le pack Nora statique.

### Pack avatar

`pnpm test:avatars` vérifie le pack versionné et son lecteur isolé. Les WebP sont
contrôlés par leurs chunks et décodés dans Chromium pour observer des frames
différentes, avec alpha. L’aperçu HTTP utilise un laboratoire temporaire sans
modèle réel ; il teste tailles, transitions, accessibilité et fallback. Aucun
appel de génération vidéo ni accès à la base du propriétaire. Voir [AVATARS.md](AVATARS.md).

La suite avatars couvre désormais les trois identités. Les deux nouvelles
sources doivent déclarer une illustration originale et un rig, sans reprendre
les vidéos Nora ; leurs portraits sont décodés et comparés sur des frames distinctes.

### Essais vidéo V2

`avatar-video-pilots.test.ts` lit les résultats existants : modèle réel, statut
completed, coût et hash du MP4. Aucun appel payant dans les tests. L’E2E couvre
l’aperçu mobile et les plages de lecture MP4. Un test technique réussi ne valide
pas le rendu ni les mouvements ; les rigs V1 ont précisément été rejetés malgré
leur validité technique. Voir [AVATAR-VIDEO-PILOTS.md](AVATAR-VIDEO-PILOTS.md).

### Portraits

`pnpm check` vérifie SHA-256, trois tailles et provenance des états par version.
La V5 impose de nouvelles sources distinctes pour travail et attente des deux
robots ; les attentes ne peuvent pas reprendre le repos. `pnpm test:avatars`
décode les animations et vérifie aussi que le bas des deux portraits de travail
s’anime (zone des mains/clavier), au lieu de n’animer que les yeux. Les contrôles
couvrent transparence, flottement de bulle, petites tailles, pause et réduction
des mouvements. Les tests ne soumettent aucune génération payante. La revue
visuelle des planches de contact et des animations reste nécessaire, notamment
pour la géométrie des têtes, les gestes et les raccords de boucle.

## Interface et setup

`pnpm check` couvre validation/CAS du profil, identité et personnalité transmises
à des cerveaux simulés, avec règles d’outils conservées. `pnpm test:web:e2e`
parcourt les cinq étapes actives (numérotation historique conservée), la reprise après rechargement et depuis un autre
contexte navigateur, les conflits et CSRF, le choix de cerveau, les appels API,
les conversations et les versions mémoire. Les vues sont contrôlées sur
320/390/820/1440 px. `pnpm test:postgres` inclut migration 004 et réouverture
du profil avec identité d’instance inchangée, plus le dump/restauration existant.
Les captures de revue n’utilisent que des données temporaires fictives.

## Chat — design Nora

`pnpm test:web:e2e` exécute aussi `tests/chat.e2e.ts` : historique rempli,
Markdown et contenus hostiles, tables/code sans débordement, scroller unique,
clavier simulé, position de lecture et brouillon conservés. Aucun réseau externe
ni appel LLM réel. Les dimensions incluent le paysage et une hauteur visuelle
de 360 px ; un test matériel reste utile pour les claviers iOS/Android.

Le design Nora utilise des tiroirs de navigation/conversations sur toutes les
tailles. Le parcours chat vérifie ouverture et fermeture des tiroirs, Échap,
retour du focus à 320/820/1440 px, puis navigation vers Mémoire. Le parcours de
gestion crée et sélectionne les fils via le tiroir et couvre tous les écrans.
Les captures actuelles sont dans `docs/design/nora-design`, avec données
jetables et fournisseur simulé. Aucune certification de clavier matériel.

Le parcours chat commence désormais par la page publique : 320/390/820/1440 px
et paysage 740 × 390, chargement du logo, absence de débordement des champs,
afficher/masquer le faux token, erreur puis connexion. `HARNESS_LOGIN_SCREENSHOTS`
permet d’exporter des captures de cette page sans aucun token réel.

## Éditeurs et retours d’état

Le parcours `tests/web.e2e.ts` ouvre les overlays de création et de correction.
Un POST projet est retenu par une barrière puis refusé : attente visible dans
la couche active, champs/boutons désactivés, Échap protégé, second submit sans
second POST, saisie conservée après refus et nouvel essai réussi. Géométries
320/390/820/1440 et paysage. Un conflit mémoire simulé conserve le texte corrigé ;
annuler l’apparence restaure le thème et le focus. Export optionnel de captures
fictives avec `HARNESS_EDITOR_SCREENSHOTS`. Aucun compte réel ni inférence.
Le même test réduit aussi le viewport visuel de l’éditeur mémoire à 360 px avec
un décalage de 22 px : le dialogue reste visible et son erreur ne recouvre pas
le bouton de sauvegarde. Ceci reste une simulation, pas un essai matériel.

## Cohérence des composants

Les choix du parcours navigateur passent par la feuille visible, pas par un
`selectOption` sur le backing select caché. La suite vérifie valeurs, annulation,
retour du focus au déclencheur, Fin au clavier, recherche dans 12 modèles et
synchronisation du type de souvenir à l’ouverture de l’éditeur. Elle compare la
typographie des en-têtes et la position/taille des créations dans les barres de page entre
les pages et tailles 320/390/820/1440. Une feuille ouverte dans l’éditeur mémoire
reste dans le viewport visuel 360 px + décalage de 22 px. Aucun clavier matériel
ni fournisseur réel n’est qualifié par cette simulation.

Les barres sont comparées au bas de la navigation avant/après défilement sur
15 pages et quatre largeurs. Chaque SVG de titre est comparé à celui du menu ;
les créations restent dans la barre et font au moins 44 px. Le chat conserve
les tests de géométrie/clavier après déplacement de ses compteurs dans Contexte.

## Barre de chat Nora

`tests/chat-tools.e2e.ts` couvre le gestionnaire de prompts (création, insertion,
édition/version, suppression, rechargement), upload réel et aperçu UTF-8,
transmission au fournisseur simulé sans base64 dans le journal, accès refusé sans
session, changement de fil pendant réponse, brouillons et arrêt effectif. Inclus
dans `pnpm test:web:e2e`. Les tests unitaires vérifient aussi l’annulation d’un
lot d’outils sans appels restants rejoués. Les tests des adaptateurs vérifient les
formats image/PDF/texte, sans prétendre qualifier une inférence fournisseur réelle.
Les 14 tests PostgreSQL et le dump/restauration incluent les nouvelles tables.

## Dates et activité de réponse

68 tests unitaires/contrats, dont signaux ChatGPT SSE dédupliqués sans texte
interne, état de run isolé puis effacé après clôture. Le parcours chat navigateur
couvre deux dates autour de minuit (fuseau Indian/Reunion), dates visibles dans
les bulles, panneau d’analyse mis à jour sans nouvel événement de message,
durée et brouillon préservé pendant une réponse ralentie. Les tests PostgreSQL
précédents restent inchangés : aucune migration dans ce chantier.

## OpenRouter : transport, catalogue et essais réels

La suite courante `pnpm check` compte 87 tests. Elle vérifie notamment Chat
Completions simulé, garde :free/prix nul, prix maximal explicite et absence de
repli, persistance privée de clé sans écraser OpenAI, erreurs bornées sans
exception fournisseur brute. Les codes de réponse vide et outil invalide sont
couverts. Le test mémoire vérifie qu’un UUID connu ne permet pas de lire un
souvenir oublié via `memory.get`, tandis que l’administration peut le restaurer.

Le catalogue teste modèles payants/gratuits/sans outils, prix réellement définis
(null exclu), capacités, doublons et erreur de transport assainie. Le parcours web
vérifie les fournisseurs séparément, recherche, filtres facultatifs et prix,
rafraîchissement manuel et après cinq minutes, conservation du choix, retrait
d’un modèle, erreur bloquante puis reprise. Ces transports simulés ne constituent
pas une validation d’inférence réelle.

`pnpm qualify:openrouter --live` est distinct de la suite simulée : véritable
modèle, outils, résumés et PostgreSQL isolé sur `nora-tests`. Le runner gratuit
est le défaut ; le mode payant requiert un identifiant explicite et un plafond
financier. Limite par défaut de 14 appels, configurable jusqu’à 24 pour couvrir
les tours d’outils variables, toujours soumise au plafond de coût avant requête.
Le scénario `memory` isole rappel, correction et oubli dans de nouveaux fils ;
le scénario `full` inclut aussi continuité, compression réelle et réouverture.
Un arrêt sur limite d’appels reste un échec du parcours complet, jamais une
preuve de panne du fournisseur ou d’échec de l’oubli.

Résultats, rapports et limites de qualification : [OPENROUTER.md](OPENROUTER.md).

## CRUD et explorateur fichiers

`tests/workspace.test.ts` couvre CRUD, révisions périmées, destinations existantes,
isolation et filtrage des permissions, liens/traversées, binaire/fichiers supérieurs à 1 Mio, pagination et import interrompu atomique, et
absence d’inférence/contenu privé dans l’audit des éditions manuelles.
`tests/workspace.e2e.ts`, inclus dans `pnpm test:web:e2e`, utilise HTTP et Engine
réels : création de dossier/fichier, édition, conflit avec brouillon conservé,
téléchargement, déplacement, suppression, droits persistés et géométries
320/390/820/1440 px, hauteur réduite.

19 tests PostgreSQL sur une base jetable nora-tests, Node 24, PostgreSQL 18 :
permissions initiales/actualisées/rechargées, refus pendant un claim actif et
actions du propriétaire avec claim partagé et journal séparé. Dump/restauration
avec digests des conversations (permissions incluses) et événements identiques.
Migration 006 sur Heart après dump privé : digests des données préexistantes
inchangés, droits initiaux lecture seule. Vérification HTTPS GET uniquement après
redémarrage, sans mutation API ni appel LLM. Les workspaces disque ne sont pas
inclus dans les dumps PostgreSQL.

Le parcours explorateur importe aussi un binaire de plus de 2 Mio, vérifie son
téléchargement à l’octet près, le déplace puis le supprime. Les tests de lecture
par blocs reconstituent un texte UTF-8 multioctet sans perte. Ces blocs et pages
sont configurables, sans plafond total de fichiers.

## Développement et exécution

Les tests terminal requièrent Linux avec bubblewrap et ripgrep disponibles ;
configurer le profil AppArmor ciblé si l’OS restreint les user namespaces.
`pnpm test:execution` vérifie isolation des fichiers/env et réseau, stdin,
annulation et sortie intégrale paginée, boucle de codage, AGENTS.md et patch
unique/révisé, ainsi qu’un budget explicite 0 dépassant huit tours d’outils.
Les scénarios sandbox sont aussi exécutés sur nora-tests avec Node 24 et les
contrôles de ressources du serveur, puis avec les restrictions du compte Heart.

Le parcours navigateur inclut le terminal réel, la sortie et son statut, stdin,
arrêt d’une commande et sélection de mode conservée après rechargement.
19 tests PostgreSQL qualifient la migration 007 et les politiques persistées.
`pnpm qualify:development` sans --live ne lance aucune inférence ; son mode live
utilise le DeepSeek explicitement choisi et des plafonds financiers/de requêtes
propres au test. Rapport et portée : [DEVELOPMENT.md](DEVELOPMENT.md).

YOLO : `pnpm test:host` est opt-in, root et systemd Linux requis, à exécuter sur
nora-tests. Il ne fait pas partie des tests unitaires ordinaires. Tous les fichiers
et commandes de qualification sont temporaires. Le parcours UI substitue le worker
pour éviter tout accès root depuis les tests navigateur ; le test d’intégration
vérifie séparément le transport Unix et l’exécution host véritables.


## Régression context.usage / PostgreSQL

Le test `upgrade from v8 preserves history and journals context usage across model changes`
construit une base jetable à partir des huit migrations historiques, peuple le
journal et reproduit le refus de `context.usage`. Après migration 009 concurrente,
il compare identité et événements existants et exécute Engine + BoundedContext
avec deux fournisseurs simulés successifs. Il vérifie deux appels modèle, deux
mesures persistées, deux runs terminés et aucun échec. Ce test appartient à
`pnpm test:postgres` (19 tests) ; `pnpm check` seul ne teste pas les CHECK SQL.

Qualification formulaires API du 17 novembre : Gemma/OpenRouter, navigateur et
HTTP/core réels, deux appels réussis ; voir
[le rapport et les limites](qualification/interactions/2026-11-17-openrouter.json).
Tests simulés additionnels : absence de plafond API implicite, troncature avec
outil complet tout de même refusée, codes HTTP sans secrets ni retries, et échec
après réponse au formulaire conservée au rechargement. Ces tests ne qualifient pas
tous les modèles ni toutes les API directes.

## Icônes, emojis et typographie étendue

`tests/chat-typography.e2e.ts` est inclus dans les huit E2E web. Il qualifie
41 icônes, huit groupes de contenu, conservation Unicode HTTP/stockage/copie,
16 variantes thème/largeur, deux tailles de texte à 200 %, deux viewports compacts,
RTL, réponses de formulaire de 200 points de code et refus de 201 sans inférence.
[Captures et portée précise](design/chat-typography/README.md).
Contrôle Chromium Linux ; pas de validation physique Safari/iOS ou Android ni
qualification d’un fournisseur LLM dans ce parcours déterministe.

## Formules mathématiques

`tests/chat-math.e2e.ts`, neuvième parcours web, traverse fournisseur simulé,
HTTP, stockage et navigateur. Vérifie les vraies structures MathML, les quatre
délimiteurs, matrices/alignements, tableaux/agrandissement, 8 variantes thème/largeur,
scroll d’équation, code/prix, source copiée, erreurs, chargement paresseux local,
échec de chargement et absence de requête externe/violation CSP. Aucun appel LLM
réel : [rapport, captures et limites](design/chat-math/README.md).

## Reprise après choix et entretien frontend

La suite courante comporte 120 tests, dix E2E et 21 tests SQL. La reprise interactive
couvre désormais le choix B avant toute action après le formulaire, l’invalidation
de A préparé, les propositions fraîches et les droits courants. Une qualification
réelle ChatGPT à trois appels crée B sans A :
[rapport](qualification/interactions/2026-11-17-replan.json).

web-client.test.ts vérifie le client extrait : partage de GET, réponses indépendantes,
invalidation lors d’écritures, absence de regroupement des mutations, CSRF/binaire,
expiration/erreur réseau/annulation. web-performance.e2e.ts exerce les vrais
contrôleurs et HTTP en navigateur, avec mesures sans seuil de temps fragile.
[Preuve et limites](qualification/ui-cleanup/2026-11-17.json).
`pnpm check` inclut TS backend, checkJs/JSDoc ciblé, Prettier ciblé et tests ; le
reste du JavaScript navigateur n’est pas encore intégralement typé.

## Conversations et travaux simultanés

`tests/concurrent-work.e2e.ts` vérifie en Chromium et HTTP réels, sur données
jetables et fournisseur simulé : deux runs simultanés, rechargement sans arrêt,
annulation ciblée, création d’un autre fil pendant le travail, points d’avancement
publics, quatre reçus mémoire sans faux succès et ouverture de la version courante.
Le catalogue SQL et la persistance run.progress sont contrôlés séparément dans
`tests/postgres.integration.ts`. L’essai ChatGPT réel est documenté dans
[qualification/concurrent-work](qualification/concurrent-work/) ; ses quatre appels
réussis ne remplacent ni ces tests UI ni une qualification de tous les fournisseurs.

## Recherche et MCP

`tests/mcp.test.ts` utilise le SDK et un véritable serveur HTTP jetable : argument
invalide, erreur distante, headers/masquage, redirection refusée, catalogue modifié,
rôles réseau/YOLO, révocation et deux lectures dont une annulée. `tests/mcp.e2e.ts`
vérifie l’éditeur, découverte, approbation, CSRF, refus sans réseau et un appel réel
au serveur jetable depuis le chat ; modèle simulé. Les métadonnées et le dump de la
table sont testés dans PostgreSQL. [Recherche locale et ChatGPT réels](qualification/self-search/) sont
qualifiés séparément, pas implicitement par les mocks. Voir [MCP.md](MCP.md).

`tests/self-search.test.ts` couvre l’absence de coupe implicite des résultats/pages,
la pagination, les incidents de moteurs, les IP privées/redirections et le serveur
MCP local HTTP avec backend jetable. Les requêtes réelles SearXNG sont documentées
séparément dans WEB-SEARCH.md et qualification/self-search.

## Réconciliation et bundle chiffré

Voir [RECOVERY.md](RECOVERY.md) et [checks.json](qualification/recovery/checks.json).
138 tests de `pnpm check`, démo SDK, 27 tests PostgreSQL sur nora-tests, 12 parcours
Chromium exécutés séquentiellement sur nora-tests et le parcours explorateur/terminal
avec Bubblewrap sur fixture locale : 13 parcours validés au total. Le test SIGKILL
interrompt réellement une action après écriture dans un fichier temporaire.
`pnpm test:backup` et `tests/qualify-backup.py` vérifient le chiffrement, les refus
d’extraction et une restauration PostgreSQL + fichiers + configuration synthétique.

Le conteneur de test garde 1,5 CPU, 2 304 Mio RAM, 256 tâches, rootfs en lecture seule
et données temporaires en tmpfs ; Chromium nécessite ici un /tmp de 1 Gio pour
les navigations répétées. Les essais initiaux avec /tmp de 256/512 Mio renvoyaient
ERR_INSUFFICIENT_RESOURCES, sans OOM ; pas une qualification fonctionnelle réussie.
Le parcours terminal utilise Bubblewrap installé, absent de l’image minimale distante.
Ces essais ne contactent aucun fournisseur LLM réel.

## Modules SQL interchangeables

`tests/sql-storage.conformance.ts` est la même suite exécutée avec PostgreSQL et
SQLite : huit groupes de comportements métier, pas une duplication des requêtes.
`pnpm check` inclut 151 tests, dont les douze comptés pour SQLite (parent/sous-tests
de conformité, migrations, SIGKILL/snapshot et scripts opérateur natifs). La suite
PostgreSQL passe à 36 tests, sur nora-tests. Deux tests de bundle chiffré, payload
SQLite réellement rouvert. [Preuves](qualification/sql-storage/checks.json).

`tests/sqlite-web.e2e.ts` emploie le véritable assemblage web, le driver SQLite et
le moteur de démo : outil fichiers, souvenir, redémarrage serveur, mêmes événements
et fichier. Ce nouveau parcours est validé sur nora-tests en Chromium ; les anciens
parcours ne sont pas présentés comme tous relancés. Aucun test de ce lot ne constitue
une qualification d’un fournisseur réel ou une migration des données du propriétaire.

## Autorisations et exécution — 20 novembre 2026

237 tests et démo locale passent. Trois parcours navigateur : explorateur et
changement de mode, instructions, assemblage SQLite à 8 192 tokens. Les premiers
ajouts de consignes dépassaient cette petite fenêtre ; descriptions condensées
sans augmenter sa taille ni retirer d’outils.

Worker root réel sur nora-tests : socket privé, lecture/édition hors fil, mode et
propriétaire Unix conservés, liens, binaire, révisions, stdin/réseau, annulation et
arrêt des descendants. `host-files.test.ts` vérifie le transfert interrompu sans
écriture partielle. `tools.test.ts` couvre aussi les références courtes : périmètre
du chemin, expiration, fichier réellement modifié, compatibilité SHA-256 canonique.

`tests/live-execution.ts` est opt-in, GPT‑6 Luna medium, assemblage web et données
jetables : protégé → YOLO → lecture seule ; fichier hors fil modifié et vérifié au
terminal, API explorateur et refus après révocation. Dernier parcours : 11 appels,
aucun formulaire ni terminal.read inutile, aucun repli API, aucune écriture métier.
Un essai a été interrompu en attente fournisseur ; un autre a identifié une mauvaise
copie du SHA-256 par le modèle. Les références courtes ont ensuite passé le parcours
complet. La limite de 180 s par appel concerne seulement ce protocole QA, pas le
runtime produit. Les preuves détaillées restent privées sous docs/qualification.

Après déploiement : contrôle réel sous l’identité personal-harness, fichier QA root
hors workspace et illisible directement, lecture/édition via socket, référence courte
et commande root avec sortie inline. Données QA retirées. Web/worker actifs, HTTPS
200 et healthz interne sain après sauvegarde chiffrée et redémarrage coordonné.

## Confiance, inspection et sorties partielles — 20 novembre 2026

238 tests, démo locale et trois parcours Chromium passent : instructions, revue
mémoire, assemblage SQLite à 8 192 tokens. Le changement de cerveau vérifie aussi
les métadonnées fournies au modèle courant après réouverture. La pagination réelle
de 150 Ko est reconstruite par les curseurs sans perdre le verdict final. Skill
code-review validé avec quick_validate ; déclencheur précisé pour éviter les
explications simples et commandes ordinaires. Aucun droit de skill supplémentaire.

GPT‑6 Luna medium : 22 appels en deux parcours, données et SQLite temporaires,
profil créatif/proactif. Ancien déni d’accès dans l’historique, puis inspection
réelle du moteur et de l’assemblage avec files.read ; réponse complète fondée sur
le code. Réponse exacte sur SQLite et le cerveau actif. Second parcours : sortie
au-delà de 64 Ko, terminal.read au bon offset, verdict final reçu ; modification
de calc.mjs via fichiers et test.mjs exécuté (exit 0, tests-ok), sans formulaire.

Premiers essais non réussis : lecture seulement documentaire, confusion de runtime,
réponse fournisseur incompatible et curseur de suite ignoré après un long corps.
Métadonnées placées avant le contenu et portée du skill corrigées ; dernier parcours
pagination/correction passe. Le contrôle QA du nom de modèle exigeait initialement
son identifiant technique alors que la réponse utilisait le bon nom affiché :
normalisation corrigée. Rapports opérateur privés, aucune écriture métier ni repli
API. Cette qualification ne représente pas tous les modèles ou toutes les pannes.

Déploiement du correctif de confiance après sauvegarde chiffrée et redémarrage web.
Vérification HTTPS authentifiée : catalogue de treize blocs, nouveau défaut work
et déclencheur du skill visibles, sans changer les overrides du propriétaire.
Santé interne saine. Le transport diagnostic provisoire de qualification a été
retiré du driver de test ; aucun changement du transport produit, aucun log brut
de réponse fournisseur ajouté au runtime.

## Mission et autonomie — 21 novembre 2026

238 tests, démo et deux parcours navigateur ciblés : modification/reset des consignes
et assemblage SQLite à 8 192 tokens. Première passe trop volumineuse : texte des
droits condensé, sans changer les règles ni augmenter la fenêtre.
GPT‑6 Luna medium réel, fixtures jetables : 12 appels ; sortie partielle poursuivie
au bon offset, bug de sum corrigé via files.replace, test node réussi (tests-ok),
aucun formulaire ni repli API. Le nouveau défaut précise le bénéfice utilisateur
et exclut les recherches CGU/CGV/analyses juridiques non demandées. Cette dernière
consigne est fournie au modèle ; le parcours ne prétend pas valider toutes les
décisions juridiques possibles d’un LLM.

Consignes d’autonomie déployées après sauvegarde chiffrée et redémarrage web.
Catalogue HTTPS authentifié : nouveau défaut work actif sans override, treize blocs,
mission/bénéfice utilisateur et absence d’analyses juridiques non demandées vérifiés.
Santé interne saine. Aucun changement des permissions ou données métier.

## Mail et images des outils — 22 novembre 2026

`pnpm check` : 275 tests ; `pnpm demo:sdk` : succès ; suite navigateur : 28 parcours
réussis. `mail-files.test.ts` vérifie le transfert HTTP binaire, les permissions
et les conflits de fichiers. `tool-images.test.ts` couvre un vrai serveur MCP,
structuredContent + image, un seul appel, l’absence de pixels dans le journal
et l’ordre des résultats par lot pour AI SDK et ChatGPT. Les cerveaux de ces
tests sont simulés. Qualification fournisseur supplémentaire réelle : GPT‑6 Luna,
effort low, a lu 4729 sur fond bleu via un résultat d’outil visuel synthétique.
Aucun mail personnel envoyé. Le service Mail a ses preuves SQL/IMAPS/SMTPS/OpenBao
et navigateur dans le dépôt nora-mcps ; Gmail natif réel reste à qualifier.

Boucle moteur réelle supplémentaire : GPT‑6 Luna a appelé une seule fois
`mail_accounts` sur le MCP de production et confirmé zéro boîte raccordée.
Aucune inférence simulée pour ce contrôle ; aucun envoi ni lecture de mail personnel.

## Cohérence des capacités et préparation Mail

278 tests (`pnpm check`) et démo SDK réussis. Les nouveaux tests vérifient que
les libellés ne modifient ni identité, callback, permission, snapshot approuvé ni
contrôle de catalogue. Le test MCP navigateur couvre aussi deux groupes repliés
et quatre largeurs 320/390/820/1440 px. Skills et fichiers/terminal sans fil restent
fonctionnels dans les parcours ciblés ; dernière suite complète : 28 parcours.
Les cerveaux des régressions sont simulés, aucune inférence payante dans ce lot.

Mail : préparation testée sur PostgreSQL isolé, idempotence, isolation A/B et
refus d’exécuter sans credentials. La fixture de présentation du portail vérifie
les états À connecter, les champs préremplis, le lien privé de saisie Gmail et les
largeurs 320/390/768/1440 px ; elle ne qualifie aucun fournisseur. En production,
seuls les réglages/identités/signatures ont été préparés : pas d’accès IMAP/SMTP,
pas d’export de secret Natio Connect ni d’envoi. Quatre états `pending` confirmés
par le MCP réel depuis Heart.

La qualification a révélé une surcharge du petit contexte 8192 de la fixture
SQLite par la répétition des titres dans l’inventaire injecté. Suppression de ce
doublon, conservation des noms/descriptions et des titres dans le journal, puis
régression SQLite + pièces jointes/relance/arrêt réussie.

Vérification déployée : groupes Mémoire/Projets/Coffre-fort/Mail/Recherche web,
éditeur reprenant le même libellé, skill Revue de code disponible, quatre largeurs,
aucune erreur JavaScript. Aucune inférence ni émission d’e-mail dans ce contrôle.

## Connexions Mail personnelles — 23 novembre 2026

`pnpm check` : 278 tests réussis ; `pnpm demo:sdk` : succès simulé explicitement.
Qualification réelle via `ExternalTools.callApproved` et les 19 outils Mail déjà
approuvés : quatre comptes connectés, `mail_test`, dossiers, recherche d’un objet
aléatoire inexistant et une identité conservée par compte. Gmail OAuth natif
(client dédié, consentement réel, refresh token chiffré) ; OVH IMAPS/SMTPS pour les
trois autres comptes. Même UUID avant/après ; transfert V4 répété : reçu rejoué,
version inchangée, sans double configuration. Aucun mail envoyé ni contenu
personnel lu ; ces essais ne qualifient pas un envoi personnel de bout en bout.

## Premier envoi réel ChatGPT Luna — 23 novembre 2026

Sur demande explicite du propriétaire, via l’API web de Heart et une conversation
dédiée persistante : fournisseur ChatGPT abonnement, `gpt-6-luna`, effort low,
accès MCP réseau du fil, sans accès fichiers/terminal. Le modèle appelle
`mail_accounts`, `mail_identities`, `mail_draft_save`, `mail_send` ; les quatre
outils réussissent, tour terminé en cinq étapes, état SMTP `accepted`. Signature
conservée, un seul destinataire, une seule intention d’envoi. Réception vérifiée
par recherche du sujet unique dans le Gmail réel via les outils approuvés Heart :
un résultat, expéditeur @natio.re et destinataire attendus. Aucun renvoi.
Ce scénario utilise réellement le fournisseur et les deux fournisseurs mail ;
aucune simulation, aucune qualification implicite des réponses/PJ par cet essai.

## Consolidation de plusieurs frontières — 23 novembre 2026

- `pnpm check` : 287 tests ; `pnpm demo:sdk` : succès (fournisseur simulé).
- `pnpm test:postgres` : 42 tests, CLI, dump/restauration, identité et contenus
  comparés. Service jetable, 256 Mio, volume tmpfs, image déjà installée, nettoyé.
- `pnpm test:backup` : deux tests de chiffrement/restauration PostgreSQL-format
  synthétique et SQLite réel ; les tests ne lisent aucun credential de production.
- 28 parcours Chromium exécutés avec concurrence 1 ; backend HTTP réel local,
  états jetables et fournisseurs simulés. Reprise du test de performances après
  le dernier changement : dix mises à jour de travail avec état visible identique,
  zéro mutation DOM, nœuds conservés. Les changements de phase ne reconstruisent
  plus les cartes ; aucun chiffre de latence globale ou appareil physique déduit.
- Tests ajoutés : erreur d’initialisation/fermeture SQL, fermeture simultanée,
  anciens résultats/session/CSRF, déconnexion sans polling résiduel, JSON HTTP
  illisible sans rejeu d’écriture, interruption persistée/concurrente, unité
  systemd survivante ou état inconnu, nettoyage des staging files, annulation
  avant journalisation et points d’entrée/cycles des modules.

Deux snapshots chiffrés code/SQL/configurations avant/après modifications. Le
second inclut aussi OAuth/credentials privés et a été déchiffré en dossier
jetable avec vérification des empreintes et du format pg_dump. Aucune restauration
sur la production. La sauvegarde complète des workspaces reste différée pendant
une commande hôte active : aucun snapshot cohérent de ces fichiers n’est prétendu.
Le worker hôte est préservé ; nouvelle supervision validée sur fixtures, activation
reportée. Web redémarré à zéro mutation active et santé vérifiée, commande hôte
restée active. Aucun autre runtime Nora modifié, aucun nouvel envoi Mail.

Après mise à jour web : `gpt-6-luna` réel, ChatGPT abonnement, effort low,
conversation dédiée. Un appel `mail_accounts`, quatre comptes connectés, zéro
erreur d’outil, tour terminé. Aucun brouillon, envoi ou modification de mémoire
demandé dans ce scénario de lecture. Nouveau contrôleur systemd également
exécuté en lecture seule sur l’unité réellement active : état running correct,
journal inchangé et aucun processus arrêté. Cela qualifie la lecture native,
pas un redémarrage du worker avec cette commande encore en cours.

## Activation terminal et sauvegarde complète — 23 novembre 2026

Sur instruction explicite du propriétaire : arrêt du veilleur crypto depuis
l’API de conversation Heart ; état interrupted et unité systemd inactive.
Redémarrage du worker hôte puis parcours réel via socket : Node 24 exécuté,
sortie relue, commande longue synthétique arrêtée avec unité inactive confirmée.
Journaux/fixtures de qualification retirés ; ancien watcher et ses données conservés
à l’arrêt. `pnpm check` : 287 tests ; démo SDK : succès.

La vérification de sauvegarde a détecté un helper installé antérieur au dépôt :
configuration MCP et racine projets absentes de son archive. Copie installée
alignée, backup forcé sous le verrou/maintenance habituels, puis déchiffrement,
empreintes et périmètres vérifiés. Le pg_dump réel a été restauré dans un conteneur
PostgreSQL jetable sans réseau, mémoire 256 Mio et données tmpfs ; identité et
compteurs événements/conversations/connexions identiques à la source au repos.
Conteneur et fichiers privés déchiffrés retirés. Aucun restore sur la production.

## Exécution indépendante de Heart — 23 novembre 2026

`pnpm check` : 287 tests et démo SDK ; `pnpm test:host` : deux intégrations natives
root/systemd (sans fournisseur LLM), `pnpm test:backup` : trois tests ; trois
parcours navigateur ciblés (workspace, racine projets, travaux simultanés).

Nouveau test natif : projet shell sur runtime système, annulation du signal du
modèle, vrai arrêt du processus worker, croissance continue du heartbeat, nouveau
worker, sorties retrouvées puis arrêt explicite. PartOf vide et aucun chemin
du code/Node embarqué de Heart dans son ExecStart. Mode stdin temporaire et ses
annulations testés séparément ; changement de permission conservant un programme
indépendant contrôlé dans les régressions.

Qualification de l’installation active : fixture Python stdlib hors code Heart,
arrêt complet web + worker, requête HTTP du projet réussie avec même PID,
redémarrage Heart, reprise du contrôle. Sauvegarde complète forcée pendant que
le projet répond : réussite, PID inchangé, manifeste externalExecution avec une
unité native active et projectFilesConsistency=live-copy. Arrêt explicite et
nettoyage de toutes les fixtures après preuve. Aucun redémarrage du veilleur
crypto, aucune migration des projets existants, aucun envoi de mail dans ce lot.
Une copie à chaud des fichiers n’est pas une qualification des backups métier
d’un service ; utiliser ses propres procédures cohérentes.

Le terminal manuel relaie interactive:true jusqu’au contrôleur hôte ; le choix
est explicite dans l’interface et stdin/EOF sont désactivés pour les commandes
indépendantes. Les libellés conservent YOLO/root. Régressions du terminal manuel,
des permissions et des trois parcours navigateur relancées après ce raccordement.

## Suivi hiérarchique — 23 novembre 2026

- `pnpm check` : 291 tests ; démo SDK sans appel réel : succès.
- Suite web complète : 29 parcours. Le nouveau parcours vérifie édition globale,
  sous-goal, task, clôture refusée, preuve, conflit conservant les champs,
  rafraîchissement préservant le formulaire, pagination de 54 éléments, absence
  de polling et affichage 320/390/768/1440 px. Backend de ce parcours simulé ;
  aucun appel modèle. Projets fonctionnels sans mémoire, y compris pendant sa panne.
- MCP : 107 contrôles avec SDK officiel/PostgreSQL réels. Cycle, parent étranger,
  fermeture prématurée, preuve absente/effacée, réouverture, compteurs globaux,
  concurrence clôture/réouverture, isolation des comptes, pagination et dump/restore.
  Bases, rôles et tokens jetables supprimés ; migrations idempotentes.
- `tests/live-project-tracking.ts --live` : vrai ChatGPT `gpt-6-luna`, medium,
  16 appels de fournisseur. MCP de même code en base/tenant synthétiques distincts,
  accès par tunnel SSH local et connexion approuvée. Le modèle a créé deux goals
  imbriqués et une task, produit un fichier puis renseigné critères/résultats et
  statuts terminés. Le test a relu le fichier et l’état distant ; projet global
  non clôturé prématurément. Aucun email/mémoire/projet du propriétaire touché.

Le parcours SQLite de persistance utilisait 8 192 tokens, désormais insuffisants
pour le catalogue complet (échec reproduit avec le code antérieur à ce lot).
Sa fixture passe à 32 768 ; les tests de petits contextes restent distincts et
aucune capacité d’un vrai modèle n’est augmentée. Une course du test de relance
chat a disparu en reprise isolée puis dans la suite complète, sans timeout relevé.

Preuves : [navigateur](qualification/project-tracking/browser.json),
[Luna réel](qualification/project-tracking/luna.json) et captures au même endroit.
La présence de texte dans evidence n’est pas une garantie universelle de sa
véracité ; les contrôles SQL protègent la structure et les transitions.

Contrôle de production en lecture seule : vraie fiche MCP sur heart.natio.re,
objectif global et trois compteurs, aucune erreur JS et aucun débordement aux
quatre largeurs. Aucun appel LLM ni modification de projet dans ce contrôle.

Sauvegarde complète Heart de `a3594cb` : déchiffrement/empreintes et récupération
des fichiers/configurations, pg_dump restauré dans PostgreSQL sans réseau
(256 Mio), identité et compteurs identiques. Conteneur/données privées retirés.
Backup MCP après migration copié hors serveur, restauration SQL/SCRAM/OpenBao
vérifiée dans un conteneur sans réseau retiré ensuite. Aucun restore en production.
