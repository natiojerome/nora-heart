# Persistance et backend PostgreSQL

PostgreSQL est le premier backend de persistance retenu et implémenté.
Le core utilise `SessionStore` et les outils fournis par l’application ; le module
mémoire utilise `MemoryRepository` ou `StructuredMemoryRepository`. Ces contrats ne dépendent pas du pilote `pg`. Le contrat complet SQL possède aussi un module SQLite optionnel : [configuration et conformité](SQL-STORAGE.md). Le présent document détaille PostgreSQL.

## Mise en service

Préparer une base dédiée au projet et un rôle disposant des droits nécessaires
au schéma `harness`. Injecter la connexion dans `HARNESS_DATABASE_URL` via
l’environnement ou un coffre ; ne pas la mettre dans le JSON de configuration.

La configuration principale contient :

```json
{
  "storage": {
    "driver": "postgres",
    "connectionStringEnv": "HARNESS_DATABASE_URL"
  }
}
```

Puis lancer, depuis le dépôt :

```sh
pnpm db:migrate
pnpm demo
```

Les deux commandes acceptent `--config /chemin/config.json`. Le fichier
`.env.example` est un repère ; aucune lecture implicite de `.env` n’est faite.
Une connexion absente, un schéma absent ou incompatible arrête le démarrage.
La CLI affiche un échec général sans détails SQL ou credentials.

La commande de migration initialise le schéma mais ne crée ni serveur, ni
base, ni rôle. Le web dispose maintenant d’un PostgreSQL dédié installé par
`scripts/deploy-postgres.py` ; les tests conservent leurs conteneurs temporaires.

## Modèle de données

| Table dans `harness` | Contenu |
| --- | --- |
| `migrations` | Versions appliquées, checksums SQL et dates. |
| `instance` | UUID d’instance stable, sans nom de produit dans sa clé. |
| `sessions` | Identifiant stable, séquence et claim `active_run`. |
| `conversations` | UUID du fil, projet optionnel, titre, dates et dernière sélection de cerveau/capacité. |
| `projects` | UUID et titre des projets Heart. |
| `events` | Journal canonique ordonné par session, avec run, type, date, JSONB et version du format. |
| `memories` | UUID, titre/texte/type, portée/projet, statut, version, provenance et hash de contenu. |
| `quick_prompts` | Prompts rapides versionnés, indépendants de la mémoire et des modèles. |
| `chat_attachments` | Métadonnées, octets bytea, UUID de conversation et statut utilisé ; références seulement dans les messages. |
| `memory_revisions` | Instantanés versionnés, écrits dans la transaction de correction/statut. |

Le module `modules/memory/basic` valide les souvenirs (4 000 caractères
maximum), crée les identifiants et prépare les termes de recherche. Les
repositories PostgreSQL et JSON ne portent plus ces règles métier.
L’index unique actif combine portée, projet (NULL normalisé) et hash. Les
souvenirs oubliés sont exclus. Un même contenu peut exister dans deux projets.
Le hash évite d’indexer directement un long texte UTF-8 ; le contenu retourné
est vérifié pour refuser une éventuelle collision. La recherche du module basic est
textuelle : chaque mot doit être présent, sans interprétation de `%` ou `_`
comme caractères SQL spéciaux. Aucun embedding ni index sémantique.

Les points de reprise sont les événements `context.checkpoint`, avec leurs
références sources et segments parents. Les messages sont les événements `message` du journal ; aucune table de runs
ou file de travaux complète n’est encore ajoutée. Les états sont reconstruits
par le moteur existant.

## Assemblage

`app/compose.ts` ouvre le stockage via son entrée publique et fournit
`storage.memories` au module mémoire sélectionné. Les outils mémoire reçoivent
uniquement `MemoryService`. Sessions et souvenirs peuvent partager le même
pool PostgreSQL sans être couplés dans le core.

Le SQL initial est conservé intact. La migration 002 ajoute conversations,
claims et type d’événement checkpoint. La 003 ajoute mémoire structurée,
projets et révisions ; les souvenirs Heart existants sont enrichis en place
sans changer leur ID ou contenu. Aucun import d’anciens fichiers.

## Transactions et migrations

`src/modules/storage/postgres/migrations/001_initial.sql` crée les tables initiales. La commande
de migration s’exécute dans une transaction sur une même connexion `pg`, avec
un verrou consultatif transactionnel pour sérialiser deux migrations concurrentes.
Une migration déjà appliquée doit conserver son checksum. Une version inconnue
est refusée ; ne pas réécrire un SQL déjà appliqué pour faire évoluer un schéma.

Les migrations 001 à 010 sont enregistrées explicitement dans l’exécuteur.
La migration 009 ajoute `context.usage` au CHECK des événements : les mesures de
contexte sont persistées avant chaque appel préparé, sans dépendre du fournisseur.
Une base v8 refuse ces événements ; migrer avant de démarrer le runtime courant.
Ajouter une migration demande son enregistrement explicite. Il n’y a pas de
moteur de découverte de migrations ni de migration descendante automatique.

