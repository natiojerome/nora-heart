# Interface web privée

Pour installer une nouvelle instance depuis GitHub avec le chemin de son choix,
utiliser [INSTALLATION.md](INSTALLATION.md). Les anciens scripts `deploy-web.sh`
et `deploy-postgres.py` restent des recettes opérateur du serveur historique ;
ils ne sont pas le nouvel installateur portable et ne doivent pas être copiés
avec ses comptes, chemins ou secrets.

La première intégration des maquettes est décrite dans [UI.md](UI.md) :
Accueil, Discussions, Projets, Mémoire, Plus et setup en cinq étapes.
Les modèles se configurent dans Modèles & connexions ou depuis le sélecteur
au sein du chat ; l’atelier d’essais est accessible dans Plus → Atelier de test.
La barre de conversation propose prompts rapides persistants, pièces jointes
et arrêt du run ; voir [CHAT-UI.md](CHAT-UI.md) pour formats et limites.
Les sections suivantes décrivent les accès, essais et connexions conservés.


L’atelier est accessible sur **https://heart.natio.re**. C’est une interface de
test privée ; le core et les contrats restent indépendants de HTTP et de l’UI.
Elle est construite en HTML/CSS/JavaScript sans framework ni build frontend.
Un serveur HTTP Node sert les assets et une petite API authentifiée.

## Utiliser

Le lien d’invitation privé ouvre directement la console. L’invitation est valable
24 heures, utilisable une seule fois, puis remplacée par un cookie de session
HttpOnly/Secure/SameSite Strict valable 24 heures. Son fragment est retiré
immédiatement de l’adresse et ne passe pas dans les logs HTTP. Un mot de passe
administrateur peut aussi être configuré côté serveur ; aucun n’est défini par
défaut. Sur Heart, depuis le 16 novembre 2026, un token administrateur permanent
est configuré à la demande du propriétaire via `HARNESS_WEB_PASSWORD`, dans
l’environnement privé du service (hors dépôt, root 0600). Il n’expire pas et
reste réutilisable après redémarrage. Les sessions navigateur expirent toujours
après 24 heures ; saisir à nouveau le même token. Les invitations temporaires
restent disponibles séparément. Ce premier atelier ne possède pas encore de
comptes multi-utilisateurs.

Dans l’atelier :

1. **Simulation** : lancer un essai immédiatement, sans compte ni coût LLM.
2. **ChatGPT** : cliquer Connecter, autoriser OpenAI, puis choisir un modèle
   dans le catalogue du compte. La liste déroulante est chargée automatiquement
   à la connexion et à l’ouverture avec un compte déjà connecté. Aucun modèle
   n’est choisi silencieusement ; la sélection est conservée entre modes et
   vérifiée à chaque rafraîchissement. Un catalogue en erreur bloque l’essai
   jusqu’à un rechargement réussi.
3. **OpenAI / Claude / OpenRouter** : enregistrer sa clé dans le champ protégé, choisir
   l’identifiant du modèle et lancer explicitement l’essai. OpenRouter propose les modèles gratuits et payants avec leurs tarifs, sans repli de modèle. La clé ne sera
   jamais réaffichée. Aucune inférence ne vérifie la clé pendant son enregistrement.
4. Lire la réponse et développer le parcours du moteur pour voir les outils
   exécutés et leurs résultats.
5. Lancer les vérifications modèles, mémoire, outils, stockage local, ou
   l’ensemble des tests locaux. Ces boutons n’utilisent pas les clés ou le forfait.

Une simulation répond de façon déterministe après avoir listé son workspace.
Elle ne comprend pas librement la demande comme un LLM réel.

### Retour de connexion ChatGPT

Le flux public documenté par OpenAI impose encore un retour HTTP loopback.
Après autorisation, le navigateur peut donc afficher une page inaccessible à
l’adresse `http://127.0.0.1:1457/auth/callback?...`.

Copier l’adresse complète de cette page et la coller dans **Adresse de retour**
dans l’atelier, puis cliquer **Terminer la connexion**. L’application transmet
ce retour à son propre listener local. État, PKCE, nonce, identité signée et
permissions continuent d’être vérifiés par le module ChatGPT.

