# Modules SQL interchangeables

Le stockage SQL est choisi à l’assemblage, pour la CLI et le web. PostgreSQL et
SQLite implémentent le même `SqlStorageConnection` : sessions/journal/reprise,
conversations, projets, mémoire simple/structurée, profil, prompts/pièces jointes
et connexions MCP. Le moteur, les outils et le comportement mémoire n’importent
aucun client SQL. Le mode JSON reste une démo distincte, aux capacités limitées.

Les dialectes et migrations restent dans chaque module. Il n’y a ni ORM, ni
traducteur SQL universel, ni nouvelle couche de requêtes exposée au core.
`app/compose.ts` choisit explicitement le module ; `app/web-conversations.ts`
assemble les services à partir du contrat complet. Ajouter un autre backend
requiert son implémentation, son inscription et le passage des mêmes tests.

## Choisir le backend

PostgreSQL reste le backend de l’installation heart.natio.re. Sa configuration,
les clés des fournisseurs et les migrations PostgreSQL 001–013 sont conservées ; la 014 ajoute la planification.

```json
{"storage":{"driver":"postgres","connectionStringEnv":"HARNESS_DATABASE_URL"}}
```

SQLite est une option explicite, utilisant l’API locale `node:sqlite` qualifiée
sur Node 24.22.3. Aucune nouvelle dépendance npm/native externe.

```json
{"storage":{"driver":"sqlite","file":".state/sqlite/heart.sqlite"}}
```

Le chemin du JSON est résolu par rapport au fichier de configuration. Un exemple
complet est fourni dans `harness.sqlite.example.json` : cerveau déterministe de
démo et mémoire structurée. Sur une installation/dossier de test :

```sh
pnpm db:migrate --config harness.sqlite.example.json
pnpm demo --config harness.sqlite.example.json
pnpm demo --config harness.sqlite.example.json
```

L’initialisation est explicite. Un fichier absent, un schéma incompatible ou un
pilote inconnu échoue ; aucune bascule silencieuse vers un autre backend. Le
fichier SQLite doit être privé (0600), régulier et sans lien symbolique. Initialiser
avec le compte OS qui exécutera Heart ; le dossier technique `.runtime` est 0700.
Le stockage en mémoire `:memory:` n’est pas un mode durable proposé.

Pour le web, dans son environnement privé :

```dotenv
HARNESS_STORAGE_DRIVER=sqlite
HARNESS_SQLITE_PATH=/chemin/prive/heart.sqlite
```

Initialiser le même fichier avant le démarrage du web. Pour PostgreSQL,
`HARNESS_STORAGE_DRIVER=postgres` et `HARNESS_DATABASE_URL` ; l’environnement
historique avec seulement l’URL reste compatible. Le choix du stockage ne change
pas la configuration ChatGPT/API ni les préférences de conversations.

**Changer la configuration ne transfère pas les données.** Une nouvelle base
initialisée possède son propre UUID. Transférer une installation PostgreSQL vers
SQLite (ou l’inverse) exige encore un export/import métier explicite, complet et
vérifié ; cet outil de transfert n’est pas livré. Aucun pg_dump n’est exécuté
contre SQLite et aucune migration PostgreSQL n’est réécrite. Les snapshots SQLite
conservent l’identité et l’historique lors d’un changement de chemin/nom.

## Différences d’exploitation derrière le contrat

| Comportement | PostgreSQL | SQLite |
| --- | --- | --- |
| Données | Serveur, transactions et JSONB | Fichier, tables STRICT, JSON/BLOB et WAL |
| Atomicité | Transaction avec verrou de ligne | Transaction courte BEGIN IMMEDIATE |
| Runs simultanés | Claim par fil, pool de requêtes | Claim par fil ; plusieurs runtimes/conversations, écritures brèves sérialisées |
| Propriétaire vivant | Lease par connexion SQL dédiée | Un fichier SQLite de lease par UUID de runtime, verrou EXCLUSIVE réel |
| Maintenance globale | Advisory lock partagé/exclusif | Base de contrôle séparée, transaction de lecture partagée/exclusive |
| Processus tué | Libération du verrou par PostgreSQL | Libération des verrous de fichiers par l’OS |
| Sauvegarde | pg_dump custom | API backup native, jamais copie à chaud du seul fichier principal |

Les verrous SQLite de contrôle/propriété utilisent le mode journal classique dans
`<fichier>.runtime/` ; le fichier de données utilise WAL. Le verrou de maintenance
est partagé par les runtimes, exclusif pendant migration/snapshot. Les connexions
de propriété ne bloquent donc pas les écritures métier. Pas de PID à deviner ni de
TTL expirant arbitrairement un travail long. Après un crash, un propriétaire actif
ou invérifiable reste refusé ; une réparation fige les anciens runs et ne rejoue
aucune action. Les déclarations d’effets restent des constats, pas de faux succès.

