# Architecture de Nora Heart

Le core, les contrats et les modules sont séparés physiquement. L’application
assemble les implémentations au démarrage. La mémoire est un module, pas un
composant imposé du core. Voir [STATUS.md](STATUS.md) pour les limites livrées et
[PLAN.md](PLAN.md) pour la suite.

## Installation et configuration initiale

`install.sh` clone le dépôt dans un chemin neuf ; `scripts/install.py` prépare
les dépendances et les unités systemd par UUID. Les services restent natifs pour
le terminal hôte ; PostgreSQL/SearXNG et le proxy optionnel utilisent Docker.
Web directement sur IP par défaut, domaine/HTTPS optionnel, `--private` pour
boucle locale. Origine et cookies correspondent au mode choisi ; utilitaires
navigateur UUID/copie compatibles HTTP sur IP. PostgreSQL/SearXNG restent privés.
Chemins explicites et données sous `<installation>/.heart` ; aucun
identifiant métier dérivé du dossier ni import des services existants.

`app/account-login.ts` réalise RFC 8628 auprès du portail HTTPS. Login/inscription
partagent ce même flux ; l’intention facultative `register` ajoute le paramètre
UI `screen_hint=signup` au lien public, sans changer le protocole d’authentification.
Le portail vérifie toujours lui-même la liste d’emails autorisés ; Heart ne reçoit
aucun mot de passe d’inscription. Inscription refusée si la machine est déjà liée. La première
installation est revendiquée par un lien local privé ; le portail authentifie
l’utilisateur et attribue les clés des services demandés via une extension Nora. Aucun mot de
passe MCP ni device/access token dans l’état navigateur. Une session Heart liée
au UUID du compte est requise sur les nouvelles installations ; les connexions
suivantes n’attribuent pas de nouvelles clés. Auth locale historique préservée.
`app/installation.ts` vérifie les endpoints/credentials MCP, conserve les secrets
dans un fichier privé et les références/schémas dans le repository existant.
L’entrée web charge uniquement les références d’environnement autorisées avant
la composition. Un changement applique les autorités au redémarrage, sans double
écriture ni repli ; le navigateur attend la révision active et reprend le wizard.
La configuration refuse les travaux actifs et suspend le scheduler pendant le
changement. Aucun mécanisme d’installation ou secret de compte dans le core.

La composition gérée signale une mémoire non configurée, omet ses outils/revue et
ne branche pas le repository SQL. Le choix d’un cerveau pendant l’onboarding est
persisté dans les défauts réutilisés par les nouveaux fils. Les installations et
fixtures existantes sans configuration gérée conservent leur assemblage explicite.

## Wallets : service local, stockage de reprise distant

`contracts/wallets.ts` sépare WalletService et WalletBackupStore.
`modules/wallets/local` implémente coffre AES-GCM, comptes préparés, cache d’actifs
et transport JSON-RPC HTTP sur socket Unix. `modules/wallets/unix` est le client
Node autonome ; Python utilise le même contrat avec sa bibliothèque standard.
`modules/tools/wallets` expose les outils du modèle via WalletService ;
`modules/storage/wallet-vault` adapte WalletBackupStore au MCP Vault officiel.
`app/wallets.ts` relie ces implémentations aux commandes et au daemon ;
`app/web-conversations.ts` raccorde le client aux droits courants des fils.
Le core et la base de conversations ne connaissent aucune implémentation wallet.
Découverte/reprise sont des méthodes WalletService et JSON-RPC/SDK, au même titre
que création/renommage. Callbacks injectés dans le module local : seul le child
worker connaît le transport Vault et charge son token. Les métadonnées passent
normalement ; l’archive privée revient par un pipe FD3 dédié. Le module local
vérifie puis fusionne par UUID sous verrou OS, rechiffre avec sa clé courante et
reconstruit les signataires ; aucun redémarrage ni déplacement manuel de coffre.
Les permissions de lecture/écriture s’appliquent, pas le bouton réseau des commandes
pour cette persistance approuvée. Les mises à jour RPC restent soumises au réseau.
Création/renommage passent par la même socket et des contrats neutres ; UUID de
création idempotent distinct du label. Mutations du coffre chiffré sous verrou OS
flock, relecture/validation et remplacement atomique ; signataires préparés en mémoire.
La sauvegarde immédiate et son regroupement sont orchestrés par callback injecté
par app/wallets : processus de backup séparé, seul lecteur du token Vault, sans
import d’un module concret par un autre. Le statut expose la révision courante
et celle sauvegardée, jamais l’enveloppe privée. Signature hors de ce chemin.


La signature opère en mémoire sans RPC/fichier/MCP ; inventaire et cache sont
locaux, actualisations explicites avec fraîcheur/portée. Le processus de sauvegarde
dispose seul du token Vault et vérifie la copie distante. Le Vault est une
autorité de confiance : archive chiffrée et clé de reprise y sont conservées.
Pas de service de signature distant ni nouveau MCP pour le chemin rapide.
Identifiants persistants UUID et CAIP-2 EVM, indépendants des libellés.
Le transport n’exporte aucune clé et le socket est réservé à ses comptes autorisés.
Il n’est pas un service multi-utilisateur ni un dispositif empêchant root d’accéder
aux secrets. Détails et limites dans [WALLETS.md](WALLETS.md).

## Fournisseur Venice AI

Prototype optionnel distinct `venice-web` dans le même module AI SDK : transport
local indépendant, enveloppes d’outils traduites et validées à la frontière ;
aucune exécution dans le proxy. Désactivé par défaut et non déployé : les essais
réels du 23 novembre sont refusés par Venice. Voir [VENICE-WEB.md](VENICE-WEB.md).

Venice est une sélection explicite du module models/ai-sdk existant, avec un
fichier interne venice.ts pour le catalogue. Aucune dépendance supplémentaire ni
import entre implémentations. L’app relie clés privées, catalogue/capacités et
choix du fil ; le core conserve son ModelProvider neutre. Effort, prix, outils et
contexte sont traduits à la frontière ; UUID des conversations inchangés.
Le catalogue public est actualisable, cache de capacités cinq minutes côté app.
Le web expose la connexion, le choix par fil et les défauts des nouveaux fils.
Le même module traduit les métadonnées Venice vers ProviderUsage : solde principal,
soldes détaillés et limites de débit. app/test-lab conserve un cache d’une minute
isolé par fournisseur/modèle/clé et regroupe les lectures simultanées. Le core
n’importe ni facturation ni client Venice. Aucun stockage SQL ajouté.
Voir MODELS.md pour le contrat HTTP et la portée de qualification.

## Personnalité et rétention du contexte

L’app compose les défauts de personnalité avec un ton amical pour l’utilisateur
et cordial/professionnel à l’extérieur ; les textes personnalisés restent prioritaires.
Les contrats context incluent maxSummaryCharacters et recentTurns. Le module
bounded garde jusqu’à quatre tours récents complets selon la fenêtre, adapte le
résumé et l’injection mémoire au budget réel et conserve tous les originaux.
Pas de limites fixes de résumé/injection par défaut ; réglages explicites conservés.
L’app relie `modules/tools/history/index.ts` au SessionStore et à l’UUID du fil.
`history.read` relit les originaux paginés avec recherche et date, sans SQL dans
l’adaptateur, sans accès inter-fil et sans duplication persistante des résultats.
Le core connaît seulement la permission et le caractère transitoire du contrat.

## Erreurs d’appels de modèle récupérables

Le contrat ModelToolCallError transporte uniquement des codes et noms d’outils
approuvés. Le module AI SDK rejette le lot entier avant exécution et traduit
localement les noms Heart exacts vers leurs alias. Le core conserve les résultats
valides, journalise le diagnostic sûr et prépare un tour de correction du même
modèle selon les budgets existants. Aucun type SDK, argument invalide ou repli
fournisseur dans le core ; aucun changement de permissions ou de stockage.

## Organisation en place