L’écriture d’un événement regroupe création de la session si nécessaire,
verrou de sa ligne, allocation de séquence et insertion dans une transaction.
Un même ID et le même contenu sont idempotents ; réutiliser l’ID pour un autre
contenu est refusé. Une insertion échouée annule également l’allocation et la
création éventuelle de la session.

L’instance, les sessions et la mémoire PostgreSQL survivent au changement du
nom affiché ou du chemin du programme. Changer de base n’est pas un renommage.

## Limites de concurrence et de reprise

Le moteur acquiert atomiquement `sessions.active_run` avant de lire le journal.
Deux moteurs ne traitent pas le même fil simultanément. Le claim est libéré dans
le finally du moteur ; un crash conserve le verrou et le journal. Le lease de
runtime et la colonne `runtime_owner` (migration 013) permettent une récupération
explicite, sans expiration ni répétition automatique. Les écritures tardives des
runs réconciliés sont refusées. Le pool est borné à quatre connexions, auxquelles
s’ajoute une connexion de lease par stockage ouvert.

Le chat expose l’examen des résultats absents et la clôture atomique des tours.
La sauvegarde complète chiffrée coordonne les writers via le verrou partagé/exclusif
PostgreSQL, puis conserve base + fichiers/configuration/code gérés. Le dump SQL
quotidien distinct est conservé. [Fonctionnement, limites et restauration](RECOVERY.md).

Les appels SQL ont des délais bornés. Ce n’est pas une annulation SQL pilotée
par `AbortSignal` : cette propagation reste à qualifier. La durabilité réelle
dépend aussi de la configuration PostgreSQL et de son hébergement.

## Mode fichiers de démonstration

`pnpm demo:local` sélectionne explicitement `harness.demo.config.json` et son
backend JSON/JSONL. C’est un mode de démo explicite, pas un repli en cas
d’indisponibilité PostgreSQL. Aucun import des anciens fichiers n’est réalisé.
Si des données utiles doivent être migrées, préparer et vérifier un import
explicite avec sauvegarde ; ne pas simplement pointer un ancien dossier sur la base.

## Tests isolés

```sh
pnpm check
pnpm test:postgres
```

Le premier contrôle lance le typage et les tests sans base. Le second crée un
conteneur PostgreSQL dédié à nom aléatoire, avec mot de passe éphémère transmis
uniquement par environnement et port aléatoire exposé sur `127.0.0.1`.
Il utilise l’image `postgres:18.4-bookworm`, un volume mémoire temporaire et des
limites de 256 Mio et un CPU. L’image est configurable par
`HARNESS_TEST_POSTGRES_IMAGE`. Une image absente peut être téléchargée par Docker.

Le runner ne lit aucun credential d’une application existante. Les tests SQL
refusent une URL absente ou une base ne finissant pas par `_test`. Ils modifient
le schéma de leur base jetable pour qualifier aussi les rejets de migrations.
Ne pas les diriger manuellement vers une base utile, même nommée avec ce suffixe.

Le runner exécute les migrations, les tests d’intégration, deux démarrages de
la CLI, puis `pg_dump` et `pg_restore` vers une seconde base. Les contenus et
l’identité sont comparés avant suppression du conteneur et du workspace
temporaire dans son bloc de nettoyage.

## Sauvegardes durables

L’installation Heart dispose désormais du bundle chiffré coordonné
`personal-harness-full-backup.timer` : base, fichiers, configuration et source,
avec clé privée séparée. Premier bundle réel déchiffré/vérifié localement ;
restauration SQL/fichier/configuration qualifiée sur installation jetable.
[Procédure et limites](RECOVERY.md). Le dump quotidien ci-dessous est conservé
comme sauvegarde SQL distincte. La copie hors machine reste à configurer.

L’exploitation doit prévoir une sauvegarde PostgreSQL native avec `pg_dump`,
une copie indépendante et une restauration testée. Les workspaces sont des
artefacts séparés à sauvegarder eux aussi. Ne jamais inclure un mot de passe
dans les arguments des commandes ou les logs ; utiliser les mécanismes de
credentials PostgreSQL adaptés au déploiement.

Le test jetable valide un aller-retour logique ; il ne constitue pas une
politique de sauvegarde installée, un test de panne machine ou une garantie
de disponibilité d’un futur service.

## Déploiement Heart

`scripts/deploy-postgres.py` installe uniquement `personal-harness-postgres`
(PostgreSQL 18.4, 512 Mio, un CPU) sur `127.0.0.1:5547`. Son volume Docker
`personal-harness-postgres-data` persiste les données. Les labels sont contrôlés
avant réutilisation ; un conteneur/volume inconnu ou une autre connexion déjà
configurée provoque un arrêt sans remplacement. Les noms d’exploitation ne
sont pas des identifiants des conversations ou de l’instance.

