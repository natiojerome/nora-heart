# Planification durable des tâches

La vue Tâches permet de créer un objectif lié à une conversation, définir une
échéance, modifier, mettre en pause/reprendre, exécuter immédiatement et consulter
l’historique. Les résultats et formulaires restent dans le chat existant.

## Définition et exécution

Une tâche conserve UUID, version, nom, instructions, conversation liée, planning,
règle de rattrapage, notification interne et état actif. Projet, modèle, effort,
accès fichiers et réseau sont **hérités du fil au début de chaque exécution**.
Pour des réglages indépendants, utiliser une conversation dédiée. Il n’y a pas
une seconde copie de configuration qui puisse diverger de celle du fil.

Un enregistrement de tâche ne lance aucune inférence. « Exécuter maintenant »
met une occurrence en file et ne décale pas l’échéance prévue. Chaque occurrence
a un UUID stable, un instant prévu, une révision, un instantané de l’objectif/fil,
son état et son lien de journal. Les notifications ne contiennent pas une seconde
transcription des réponses ; le journal du chat reste la source canonique.

Le moteur reçoit cet UUID comme identifiant d’exécution : s’il trouve déjà ce
travail, il ne rappelle pas le modèle et ne rejoue pas ses outils. Les états et
résultats restent distincts pour chaque nouvelle occurrence d’une récurrence.
L’exécution utilise les mêmes profils, skills, budgets et droits que les envois
manuels. Aucun réseau ou YOLO activé par le simple fait de planifier.

## Horaires

Le contrat stocke des horaires structurés : une fois, quotidien, jours ouvrés,
hebdomadaire. Date/heure et fuseau IANA sont explicites. Le formulaire ne choisit
pas une heure arbitraire ; il préremplit seulement le fuseau du navigateur, visible
et modifiable. Une date locale ponctuelle est convertie avec son fuseau côté serveur.
Les instants persistants sont normalisés en UTC ISO 8601 ; l’interface indique le
fuseau du planning pour l’échéance et conserve celui de l’occurrence.