```text
src/
  contracts/
    tasks.ts                calendrier, tâches, occurrences et repository neutres
    skills.ts               catalogue et lecteur de skills neutres
    assistant.ts            profil et préférences versionnés
    instructions.ts         clés stables et surcharges de consignes
    assistant-presets.ts    packs visuels et modèles de personnalité
    conversation-defaults.ts défauts copiés dans les nouveaux fils
    usage.ts                contexte estimé et métadonnées fournisseur
    json.ts                 valeurs sérialisables
    interactions.ts         questions, réponses et reprise neutres
    messages.ts             messages et appels d’outils
    context.ts              ContextManager et budget par modèle
    conversations.ts        catalogue et sélection neutre du cerveau
    chat-assets.ts          références de fichiers, prompts et repository
    models.ts               ModelProvider
    memory.ts               MemoryService, MemoryRepository et Memory
    structured-memory.ts    gestion versionnée et repository structuré
    projects.ts             UUID et catalogue de projets
    project-tracking.ts     fiche, objectifs hiérarchiques et commandes de suivi
    storage.ts              SessionStore, événements et StorageConnection
    sql-storage.ts          contrat complet des repositories SQL et reprise
    external-tools.ts       connexions, schémas approuvés et repository MCP
    tools.ts                outils et permissions
    files.ts                espaces fichiers et niveaux d’accès
    execution.ts            commandes, état, sortie et ExecutionService
  core/
    engine.ts               boucle, pause/reprise et contrôles
    interactions.ts         état interactif depuis le journal
    recovery.ts             preuves et réparation des interruptions, sans exécution
  modules/
    skills/local/index.ts   manifeste explicite, YAML et ressources
    models/demo/index.ts    fournisseur déterministe de démonstration
    models/ai-sdk/index.ts  adaptation AI SDK, clients directs et validation Ajv
    models/chatgpt/        OAuth, credentials privés, Responses SSE ; entrée index.ts
    context/bounded/index.ts construction et compression du contexte
    memory/review/index.ts  décision explicite avant clôture, sans exécution ni SQL
    memory/basic/index.ts   règles mémoire et recherche textuelle de démo
    memory/structured/index.ts portées, validation, classement et versions
    storage/
      postgres/index.ts     connexions, transactions et repositories SQL
      postgres/migrations/  SQL versionné
      sqlite/index.ts       ouverture/migration/snapshot, entrée publique
      sqlite/repositories.ts repositories SQLite des contrats communs
      sqlite/sessions.ts    journal, claims et réconciliation
      sqlite/leases.ts      verrous OS via bases SQLite de contrôle/propriété
      sqlite/migrations/    schéma SQL versionné propre au module
      json/index.ts         stockage fichiers de démonstration
    search/searxng/index.ts recherche et lecture publiques sans quota commercial
    tools/
      tasks/index.ts        adaptateur TaskService en trois outils JSON Schema
      mcp-server/index.ts  exposition MCP de Tool injectés, loopback
      mcp/index.ts          client MCP Streamable HTTP et validation
      interactions/index.ts questions validées, aucune persistance concrète
      files/index.ts        LocalFiles, CRUD et remplacement ciblé révisé
      terminal/index.ts     exécuteurs Bubblewrap/host, client Unix et outils terminal
      memory/index.ts       outils qui consomment MemoryService
      memory-structured/index.ts outils enrichis via StructuredMemoryService
  app/
    task-progress.ts        projection incrémentale des états de tâche, sans corps
    tasks.ts                service des tâches et lien avec Conversations
    skills.ts               activation et contexte des skills par tour
    assistant.ts            profil, patchs ciblés et conflits
    assistant-presets.ts    catalogue initial de personnalisation
    account-quota.ts        collecteur de quotas en lecture seule
    host-terminal.ts        assemblage du worker YOLO optionnel
    config.ts               validation et résolution de configuration
    compose.ts              sélection, construction et fermeture des modules
    chatgpt.ts              composition et commandes de connexion par abonnement
    test-lab.ts             assemblage des essais web isolés et des suites
    external-tools.ts       approbation, configuration et outils distants
    project-context.ts      fiche MCP actuelle réinjectée par préparation
    memories.ts             administration des souvenirs
    project-management.ts   suivi des projets via contrats injectés
    conversations.ts        catalogue, envoi et annulation dans un fil persistant
    workspace.ts            commandes propriétaire et journal fichiers séparé
    chat-assets.ts          validation, résolution des médias au bord modèle
    web-conversations.ts    assemblage SQL/contexte pour le web
    web-access.ts           invitations et sessions d’accès au web
  interfaces/
    cli.ts                  démo
    migrate.ts              commande de migration
    chatgpt.ts              connexion, catalogue, test et déconnexion
    web.ts                  démarrage HTTP
    web/server.ts           routes et contrôles HTTP
    web/public/             interface web statique
    web-invite.ts           émission explicite d’invitation privée
```

Les entrées publiques de chaque implémentation sont ses `index.ts`.
Pas de dossiers vides, de microservices ou de gestionnaire de plugins générique.

## Dépendances autorisées

| Zone | Peut dépendre de |
| --- | --- |
| `contracts` | Autres contrats uniquement. |
| `core` | Contrats, autres fichiers du core et fonctions natives Node. |
| Une implémentation dans `modules/<famille>/<nom>` | Contrats, ses propres fichiers et bibliothèques techniques nécessaires. |
| `app` | Contrats, core et entrées publiques des modules. |
| `interfaces` | Application, contrats et code de présentation de l’interface. |

Un module ne construit pas une autre implémentation. Il reçoit ses dépendances
via les contrats. La CLI ne construit ni pool PostgreSQL ni module mémoire.
Le test `tests/architecture.test.ts` analyse les imports TypeScript et vérifie
ces frontières, y compris les imports dynamiques littéraux.

## Mémoire et base de données

```text
app/compose.ts
  -> ouvre le stockage PostgreSQL ou fichiers
  -> construit BasicMemory avec storage.memories
  -> construit les outils mémoire avec MemoryService
  -> fournit les outils et SessionStore au core
```

`MemoryService` expose `remember` et `search` aux outils et au
constructeur de contexte des conversations web. Le web emploie
`structured` derrière le repository local ou le repository MCP explicitement sélectionné, tandis que `basic` reste disponible pour la démo et la compatibilité. `MemoryRepository` expose `save` et `find` à une
implémentation de mémoire qui a besoin de persistance.

Les contrats structurés ajoutent portées, versions et correction/oubli.
`app/web-conversations.ts` construit une mémoire limitée au projet du fil, les
outils correspondants et le contexte. Le core ne connaît pas ces portées.
`app/memory-instructions.ts` fournit la politique conversationnelle commune aux
fournisseurs : faits durables utiles, recherche de doublons, refus et confirmation
après sauvegarde. `app/memory-policy.ts` fournit la règle unique d’initiative et de
consentement aux consignes principales et, par injection explicite, au module de revue.
Les faits personnels courants, dont prénom/lien d’un proche, ne déclenchent pas une
demande d’accord systématique ; sensibilité réelle et ambiguïté restent distinctes. Le web compose aussi `modules/memory/review` via le contrat optionnel
`CompletionReview` : une décision explicite du même modèle est demandée avant la
première réponse finale du tour. Les effets proposés repassent par la boucle outils ;
le core ne connaît que ce contrat, sans règle mémoire, SQL ou fournisseur concret.
Un audit `run.progress` de kind review consigne les catégories, hors bulles de chat.
Un échec préserve la réponse et ajoute l’avertissement fourni par le module.
Ce contrôle mémoire ajoute un appel modèle par tour terminé hors démo/modèle sans outils ;
aucune reprise rétroactive ni décision mémoire en boucle. Après effets, une
vérification de stockage sans inférence peut précéder le contrôle des projets.
L’outil `memory.get` refuse les souvenirs oubliés, même avec un UUID connu ;
le service administratif conserve leur lecture pour restauration et historique.
Voir [MEMORY.md](MEMORY.md).

Le module `basic` valide les souvenirs, crée leurs identifiants, prépare les
termes de recherche et fixe la limite de résultats. Le repository gère les
lectures/écritures, la déduplication atomique et l’ordre des résultats. Le SQL,
les connexions et le format des fichiers restent dans les modules de stockage.

Une mémoire externe peut implémenter `MemoryService` sans utiliser le repository
local. Les sessions continuent alors à utiliser leur propre stockage. Aucun
passage obligatoire par PostgreSQL pour toutes les futures mémoires.

## Ajouter une implémentation

Pour ajouter une mémoire `exemple` :

1. Créer `src/modules/memory/exemple/index.ts` et y exposer une implémentation
   de `MemoryService` ; utiliser les contrats pour ses dépendances.
2. Importer son entrée publique dans `app/compose.ts` et ajouter sa factory
   à la liste explicite `memoryModules`.
3. Choisir `"modules": { "memory": "exemple", "model": "demo" }` dans la configuration.
4. Tester ses comportements et son remplacement, puis actualiser l’état et les choix.

Même principe pour un fournisseur de modèles dans `modules/models/<nom>` et
`modelModules`. Ajouter un stockage exige sa configuration et son assemblage
explicites ; aucun scan de dossiers ni import construit depuis une chaîne.
Les outils sont actuellement assemblés explicitement, sans sélection par nom
individuel dans le fichier de configuration.

Les options AI SDK sont validées dans `app/config.ts`, les références de clés
résolues dans `app/compose.ts`, puis passées au module. Aucun système universel
de configuration ou de découverte n’est nécessaire. Le module `chatgpt` utilise
ses propres options et son répertoire privé de credentials, sans passer par
le stockage des souvenirs/sessions. `compose` attend la construction du modèle
et contrôle la connexion avant d’ouvrir le stockage applicatif.
Voir [MODELS.md](MODELS.md) et [CHATGPT.md](CHATGPT.md).

## Exécution et garanties

Le core relit l’historique, appelle le modèle, contrôle les droits, journalise
les appels et exécute les outils fournis. Les contrôles communs restent
obligatoires quelle que soit l’implémentation. Changer une stratégie de boucle
plus tard devra conserver cette règle.

Chaque run conserve sa configuration. Le changement de modèle intervient entre
deux runs, après adaptation du contexte et contrôle des capacités. Les formats
persistants appartiennent au harness, pas à un fournisseur. Les identifiants
sont indépendants du nom affiché et du chemin du dépôt.

Les messages utilisateur acceptent des références neutres de pièces jointes.
Les octets sont résolus par app avant adaptation en image/PDF/texte, sans base64
dans les événements. Streaming, consommation et erreurs enrichies devront être
ajoutés sans exposer les types
internes d’un SDK au core. AI SDK et Ajv sont encapsulés à la frontière modèle ;
MCP est adapté dans tools/mcp via Streamable HTTP ; les connexions et snapshots
JSON Schema approuvés utilisent un contrat neutre (migration 012). Les types SDK
ne deviennent pas le format des sessions. Voir [MCP.md](MCP.md). Les alias de noms d’outils sont locaux
à cet adaptateur ; le core conserve les noms et permissions du harness.

Une action commencée au résultat inconnu exige une réconciliation avant
répétition. L’annulation d’une attente ne prouve pas l’arrêt d’une action
externe. Le claim PostgreSQL sérialise les runs d’un même fil et reste bloqué après
un crash jusqu’à réconciliation. Le mode JSON reste limité à un propriétaire.
Ces limites sont détaillées dans [STORAGE.md](STORAGE.md).

## Diagnostics web de développement

L’Atelier est retiré de la navigation utilisateur. Sa route technique et ses
essais restent disponibles pour les diagnostics et tests automatisés.
L’UI est une interface supplémentaire, pas un nouveau moteur : `app/test-lab.ts`
assemble les modules existants et le même core dans un espace temporaire. Les
sessions d’accès web sont distinctes du journal d’exécution. Le secret de
signature, les clés API et la connexion ChatGPT vivent hors du dépôt et de la
mémoire. Le stockage JSON de chaque essai est choisi explicitement ; aucune
connexion implicite aux données PostgreSQL existantes.

L’adaptateur HTTP n’importe que `app` ; le rendu Markdown utilise seulement des bundles locaux Marked/DOMPurify. Le relais de callback ChatGPT utilise le module OAuth existant et
conserve ses validations, avec une remise d’adresse manuelle côté navigateur.
Les chemins, le déploiement et les limites sont décrits dans [WEB.md](WEB.md).

