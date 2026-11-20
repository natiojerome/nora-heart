# Reprendre et restaurer Heart

## Reprise d’un fil

Fermer le navigateur laisse le serveur travailler. Arrêter une réponse annule le
run de ce fil ; une commande lancée séparément peut continuer. Après un crash,
Heart conserve le journal et bloque tout rejeu implicite.

Le chat propose **Examiner la reprise** lorsqu’un tour, un claim ou des appels
restent ouverts. La fenêtre distingue :

- résultats effectivement conservés : ils restent inchangés dans l’historique ;
- appels sans `tool.started` : jamais lancés par le moteur ;
- appels avec `tool.finished`, mais sans résultat : invocation terminée, résultat
  perdu ; cela ne prouve pas qu’une commande asynchrone est terminée ;
- appels avec `tool.started` seul : effet incertain.

Pour les deux derniers cas, vérifier le terminal, les fichiers et les effets
externes, puis confirmer leur prise en compte. Un constat facultatif reste daté
dans le journal. Un résultat inconnu reste inconnu : la confirmation du propriétaire
n’est pas un reçu d’exécution réussi.

**Clôturer sans rejouer** ajoute les résultats d’erreur manquants et clôture les
tours concernés, dans une transaction. Aucun outil, commande ou modèle n’est
appelé. Le propriétaire continue ensuite dans le même fil, avec ses droits et son
cerveau courants. Le modèle reçoit l’avertissement de vérifier les effets avant
une nouvelle action ; ce n’est pas une garantie d’exactly-once des services externes.
Les formulaires en attente gardent leur propre parcours de réponse/annulation.
Le journal privé de l’explorateur est examiné et réparé séparément avant le fil,
sans copie de son contenu dans le contexte du modèle. Chaque journal est réparé
atomiquement ; si le second a changé, actualiser pour terminer la réconciliation.
Un claim sans journal impose une vérification, sans présumer qu’aucune action n’a eu lieu.

### Propriété et concurrence

Contrat `SessionStore.reconcile` indépendant de l’implémentation. Le core calcule
les preuves et les événements de réparation ; l’application valide l’entrée ; le
stockage vérifie la propriété, la dernière écriture et la transaction.

PostgreSQL : chaque connexion de stockage applicative détient un lease via une
connexion dédiée et un verrou consultatif de session. Chaque claim indique son
UUID de runtime, indépendant du nom/chemin. Une récupération refuse un propriétaire
encore connecté ; aucun délai arbitraire n’expire un travail long. Si PostgreSQL
n’a pas encore constaté la perte de connexion, la récupération attend ce constat.

La transaction verrouille la ligne session, vérifie le dernier événement, refuse
un propriétaire actif, ajoute la réparation et libère le claim. La table
`reconciled_runs` refuse les écritures tardives de ces anciens runs. Une répétition
de la demande rencontre un conflit de version, sans doublon. Même un crash entre
l’acquisition du claim et le premier événement est récupérable.

Migration **013** : colonne nullable `runtime_owner` et table `reconciled_runs`.
Les anciens claims sans propriétaire vérifiable sont refusés explicitement :
ils demandent une intervention opérateur après arrêt des moteurs et vérification
des effets. La migration n’efface aucun claim. Le pool garde quatre connexions ;
le lease ajoute une cinquième connexion par assemblage PostgreSQL ouvert.

JSON/JSONL reste réservé à un seul processus propriétaire : file sérialisée,
claims en mémoire, remplacement atomique du journal et refus des anciens runs
réconciliés. Aucun verrou interprocessus ni équivalence d’exploitation PostgreSQL
n’est promis par ce mode de démo.

## Sauvegarde de l’installation gérée

`scripts/heart-bundle.py` crée un bundle chiffré par **age** : dump PostgreSQL
custom ou snapshot SQLite natif selon le module choisi, fichiers et manifeste SHA-256. Le manifeste des nouveaux bundles précise le pilote et le format du payload. Le service administrateur
`scripts/heart-backup-managed.py` ajoute la coordination de l’installation courante.
La clé privée age reste hors bundle, root uniquement ; son destinataire public
suffit pour créer les sauvegardes. Ne jamais coller la clé dans le chat.

Périmètre : base Heart, `/var/lib/personal-harness`, racine des projets configurée
(`HARNESS_PROJECTS_ROOT`, défaut `<installation>/projects`, scope `projects`), état/home/sorties du worker
Heart, configuration privée web/PostgreSQL/quota/recherche, unités systemd Heart
et overrides web, archive Git du code au commit indiqué. La clé de déchiffrement,
les projets situés hors de cette racine et les modifications YOLO faites ailleurs sur le serveur ne
sont pas inclus. Le snapshot de quotas peut être régénéré ; les volumes/cache
SearXNG sont recréables. Node 24, dépendances pnpm et paquets système se réinstallent
avec le source et son lockfile ; ce n’est pas une image disque autonome hors ligne.

À la restauration, replacer `files/projects` dans la racine configurée et rétablir
le propriétaire du service et son droit systemd `ReadWritePaths`. Les liens
symboliques conservés restent à contrôler avant réouverture, comme les autres scopes.

Le timer tente chaque heure et conserve au plus une sauvegarde réussie par jour,
avec rétention locale de sept jours. Il conserve le dump quotidien préexistant
comme sauvegarde SQL distincte.

1. Créer exclusivement le marqueur `/var/lib/personal-harness/maintenance` : le web
   refuse les nouveaux POST avec HTTP 503 explicite et laisse finir ceux engagés.