Cela évite le terminal et le tunnel SSH. Ce n’est pas une redirection OAuth
HTTPS automatiquement enregistrée : le transfert de l’adresse reste manuel
dans cette première version. L’adresse contient un code temporaire, pas les
access/refresh tokens ; ne pas la publier. Le relais n’accepte que l’origine
et le chemin loopback de la tentative actuellement en attente. Aucun serveur
arbitraire ne peut être appelé. L’app ne récupère aucun token d’un autre Nora/Codex.

## Isolation des essais

Chaque essai crée un nouveau répertoire de test privé, un workspace contenant
`bienvenue.txt` et un stockage JSON explicitement temporaire. Il utilise les
vrais modules fichier/mémoire et le même `Engine`. Le modèle choisi varie ;
les autres garde-fous restent identiques. Permissions : lecture fichiers,
lecture/écriture mémoire de test. Aucun shell ni accès aux workspaces des autres
projets. Les données sont supprimées à la fin, même après un échec.

Un nouvel essai de l’atelier repart avec un contexte neuf. Les conversations
persistantes sont un panneau distinct, raccordé à la base dédiée Heart. Les
sessions des autres Nora ne sont ni consultées ni modifiées. Le stockage JSON
de test est explicite, pas un fallback PostgreSQL.
Les vérifications SQL et sauvegarde/restauration restent `pnpm test:postgres`,
avec leur conteneur jetable. Le service web n’a pas accès au socket Docker.

Une seule exécution de test à la fois. Les suites lancées depuis l’UI sont sur
liste blanche, exécutées sans shell et sans credentials modèles/DB dans leur
environnement, avec délai et sortie bornés. Le bouton Tout vérifier couvre
les tests locaux, pas le parcours Docker PostgreSQL ni une inférence réelle.
Les essais réels sont limités à 1–4 étapes ; API à 1024 tokens de sortie par
requête. Les limites spécifiques du mode abonnement sont dans [CHATGPT.md](CHATGPT.md).

## Fichiers et composants

| Emplacement | Responsabilité |
| --- | --- |
| `src/app/test-lab.ts` | Composition des modules, essais isolés, catalogue, connexion, clés et suites autorisées. |
| `src/app/web-access.ts` | Invitations, sessions signées, CSRF et limitation des essais de connexion. |
| `src/interfaces/web/server.ts` | Adaptation HTTP, contrôle d’origine/hôte, cookies, assets et corps bornés. |
| `src/interfaces/web/public/` | UI responsive sans dépendance. Aucun HTML fourni par le modèle n’est exécuté. |
| `src/interfaces/web.ts` | Entrée du serveur et fermeture. |
| `src/interfaces/web-invite.ts` | Réémission explicite d’une invitation par l’administrateur. |

## Exploitation actuelle

Déployé le 13 novembre 2026 sur l’hôte existant, sans nouvelle location serveur :

- DNS OVHcloud A `heart.natio.re` → `65.21.3.84`, TTL 300, opération V4
  `99106b58-673b-438b-82e7-a5390ab0ba6a`, état `succeeded`.
- Service `personal-harness-web.service`, utilisateur système distinct
  `personal-harness`, écoute sur `172.18.0.1:4215` (bridge Docker interne).
- Runtime Node 24 du projet, sans changement des runtimes des autres Nora.
- État privé `/var/lib/personal-harness`, credentials ChatGPT dans `chatgpt/`,
  clés API dans `lab/api-keys.json` (0600), dossiers 0700. Aucune clé de session
  ni credential n’est versionné ou affiché par l’API. Fichiers non chiffrés au
  repos : les sauvegardes et l’hôte doivent rester protégés.
- Configuration et clé de signature dans `/etc/personal-harness/web.env` (0600),
  lue par systemd. Conserver cette clé pour garder les cookies valides lors des
  redémarrages. Les révocations explicites de cookies sont en mémoire ; une
  rotation de cette clé invalide tous les cookies, même après redémarrage.