## Évolution sans complexité inutile

Conserver des contrats courts, des dépendances visibles et une composition
explicite. Prévoir les remplacements sans multiplier les implémentations
inutilisées. Planification, contexte, routage et interfaces supplémentaires
s’ajouteront à ces frontières lorsqu’ils seront développés.

Un outil chargé dans le processus est du code de confiance ; une interface
TypeScript ou MCP ne constitue pas une isolation système. Aucun secret dans
les données mémoire, les logs ou les configurations versionnées.

## Conversations et contexte

Le web assemble aussi des conversations persistantes SQL via
`app/web-conversations.ts`, distinctes des essais temporaires. Le core reçoit
un `ContextManager` optionnel ; `modules/context/bounded` construit la requête,
recherche les souvenirs via `MemoryService` et journalise les points de reprise
via `SessionStore`. Aucun module n’importe un autre module concret.

Le catalogue de fils utilise `ConversationRepository`. Les messages restent le
journal canonique ; la compression n’efface rien et ne crée pas de souvenir
personnel. La même conversation visible peut contenir plusieurs segments LLM.
Voir [CONVERSATIONS.md](CONVERSATIONS.md) et [CONTEXT.md](CONTEXT.md).

## Ressources visuelles

Le pack de base proposé est statique : logo et avatar de conversation Nora Aurora,
référencés séparément par leurs emplacements d’usage. `AssistantAvatarPack` décrit
un UUID stable, un nom affiché et ses ressources ; `app/assistant-presets.ts` fournit
le catalogue approuvé. Le profil conserve `avatarPackId`, jamais le nom affiché
ou le dossier. Renommer l’assistant ne change pas son pack. Seul ce pack de base
est proposé actuellement ; les anciens essais Orion/Prisme ne sont pas réactivés.
Pas de vidéo, WebP animé ou personnage au-dessus de la saisie. Champs/fichiers
historiques conservés pour compatibilité. Logo, portrait, personnalité et thème
restent indépendants du core et du fournisseur LLM.

## Profil de l’assistant et présentation

`contracts/assistant.ts` sépare `AssistantSettings` et son repository.
`app/assistant.ts` valide les choix ; `storage/postgres` les conserve par UUID
d’instance (migration 004, version optimiste). `app/web-conversations.ts`
injecte les instructions du profil aux runs, via une option générique du core.
Le premier choix de personnalité initialise `personalityInstructions` à partir
d’un modèle (`professional`, `warm`, `direct`, `creative`). L’utilisateur peut
modifier ce texte librement ; il devient la source effective de personnalité,
sans réinjection cachée du ton du modèle de départ. Nom et genre restent des
champs d’identité. Longueur/initiative historiques servent seulement à initialiser
les profils anciens qui n’ont pas encore de texte libre.

Le profil JSONB existant garde texte et pack, sans migration. `get()` normalise
un ancien profil en lecture seule, sans écriture ni changement de version ; les
anciens clients qui n’envoient pas ces nouveaux champs préservent les retouches.
Le catalogue de modèles de personnalité et packs est communiqué dans l’état
HTTP authentifié. Aucun LLM n’est appelé pour installer ou éditer une personnalité.

Après installation, Mon assistant ouvre Configuration → Assistant ; sa carte Identité et
personnalité donne accès au nom, genre, texte et pack (Identité visuelle), avec
remplacement explicite du brouillon par un modèle ou le défaut de personnalité.
Configuration réunit aussi les onglets Apparence, Discussions (défauts des
conversations) et Instructions (onze blocs de fonctionnement). L’aperçu de présentation et le défaut de personnalité
sont dérivés du profil pour l’API, sans seconde valeur persistante. Le patch
ciblé utilise version et valeurs de base : les changements indépendants de thème
ou de défauts sont conservés, les conflits sur les mêmes champs restent refusés.
L’application injecte uniquement le texte de personnalité courant aux prochains
runs ; changer de cerveau ne le régénère pas.

Le core n’importe ni profil, ni thème, ni avatar. `ui.js` gère uniquement la
présentation et le setup ; `app.js` garde les contrôleurs API. Voir [UI.md](UI.md).

Le chat a un contrôleur de présentation `chat.js` et une feuille `chat.css`,
sans accès direct au réseau ni aux credentials. Les appels restent dans
`app.js`. Les dépendances Markdown n’entrent dans aucun contrat du core.

Le design de l’ensemble de l’interface est adapté de Nora : tokens CSS,
barre supérieure et tiroirs natifs, sans dépendance React ni pont vers son
runtime. La navigation et la liste des fils utilisent des dialogues natifs ;
leurs contrôleurs restent dans `ui.js`, sans modification des contrats métier.

`feedback.js` est un petit contrôleur de présentation partagé : début/fin des
requêtes HTTP, indicateur et annonces accessibles, verrouillage du formulaire
actif et statut dans la couche modale. `app.js` conserve les appels et mutations ;
`ui.js` ouvre les éditeurs natifs. Aucun contrat, module ou schéma SQL modifié.

`components.css` porte le contrat visuel partagé (barres fixes, champs, choix, actions,
feuilles). `controls.js` adapte les selects natifs en feuilles accessibles et
synchronise leurs valeurs ; aucune donnée métier ni requête réseau dans ce
contrôleur. Les valeurs/événements natifs alimentent toujours `app.js`. Pas de
framework de composants ni de dépendance externe supplémentaire.

Les barres de page gardent leur en-tête dans la vue correspondante ; CSS les
ancre sous la navigation et réserve l’espace du contenu. Le catalogue SVG de
`ui.js` est partagé entre menu et titres via `paintIcons`, y compris pour les
projets créés dynamiquement. Aucun portail ou nouveau gestionnaire de navigation.

## Valeurs par défaut des conversations

`ConversationDefaults` est un contrat neutre : sélection modèle (fournisseur,
identifiant, contexte et effort facultatif), mode fichiers/exécution et réseau.
`app/conversation-defaults.ts` valide ces valeurs. Le profil assistant conserve
ce champ optionnel dans son JSONB existant ; aucun nouveau schéma SQL. L’API
GET/POST `/api/conversation-defaults` utilise la version optimiste du profil,
l’authentification et le CSRF existants. Un ancien client qui sauvegarde seulement
la personnalité conserve les valeurs par défaut déjà enregistrées.

`app/web-conversations.ts` injecte un lecteur des valeurs par défaut dans
`Conversations`. La création copie les valeurs dans le fil, sans toucher aux
anciens fils. Le core ne connaît pas les préférences globales ; il reçoit toujours
les permissions et le modèle effectifs de ce fil. YOLO implique le réseau et
une création échoue explicitement si le worker root manque, sans repli de mode.
L’effort est proposé depuis les capacités du modèle et reste validé à l’envoi.
La sauvegarde des défauts renvoie le profil confirmé : l’UI le réutilise directement,
sans dépendre d’une seconde lecture globale pour annoncer le succès. Le formulaire
reste intact en cas d’échec ou de conflit. Avec `baseDefaults`, une version devenue
ancienne peut être rapprochée si les défauts n’ont pas changé ; un conflit portant
sur ces mêmes valeurs reste refusé. Apparence utilise une modification ciblée de
`theme` avec sa valeur de base, pour préserver les autres préférences. PostgreSQL
reste le dernier contrôle de version : aucune écriture concurrente écrasée.

`preferences.js` gère le formulaire dédié en overlay, les catalogues indépendants
de la sélection du chat et Consommation.
Cette dernière lit les fournisseurs connectés via `ProviderUsage` : dépenses
OpenRouter de la clé (total/jour/semaine/mois), budget ou solde, resets, quotas
ChatGPT du même compte. Périodes du fournisseur, périmètre annoncé ; aucune somme
présentée comme dépense exclusive Heart. OpenAI/Anthropic : facturation absente
avec les connexions actuelles, absence explicite plutôt que zéro. Lectures
parallèles, rafraîchissement 60 s et manuel ; aucun appel d’inférence.

Les filtres Conversations et Mémoire restent dans une barre fixe sous l’en-tête
de page, avec marge intérieure et espace réservé dans le contenu. Les vues
Confidentialité et Activité sont retirées ; les permissions restent dans les
réglages et le suivi de réponse dans le chat.
Les portées mémoire restent Personnel et Projet, avec aide et accès à la création
d’un projet lorsqu’il n’en existe pas.

## Compteurs du chat

La liste de conversations est distincte du chat ouvert : largeur complète sur
mobile, métadonnées du dernier modèle/effort enregistré et filtre par UUID de
projet combiné à la recherche. Les mêmes contrôles alimentent le tiroir des fils ;
aucun nouveau contrat ni stockage. La barre d’usage est masquée dans la liste.

Une troisième barre sous le titre du fil affiche messages, contexte, crédits/budget
et reset. `usage.js` gère les compteurs et leur détail en lecture seule. Les badges
modèle/accès/effort restent au-dessus du composeur. Compteurs inconnus : « — »,
jamais zéro inventé. Feuille accessible, actualisation visible, liens fournisseur.

`ContextOptions.onPrepared` remonte l’estimation du contexte final préparé, après
injection mémoire et éventuelle compression. Le core journalise `context.usage`
avec fenêtre, réserve, date et identité fournisseur/modèle. Aucun appel LLM
supplémentaire. L’application expose la dernière mesure et compte les messages sur
une projection incrémentale de tout le journal, indépendamment de la page envoyée au navigateur. Le
pourcentage indique l’entrée estimée du dernier appel préparé, hors réponse et
brouillon ; il est masqué si le modèle choisi ne correspond plus à la mesure.
Les anciens fils sans mesure restent sans pourcentage jusqu’au prochain appel.

`ProviderUsage` décrit les valeurs de facturation disponibles, leur portée et
leur source ; il ne dépend ni de PostgreSQL ni du core. Le module AI SDK traduit
les métadonnées OpenRouter. `TestLab.usage` utilise les credentials privés existants,
met en cache 60 secondes et mutualise les lectures en cours. Route authentifiée
GET `/api/provider-usage`, sans clé, label ou identité privée dans sa réponse.
Le navigateur ignore les réponses tardives d’un autre modèle et propose Actualiser.
Aucune dépense, recharge ou consommation de crédit de reset.

