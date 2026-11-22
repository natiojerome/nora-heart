# Installer Heart sur son serveur

Une installation indépendante depuis le dépôt public, avec un chemin choisi.
Cible actuelle : **Debian 12+/Ubuntu 24.04+ avec systemd**, droits root/sudo, Docker rootful,
Linux x86_64 ou ARM64. Le parcours complet est qualifié sur x86_64 ; la sélection
des binaires ARM64 est prévue, sans qualification sur machine ARM dans ce lot.
Aucun compte, historique, secret, projet ou wallet de notre serveur n’est importé.

## Une commande

```sh
curl -fsSL https://raw.githubusercontent.com/natiojerome/nora-heart/main/install.sh | sudo bash -s -- --path /srv/mon-assistant
```

Le chemin peut contenir des espaces si l’argument est cité :
`--path '/srv/Mon assistant'`. Un dossier non vide non reconnu est refusé.
Le chemin par défaut est `/opt/nora-heart`.

Avec un domaine dont le DNS pointe **déjà** vers ce serveur :

```sh
curl -fsSL https://raw.githubusercontent.com/natiojerome/nora-heart/main/install.sh | sudo bash -s -- --path /srv/mon-assistant --domain assistant.example.com
```

Les ports 80 et 443 doivent être disponibles et accessibles depuis Internet.
Caddy gère HTTPS et le renouvellement des certificats. Le script vérifie
l’accès HTTPS authentifié avant de déclarer ce mode prêt. Si le DNS ou l’émission
du certificat échoue, les données sont conservées pour une reprise.

Si un proxy est déjà installé, utiliser `--private` sans `--domain` pour garder le web en local
et ajouter une route dans ce proxy vers le port indiqué. Aucun proxy existant
n’est remplacé. L’installation actuelle `heart.natio.re` n’est pas un exemple de
compte ou de configuration partagé à recopier.

Par défaut, aucun domaine n’est nécessaire : ouvrir **`http://IP_DU_SERVEUR:<port>`**
affiché par l’installateur. L’adresse est détectée via les métadonnées locales
Hetzner, sinon via les interfaces/routage de la machine. `--address 203.0.113.10`
permet de la préciser (IPv6 accepté). Le web écoute sur les interfaces réseau ;
PostgreSQL et les moteurs locaux restent privés. Le port est choisi automatiquement ;
`--port 4215` le fixe. Autoriser ce port TCP dans le pare-feu du serveur si nécessaire.
La connexion et l’onboarding fonctionnent sur cette origine IP ; HTTP ne chiffre
pas les échanges. `--domain` reste une option pour HTTPS.

`--private` demande une écoute sur **127.0.0.1** et le tunnel SSH affiché, pour un
accès local ou derrière son propre proxy. `--private`, `--domain` et `--address`
sont des modes exclusifs. Une reprise conserve le mode réseau enregistré : les
installations antérieures en local ne sont pas exposées implicitement.

## Ce que la commande installe

- Clone du dépôt et runtime Node 24 de `.node-version`, téléchargement officiel
  vérifié par SHA-256 ; pnpm 12.15.0 et dépendances verrouillées.
- Dépendances système Git, Python, Bubblewrap, ripgrep, certificats et ACL ; Docker
  installé par son script officiel s’il est absent. Aucun remplacement d’un Docker
  existant ni ajout du compte web au groupe Docker.
- PostgreSQL 18.4 dédié, migrations appliquées, stockage dans le dossier choisi,
  port aléatoire accessible uniquement en boucle locale et mot de passe propre.
- Services systemd distincts : web, worker hôte pour les fils YOLO, recherche MCP
  locale et daemon wallets. SearXNG est auto-hébergé en Docker sur un port privé.
- Racine `<installation>/projects`, fichiers/terminal accessibles sans conversation.
- Coffre wallet initialement **vide** et credential systemd propre ; aucun wallet
  de l’installateur ou du serveur n’est importé, aucun wallet financier n’est créé.
- Vérification quotidienne de la sauvegarde wallet, qui reste explicitement
  ignorée tant que le Vault n’est pas configuré. Après import d’un wallet,
  sauvegarder et vérifier immédiatement avant utilisation ; voir [WALLETS.md](WALLETS.md).
- Caddy et ses données de certificats si `--domain` est demandé.

Avant de déclarer l’installation prête, le script contrôle les services, sockets,
connexion propriétaire/SQL et exécute `node --version` dans le terminal protégé.
Il ne se contente pas de créer les fichiers de configuration.

Les services redémarrent au démarrage du serveur. Le web utilise un compte système
propre à l’installation ; le worker YOLO est root mais ses droits ne s’appliquent
qu’aux conversations où le propriétaire choisit YOLO. Les nouveaux fils démarrent
avec les droits de lecture et sans réseau, modifiables pendant l’onboarding.
Les accès au terminal protégé et au worker sont réellement vérifiés dans la
qualification ; ce ne sont pas des conteneurs présentés comme un accès root hôte.