2. Si une mutation ou une commande enregistrée travaille, reporter la sauvegarde,
   enlever le marqueur et réessayer à la prochaine échéance. Aucun travail annulé.
3. Arrêter brièvement le web, acquérir le verrou consultatif exclusif de sauvegarde.
   Les runtimes Heart ouverts détiennent le verrou partagé opposé : un autre moteur
   fait reporter le snapshot. Un nouveau moteur ou une migration est refusé pendant
   le snapshot. Un ancien claim bloqué fait aussi reporter la sauvegarde complète.
4. Dumper la base et archiver les fichiers au repos ; chiffrer et publier atomiquement.
   Relâcher le verrou, redémarrer le web, vérifier sa santé et enlever le marqueur.

Le verrou protège les runtimes Heart qui ouvrent le stockage par l’assemblage
supporté ; des scripts SQL ou programmes externes ne doivent pas écrire ces
fichiers/base pendant un snapshot. Les tentatives différées sont visibles dans
le journal systemd ; elles ne sont pas annoncées comme sauvegardes complètes.

### Installation opérateur

Dépendances : Python 3.12+, age, Docker/CLI PostgreSQL, Node 24 et dépendances du
dépôt. Installer les deux helpers Python côte à côte dans
`/usr/local/lib/personal-harness/`, exécutables root ; le garde PostgreSQL reste
`scripts/heart-backup-lock.mjs` dans le code installé. Installer les unités
`deploy/personal-harness-full-backup.{service,timer}`.

Créer une fois, sans afficher le contenu privé, l’identité
`/etc/personal-harness/backup-age.key` (0600) avec `age-keygen`, puis écrire son
seul destinataire public dans `backup-age.recipient`. Sauvegarder séparément la
clé privée en lieu sûr : perdre le serveur et cette clé rend les bundles inutiles.
Ne pas remplacer une identité existante. Activer le timer après un premier essai
et un contrôle de déchiffrement. Aucun envoi hors machine n’est configuré.

### Restaurer sans toucher le runtime courant

Sur une machine/dossier isolé, disposer de l’identité privée séparée et lancer :

```sh
python3 scripts/heart-bundle.py extract \
  --bundle /chemin/heart-AAAAmmjjTHHMMSS.tar.age \
  --identity /chemin/prive/backup-age.key \
  --directory /nouveau/dossier-vide
```

L’extraction exige un dossier inexistant, vérifie le chiffrement et les SHA-256,
refuse les chemins sortants et fichiers spéciaux. Elle ne démarre aucun service,
ne charge aucun secret et n’exécute aucune commande de l’archive. Les liens sont
conservés dans `links.json`, à examiner/recréer explicitement ; ils ne sont pas
suivis ni activés pendant l’extraction. Le marqueur de maintenance est exclu.

Créer une base PostgreSQL isolée, restaurer `database.dump` avec `pg_restore
--no-owner --exit-on-error`, extraire l’archive de source de confiance, installer
Node/dépendances et replacer les scopes de `files/` dans les emplacements choisis.
Adapter les chemins et identifiants de service avant un démarrage. Une restauration
avec credentials de production ne doit pas démarrer silencieusement des outils
externes. Comparer base/fichiers/configuration avant toute bascule du trafic.

## Qualifications

- `tests/recovery.test.ts` : classement des preuves, réparation sans faux reçu,
  conservation des résultats, tours déjà échoués et claim sans événement.
- `tests/postgres.integration.ts` : propriétaire vivant refusé, transaction et
  comparaison de version, concurrence, écritures tardives refusées, lease de
  maintenance et vrai SIGKILL d’un processus qui venait d’écrire un fichier.
- `tests/recovery.e2e.ts` : fenêtre compacte, confirmation nécessaire pour effet
  incertain, zéro appel modèle pendant la réparation puis continuation du même fil,
  largeurs 320/390/820/1440. [Rapport](qualification/recovery/browser.json).
- `pnpm test:backup` : chiffrement, empreintes, configuration et octets des fichiers,
  refus d’écraser, archive tronquée, lien sortant conservé pour examen.
- `python3 tests/qualify-backup.py` : PostgreSQL jetable sur nora-tests, bundle et
  restauration réels, comparaison des tables + fichier + configuration synthétique.
  [Rapport](qualification/recovery/backup.json). Aucun credential propriétaire
  transmis au serveur de tests, aucun appel fournisseur réel pour ce lot.

## Module SQLite optionnel

La reprise et les repositories complets existent aussi pour SQLite. Les détails
de configuration, les verrous natifs des fichiers de preuve et la sauvegarde
CLI se trouvent dans [SQL-STORAGE.md](SQL-STORAGE.md). Le bundle géré sélectionne
pg_dump ou snapshot natif selon le pilote ; un payload SQLite ne passe pas dans
pg_restore. Restaurer son fichier et ses preuves `.runtime` vers un chemin neuf.
Les anciens bundles sans champ database restent les dumps PostgreSQL historiques.
L’installation propriétaire reste sur PostgreSQL ; aucun transfert automatique
entre moteurs ni configuration SQLite de production n’est qualifié implicitement.

## Occurrences planifiées

Une occurrence réservée conserve son UUID dans le journal du moteur. Après crash,
le scheduler retrouve les résultats ; il ne remet pas automatiquement en file une
occurrence non terminée. La réconciliation existante traite les effets, puis la
fiche permet une clôture sans relance. Le test SIGKILL après effet fichier vérifie
ce chemin. Le compteur santé et le marqueur de maintenance incluent le scheduler.
Les dumps intègrent tasks/task_runs ; aucune nouvelle clé secrète de planning.