OpenRouter : GET `/api/v1/key`, budget effectif ou plafond de clé, et quota journalier
si modèle `:free` et donnée fournie. GET `/api/v1/credits` uniquement si la clé se
déclare de gestion ; sinon aucun solde de compte supposé. Un reset de budget reste
identifié comme tel même si un solde de compte est disponible. Une périodicité
seule n’est jamais convertie en date. ChatGPT direct ne communique pas les compteurs
Codex de Nora ; OpenAI/Anthropic n’ont pas de lecture de facturation raccordée.
Ces absences restent explicites. Pas de nouvelle migration SQL.

## Prompts et pièces jointes du chat

`ChatAssetsRepository` est indépendant de `SessionStore` et de la mémoire.
Son implémentation PostgreSQL vit dans le module stockage ; `app/chat-assets.ts`
valide les entrées et hydrate le modèle pour une conversation précise. L’assemblage
web injecte ce service, sans client SQL dans le core ou les adaptateurs modèles.
Migration additive 005 : `quick_prompts` et `chat_attachments` (octets bytea).
Le core conserve les références et gère le signal d’annulation ; il ne dépend
ni du navigateur, ni de l’interface de prompts, ni d’un format de média fournisseur.

## Activité en cours

`ModelRequest.onActivity` est une notification facultative de phase, définie
par le contrat neutre. Le core annonce préparation/attente et relaie les signaux
d’adaptateur ; ChatGPT traduit les événements SSE d’analyse/rédaction en phases,
sans collecter leur texte, état chiffré ou métadonnées privées. Le callback n’est
pas un message et ne change pas le contexte envoyé au modèle.

`Conversations` conserve phase, date et compteur de tours dans chaque run actif.
`GET /api/conversations/:id` les expose avec le journal. Le contrat facultatif
`ModelRequest.onProgress` accepte seulement des commentaires publics. Le core
journalise `run.progress` (migration additive 011), déduplique les commentaires
identiques et ignore les callbacks tardifs. Le texte public accompagnant une
réponse avec outils devient aussi un point d’avancement. Les adaptateurs actuels
n’extraient pas de pensées privées ; sans commentaire, le panneau garde une phase
neutre. Ces événements ne sont pas injectés comme messages supplémentaires au LLM.

Les conversations ont chacune leur run et leur annulation ; un claim protège un
même fil. Une fermeture HTTP n’annule plus un envoi ou une reprise interactive :
seul Arrêter, le signal serveur ou une erreur clôture le travail. L’arrêt normal du
service annule les runs et attend leur clôture avant de fermer PostgreSQL. Un crash
exige toujours une réconciliation, sans rejeu automatique ou file durable de tâches.

`GET /api/conversations/work` fournit UUID/titre/état sans charger les historiques.
PostgreSQL projette les états terminaux depuis le journal ; l’app superpose les runs
actifs. `work.js` les suit toutes les 1,8 s lorsqu’un travail existe, onglet visible,
et au retour au premier plan. Seul le chat ouvert conserve son GET historique par
seconde. Badge, liste de travaux et arrêt ciblé sont disponibles dans Conversations.

`chat-turns.js` présente un panneau compact de commentaires publics/phases et
compte les opérations réellement lancées. Les blocs techniques d’outils ne sont
pas rendus dans le chat ; le journal backend reste complet.
Les résultats mémoire réussis deviennent des cartes datées (création, correction,
oubli, restauration), reconstituées depuis le journal et ouvrant la version actuelle
via `GET /api/memories/:id`. Les erreurs et appels non exécutés ne créent aucune carte.
Aucune opération mémoire supplémentaire n’est déclenchée pour afficher ces cartes.
Le texte final n’est pas encore streamé.

## OpenRouter et qualification réelle

Le module `models/ai-sdk` adapte aussi Chat Completions OpenRouter ; le choix
reste explicite dans `ModelSelection` et la configuration. Il utilise le modèle explicitement choisi, sans repli. Le mode de qualification
`freeOnly` impose :free et prix maximal nul ; il est distinct du choix utilisateur. Aucun changement
du core, de la mémoire ou du format du journal. Les routes directes OpenAI et
Anthropic sont conservées. Le web utilise le même stockage privé de clés.
Le runner opt-in `tests/live-openrouter.ts` assemble les implémentations réelles
sur une base et un workspace temporaires. Il ne fait pas partie des tests
unitaires simulés ; sans `--live` ou clé, aucun appel. Les erreurs AI SDK
portent un code borné (SDK, réponse vide/incomplète, outil invalide), sans corps
fournisseur ni exception brute ; le runner capture ce code avant la traduction
HTTP de l’application. Le mode payant opt-in
reste sur un identifiant explicite et ajoute un plafond de prix fournisseur,
une réservation de coût avant chaque requête et au plus 24 appels (14 par défaut). Ce contrôle
est propre au runner, pas un budget global des conversations web. Voir OPENROUTER.md.

Le catalogue public OpenRouter est adapté dans `models/ai-sdk`, puis exposé par
l’app et HTTP. Le navigateur conserve un catalogue courant avec fournisseur,
horodatage et version de requête pour ignorer une réponse tardive d’un autre
fournisseur. Rafraîchissement manuel et à la reprise après cinq minutes, sans
boucle d’inférence ; aucun client SQL ni dépendance de catalogue dans le core.

Le catalogue inclut les modèles texte gratuits et payants, leurs prix USD par
million de tokens, contexte et capacités. Les modèles sans outils restent
sélectionnables ; lorsqu’ils sont connus du catalogue, l’adaptateur omet les
définitions d’outils. Les métadonnées enrichissent les options du select natif ;
le contrôleur de feuille les présente sur deux lignes compactes avec filtres
facultatifs. Aucune tarification ou logique de catalogue n’entre dans le core.

## Espaces fichiers

Le module `tools/files` implémente le contrat `WorkspaceFiles` et ses outils,
indépendamment du modèle. Le core conserve les contrôles habituels ; app assemble
les permissions none/read/write persistées par fil (migration 006, lecture par
défaut). Le workspace UUID du fil est le périmètre protégé ; YOLO utilise les
chemins du serveur via HostFiles. Flux
AsyncIterable<Uint8Array> pour import/téléchargement tous formats ; lecture UTF-8
et listes paginées, sans plafond global de fichier imposé. L’adaptateur outils
remplace les longues révisions par des références de lecture éphémères, liées au
chemin et résolues dans le même ensemble d’outils vers le SHA-256 canonique. La
persistance et l’UI gardent leurs révisions complètes ; le contrôle de conflit est
inchangé. Une référence expirée impose une relecture, sans résolution implicite
vers une version plus récente.
`app/workspace.ts` utilise Engine pour les mutations manuelles, sans LLM : journal
d’audit séparé, contenu de l’éditeur hors journal, claim partagé avec le fil.
Le navigateur a un contrôleur `workspace.js`, un panneau de réglages de fil
commun au modèle, aux permissions et au contexte, et des overlays fichiers
réutilisant les composants Nora. `ui.js` fournit heartSettings.open pour tous
les points d’entrée ; le DOM des contrôles est déplacé, jamais dupliqué. Le
menu Fichiers et le bouton du chat partagent le même explorateur. Voir [FILES.md](FILES.md).

## Mode Développement

`contracts/execution.ts` reste indépendant du core, du stockage et des SDK.
`modules/tools/terminal` implémente ExecutionService et les outils associés.
L’app construit une instance partagée, puis l’injecte dans les conversations et
les outils ; aucun module ne construit une autre implémentation concrète.
Bubblewrap assure des namespaces Linux et un montage du seul espace du fil,
sans credentials parent ; aucun shell hôte en repli. Les commandes et sorties
sont persistées hors du montage du projet, avec identifiant et code de sortie.

La permission process.execute est accordée par le core en modes develop et yolo. Réseau
et budget de tours sont persistés séparément du modèle (migration 007). Le web
utilise maxSteps=0, jusqu’à réponse finale ou annulation, et expose un budget
positif facultatif. Le core conserve ses contrôles et sa compatibilité CLI ;
les AGENTS.md racine sont composés par app dans les instructions du run.
`files.replace` effectue un remplacement texte unique et révisé en flux ; les
diffs unifiés passent par Git apply natif. Pas de format propriétaire de patch.
Voir [DEVELOPMENT.md](DEVELOPMENT.md) pour les écarts explicites à la cible Codex.

Le mode YOLO (migration 008) est un choix durable par fil. L’app sélectionne
HostExecutionClient vers un worker root optionnel sur socket Unix privé ;
`app/host-terminal.ts` assemble HostExecution et LocalFiles en mode hôte.
HostFiles implémente WorkspaceFiles sur le même socket : l’app sélectionne cette
factory pour les outils et l’explorateur YOLO. Import/téléchargement en flux,
révisions conservées et aucune construction croisée de modules. Le mode protégé
garde LocalFiles confiné ; le workspace UUID est seulement le départ en YOLO.
terminal.exec attend brièvement (yieldTimeMs, 500 ms par défaut) et retourne
statut/sortie sans imposer terminal.read aux commandes courtes.
L’interface `host-terminal.ts` démarre ce worker sans credentials du web.
Les commandes host sont des unités systemd transitoires, hors du sandbox et du
budget de ressources web. L’arrêt utilise leur cgroup ; aucun shell hôte en repli
du mode isolé. Contrat ExecutionService identique, pas de dépendance core au mode
ou à systemd. Portée réelle et administration complète explicites dans l’UI.

## Inventaire effectif des outils

Le core filtre les outils par permissions et par la capacité optionnelle
ModelProvider.supportsTools (false pour un modèle explicitement sans appels
outils). Il construit l’inventaire courant dans les instructions avant le calcul
de contexte : mêmes noms canoniques que les définitions, aucun ancien plafond ni
outil parallèle implicite. L’app précise séparément le mode et sa portée.
Les adaptateurs conservent ces noms dans les descriptions malgré leurs alias de
transport ; le journal et les permissions restent indépendants de ces alias.
Le wrapper de pièces jointes conserve la capacité du fournisseur.