## Premier accès et onboarding

La première connexion passe par **le compte du portail Nora MCPs**, avant la
personnalisation. L’installateur affiche un lien privé à usage unique dans le
terminal interactif ; sinon le retrouver sur la machine :

```sh
sudo cat /srv/mon-assistant/.heart/config/first-login-url
```

1. Ouvrir ce lien, puis **Se connecter à Nora MCPs** ou **Créer un compte**.
   Ce second bouton ouvre directement l’inscription sur le portail sécurisé,
   sans perdre la demande de connexion Heart.
2. Le portail HTTPS s’ouvre : se connecter avec son email/mot de passe, vérifier
   le code affiché dans Heart et autoriser cette installation. Les inscriptions
   restent réservées aux adresses autorisées par le propriétaire du portail.
   Une adresse refusée reste sur le formulaire avec une erreur ; une inscription
   réussie passe à l’autorisation de cette installation, puis Heart reprend seul.
   Sur une installation déjà liée, utiliser son compte existant : le bouton de
   création n’est plus proposé.
3. Heart crée les clés distinctes **Mémoire, Projets et Coffre-fort**, vérifie
   réellement les trois MCP, les enregistre côté serveur en fichier privé 0600,
   puis redémarre et reprend automatiquement. Aucune clé à recopier.
4. Choisir nom/avatar, thème, personnalité et fournisseur/modèle/effort par défaut.
   Les autorisations du fournisseur LLM restent propres à ce fournisseur : cette
   connexion MCP ne fournit pas une clé Venice/OpenRouter ou un abonnement ChatGPT.
5. Terminer. Après actualisation, le wizard reprend à l’étape enregistrée.

Le lien initial sert uniquement à réserver la nouvelle installation. Le mot de
passe MCP est saisi sur **le portail HTTPS**, jamais envoyé à Heart sur IP HTTP.
Le HTTP de Heart reste non chiffré : choisir domaine/HTTPS ou tunnel pour protéger
sa session et ses conversations sur un réseau non fiable.

Aux connexions suivantes, le même compte MCP est requis ; ses clés ne sont pas
recréées à chaque connexion. L’installation est liée au compte initial : changer
implicitement de propriétaire ou d’autorité est refusé. `--account-server` permet
une instance Nora MCPs compatible en HTTPS, choisie lors de l’installation.
Le flux de connexion suit RFC 8628 ; l’attribution groupée des clés est une
extension Nora, pas une promesse d’OAuth générique pour tous les clients MCP.

Un mot de passe local d’administration reste en fichier privé `config/owner-password`
(`--password-file` pour l’automatisation). Il permet les contrôles techniques,
**pas de contourner la connexion MCP** sur ces nouvelles installations.
Les déploiements existants gardent leur authentification et leurs clés ; aucune
migration de compte implicite. Leur ancien raccordement manuel reste compatible.

Après connexion, l’assistant peut appeler `wallets.backups`, puis `wallets.restore`
pour récupérer une sauvegarde choisie de ce compte dans le coffre actif, sans
commande d’administration ni redémarrage. Le coffre initial reste vide tant qu’une
restauration ou création n’est pas demandée. Voir [WALLETS.md](WALLETS.md).

Mémoire/projets/coffre exigent des connexions valides ; pas de mémoire SQL ou de
catalogue Projets de remplacement. Conversations et réglages restent dans le
PostgreSQL local. Une reconfiguration attend la fin du travail en cours.

## Fichiers et isolation

```text
<installation>/
  src/                    code public et modules
  .tools/                 Node et pnpm locaux
  node_modules/           dépendances
  projects/               artefacts des projets
  .heart/                 privé, exclu de Git
    install.json          UUID, chemins et ports de cette installation
    config/               configuration systemd et secrets du propriétaire
    state/                historique d’exécution, configuration et clés API
      installation.json   credentials et bindings MCP privés
    auth/                 connexion ChatGPT propre à Heart
    postgres/             données PostgreSQL
    host/                 commandes/homedir du worker
    wallets/              coffre chiffré et reçus de sauvegarde
    caddy/                certificats, si activés
```

Les unités sont nommées `heart-<id>-web`, `-host`, `-search`, `-wallets`,
`-wallets-backup` et son timer. Cet identifiant vient d’un UUID conservé, jamais du
nom du dossier ou de l’assistant. Les sockets sont sous `/run/<unité>/` ;
`/etc/nora-heart/<UUID>/master.cred` est un lien privé vers le credential chiffré
dans l’installation, pour éviter les problèmes de chemins de certains systemd.
Les parents d’un chemin privé reçoivent seulement le droit de traversée ACL pour
le compte dédié ; le dossier de secrets reste privé. Plusieurs installations
peuvent cohabiter avec leurs données, comptes, services et ports distincts.

