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

Si un proxy est déjà installé, ne pas donner `--domain` : garder le web en local
et ajouter une route dans ce proxy vers le port indiqué. Aucun proxy existant
n’est remplacé. L’installation actuelle `heart.natio.re` n’est pas un exemple de
compte ou de configuration partagé à recopier.

Sans domaine, l’écoute reste sur **127.0.0.1**. Le script affiche la commande de
tunnel SSH et l’URL `http://localhost:<port>` à ouvrir sur son ordinateur. Le port
est choisi automatiquement ; `--port 4215` permet de le fixer. Ne pas ouvrir une
adresse IP distante en HTTP : l’origine et les cookies correspondent à l’URL
configurée. Le tunnel permet de faire l’onboarding avant d’ajouter un domaine.

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

Les services redémarrent au démarrage du serveur. Le web utilise un compte système
propre à l’installation ; le worker YOLO est root mais ses droits ne s’appliquent
qu’aux conversations où le propriétaire choisit YOLO. Les nouveaux fils démarrent
avec les droits de lecture et sans réseau, modifiables pendant l’onboarding.
Les accès au terminal protégé et au worker sont réellement vérifiés dans la
qualification ; ce ne sont pas des conteneurs présentés comme un accès root hôte.

## Premier accès et onboarding

Un **mot de passe permanent unique** est généré. Il est affiché directement dans
le terminal interactif, pas dans la sortie journalisée du script. Sans terminal
interactif, le script indique son fichier privé :

```sh
sudo cat /srv/mon-assistant/.heart/config/owner-password
```

Pour un déploiement automatisé, fournir `--password-file /chemin/prive/password`.
Le fichier contient une ligne d’au moins 16 caractères ; aucune valeur de secret
ne doit être passée comme argument de commande ou ajoutée à Git.

Après connexion :

1. Choisir le nom, les formulations et le pack avatar de l’assistant.
2. Choisir le thème.
3. Choisir un modèle de personnalité et affiner directement son texte.
4. Connecter son fournisseur (ChatGPT ou clé API), choisir le modèle et l’effort,
   puis les utiliser comme défaut des nouveaux fils. Une simulation explicite
   permet aussi d’explorer sans fournisseur. Le parcours reprend après les
   écrans de connexion et les réglages ; les choix sont persistants.
5. Raccorder les services partagés et terminer. Une actualisation du navigateur
   pendant le parcours reprend à la dernière étape enregistrée.

Pour les services partagés, saisir l’URL de son serveur Nora MCPs compatible et
ses clés distinctes Mémoire/Projets/Coffre-fort. Le serveur par défaut proposé
est `https://mcps.natio.re`, mais aucun compte ni accès n’y est créé ou fourni par
Heart. On peut utiliser sa propre instance et ses propres droits.
Les endpoints sont construits avec `/memory`, `/projects`, `/vault`.

Les clés sont vérifiées par une vraie découverte MCP et les outils attendus sont
contrôlés avant enregistrement. Elles sont stockées dans un fichier privé,
séparées des descriptions d’outils en base. Aucune clé n’est renvoyée à l’interface
ou injectée dans les instructions du modèle. Heart redémarre brièvement pour
appliquer les autorités choisies, avec indication de progression et reprise.
Une reconfiguration est refusée pendant un travail actif.

Ces services peuvent être configurés plus tard depuis **Capacités → Connexions →
Configurer les services partagés**. Le chat personnel fonctionne sans projet.
Sur cette installation gérée, sans connexion Mémoire, les outils mémoire restent
absents ; pas de mémoire SQL ou catalogue de projets créé en remplacement.
Mémoire/projets/coffre ne deviennent utilisables qu’avec des connexions valides.
Les conversations et leurs configurations restent dans le PostgreSQL local.

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
pas réinitialisés. Cette commande n’est pas un mécanisme de mise à jour : elle ne
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

`pnpm check`, `pnpm demo:sdk` et `tests/web.e2e.ts` couvrent les régressions.
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

Standards réutilisés : [installation Docker](https://docs.docker.com/engine/install/ubuntu/),
[distributions Node](https://nodejs.org/dist/), unités systemd et contrats
HTTP/MCP existants. Aucun orchestrateur propriétaire ni dépendance du core à
l’installateur.