run.started enregistre noms déclarés, permissions et capacité d’appel, sans
arguments, secrets ni schémas dupliqués. Le panneau Contexte montre cet inventaire
pour le dernier envoi ; un ancien run sans snapshot est explicitement signalé.
Les changements de droits prennent effet au prochain run ; l’inventaire ne
constitue pas une détection des programmes installés derrière le terminal.
Aucune migration SQL ni recherche LLM supplémentaire pour cet affichage.

## Réglages par modèle

ModelSelection conserve reasoningEffort optionnel, chaîne neutre sans type SDK.
Chaque frontière adapte les capacités : catalogue ChatGPT du compte ; objet
`reasoning.supported_efforts`/`default_effort` OpenRouter (champ absent = pas de
choix, null = valeurs gateway, mandatory exclut none) ; Models API Anthropic avec
`capabilities.effort` ; Models API OpenAI et niveaux publiés des familles reconnues
si cette métadonnée manque. Les modèles inconnus n’ont aucun niveau inventé.
GET authentifié `/api/model-capabilities` prend fournisseur et identifiant ; aucune
clé ni réponse brute renvoyée. Les appels sont des lectures de métadonnées.

App valide l’effort contre les capacités du fournisseur/modèle sélectionné,
puis le module traduit : ChatGPT et OpenAI Responses → `reasoning.effort`,
Anthropic → `output_config.effort`, OpenRouter → `reasoning.effort` avec routage
exigeant la prise en charge des paramètres. Automatique omet le paramètre. Le transport de frontière préserve l’effort
validé même si le modèle est plus récent que la table interne du SDK.
La sélection JSONB existante conserve la valeur, sans migration ; core inchangé.
Le formulaire des nouveaux fils est continu, sans sections. Catalogues asynchrones
protégés contre les réponses tardives, debounce annulé au changement/fermeture,
champs non interactifs pendant leur chargement initial, double sauvegarde bloquée.

L’UI sépare trois usages : Fournisseurs (`#providers`, alias historique `#models`)
pour les connexions OAuth/clés seulement ; Configuration pour les valeurs par
défaut des nouveaux fils ; Modèle du fil pour fournisseur, modèle et effort d’un
fil ouvert. Le sélecteur reste dans son dialog dédié, sans déplacement entre
pages ni contrôles de connexion imbriqués. Le bouton modèle/effort du chat y mène
directement ; l’onglet Modèle des réglages du fil propose aussi cet accès.

POST `/api/conversations/:id/model` valide la sélection comme l’envoi, la conserve
sans inférence et renvoie le fil actualisé. Une valeur de base vérifie les
modifications concurrentes, puis le repository PostgreSQL compare atomiquement
le JSONB et refuse une écriture durant un run actif. `Conversations.selectModel`
utilise le verrou local ; le core et le journal restent inchangés. Aucune migration.
Annuler restaure la sélection enregistrée, sans perdre le brouillon. « Modèle par
défaut » copie uniquement le modèle/effort configuré dans ce fil, sans modifier
ses permissions, les préférences globales ni les autres fils. Les connexions API
ont leur propre cible fournisseur ; enregistrer une clé ne change pas le cerveau
sélectionné. Retour vers la liste après sauvegarde indépendant de sa confirmation.
Les valeurs d’effort sont mémorisées par fournisseur/modèle et restaurées depuis
la sélection du fil. Les clés API restent hors stockage navigateur. Réseau et
budget utilisent des formulaires indépendants vers la politique existante.

## Relance d’un message depuis l’UI

chat.js reste présentation : copie locale et callbacks avec fil, événement,
contenu et références. app.js possède l’envoi commun et vérifie le fil actif ;
la relance réutilise la même route messages et la même politique que l’envoi
normal, en préservant brouillon et sélection de pièces jointes. Pas d’API de
réexécution d’événement, de nouveau format persistant ni de rejeu des outils.
Les fichiers d’origine sont revalidés et hydratés par ChatAssets. Verrou d’envoi
et état des actions indépendants de la présence de texte dans le composeur.


## Métadonnées des quotas du compte

`contracts/usage.ts` transporte les fenêtres et leur portée, séparément du moteur
et des modèles. `models/chatgpt/quota.ts` normalise la réponse HTTP réelle et
vérifie les snapshots. `app/account-quota.ts` assemble le collecteur root en
lecture seule ; l’interface CLI est déclenchée par systemd chaque minute. Le web
reçoit le chemin du snapshot privé, jamais la session source. TestLab compare
l’empreinte au compte Heart courant avant d’exposer uniquement les fenêtres et
la date d’observation. Aucun SQL ni appel modèle pour actualiser les compteurs.

## Coût des mises à jour web

La présentation reste en JavaScript natif. Les observateurs des sélecteurs
regroupent leurs notifications par microtâche ; leur réconciliation n’écrit que
les valeurs modifiées. Le catalogue d’effort, le pack visuel et les pièces jointes
possèdent chacun une clé de contenu locale, sans cache des secrets.

`app.js` lance en parallèle les lectures indépendantes de démarrage et rend chaque
résultat disponible séparément. `chat.js` compare les identifiants des événements
visibles du journal immuable : les seules phases d’activité ne remplacent pas
l’historique ; les anciennes bulles sont réutilisées lors de nouveaux messages.
Le panneau d’activité garde son cycle propre. Le moteur et les formats persistants
ne dépendent pas de ces optimisations de présentation.

Le serveur statique fournit un ETag de taille/date du fichier et
`public, max-age=0, must-revalidate` ; les mises à jour sont vérifiées à chaque
ouverture. Les routes API conservent `private, no-store`. Le proxy Heart respecte
cette séparation. Aucun service worker ni cache navigateur des conversations,
mémoires ou credentials. Mesures et limites dans [PERFORMANCE.md](PERFORMANCE.md).

## Contenus enrichis des messages

Le contenu persistant reste Markdown : tableaux GFM, références d’images et liens
fichiers, sans type de SDK ni nouveau tool call d’affichage. `chat-content.js`
porte les contrôles de lecture dans interfaces/web ; `chat.js` l’appelle après
assainissement. Les fichiers restent dans le workspace UUID du fil ; l’app fournit
un flux d’aperçu image vérifié et l’interface expose une route propriétaire privée.
Aucun SQL ni import de module concret dans le core. Le contrôle de lecture est
celui de l’explorateur propriétaire existant ; les permissions des outils modèle
restent inchangées. La génération d’images est une autre capacité, non fournie par
ce renderer. Voir [CHAT-CONTENT.md](CHAT-CONTENT.md).

L’adaptateur ChatGPT accepte aussi la liste terminale output vide observée sur
SIWC : il reconstruit depuis response.output_item.done après confirmation finale,
puis valide les sorties et arguments comme auparavant. Ce traitement reste dans
le module ; core, journal, permissions et renderer ne changent pas. Voir CHATGPT.md.

## Interactions utilisateur

Un Tool texte conserve son contrat par défaut ; un outil interactif retourne un
InputRequest neutre. Le core persiste interaction.requested et rend la main,
libérant le claim ; aucun LLM en attente. resolveInput valide la réponse à la
frontière du module. Réponse, résultat d’outil et début de continuation utilisent
SessionStore.appendBatch atomique. Les messages d’outils restent au format neutre
existant pour tous les modèles et la compression. Les appels précédents ne sont
pas rejoués ; les suivants non exécutés sont clôturés comme caducs avec la réponse,
puis une nouvelle inférence précède les propositions soumises aux droits courants. Annuler produit leurs
résultats d’annulation sans LLM. Migration 010, deux types de journal ; pas de
repository générique de plugins ni de nouvelle table. Voir INTERACTIONS.md.

L’adaptateur AI SDK distingue les erreurs de protocole, HTTP et sortie dans des
messages sûrs bornés ; app les relaie et le chat affiche uniquement ces messages
connus. Le web omet le budget de sortie implicite, laissant le fournisseur/SDK
appliquer ses valeurs natives ; les budgets explicitement fournis restent supportés.
Aucun détail de SDK ajouté au contrat modèle ou au core.

Les formules restent du Markdown/LaTeX dans le journal neutre. `chat-math.js` utilise
les extensions Marked pour protéger le TeX, puis KaTeX DOM après assainissement,
avec ressources locales chargées à la demande. Core, mémoire et formats persistants
inchangés ; les fonctions mathématiques ne constituent pas un nouvel outil modèle.

Le premier entretien frontend extrait api-client.js (transport HTTP injecté) et
icons.js (catalogue/réconciliation SVG). management.css porte les styles de gestion
après chat.css, avant components.css, avec cascade conservée. Typage JS/JSDoc ciblé,
aucun framework runtime ni contrat backend ajouté. Voir WEB-FRONTEND.md.

## Recherche web par MCP

Le propriétaire configure et approuve une connexion dans Capacités. Le repository
PostgreSQL conserve UUID, version, URL, références d’environnement et définitions
JSON Schema ; aucune valeur de clé. L’application injecte le connecteur dans
ExternalTools, puis ses Tool dans le moteur du fil si le réseau ou YOLO l’autorise.
La permission external.read reste vérifiée dans le core. Aucun module ne construit
un autre module. La recherche locale auto-hébergée est le serveur actif, remplaçable par configuration.

Une session MCP est ouverte/fermée par appel. Les définitions courantes doivent
correspondre aux snapshots approuvés ; aucune extension distante silencieuse.
Annulations indépendantes, pas de rejeu automatique, et écritures distantes hors
périmètre. Les libellés lisibles sont séparés des identifiants techniques stables.
La CLI de démonstration ne charge pas les connexions web implicitement.

## Recherche auto-hébergée sans quota commercial