## Reprise et administration

Relancer la **même commande** reprend une installation interrompue avec le même
UUID, les mêmes mots de passe et données. Une installation déjà prête est vérifiée
par connexion propriétaire et lecture SQL via l’application ; ses choix ne sont
pas réinitialisés. Les ajouts privés dans `runtime.env` sont conservés ; une
configuration structurelle personnalisée (base, chemins, sockets, origine) est
refusée plutôt qu’écrasée pendant une réparation. Cette commande n’est pas un mécanisme de mise à jour : elle ne
fait pas de `git reset`, ne tire pas une nouvelle version sur un dépôt existant,
ne supprime pas de base et ne déplace pas une installation.

L’UUID et les noms exacts sont dans `.heart/install.json`. Exemples, en remplaçant
le nom par celui de son installation :

```sh
sudo systemctl status heart-xxxxxxxxxx-web
sudo journalctl -u heart-xxxxxxxxxx-web -n 50
sudo systemctl restart heart-xxxxxxxxxx-web
```

Sauvegarder `.heart` et `projects` avec une procédure PostgreSQL cohérente,
des secrets chiffrés et une copie hors serveur. L’installation ne fournit pas
automatiquement un plan complet de sauvegarde de toutes les données du serveur.
La sauvegarde wallet distante est indépendante des conversations ; elle exige
le Vault choisi. Les collecteurs de quotas d’autres clients, leurs sessions et
les anciens services Nora ne sont pas copiés.

## Vérifications et sources

`pnpm check`, `pnpm demo:sdk`, `tests/web.e2e.ts`, `tests/sqlite-web.e2e.ts`,
`tests/chat-math.e2e.ts` et `tests/onboarding.e2e.ts` couvrent les régressions. Le dernier contrôle vérifie
le parcours fournisseur → modèle/effort → défauts, sur loopback et sur IP privée
non loopback en HTTP (contexte navigateur non sécurisé), avec catalogue simulé
et aucun appel commercial. UUID, copie et initialisation du rendu mathématique
fonctionnent aussi sans les API navigateur réservées à HTTPS.
`tests/installation.test.ts` vérifie les connexions/credentials, compatibilité,
concurrence, reprise et absence de clés dans les métadonnées. Les tests Python
vérifient les fichiers privés et les diagnostics sans secrets.

`pnpm exec tsx tests/qualify-installation.ts --root '<installation jetable>'`
exerce une vraie installation : onboarding mobile avec reprise, valeurs par
défaut, fichiers, terminal protégé Node 24, worker root YOLO, chat simulé avec
vrai moteur/PostgreSQL, recherche déclarée, service wallets et persistance après
redémarrage. Ne pas pointer cet essai vers une installation utilisée : il crée
des données synthétiques et refuse par défaut un profil déjà configuré.
Ce test n’est pas une qualification universelle des comptes fournisseurs.

Pour qualifier un vrai fournisseur et les MCP (inférence explicitement autorisée),
utiliser une installation jetable neuve nommée `/projects/heart live qa-<identifiant>` :

```sh
pnpm qualify:install:live --live --provider openrouter --model deepseek/deepseek-v4-flash-0731 --root '/projects/heart live qa-<identifiant>' --api-key-file /chemin/prive/api-keys.json --mcp-env-file /chemin/prive/mcps.env
```

`--provider` accepte `chatgpt`, `openrouter`, `venice`. Le JSON privé contient la
propriété du fournisseur API choisi (`openrouter` ou `venice`) ; le fichier MCP
contient `NORA_MCPS_MEMORY_TOKEN`, `NORA_MCPS_PROJECTS_TOKEN`, `NORA_MCPS_VAULT_TOKEN`.
Pour ChatGPT, l’instance de qualification doit déjà disposer de son autorisation
privée valide ; `--api-key-file` est inutile. L’installateur ne copie pas de session.
Les fichiers sont fournis explicitement par l’opérateur, jamais embarqués dans
l’installation. Aucun compte, clé ou crédit créé par le scénario.
`--existing-qa-profile` permet ensuite de qualifier un autre fournisseur sur cette
même instance, en refusant tout profil autre que celui de cette QA.

ChatGPT/GPT-6 Luna et OpenRouter/DeepSeek Flash ont passé les vrais appels d’outils,
la mémoire distante et le rappel dans un nouveau fil après restart. Venice reste
refusé HTTP 402. La réutilisation explicite d’une autorisation ChatGPT existante
ne qualifie pas une nouvelle autorisation OAuth. Voir [TESTING.md](TESTING.md).

Standards réutilisés : [installation Docker](https://docs.docker.com/engine/install/ubuntu/),
[distributions Node](https://nodejs.org/dist/), unités systemd et contrats
HTTP/MCP existants. Aucun orchestrateur propriétaire ni dépendance du core à
l’installateur.
