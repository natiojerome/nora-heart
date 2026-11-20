# Connexion par abonnement ChatGPT

Le module `modules/models/chatgpt` implémente `ModelProvider` via Sign in with
ChatGPT et les requêtes Responses éligibles à l’usage du forfait. Il n’embarque
pas Codex et ne lit aucun credential des autres Nora. Le moteur conserve
l’historique, les permissions et l’exécution des outils.

Le module `ai-sdk` et ses clés API OpenAI/Anthropic restent disponibles avec
leur configuration actuelle. Les deux modes sont sélectionnés explicitement ;
un échec de connexion ou une limite du forfait ne déclenche aucun repli API.

## État de qualification

OAuth et identité signée, renouvellement, fichiers protégés, annulation,
révocation, découverte des modèles et flux d’inférence sont testés avec des
services simulés. `pnpm demo:chatgpt` exécute le parcours complet avec un outil,
sans compte réel ni réseau. Les réponses réussies API OpenAI/Anthropic et le
passage de ChatGPT vers AI SDK avec historique ont aussi leurs tests.

Le compte réel est désormais connecté et son catalogue est accessible dans
l’atelier (8 modèles visibles vérifiés). Un parcours d’inférence réel court avec
GPT-6.1-Sol a réussi depuis le navigateur : appel de `files.list`, résultat puis
réponse finale. Cela ne qualifie pas tous les modèles ni tous les outils.

## Depuis l’interface web