`app/search.ts` assemble `modules/search/searxng` et `modules/tools/mcp-server` ;
`interfaces/search.ts` expose ce service seulement sur loopback. Le premier module
consomme l’API JSON d’un SearXNG officiel séparé et lit les pages publiques ; le
second adapte des Tool injectés au protocole MCP. Aucun SQL, client LLM ou règle
mémoire dans ces modules. Le service Node ne reçoit pas les credentials du web.

Les liens HTML sont conservés, scripts ignorés, pas de coupe implicite du texte.
Le lecteur valide les IP lors de la résolution socket et sur les redirections pour
respecter la portée publique d’external.read. Le serveur privé refuse les origines
et hôtes étrangers. Les connexions et leurs droits restent gérés par le client MCP
existant. Pas de migration SQL. Voir [WEB-SEARCH.md](WEB-SEARCH.md).

## Reprise et sauvegarde coordonnée

Le core calcule un plan de récupération depuis le journal ; le contrat de stockage
assure la transaction et le contrôle du propriétaire. PostgreSQL utilise un lease
par runtime, des claims par fil et un verrou partagé/exclusif pour les sauvegardes.
Les scripts opérateur restent hors du core. Le détail courant et les limites sont
dans [RECOVERY.md](RECOVERY.md), notamment le mode JSON monoprocessus et les anciens
claims sans propriétaire vérifiable. Migration 013 additive, aucune expiration
automatique ni rejeu d’action.

## Contrat complet de stockage SQL

`SqlStorageConnection` complète le contrat minimal de la démo : repositories de
conversations, projets, mémoire structurée, profil, prompts/pièces jointes et MCP,
avec SessionStore atomique et récupérable. PostgreSQL et SQLite exposent ce contrat.
`compose.openSqlStorage` est le sélecteur explicite partagé avec l’assemblage web ;
le web n’ouvre plus PostgreSQL directement. Les migrations restent locales aux
modules : PostgreSQL 014 et SQLite 002 ne sont pas deux versions d’un même SQL.
Aucune migration de données entre moteurs ni bascule à chaud n’est impliquée.
[Configuration, verrous, snapshots et tests communs](SQL-STORAGE.md).

## Reçus de chat et délai fournisseur

Le rendu commun `heartTurns.receipt` est réutilisé pour mémoire et formulaire
résolu, vert et bleu respectivement ; il ne déclenche aucune action. Les détails
longs sont dépliables. `Interaction.respondedAt` est dérivé du journal de résolution,
sans nouveau stockage ou migration. Formulaires actifs et idempotence conservés.
Le module ChatGPT utilise un délai d’inactivité réseau réarmable au lieu d’une
coupure de durée totale ; son erreur sûre timeout est traduite par app/chatgpt.
Annulation et validation finale des appels restent obligatoires.

## Instructions configurables

`app/instruction-defaults.ts` centralise les onze blocs web ; les surcharges
optionnelles résident dans le profil versionné existant. `Assistant` expose
catalogue/écriture ciblée et contrôle les conflits du bloc. Conversations capture
les réglages une fois par run et les passe à l’assemblage comme aux instructions
principales. Revue et compression reçoivent leurs textes par constructeur, sans
nouvelle dépendance entre modules. Les permissions et schémas d’outils restent des
contrôles exécutables. [Injection, API et limites](INSTRUCTIONS.md).

Le contrôleur web `settings.js` (`heartConfiguration`) ne fait aucun appel API :
il synchronise liens, onglets accessibles et panneaux persistants. Il reste
séparé de `heartSettings`, réglages du fil. `instructions.js` possède le catalogue
privé : chargement différé, cache mémoire versionné, DOM inchangé réutilisé,
réponses plus anciennes que le profil ignorées et purge à la déconnexion.

## Fenêtre d’historique et projection privée

`SessionStore.page` et les positions de catalogue restent neutres ; SQL lit par
sequence indexée et clé date exacte/UUID. `app/conversation-view.ts` reconstruit puis
met à jour les seules métadonnées, formulaires et preuves de récupération ; le core
partage `RecoveryTracker`, sans client SQL ni cache d’affichage. Cache LRU privé
réglable et jetable, audit fichiers séparé. `history.js` fusionne pages/deltas et
le chat réconcilie les nœuds, sans transformer la fenêtre web en contexte LLM.
Le chargement des précédents est déclenché par un scroll passif vers le début,
avec verrou de requête et contrôle de génération ; feedback en surimpression,
complément automatique des pages courtes/invisibles, retry seulement après erreur.
Aucune migration. [API, reconstruction et limites](HISTORY.md).

La continuité entre modules ChatGPT et AI SDK/OpenRouter est qualifiée par
`tests/live-continuity.ts` : même assemblage web, stockage SQLite temporaire et
vrais fournisseurs, sans changement de core ou des contrats. Le résumé passe par
le module de contexte existant ; les corrections de souvenirs sont relues par la
mémoire courante. [Budget de test et portée](CONTINUITY.md).

## Politiques de fonctionnement

Contrat neutre `contracts/policies.ts` : messages, lots d’outils, compression,
recherche/injection mémoire. Les écarts aux défauts sont stockés dans le profil
JSON existant ; les valeurs effectives sont dérivées par l’application. Aucun
SQL dans le comportement mémoire, aucune dépendance de module vers un autre
module concret. Le core reçoit seulement son budget de lot.

`Conversations` capture identité, surcharges et politiques depuis une seule lecture
du profil au début d’un tour ; l’assemblage web
les passe explicitement à `StructuredMemory`, `BoundedContext` et `Engine.run`.
Un changement est effectif au prochain tour, sans modifier l’exécution courante.
`GET/POST /api/policies` partagent l’authentification et le CAS du profil ; les
éditions indépendantes sont fusionnées par champ. Pas de nouvelle migration,
ni de configuration dupliquée par conversation. [Contrat et portée](POLICIES.md).

## Espace manuel des projets

`app/ProjectsWorkspace` réutilise `Workspace` (fichiers/journal propriétaire) et un
`ExecutionService` injecté, séparément de `Conversations`. L’assemblage web fournit
la racine, les sessions et l’exécution isolée. Routes HTTP authentifiées
`/api/projects-root[/workspace|/commands]` ; aucune conversation ni inférence créée.
Le web choisit le chemin par `projectsRootDirectory` : configuration absolue ou
`projects/` relatif à l’installation ; les tests injectent une racine temporaire.
Les contrôleurs existants distinguent espace global et contexte du fil, sans changer
les droits du LLM. Aucun contrat core ou schéma SQL modifié. Le bundle géré inclut
le nouveau scope fichiers. [Usage et installation](FILES.md).

## Navigation des capacités

`capabilities.js` gère seulement les trois panneaux DOM persistants et leurs
onglets accessibles : Outils, Skills, Connexions. Les contrôleurs `skills.js` et
`external-tools.js` gardent leurs propres lectures différées/cache et formulaires.
Le bouton d’ajout est limité aux connexions. Le snapshot MCP commun à Outils et
Connexions rend visible la provenance des outils approuvés, avec accès à la fiche
source et liste inverse par connexion. Aucun appel distant à l’affichage.
Aucun catalogue parallèle dans le
core, nouveau droit ou changement de stockage. Le contrôleur de navigation est
vérifié par TypeScript strict. [Usage](SKILLS.md).

## Skills portables et contexte protégé

`SkillCatalog`/`SkillReader` sont des contrats neutres. `skills/local` lit les dossiers
enregistrés par UUID ; `tools/skills` adapte seulement le lecteur en outils. L’app
compose catalogue, profil et tour ; aucun module ne construit une autre implémentation.
Le core reçoit ses outils et un `ContextManager`, sans connaissance des skills.

`SkillRun` enveloppe le contexte injecté : guidances chargées une fois dans les
instructions, reçus courts dans la requête modèle et journal canonique inchangé.
Reconstruction après checkpoint/reprise, révision vérifiée et retrait des guidances
désactivées. Le profil stocke les seuls écarts d’activation, sans nouvelle migration.
Le manifeste d’installation garde les IDs indépendants des noms/chemins ;
`SKILL.md` garde son format standard. [Contrats et limites](SKILLS.md).

## Planification durable

`contracts/tasks.ts` définit calendrier, définitions/occurrences, repository et
exécuteur neutres. `scheduling/calendar` isole Temporal ; `scheduling/runner` orchestre
les contrats, sans SQL ni LLM concret. Les adaptateurs tasks vivent dans chaque
module SQL. L’app relie tâches et Conversations, avec configuration héritée du fil.

L’UUID d’occurrence devient l’ID stable du run ; le core refuse son rejeu, sans
connaître la planification. Un leader par verrou de connexion/OS protège le
dispatch ; réservation/avancement atomiques et CAS des états. App/web démarre
explicitement la boucle ; arrêt ordonné avant fermeture des repositories. La santé
HTTP compte aussi son travail pour les sauvegardes. [TASKS.md](TASKS.md).

Le suivi Tâches distingue lectures silencieuses et actions explicites, ralentit au
repos et conserve les pages chargées. Le repository expose recherche d’occurrence
par UUID et parcours de file par séquence ; ni scan de l’historique pour acquitter,
ni blocage des tâches suivantes derrière une discussion occupée. Sans migration.

Consolidation : `app/task-progress.ts` parcourt `SessionStore.page` une fois puis
par deltas, ne conserve que les métadonnées des occurrences ouvertes et suit les
reprises de formulaires. Éviction via l'exécuteur injecté. Catalogue par clé UUID
et résultats limités à la fenêtre ; pagination et rendu hors écran côté web.
Contrôleur Tâches inclus dans le contrôle TypeScript du navigateur. Sans migration.
Qualification réelle GPT‑6 Luna sur les deux backends, interface et SIGKILL après
effet réel : voir STATUS.md.

## Tâches conversationnelles

`TaskService` expose les opérations de l’application indépendamment de leur
interface. `tools/tasks` reçoit ce contrat, sans importer stockage, calendrier ni
conversation concrète. `app/compose.ts` fabrique les outils, l’assemblage web injecte
le service commun à chaque moteur de fil. La factory du moteur est différée jusqu’au
tour ; le service est lié avant toute réception de message.