- Service limité à 1 CPU et 1 Gio, système de fichiers protégé, `/tmp` privé,
  écriture uniquement dans son état privé. Le processus ne tourne pas en root.
- Caddy : `deploy/heart.caddy` installé dans le répertoire d’imports runtime du
  proxy existant. HTTPS automatique. `/healthz` public renvoie 404 ; le proxy
  utilise la sonde interne.
- UFW : accès 4215 seulement depuis le proxy `172.18.0.8` sur
  `br-977bba49c154` vers `172.18.0.1`. Aucun port Node ouvert sur Internet.

La configuration du DNS utilise exclusivement les outils Infrastructure V4.
Le routage local est ajouté comme un nouvel import Caddy, sans changer les
routes des autres applications. La recharge emploie le script officiel existant
`/projects/natio-connect-v4/scripts/reload-proxy.sh`. Les sondes des sites/API/MCP
et des autres Nora ont été contrôlées avant et après.

### Redéployer

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:web:e2e
bash scripts/deploy-web.sh
```

Le script d’installation nécessite root, conserve la clé de session et les
credentials, et accepte `HARNESS_NODE_BIN` pour un autre emplacement Node 24.
Il ne configure pas le DNS, le pare-feu ou le proxy automatiquement. Les adresses
du bridge et du proxy ci-dessus doivent être vérifiées si la topologie change.
Installer `deploy/heart.caddy` dans les imports du proxy, puis employer son
script de recharge. Ne pas lancer un autre Caddy sur 80/443.

### Réémettre une invitation

En administrateur local, avec le runtime du projet actif :

```sh
sudo -u personal-harness env \
  HARNESS_WEB_ORIGIN=https://heart.natio.re \
  HARNESS_WEB_INVITE_FILE=/var/lib/personal-harness/invite.json \
  /chemin/node24 node_modules/tsx/dist/cli.mjs src/interfaces/web-invite.ts