Ne pas supprimer/déplacer le dossier `.runtime` à part de sa base. Les anciens
fichiers de propriétaires sont conservés pour prouver l’état des claims laissés
après crash. Le snapshot CLI ne copie que les preuves encore requises par ces
claims. Un verrou sans fichier de preuve valide n’est pas déclaré mort.

SQLite est qualifié sur système de fichiers local Linux, pour les runtimes d’un
même compte OS. WAL ne constitue pas une base partagée entre machines via NFS.
Les opérations du driver sont synchrones et courtes ; ce module n’offre pas le
parallélisme d’écriture d’un serveur PostgreSQL. Le délai d’attente d’un verrou
SQL est 5 s, comme le lock_timeout PostgreSQL actuel ; cette attente peut bloquer
la boucle Node. Pas de promesse de performance universelle.

## Sauvegarder et restaurer SQLite

Fermer tous les runtimes qui utilisent le fichier, puis :

```sh
pnpm db:backup:sqlite --config harness.sqlite.example.json --output /dossier/neuf/snapshot.sqlite
```

La commande refuse une destination existante et un runtime vivant. Elle produit
le fichier consolidé par l’API backup SQLite et son dossier `snapshot.sqlite.runtime`,
avec les preuves inactives nécessaires pour réconcilier les claims du snapshot.
Les deux doivent rester ensemble. Le fichier contient potentiellement des données
privées : le chiffrer pour conservation/transfert. Ce snapshot CLI couvre la base et
la reprise ; les workspaces et la configuration sont des scopes séparés.

Le bundle géré par `heart-backup-managed.py` choisit désormais son snapshot selon
le pilote configuré et archive aussi les preuves SQLite. Le manifeste indique
`database.driver` et `database.format` ; les anciens bundles sans ce champ restent
les dumps PostgreSQL historiques. Le garde de maintenance couvre les deux modules.
Le timer SQL quotidien historique reste un dump de son serveur PostgreSQL dédié.

Après extraction d’un bundle SQLite, utiliser `database.dump` comme fichier SQLite
consolidé et le scope `sqlite-runtime` comme `<nouveau-fichier>.runtime`. Restaurer
vers un chemin neuf, sans WAL/SHM résiduels ; ne pas le superposer au fichier brut
éventuellement présent dans le scope state. Replacer les workspaces/configuration
selon le nouvel environnement, vérifier puis démarrer explicitement. Ne pas lancer
pg_restore sur ce payload. [Chiffrement et procédure générale](RECOVERY.md).

## Tests communs et preuves

`tests/sql-storage.conformance.ts` contient une seule suite appliquée aux deux
modules : identité/projets/conversations, permissions, ordre/idempotence/batch
atomique, concurrence, comparaison sémantique du modèle, mémoire Unicode/portées/
versions/oubli, profil/MCP, prompts et pièces jointes binaires, pause/réponse humaine
et invalidation des actions dépendantes, propriétaire vivant/mort et écritures
tardives refusées. La fermeture de connexion doit être idempotente.

```sh
pnpm test:storage:sqlite
pnpm test:postgres
pnpm check
pnpm test:backup
```

Les repositories SQLite utilisent de vrais fichiers temporaires ; PostgreSQL est
un vrai serveur jetable. Les seuls cerveaux sont simulés. Les essais SQLite ajoutent
un vrai SIGKILL après écriture, snapshot natif puis récupération du fil restauré,
rejets de version/checksum et garde opérateur exécuté par Node natif.

Le parcours navigateur utilise le véritable assemblage web SQLite : fichier créé
par l’explorateur, appel d’outil fichiers via le moteur de démo, souvenir enregistré,
redémarrage serveur et vérification des mêmes événements/données, quatre largeurs.
[Rapport](qualification/sql-storage/browser.json),
[CLI et snapshot](qualification/sql-storage/cli.json).
Le bundle chiffré SQLite est réellement déchiffré et rouvert par SQLite dans
`tests/test-heart-bundle.py`. Le service de production reste qualifié sur PostgreSQL ;
aucune installation propriétaire n’est migrée ni appelée via un fournisseur payant.

Références : [API Node SQLite](https://nodejs.org/api/sqlite.html),
[WAL SQLite](https://www.sqlite.org/wal.html),
[verrous SQLite](https://www.sqlite.org/lockingv3.html). Le client Node est une API
de bibliothèque adaptée dans le module, pas un standard imposé aux contrats.

## Tâches persistantes

Migrations additives PostgreSQL 014 et SQLite 002, tables tasks/task_runs. Contrat
TaskRepository commun : CAS, réservation unique, historique par séquence,
notifications et lease de leader. Les anciennes migrations restent inchangées.
PostgreSQL conserve une connexion de verrou ; SQLite utilise un fichier technique
privé scheduler.sqlite, sans données métier, et un verrou OS libéré au crash.
Les deux upgrades et la concurrence sont qualifiés, voir [TASKS.md](TASKS.md).