Le core fournit runId/callId aux outils de manière neutre. Le module dérive des
UUIDv5 de namespace fixe pour création/lancement réémis, sans utiliser nom ou chemin.
Permissions tasks.read/write indépendantes des accès fichiers/réseau ; les travaux
héritent des réglages actuels de leur fil. Le planning et la boucle LLM restent uniques.
La lecture canonique réutilise TaskProgress avec un observateur éphémère, sans
cache des corps. Trois schémas compacts gardent le profil 8 192 tokens utilisable.
[Contrat et preuves](qualification/task-tools/README.md).


## Raccordement Nora MCPs

Le client Streamable HTTP existant prend maintenant en charge les outils d’écriture
approuvés (external.write) et un mode transitoire indépendant du fournisseur. Le core
ne persiste pas les arguments/résultats de ces outils ; leurs messages complets restent
en mémoire pendant le tour et sont retirés de la revue finale. Pas de retry ni de
résultat sensible réinjecté au tour suivant. Les textes produits par le modèle ne
sont pas garantis secrets : frontière de confiance explicitée dans NORA-MCPS.md.

`modules/storage/mcp-memory` implémente StructuredMemoryRepository derrière un
caller neutre injecté par l’application. Aucun import d’un client MCP ou d’un autre
module concret. Les règles structured, contexte et cartes restent réutilisées ;
capacité supportsRestore=false pour l’oubli distant. Le choix de repository est
explicite via HARNESS_MEMORY_MCP_CONNECTION_ID, sans repli automatique. Les données
locales restent intactes ; le propriétaire a choisi le MCP sans copie des trois
souvenirs. Ce repository est maintenant actif, sans repli ni double écriture.
Clés dans un fichier privé d’environnement du service, catalogues seuls en SQL.
Le MCP Projects est la source unique des projets métier : création, lecture,
modification et archivage passent par lui. Heart garde les conversations, le
planning d’exécution et les artefacts physiques locaux, associés à l’identifiant
MCP stable. Il n’y a pas deux catalogues de projets métier à relier/synchroniser.
L’assemblage injecte McpProjectsRepository derrière le contrat projet,
sans client MCP dans le core. Les liaisons locales ne sont pas des fiches métier.
HARNESS_PROJECTS_MCP_CONNECTION_ID sélectionne explicitement la source. Les clés
étrangères locales retirées par PostgreSQL 015/SQLite 003 permettent de conserver
directement les UUID distants. Les anciennes lignes restent intactes sans servir
de miroir. La création utilise un operationId distinct de l’id renvoyé. Les
lectures simultanées du catalogue partagent leur promesse, sans cache persistant. [Contrat et qualification](NORA-MCPS.md).


Les adaptateurs modèles ChatGPT et AI SDK valident les schémas des outils selon
leur dialecte draft-07/2020-12, avec formats standards, avant envoi et à réception
des arguments. Le support dans le transport MCP seul ne suffit pas ; les tests
réels déclarent aussi les outils externes dans la requête du cerveau. Les détails
Ajv restent dans chaque adaptateur, sans dépendance concrète entre modules.


La présence d’un fait dans le journal n’est pas une preuve de son état mémoire
courant. BoundedContext marque aussi les recherches sans résultat ; memory.search
vide fournit une énumération explicite bornée par la politique existante. La revue
CompletionReview peut demander une révision du brouillon avant publication, sans
écrire elle-même ni ajouter de revue en boucle. Une observation mémoire structurée
cite le brouillon ; le moteur rappelle le modèle principal avec son inventaire
complet. La revue ne peut plus remplacer directement la réponse par son propre texte.
Les lectures
mémoire du tour rejoignent ses preuves, les sorties fichiers/web/Vault restent exclues.
Une entrée dans la vue Mémoire provoque une lecture unique, sans timer supplémentaire.

Les reçus mémoire antérieurs au dernier message humain sont projetés en références
historiques par BoundedContext, avant inférence ou nouvelle compression. Le journal
et les positions des checkpoints restent inchangés. Les reçus du tour courant
restent disponibles. Une décision known dans MemoryReview transporte id/version ;
MemoryService.get relit l’état courant et exige une révision active identique,
avec un cache limité à cette revue. Aucune dépendance au backend concret.
CompletionReview déclare une politique failureMode optionnelle ; la revue mémoire
choisit revise : le brouillon reste retenu, puis le modèle principal reprend si
la vérification échoue. Les autres revues conservent leur comportement. Une seule décision mémoire, un appel primaire supplémentaire sur révision ou échec.
Les effets sont relus sans nouvelle décision via verifyAfterTools.
Le contrôle des projets a son propre cycle de vérification, décrit plus bas.

L’absence de binding Projects désactive la création et ne lit pas le catalogue SQL.
Une injection de repository explicite sert aux fixtures de qualification ; elle
ne constitue pas un réglage de repli en production. Les anciens modules SQL sont
conservés pour leurs données et leurs tests, sans être sélectionnés implicitement.

L’inventaire primaire est fourni à la revue par primaryToolNames ; l’unique outil
memory.assess de ce contrôle ne représente pas les capacités du fil. La correction
memoryCorrection contient claim/issue, vérifiée comme citation du brouillon puis
transmise par le contrat neutre revision. Une seule décision mémoire par run ; un nouvel appel
primaire uniquement si correction demandée, avec budget/contexte/permissions inchangés.
Aucun brouillon rejeté ni feedback de contrôle ajouté à l’historique conversationnel.

CompletionReviewError porte un code sûr et statique (validation, citation, preuve,
version, portée ou budget) ; les autres erreurs sont UNAVAILABLE dans l’audit.
Le moteur ne journalise jamais les erreurs brutes. Une panne de contrôle déclenche
la même reprise primaire que sa demande de correction, avec statut failed explicite
et résultats d’outils précédents conservés. Aucun reset, rejeu moteur ni permission
ajoutée. Le budget d’appels et le signal d’annulation restent applicables.

## Provenance du runtime et inspection

La configuration du run ajoute des faits de l’assemblage : UUID de stockage, driver
des conversations, backends mémoire/projets et chemin du code. Conversations ajoute
la sélection validée du tour (fournisseur/modèle/effort), pas celle du tour précédent.
Ces faits distinguent l’instance du fil des exemples du dépôt et autres processus.
Pas de secret, de test réseau supplémentaire ni de couplage du core aux modules.

Le module terminal joint un curseur de continuation aux sorties partielles de ses
outils ; ExecutionService et le terminal manuel restent inchangés. Le modèle choisit
les pages utiles, les permissions du core restent vérifiées pour chaque appel.

## Mail et résultats visuels MCP

`contracts/mail.ts` définit le transfert binaire. `modules/mail/http` transporte
les fichiers ; `modules/tools/mail-files` relie ce contrat à WorkspaceFiles.
`app/web-conversations` assemble la connexion Mail approuvée avec les droits
réseau/fichiers du fil, sans import croisé entre modules. `mail.attach_file`
transfère un fichier vers Mail, `mail.save_attachment` importe ses octets par UUID
avec les contrôles atomiques du système de fichiers existant. Pas de base64 dans
le contexte du modèle pour ces transferts.

Les contrats outil/session offrent une réponse multimédia optionnelle en plus du
texte historique. L’adaptateur MCP conserve les images même avec structuredContent ;
le core les garde pour le tour et retire les pixels du journal. Les adaptateurs
modèle les traduisent par le transport de pièces jointes existant après le lot
complet des résultats outils. Une source doit être relue lors d’un tour ultérieur.
Les données d’image restent externes, sans donner d’autorisation utilisateur.

Les nouvelles demandes de compte négocient quatre services (Mail inclus) ; les
anciennes configurations à trois services restent lisibles et valides. Le portail
conserve le contrat à trois clés quand le client omet le scope.

Les accès des boîtes appartiennent exclusivement au service Mail. Un transfert
Natio V4 autorisé passe directement entre serveurs avec une cible configurée par
opérateur ; Heart conserve uniquement sa clé MCP Mail. Gmail utilise le client
OAuth de l’instance Mail, PKCE et un refresh token chiffré ; le callback réutilise
l’UUID d’un compte préparé de même adresse et conserve ses identités/signatures.

## Noms et organisation des capacités

`app/capability-labels.ts` contient les libellés de présentation, pas un second
catalogue d’outils : seuls les outils réellement assemblés/découverts sont affichés.
Les anciennes étiquettes automatiques sont présentées en noms courts (Mémoire,
Projets, Coffre-fort, Mail, Recherche web), les noms personnalisés sont conservés.
Les titres explicites des serveurs restent prioritaires. `ExternalTools.list` et
la découverte ajoutent des champs de vue, séparés des snapshots approuvés bruts ;
le stockage, les comparaisons et l’exécution ne reçoivent pas ces champs.
`presentTools` applique les titres aux outils intégrés dans compose et dans le web.

Capacités garde trois vues : Outils, Skills et Connexions MCP. Les outils distants
sont regroupés par connexion avec nom, icône et état communs aux deux vues ;
plusieurs groupes sont repliés initialement et leur ouverture est conservée lors
d’une actualisation. Les noms techniques sont consultables dans le détail.
Les cartes des outils intégrés sont des raccourcis d’interface ; la mémoire
distante n’y figure plus. Le snapshot du moteur reste la source des droits du fil.

Noms internes `famille.action`, noms MCP distants conservés, identités UUID stables.
Skills au format Agent Skills (`SKILL.md`, noms de paquet avec tirets) ; modules
sous `src/modules/<famille>/<nom>`, transport et logique distincts. Aucune migration
d’ID, de souvenirs, de clés ou d’historique pour changer une étiquette.

Les titres de présentation sont journalisés avec `run.started.toolTitles` et
`tool.started.title`, mais ne doublent pas l’inventaire textuel injecté. Les noms
canoniques et descriptions/schema complets restent transmis au fournisseur.

## Cycle de vie et supervision après consolidation

`openWebConversations` reste le point d’assemblage concret web. Sa factory de
stockage optionnelle retourne le contrat `SqlStorageConnection` ; aucun client
SQL n’entre dans le core ou les autres modules. Une initialisation échouée ferme
les ressources déjà ouvertes. La fermeture est partagée/idempotente et poursuit
les autres étapes après erreur, puis rapporte les échecs groupés. Contexte
construit une seule fois par tour, décoré par les skills si présents.