Le module calendrier utilise [Temporal](https://github.com/js-temporal/temporal-polyfill),
sans imposer son format interne au stockage. En changement d’heure, la politique
`compatible` avance une heure locale inexistante et choisit la première occurrence
d’une heure répétée ; une récurrence n’est pas lancée deux fois le même jour local.
Les jours ouvrés sont lundi–vendredi, sans calendrier de jours fériés implicite.

Au démarrage, une échéance non réservée déjà passée suit le choix propriétaire :

- **Rattraper une fois** : une occurrence, puis prochaine échéance future. Pas de
  rafale pour tous les jours manqués.
- **Ignorer** : occurrence marquée ignorée, puis prochaine échéance future. Une
  échéance dépassée d’une période entière pendant le fonctionnement suit aussi
  cette règle ; le léger retard normal du polling reste accepté.

Une occurrence déjà mise en file reste une demande acceptée à traiter. Une pause
ou une modification annule les occurrences encore en file, laisse les travaux
lancés se terminer et recalcule le prochain horaire lors de la reprise. Pour une
tâche ponctuelle dont la date est dépassée, choisir une nouvelle date ou utiliser
l’exécution immédiate. Une exécution en erreur n’est pas retentée automatiquement ;
la prochaine récurrence autorisée est indépendante.

## Orchestration et reprise

Le planificateur est un petit service dans le processus web, séparé du core. Il
reçoit repository, calendrier et exécuteur via leurs contrats. Aucune nouvelle
boucle LLM, dépendance à Redis ou service commercial de planning.

Un seul leader par base : verrou consultatif PostgreSQL sur connexion dédiée,
ou verrou SQLite réel dans un fichier technique distinct. Pas de PID/TTL servant
de preuve de vie. Les réservations et avancements du planning sont atomiques,
avec unicité de l’occurrence planifiée et CAS des transitions. Une autre instance
reste en veille et peut prendre le relais après perte du verrou.

Une conversation occupée ou avec un formulaire antérieur fait patienter la tâche.
Une seule occurrence ouverte par tâche empêche les chevauchements et l’accumulation
pendant une attente. Plusieurs conversations peuvent avancer en parallèle. Un curseur de file évite
qu’une discussion occupée en première position bloque les tâches suivantes.

États : `queued`, `running`, `waiting`, `succeeded`, `failed`, `interrupted`,
`skipped`, `cancelled`. Une réservation abandonnée sans résultat vérifiable passe
« À vérifier » ; elle ne redevient jamais exécutable automatiquement. Les traces du
journal permettent de retrouver un succès ou un échec, et de suivre les résolutions
successives de formulaires jusqu’au résultat final. Une réponse humaine passe par
le parcours de reprise normal du chat, avec ses permissions courantes.

Après crash pendant un effet, utiliser la réconciliation de la conversation. Le
bouton « Clôturer sans relancer » ne rejoue rien ; il refuse de clôturer un travail
encore non réconcilié. Une réservation sans événement de moteur peut être clôturée
sans relance. Aucune garantie d’exactly-once d’un service externe n’est revendiquée.

## Configuration d’exploitation

- `HARNESS_SCHEDULER_ENABLED=0` : pas de boucle périodique au démarrage du web.
- `HARNESS_SCHEDULER_INTERVAL_MS` : défaut 5000 ms, délai de vérification serveur,
  configurable dans les limites natives de `setTimeout`.
- `HARNESS_SCHEDULER_CONCURRENCY` : défaut 2, visible dans la vue ; 0 sans plafond
  du planificateur. Les demandes supplémentaires attendent en file. Les travaux
  manuels du chat gardent leur contrôle indépendant.

Les tâches créées dans les tests n’existent pas en production. Livrer le
planificateur ne crée aucune routine active et ne déclenche aucun modèle.
Le marqueur de maintenance bloque les nouveaux dispatchs ; `/healthz` inclut les
travaux et réservations du scheduler dans le compteur de mutations. L’arrêt du web
stoppe la boucle, annule les inférences courantes via Conversations, attend les
écritures puis libère les verrous avant de fermer le stockage.

## Persistance et API

`contracts/tasks.ts` contient définitions, occurrences, repository, calendrier,
exécution et lease neutres. `modules/scheduling/calendar` calcule les horaires ;
`modules/scheduling/runner` orchestre les contrats. Les repositories SQL vivent dans
leurs modules de stockage ; l’app assemble et relie l’exécuteur aux conversations.

Migrations additives PostgreSQL **014** et SQLite **002** : `tasks` et `task_runs`.
Aucune migration appliquée antérieure n’est modifiée. Les définitions et états
survivent au redémarrage ; une sauvegarde normale inclut ces tables. PostgreSQL
reste le backend de production, aucun transfert vers SQLite.

- `GET /api/tasks?after=…&limit=20` : fenêtre de catalogue par UUID, derniers états
  de cette fenêtre, `nextCursor`, notifications globales non lues et état serveur.
- `POST /api/tasks` : création ; `POST /api/tasks/:id` : modification avec version.
- `POST /api/tasks/:id/active` : pause/reprise avec version.
- `POST /api/tasks/:id/run` : réservation manuelle avec UUID d’idempotence et version.
- `GET /api/tasks/:id?before=…&limit=20` : fiche et historique par curseur.
- `POST /api/tasks/:id/runs/:runId/read` : acquittement du statut observé.
- `POST /api/tasks/:id/runs/:runId/resolve` : clôture vérifiée sans relance.

Contrôles d’authentification/origine/CSRF habituels. Les changements concurrents
sont refusés sans perdre le brouillon. Une requête manuelle réémise avec le même
UUID retrouve la même occurrence ; le navigateur conserve cet UUID après une erreur
réseau. L’historique n’est pas limité aux vingt premiers résultats.

## Interface et notifications

Création/modification en overlay commun, contrôles personnalisés et champs lisibles
sur mobile. Recherche et pagination des conversations, sans les limiter aux premières
entrées. Fiche : pause/reprise, exécution immédiate, résultats et discussion liée à
chaque occurrence, y compris si la définition change ensuite de conversation.
Lecture de l’historique réouverte sans disparition des lignes ; requêtes périmées
invalidées après écritures ou déconnexion. Les cartes inchangées gardent leur DOM.

Les notifications sont **internes à Heart** : compteur non lu, états et lien vers la
discussion. Acquittement explicite, persistant, sans masquer un statut nouveau.
Pas de WhatsApp/e-mail, notification système ou push lorsque le navigateur est fermé.
Le suivi automatique reste silencieux : 15 s au repos dans Tâches, 3 s quand un
travail attend/s’exécute ou qu’une échéance est proche, 30 s ailleurs. Aucune lecture
en page cachée ou pendant l’édition, reprise au retour d’onglet. Le retour de
chargement reste réservé aux actions explicites. Données identiques : aucun changement
de DOM des cartes/statuts ; les pages d’historique, le focus et le défilement sont
conservés. Les corps des conversations ne sont pas repollés par ce suivi.
[Revue et mesures](qualification/tasks-review/README.md).

## Portée du premier lot et qualification

Pas encore d’archive/éditeur de fréquences libres,
calendrier de jours fériés ou permissions propres à une tâche. Ces extensions ne
sont pas nécessaires au fonctionnement livré. Le choix du modèle et les consentements
restent ceux du fil ; aucune garantie du jugement d’un LLM simulé.

[Preuves et limites](qualification/tasks/README.md) : tests SQL communs, calendrier,
idempotence, attente/formulaire, pause, rattrapage, migration, SIGKILL après effet réel,
interface mobile et modèles simulés. Aucun nouvel appel fournisseur réel pour ce lot.

## Consolidation et qualification

Suivi serveur incrémental par `SessionStore.page`, métadonnées seules et éviction
des occurrences fermées. Catalogue paginé, suite automatique au défilement, contrôleur
web typé et rendu hors écran natif. Code vérifié sur état isolé et qualifié avec
GPT‑6 Luna sur SQLite/PostgreSQL, dont résumés réels, interface et crash. Voir
[le protocole et les résultats disponibles](qualification/tasks-consolidation/README.md).

## Gérer depuis le chat

Le modèle dispose de `tasks.list`, `tasks.read` et `tasks.write` via TaskService.
write gère create/update/pause/resume/run_now ; read sans runId lit définition/version
et occurrences (before), avec runId les réponses canoniques et reprises (after).
Les curseurs ne sont pas interchangeables et les résultats ne donnent aucun droit.
Lecture/écriture des tâches accordées dans l’assemblage web, distinctes des accès
fichiers/réseau ; aucun paramètre de ces outils ne modifie les permissions du fil.

Les créations/lancements réémis avec la même identité moteur retrouvent la même
tâche/occurrence. Lancement = mise en file : le fil courant termine son tour avant
le travail. Les reçus de création/modification/pause/reprise/lancement ouvrent la
fiche commune. La consigne Tâches planifiées est éditable dans Instructions.
Heure/fuseau réellement manquants → formulaire ; aucun planning implicite pour une
simple discussion. [Qualifications réelles et limites](qualification/task-tools/README.md).