Les credentials générés vivent dans `/etc/personal-harness/postgres.env` et la
connexion dans `/etc/personal-harness/web.env`, fichiers root 0600. Aucun secret
n’est imprimé. Le script applique les migrations avant de raccorder la base au
web. Le conteneur redémarre avec Docker. Redémarrer ensuite uniquement
`personal-harness-web.service`.

`personal-harness-backup.timer` produit chaque jour vers 03:20 UTC un dump
PostgreSQL natif dans `/var/backups/personal-harness` (root 0700, dumps 0600),
avec rétention de sept jours. Une sauvegarde peut être lancée par
`systemctl start personal-harness-backup.service`. La restauration doit se faire
dans une base distincte et être comparée avant tout remplacement. Le parcours
jetable teste dump/restore des événements, souvenirs et conversations. Le dump
du service dédié a aussi été restauré dans une base temporaire distincte, avec
comparaison du catalogue, des souvenirs, de l’identité et des huit événements
de la conversation de démonstration, puis suppression de cette base de contrôle.

Ces copies sont locales à la machine : copie indépendante hors machine et
sauvegarde des workspaces restent à mettre en place. Les sauvegardes ne couvrent
pas les credentials ChatGPT/API et ne doivent pas servir à les publier.

Les contrôles de version mémoire, l’oubli réversible, la migration v2 peuplée
et la recherche par portée sont détaillés dans [MEMORY.md](MEMORY.md).

## Préférences d’assistant

La migration additive 004 crée `assistant_profile`, lié à l’UUID d’instance.
Le repository reçoit un document validé par `app/assistant.ts`, avec version
optimiste (pas d’écrasement concurrent). Nom, genre, avatar, thème, personnalité,
animations et progression de setup ne sont ni des souvenirs ni des credentials.
Les scripts de dump/restauration incluent cette table. Aucun nom affiché ou
chemin d’installation n’est utilisé comme identité. Voir [UI.md](UI.md).

## Fichiers et prompts du chat

Migration additive 005, à appliquer avant redémarrage. Les prompts utilisent
un contrôle de version pour édition/suppression. La sélection des fichiers est
revérifiée côté serveur et leur attribution au message se fait atomiquement :
un fichier absent empêche de marquer les autres comme utilisés. Un fichier
utilisé ne peut plus être retiré de cet historique. Le dump PostgreSQL inclut
les octets ; le test de restauration compare aussi les tables de prompts et de
pièces jointes. Les limites de taille et formats sont dans [CHAT-UI.md](CHAT-UI.md).

## Permissions et audit des fichiers

Migration 006 : colonne file_access none/read/write sur les conversations,
défaut read. Le stockage conserve ce réglage séparément du choix de modèle.
Changer l’accès pendant un claim actif est refusé. Les opérations manuelles
acquièrent le claim du fil puis utilisent un journal `workspace-<UUID>` distinct
pour ne pas injecter l’éditeur dans les messages du LLM. Ce journal ne conserve
pas le texte édité. Les fichiers eux-mêmes restent sur disque et sont exclus
du dump PostgreSQL ; leur sauvegarde dédiée reste à mettre en place.
Voir [FILES.md](FILES.md) pour l’API et les limites.

## Exécution et politique de développement

Migration 007 : mode develop dans file_access, network_access booléen false,
max_steps entier positif ou zéro (zéro sans plafond de tours). La politique de
fichiers est conservée lors de la migration. Une politique ne remplace pas le
choix du modèle ; changes pendant un run actif refusés par claim.
Les journaux d’exécution et sorties sont des fichiers privés dans le répertoire
d’état, hors workspace monté ; ils ne sont pas dans le dump PostgreSQL. Les
processus ne survivent pas au redémarrage du service ; aucun rejeu implicite.

Migration 008 : extension du CHECK file_access à yolo. Aucun droit existant ni
message n’est modifié ; le mode est un choix par fil, pas une propriété du modèle.

## Demandes et réponses interactives

Migration 010 ajoute interaction.requested/interaction.resolved au CHECK des
événements. Pas de nouvelle table, pas de réécriture des anciennes migrations.
appendBatch est transactionnel : résolution + résultat de l’outil + nouveau run
sont tous enregistrés ou aucun. Le verrou/claim existant empêche deux reprises.
Un marqueur durable de pause ou d’annulation permet uniquement la récupération
du claim correspondant si le processus meurt avant sa libération ; les autres
runs interrompus gardent leur contrôle de réconciliation. Voir INTERACTIONS.md.

## Connexions MCP

Migration 012 : table external_tools, UUID/version et configuration JSONB avec URL,
authentification par nom de variable et snapshots JSON Schema approuvés. Aucun
secret brut. Édition optimiste, désactivation sans supprimer l’historique des appels.
La nouvelle table est incluse dans le dump PostgreSQL et comparée après restauration
jetable. Les valeurs des variables restent hors du dump, dans l’environnement privé.