Dans le module terminal, `SystemdUnits` contrôle l’état natif du processus hôte.
L’absence d’un enfant dans la Map JS ne prouve pas l’arrêt d’une unité systemd.
Unité active : état conservé. Les unités indépendantes ne bloquent ni maintenance
ni sauvegarde de Heart. Unité inactive : code de sortie natif conservé s’il existe,
sinon interruption explicite. Une erreur de supervision ne prouve jamais l’arrêt. Le contrat neutre
`ExecutionService` et les autres modules restent inchangés ; la supervision
spécifique Linux est injectable à la frontière du module pour ses tests.

Le client HTTP garde une seule frontière de transport, sans retry des mutations.
Réponses d’une ancienne connexion : aucun reset de la nouvelle session/CSRF. Le
catalogue de travaux utilise une génération et une signature limitée aux champs
effectivement affichés ; changer une phase interne ne reconstruit pas les cartes.
Les tests d’architecture couvrent points d’entrée, dépendances et cycles runtime
y compris imports dynamiques statiques, hors références purement de type.

## Projets : aucune dépendance de fonctionnement à Heart

Heart développe et administre, mais ne fournit pas le runtime de production des
projets. Code, données, dépendances, configuration et déploiement système leur
appartiennent. Services systemd persistants ou Docker Compose natif, sans import
Heart ni dépendance de démarrage/arrêt à ses services. Les exécutions du modèle et
les terminaux isolés sont des tâches de développement distinctes de ces services.

Dans le module terminal, le chemin hôte par défaut délègue à PID 1 via systemd-run,
avec sorties append natives et résultat écrit par un wrapper POSIX autonome.
Pas de PartOf, de pipe Heart, de runtime Node embarqué ou d’écouteur d’annulation
du tour. CommandSnapshot.independent distingue ce comportement ; les permissions
de conversation ne tuent pas le programme en cours. Le nouveau worker relit état
et fichiers sans reprise implicite. Les sessions interactive:true sont temporaires,
avec stdin, explicitement distinctes des projets ; elles restent annulables.

Les unités de commande sont transitoires à l’échelle de la machine : les projets
permanents doivent déployer leurs propres services activés au boot. Aucun registre
d’exploitation ni framework de runtime maison ajouté. Le backup Heart annote les
fichiers copiés à chaud quand ces programmes tournent ; il ne remplace pas les
sauvegardes cohérentes propres aux projets. Contrats et core restent indépendants
du contrôleur systemd situé dans le module terminal.

## Suivi hiérarchique des projets

ProjectTracking est un contrat distinct de ProjectRepository, adapté par
McpProjectsRepository et injecté dans ProjectManagement/Conversations. L’app
expose la fiche et les commandes web ; aucun SQL, règle de stockage MCP ou miroir
local ajouté à Heart. Chargements Mémoire et Projets indépendants.

Le MCP gère parentId, critères/preuves, versions et gardes transactionnelles de
clôture. projects_overview fournit une fiche, les compteurs globaux et une page
détaillée cohérente ; pagination courante entre les requêtes. L’app injecte la
fiche et les compteurs par tour, détail à la demande via outils. Lectures
de catalogue simultanées regroupées ; fiches de suivi relues indépendamment pour
éviter un instantané démarré avant une écriture, sans cache périmé/polling. Contrôleur web séparé et
formulaires versionnés préservés sur conflit. Voir [PROJECTS.md](PROJECTS.md).

## Reconstitution du contexte courant

Le profil/les surcharges/politiques sont capturés ensemble au début du tour.
À chaque étape : inventaire réellement permis, fiche Projets via ProjectTracking,
guidances actives via SkillRun, puis budget/résumé/mémoire via ContextManager.
Le core ne dépend d’aucun de ces backends. Une révocation détectée par l’app
retourne ToolUnavailableError avec les noms approuvés de sa source ; le core
les retire immédiatement du lot et des prochaines déclarations/inventaires.
Pas de nouveau catalogue parallèle ou d’approbation implicite.

ContextOptions porte une projection summaryMessages alignée sur les messages
canoniques : arguments/résultats transitoires et images volatiles exclus des
entrées de compression. Les guidances des skills sont réinjectées hors résumé
et leurs anciens corps deviennent des reçus. BoundedContext accepte les limites
de lots complets pendant un long tour, en conservant la demande active et le
lot récent. Un lot/checkpoint historique surdimensionné est fragmenté comme
données, sans appels de protocole incomplets et sans rejeu d’effet. Checkpoint
validé par budget, référence source, lot complet et append atomique.

Mémoire : recherche actuelle avec correction courte prioritaire ; versions
relues identifiables même lorsque le corps est dédupliqué. Une indisponibilité
reste explicite et ne bloque pas le travail indépendant. context.usage garde
segment/messages couverts et statut/compteur de recherche sans contenu.
ContextError transporte un code/message sûr jusqu’à l’HTTP. Pas de nouvelle
table, dépendance, mécanisme de thread fournisseur ou copie de plan local.

Le contexte de projet indique aussi l’outil d’aperçu de sa source lorsqu’il figure
réellement dans les déclarations du tour. Les fiches ne regroupent pas leurs
lectures en vol : une requête postérieure à une écriture part de l’autorité, sans
rejoindre un ancien instantané. Les catalogues gardent leur regroupement léger.
Compteurs de résultats d’outils déjà reçus reconstruits hors résumé pendant un
long tour ; aucun argument/résultat sensible dans ces compteurs.

## Écritures de suivi pilotées par Heart

`modules/tools/projects/index.ts` expose `projects.read`/`projects.write`, limités
au projet courant derrière le contrat `ProjectTracking`. La composition filtre
chaque opération selon les outils approuvés et le droit d’écriture du binding.
Les permissions `projects.read`/`projects.write` sont distinctes de celles des
commandes et outils externes : couper leur réseau ne coupe pas la persistance
interne du suivi. L’adaptateur MCP revérifie toujours les autorisations distantes.

`modules/projects/review/index.ts` implémente le contrat générique CompletionReview.
Le moteur accepte une liste ordonnée : mémoire d’abord, suivi du projet ensuite.
Une décision sans effet passe au contrôle suivant sans réappeler le modèle principal.
Le contrôle reçoit les preuves canoniques privées (résultats transitoires retirés),
les contraintes/contexte de la requête principale et une fiche MCP fraîche. Il
choisit none, inspect ou update. inspect émet des lectures ordinaires puis une
nouvelle décision ; une lecture identique répétée est refusée. update émet des
écritures ordinaires, jamais une écriture cachée depuis le contrôle.

`verifyAfterTools` permet une vérification après effets. Le contrôle relit versions
et champs distants, sans inférence supplémentaire. La proposition temporaire est
limitée au run ; intentions/reçus restent dans le journal existant et les données
métier dans le MCP. Aucun plan SQL local, worker supplémentaire ou reprise aveugle.
Création : UUID d’opération stable dérivé du run/call ; édition : expectedVersion.
Une erreur/concurrence ne doit pas devenir une fausse confirmation ; une absence
de confirmation est explicitement ajoutée au bilan. Pas d’atomicité multi-écritures.

Une consultation ne déclenche pas de reformulation du plan. Budget insuffisant
pour le contrôle complet : délégation explicite de la réconciliation au modèle
principal, sans retrait silencieux des preuves. Démo, absence d’outils ou de droit
d’écriture : pas de contrôle d’écriture. Instructions `projectReview` configurables
avec reset, quinzième bloc ; aucune règle NLP parallèle ni backend imposé au core.


## Relecture des écritures mémoire

MemoryReview contrôle aussi les effets mémoire, avant ProjectReview. Une seule
décision LLM propose remember/update/forget explicite ou known/confirm/none ;
les écritures reviennent au moteur, puis verifyAfterTools relit l’état via
StructuredMemoryService. Les écritures principales déjà réussies sont également
vérifiées, dernière mutation réussie par ID. Reçus canoniques filtrés mémoire et
formulaires, pas de nouvelle copie de données transitoires après compression.

MemoryNotFoundError est un type du contrat ; le service le produit pour une
absence confirmée par le repository. Oubli distant : reçu réussi + absence typée ;
un échec transport ne vaut pas suppression. Statut, version et contenu doivent
correspondre au résultat attendu ; conflit ou panne déclenchent une révision du
bilan sans rejeu/écrasement. Portée projet dérivée du fil, et non d’un argument
absent des outils. Aucune nouvelle dépendance ni couche générique de suivi ajoutée.


CompletionReview expose aussi verifyAfterRevision : au plus une nouvelle visite
après reprise primaire. MemoryReview l’active pour relire les effets de récupération
si son évaluation a échoué, sans seconde évaluation modèle. Le core garde seulement
les noms de contrôles visités ; le module garde son état de run. Aucun effet :
no-new-effects, pas verified. Une nouvelle panne ne crée pas une boucle de contrôle.


## Options d’économie de contexte

ContextExperiments décrit deux booléens optionnels par envoi. app valide et injecte
referenceRepeatedText dans ProjectReview ; aucune dépendance concrète entre les
modules. L’encodeur retourne une représentation à dictionnaire uniquement en cas
de réduction réelle, reconstruisible à l’identique. Source et preuves restent
inchangées. Aucun cache global de données métier ni nouveau stockage SQL.

Le core peut mesurer chaque generate derrière le contrat ModelProvider sans
modifier requêtes/résultats/effets. purpose identifie réponse, compression ou revue,
ajouté après budgétisation et ignoré par la sérialisation des adaptateurs. Les
compteurs anonymes vont dans run.progress/model-usage, jamais dans le chat.
Les options actives sont enregistrées avec run.started pour reprendre un formulaire.
Défauts inchangés et absence de champ = référence. Le navigateur stocke seulement
les booléens par UUID/onglet ; le panneau paresseux attend l’annonce de compatibilité
serveur. Voir CONTEXT-ECONOMY.md pour les unités, limites et qualification A/B.