```

La sortie est un lien privé à remettre au propriétaire, pas à journaliser dans
un ticket public. Une nouvelle émission remplace l’invitation précédente. Les
cookies existants restent valides. Le token d’invitation peut aussi être copié
dans le champ de connexion ; le navigateur transmet les deux modes au même
contrôle serveur, sans créer de mot de passe permanent. La déconnexion de l’atelier ne déconnecte
pas implicitement le compte ChatGPT : son bouton distinct réalise cette action.

## Vérifier

`pnpm check` inclut les tests HTTP/session et l’isolation des essais. Installer
Chromium via `pnpm exec playwright install chromium` pour `pnpm test:web:e2e`
sur une nouvelle machine. Le test navigateur utilise le vrai backend local,
un compte de test factice, des répertoires temporaires et bloque le réseau
extérieur ; aucune clé réelle ni application publique n’est nécessaire.

La qualification publique a aussi été effectuée sur le domaine HTTPS réel :
invitation, cookie sécurisé, simulation avec journal, tests mémoire, vue mobile
sans débordement et aucune erreur JavaScript. Le compte ChatGPT est connecté :
le catalogue réel et ses 8 modèles visibles ont été vérifiés sur HTTPS, avec
chargement automatique, sélection et réouverture de la page. Un essai réel
GPT-6.1-Sol → `files.list` → réponse `bienvenue.txt` est terminé avec succès
depuis le navigateur HTTPS. Aucune clé API n’a été utilisée pour ce test.

## Conversations persistantes

Le panneau Conversations complète l’atelier temporaire. Créer un titre, choisir
le cerveau dans l’atelier puis envoyer dans le panneau du fil. Le choix de modèle
peut changer entre messages. Un rechargement conserve le fil sélectionné grâce
à son UUID dans l’URL. Le résumé apparaît comme un événement de reprise dans le
même historique. Voir [CONVERSATIONS.md](CONVERSATIONS.md) et
[CONTEXT.md](CONTEXT.md).

Le démarrage raccorde cette fonctionnalité seulement si `HARNESS_DATABASE_URL`
est fourni ; aucune bascule implicite vers des fichiers. Une connexion erronée
ou un schéma non migré fait échouer le démarrage. L’atelier conserve son propre
stockage temporaire et la configuration des clés existantes.

Installation sur l’hôte déjà autorisé :

```sh
sudo python3 scripts/deploy-postgres.py
sudo systemctl restart personal-harness-web.service
```

Cette base est propre à Heart. Le script préserve le secret de session web et
les credentials ChatGPT/API ; il refuse une autre connexion déjà configurée.
Le script `deploy-web.sh` conserve la ligne de connexion lors des redéploiements.
Ne pas exposer son port 5547 hors loopback et ne pas ouvrir les autres bases.
La sauvegarde locale, la rétention et leurs limites sont dans [STORAGE.md](STORAGE.md).

## Mémoire et projets

Le panneau Mémoire gère souvenirs personnels/projet, versions, correction,
oubli et restauration sans appel LLM. Créer un projet ici, puis le choisir dans
« Projet du nouveau fil ». Les anciens fils gardent leur portée personnelle.
Le projet d’un fil n’est pas modifiable après sa création dans cette version.
Les limites et routes sont dans [MEMORY.md](MEMORY.md). Les boutons de
vérification Mémoire couvrent désormais aussi mémoire structurée et contexte.

### Cache des ressources publiques

Le shell, les scripts, styles et images publics utilisent un ETag avec revalidation
obligatoire (`max-age=0, must-revalidate`). Le proxy Heart remplace les directives
pour ces ressources seulement ; les API gardent `private, no-store`. Après changement
du serveur, redémarrer le service web ; après changement de `deploy/heart.caddy`,
installer cet import puis lancer le script de recharge officiel du proxy, dont
l’administration à chaud est désactivée. Vérifier les sondes du proxy et un GET
conditionnel d’asset (304), puis `/api/state` (no-store). Voir [PERFORMANCE.md](PERFORMANCE.md).

## Recherche locale privée

SearXNG sur 127.0.0.1:4216 (conteneur officiel épinglé) et pont MCP sur
127.0.0.1:4217 (service personal-harness-search) fournissent la recherche sans
abonnement ou quota commercial. Aucun nouvel endpoint public ni changement de
proxy/Nora. Configuration et démarrage : [WEB-SEARCH.md](WEB-SEARCH.md).

## Reprise et sauvegarde complète

Le chat propose une réconciliation explicite des interruptions. Aucun effet ni
inférence rejoué pendant la clôture ; audit propriétaire des fichiers traité à
part. [Contrôle du runtime et limites](RECOVERY.md).

`personal-harness-full-backup.timer` tente chaque heure une sauvegarde complète
quotidienne au repos, en complément du dump SQL. Les POST engagés sont comptés ;
le marqueur de maintenance refuse les suivants avec 503. Une commande, mutation
ou autre runtime actif fait reporter le snapshot. Le script dérive l’adresse de
santé et le marqueur de la configuration web réelle ; ne pas supposer que le web
écoute sur 127.0.0.1. Il arrête le web brièvement pour le snapshot, puis vérifie
sa santé après redémarrage. Journaliser uniquement le résultat, jamais les secrets.

Bundle local chiffré age, rétention sept jours et identité privée hors archive.
[Restaurer en isolation](RECOVERY.md), [validation de production](qualification/recovery/managed-backup.json).
Aucune restauration ne démarre automatiquement les connexions avec credentials
archivés ; aucun envoi hors machine n’est configuré.

## Choix du stockage SQL

Le même assemblage web utilise PostgreSQL ou SQLite via `SqlStorageConnection`.
`HARNESS_STORAGE_DRIVER=sqlite` et `HARNESS_SQLITE_PATH` absolu choisissent une
base SQLite préalablement initialisée ; sans driver explicite, l’URL PostgreSQL
existante conserve son comportement. Aucun repli entre bases. Le changement
requiert un redémarrage ; il ne copie aucune donnée.
[Configuration et sauvegardes par pilote](SQL-STORAGE.md). Le site Heart actuel
reste sur PostgreSQL et ses données ont été comparées après déploiement.