L’[atelier privé](https://heart.natio.re) permet désormais de connecter ChatGPT,
choisir un modèle et lancer un essai sans terminal. Si le retour OpenAI sur
loopback échoue, l’atelier accepte l’adresse de retour complète et la remet au
listener local. Voir [WEB.md](WEB.md). Les commandes ci-dessous restent
disponibles pour le développement et l’administration.

## Première connexion

Sous Node 24, choisir un dossier **privé dédié hors du dépôt**, en utilisant
le même chemin pour toutes les commandes de cette installation :

```sh
export HARNESS_CHATGPT_AUTH_DIR="$HOME/.config/personal-harness/chatgpt"
pnpm chatgpt --action login
```

La commande lit `harness.chatgpt.config.json`. Elle ne contacte pas PostgreSQL.
Elle affiche un lien local `http://127.0.0.1:1455/connect/…` : ouvrir ce lien et cliquer
sur **Continue with ChatGPT**, puis autoriser l’usage du forfait dans OpenAI.
La tentative expire après cinq minutes. Ctrl+C ferme le listener et libère
le verrou. Une nouvelle tentative conserve l’identifiant d’installation.

Pour un autre fichier, ajouter `--config chemin.json`. Un port occupé peut
être remplacé par `--port 1456` ; utiliser le même port dans le tunnel ci-dessous.
Ne pas exposer le listener publiquement : il écoute uniquement sur loopback.

### Depuis une machine distante

Le navigateur et la commande doivent pouvoir communiquer sur le port loopback.
Si la commande tourne sur le serveur et le navigateur sur ton ordinateur,
ouvrir d’abord ce tunnel **sur ton ordinateur**, en remplaçant la cible SSH :

```sh
ssh -N -L 1455:127.0.0.1:1455 utilisateur@serveur
```

Lancer ensuite `pnpm chatgpt --action login` sur le serveur et ouvrir le lien
local dans le navigateur de l’ordinateur. L’échange et les fichiers restent
sur le serveur. L’ID token retenu comme indice de reconnexion n’est jamais
affiché dans le terminal : seule la page loopback, sous un chemin aléatoire propre
à la tentative, redirige vers OpenAI. La racine du listener ne sert aucune page.

OpenAI documente aussi une connexion locale puis le transfert sécurisé de
credentials. Cette importation n’est pas automatisée ici. Ne pas copier les
credentials d’un autre client, ni les coller dans le chat.

## Choisir et tester un modèle

```sh
pnpm chatgpt --action status
pnpm chatgpt --action models
```

Le catalogue vient du compte connecté. Remplacer le placeholder `chatgpt.modelId`
dans `harness.chatgpt.config.json` par un identifiant retourné. Le projet
n’impose aucun modèle commercial et ne sélectionne pas silencieusement le premier.

```sh
pnpm chatgpt --action test
```

Cette dernière commande effectue une **inférence réelle** courte avec le forfait,
sans stockage de session ni outil. La réponse n’est acceptée qu’après l’événement
`response.completed`. Elle peut consommer l’usage du forfait ou les crédits
autorisés dans les réglages du compte. Gérer ces droits et limites dans
[ChatGPT → Usage](https://chatgpt.com/settings/usage).

Pour tester ensuite le moteur avec ses outils et le stockage PostgreSQL dédié :

```sh
pnpm db:migrate --config harness.chatgpt.config.json
pnpm demo --config harness.chatgpt.config.json --session chatgpt-first-test
```

Ces commandes nécessitent `HARNESS_DATABASE_URL`. La CLI permet uniquement les
outils de lecture. Pour revenir aux clés API, sélectionner une configuration
`modules.model: "ai-sdk"` décrite dans [MODELS.md](MODELS.md) ; aucun changement
de code, de données ou de credentials ChatGPT n’est nécessaire.

## Profils et déconnexion

`chatgpt.profile` choisit une connexion : `default`, `personnel`, etc. Pour
ajouter un compte ou workspace, choisir un autre profil dans sa configuration
et lancer login. Chaque profil conserve son client OAuth et son identité
vérifiée séparément ; le host ID reste commun à cette installation. Une
reconnexion du même profil refuse de remplacer son identité par une autre.

```sh
pnpm chatgpt --action logout
```

La commande tente de révoquer la session renouvelable et supprime les tokens
locaux du profil. Si la révocation distante n’est pas confirmée, elle l’indique :
déconnecter alors l’application dans les réglages ChatGPT. Les autres profils,
les clés API, les sessions et les souvenirs restent indépendants.

## Sécurité et limites

- OAuth code + PKCE S256, état et nonce aléatoires, signature JWT vérifiée avec
  `jose` contre les JWKS OpenAI, issuer/audience/expiration/subject contrôlés.
  La permission explicite d’utiliser le forfait est vérifiée avant activation.
- Fichiers de credentials en `0600`, dossier en `0700`, appartenance à
  l’utilisateur et absence de liens de fichiers contrôlées, remplacement atomique
  et synchronisé. Les fichiers ne sont pas chiffrés au repos : protéger l’hôte
  et ses sauvegardes. Le répertoire est indépendant du stockage applicatif.
- Les refresh tokens tournants sont renouvelés sous verrou de fichier partagé
  entre processus. Un échec temporaire conserve les credentials ; un
  `invalid_grant` efface les tokens invalides et demande une reconnexion.
  Après un crash laissant un `.lock`, arrêter les processus concernés avant
  de supprimer uniquement ce verrou. Aucun vol de verrou automatique.
- Les réponses exigent `store: false`, `stream: true`, un historique explicite
  et des outils locaux regroupés sous un namespace. Ajv vérifie les arguments.
  Les alias de noms n’entrent pas dans le journal du harness.
- Le module ne transmet aucun champ `max_output_tokens`, refusé par cette
  préversion. Le délai configuré et la limite locale de flux de 8 Mio ne sont
  pas des plafonds de facturation. Une annulation ne garantit pas l’arrêt du
  calcul distant. Le moteur garde son budget d’étapes.
- Les deltas partiels ne déclenchent aucun outil. Une réponse incomplète,
  refusée ou interrompue échoue. Les codes connus de limite/éligibilité sont
  conservés sans détails de requête ; aucune relance ni substitution automatique.
- La route directe observée peut omettre l’en-tête Content-Type malgré un flux
  SSE valide. Son absence seule ne constitue pas un échec ; le flux doit toujours
  se terminer par response.completed. Un MIME explicitement incompatible reste
  refusé.
- Le contrat reste textuel, même si le transport HTTP est un flux SSE.
  Pas de streaming exposé au core, d’images, d’outils hébergés ou d’historique
  récupéré depuis ChatGPT. Chaque requête transmet son contexte au fournisseur.
- Les garanties sur les fichiers décrites ici sont qualifiées sous Linux.
  La qualification réelle reste limitée au parcours indiqué ci-dessus.

## Dépendances et sources

Le devkit `@siwc/local` décrit dans le cookbook n’était pas publié dans le
registre npm consulté. L’implémentation suit le protocole officiel avec `jose`
pour OIDC/JWT et `eventsource-parser` pour SSE ; tous deux sous licence MIT,
sans dépendance runtime transitive. Aucun code de harness ou du devkit n’a été
copié. Les types SDK ne sont pas imposés aux contrats du moteur.

Sources officielles consultées le 13 novembre 2026 :
[inscription et connexion](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[comptes et renouvellement](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
[modèles et inférence](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference),
[limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations),
[OIDC](https://developers.openai.com/siwc/website),
[VM](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).

## Effort de raisonnement

Réglages du fil → Modèle → Réglages du modèle. Les niveaux proposés et le défaut
viennent du catalogue du compte, non d’une liste partagée entre tous les modèles.
Une sélection explicite passe en reasoning.effort ; Par défaut omet le champ.
Le niveau est validé par app puis conservé dans ModelSelection au prochain envoi.
La connexion ChatGPT et les clés API restent des voies distinctes.

Référence du format : [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
Le catalogue sous abonnement peut annoncer des choix propres au compte ; ses
métadonnées pilotent l’UI. Un appel réel avec gpt-6.1-sol/low a réussi ; les autres
niveaux sont testés au niveau des validations et du transport simulé.


## Quotas du compte dans Heart

Le lecteur HTTP appelle `GET https://chatgpt.com/backend-api/wham/usage` avec
une session existante autorisée pour cette route. Aucun binaire Codex, RPC,
modèle ou outil n’est exécuté par la collecte. La connexion SIWC propre à Heart
reste utilisée pour l’inférence ; elle reçoit toujours 401 sur cette route de
quota. Le défaut est [signalé chez OpenAI](https://github.com/openai/codex/issues/54219).

Le collecteur root `src/interfaces/account-quota.ts` est un oneshot systemd
(`deploy/personal-harness-quota.service` + `.timer`), toutes les 60 secondes.
Il lit deux fichiers privés configurés : la session source, et le compte Heart.
Le courriel renvoyé par l’API doit correspondre au compte Heart et l’identifiant
de compte renvoyé à celui de la session source. Il ne copie, ne renouvelle et
ne réécrit aucun credential. Le renouvellement reste à la charge du client
propriétaire de cette session source ; si elle expire ou disparaît, le collecteur
publie Indisponible et la connexion source doit être renouvelée. Aucune inférence,
dépense ou réinitialisation de limite n’est déclenchée.

Seuls les fenêtres, pourcentages, échéances, observation et empreinte de compte
sont écrits atomiquement dans le snapshot root:personal-harness 0640, répertoire
0750. Le web n’a pas accès à la session source. Son chemin de snapshot est donné
par `HARNESS_QUOTA_SNAPSHOT_FILE` ; `HARNESS_QUOTA_MAX_AGE_MS` vaut 180000 en
production et refuse un ancien snapshot après trois minutes sans actualisation.
Le web vérifie propriétaire root, permissions, absence de lien symbolique,
fraîcheur et empreinte du compte actuellement connecté. Le JSON public ne contient
ni identité, ni empreinte, ni jeton. Le collecteur remplace aussi un succès par
un état Indisponible dès un refus HTTP, compte différent ou format invalide.

La barre du chat affiche **Quota compte : pourcentage restant · durée**, puis
**Renouv.** La fenêtre générale la plus consommée est mise en avant ; le détail
montre toutes les fenêtres effectivement reçues, dont les limites supplémentaires
par modèle si présentes. Aucune fenêtre 5 h n’est déduite du nom primary/secondary.
Le détail sépare le quota général côté Codex du plafond propre à l’application
Heart, qui reste non communiqué. Aucun solde de crédits n’est converti en dollars.
Le bouton Actualiser relit le snapshot ; la collecte réseau se fait chaque minute.

Configuration privée du collecteur : `/etc/personal-harness/quota.env`, 0600,
avec `HARNESS_QUOTA_SOURCE_FILE`, `HARNESS_QUOTA_HEART_ACCOUNT_FILE` et
`HARNESS_QUOTA_SNAPSHOT_FILE`. Le web ne reçoit que le dernier chemin et l’âge
maximal. L’endpoint est interne et son contrat peut évoluer : une incompatibilité
est signalée comme indisponible plutôt que d’afficher des compteurs estimés.

Validation : 99 tests, démo SDK et quatre parcours Chromium ; tests identité,
401 sans rejeu, formats, zéro, limites par modèle, lien symbolique, fraîcheur,
remplacement d’un ancien succès et conservation des fichiers source. HTTPS réel
contrôlé à 320/390/820/1440 px, en lecture seule, sans inférence ou écriture dans
les conversations. Collecteur et timer démarrés, première actualisation automatique
vérifiée. [Capture réelle mobile](design/account-quota/live-mobile.png).

Preuves : [connexion directe](qualification/chatgpt-quota/2026-11-17.json),
[source du même compte](qualification/chatgpt-quota/2026-11-17-codex-source.json),
[interface réelle](qualification/chatgpt-quota/2026-11-17-heart-live.json).

## Éléments finalisés et liste terminale vide

Sur les requêtes réelles du 17 novembre, la route directe a envoyé les appels
et messages complets dans response.output_item.done, puis response.completed
avec output vide. Le module reconstruit la sortie depuis les items finalisés
(index continu et unique), seulement après confirmation completed. Les deltas
ne sont jamais des sorties exécutables. Les validations habituelles de namespace,
nom, statut et JSON Schema s’appliquent ensuite. Une liste terminale non vide
conserve son comportement existant. Le raisonnement n’est pas collecté.

[Preuve et portée](qualification/chatgpt-display/2026-11-17.json) : deux appels
réels GPT-6.1 Sol medium depuis un navigateur, fichier SVG créé par le core,
tableau/image affichés dans un workspace jetable ; aucun rejeu du fil propriétaire.
Contrat SSE : [items finalisés](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.output_item.done)
et [attente de la confirmation finale](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference#3-wait-for-completed-inference).

## Délai et diagnostic de reprise

`ChatGptProviderOptions.timeoutMs` borne l’inactivité réseau (120 s par défaut),
pas la durée totale d’une inférence qui continue à transmettre des octets. Le
compteur couvre l’attente initiale puis est réarmé à réception des en-têtes et de
chaque fragment du flux. Une annulation utilisateur reste distincte ; le timer est
nettoyé à la sortie et le lecteur fermé. `ChatGptError` de code local `timeout`
expose un message sûr, sans réponse brute, et n’entraîne aucun repli API ni retry.
La complétion terminale reste indispensable même après réception d’items finalisés.

Le cas historique du 18 novembre correspond à 120 007 ms entre contexte et échec,
mais le transport n’avait pas de diagnostic conservé permettant d’affirmer si le
serveur progressait encore. [Chronologie](qualification/chat-receipts/failure-diagnosis.json).
Les deux tests d’horloge simulée vérifient inactivité et progression au-delà du délai.
Un court appel réel confirme le parsing ; il ne reproduit pas une panne longue.
