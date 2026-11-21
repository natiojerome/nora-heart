# Plan courant

Point du 21 novembre 2026, après qualification de Venice, compteurs et reprise des appels invalides. Finalité conservée : une
assistante quotidienne dont le propriétaire contrôle moteur, données, outils et
permissions, avec des cerveaux interchangeables selon besoin et coût.
[STATUS.md](STATUS.md) décrit le livré ; les lots 1 et 2 sont livrés ; le lot 3 est qualifié sur un scénario réel ciblé. [REVIEW.md](REVIEW.md) donne les écarts constatés.

## Complément livré — Wallet local et sauvegarde MCP

Inventaire, actifs et signatures locales accessibles au code JS/Python et aux
outils Heart. Sauvegarde réelle sur Vault, clone restauré vérifié puis supprimé ;
ancien signataire préservé, aucune diffusion. Les signatures EVM/Solana sont
qualifiées, XPR/XRPL restent en lecture seule. Voir [WALLETS.md](WALLETS.md).
La suite utile est un premier flux métier utilisant le SDK : préparer/simuler une
transaction, gérer son nonce et sa diffusion dans le code appelant, puis mesurer
la latence sur ce flux. Aucune automatisation de dépense n’est activée par ce lot.
Ajouter un adaptateur de réseau ou un indexeur ERC-20 seulement pour un besoin
identifié ; ne pas retransformer le chemin rapide en MCP distant.

## Principes conservés

- TypeScript strict, Node.js 24, pnpm ; PostgreSQL en production, SQLite optionnel via contrat commun.
- Contrats/core/modules/app/interfaces séparés ; assemblage explicite, aucun SDK
  imposé au core ou au stockage. Mémoire distincte de son repository.
- UUID indépendants des noms/chemins. Aucun import des données des autres Nora.
- Choix du cerveau et droits explicites, abonnement/API distincts, aucun repli
  implicite. YOLO reste un accès root consenti, pas un module fictif.
- Interface native mobile first ; nettoyage progressif et tests de non-régression.
  Pas de changement de stack ou de framework justifié actuellement.
- Contributions externes possibles sur le dépôt public autorisé ; main et petits commits vérifiés.

## Livré et conservé

Le socle orchestre modèles, outils, mémoire, contexte et journal. Plusieurs
conversations peuvent travailler simultanément ; chaque fil a ses droits,
workspace et sélection de modèle. Le chat gère les formulaires, contenus enrichis,
activité publique et reçus mémoire. La réponse humaine précède toute nouvelle
action dépendante, sans rejeu des effets déjà terminés.

Premier entretien UI livré : HTTP/SVG séparés, lectures mutualisées sans cache
privé persistant, DOM préservé, styles de gestion et typage JS ciblé.
Les fichiers, terminal isolé/YOLO et MCP de lecture sont raccordés.
Les outils manuels ouvrent aussi une racine de projets configurable, sans fil
technique caché ; le chat conserve ses espaces/droits propres. Recherche web
locale via SearXNG, sans quota commercial ; Exa désactivé. Preuves dans STATUS.md.

## Compléments livrés — Mémoire et configuration

Revue mémoire explicite avant clôture, politique de consentement commune et reçus
mémoire/formulaires partagés. Les faits durables ordinaires peuvent être conservés
sans formulaire ; les cas sensibles ou ambigus demandent un accord. Le jugement
reste celui du modèle et la revue a un coût supplémentaire documenté.

Configuration et Instructions partagent cinq onglets : Apparence,
Assistant, Discussions, Instructions, Limites. Identité/personnalité/pack et treize blocs
modifiables avec défauts, resets et conflits conservés. Catalogue différé/versionné,
panneaux persistants et réponses périmées ignorées. Qualification de ce complément : 175 tests, démo
et trois parcours navigateur ; qualification HTTPS en lecture seule. Voir
[preuves](qualification/settings-tabs/README.md). Ces optimisations ne remplacent
pas la qualification des gros volumes et appareils physiques.

## Recherche web : usage courant, évolution différée

La recherche et la lecture avec liens vers les sources suffisent pour les besoins
courants. Les utiliser sur des demandes réelles. Recherche de passages, références
structurées et cartes de sources dédiées restent différées jusqu’à un défaut ou
besoin concret. Ne pas confondre cette évolution avec une dépendance au moteur
OpenAI de Codex. Aucun retour automatique à un fournisseur gratuit plafonné/payant.

## Lot 1 livré — Reprendre et restaurer un travail

**Résultat pour l’utilisateur** : constater ce qu’un travail interrompu a réellement
fait et pouvoir continuer sans répéter ses effets.

- Montrer résultats connus, actions non terminées et effets incertains depuis le
  journal. Distinguer fermeture du navigateur, arrêt explicite et crash du serveur.
- Vérifier les preuves disponibles avant de reprendre. Continuer lorsque l’état
  est établi ; demander une décision seulement si un effet reste réellement ambigu.
  Aucun déverrouillage automatique suivi d’un rejeu aveugle.
- Compléter le dump PostgreSQL par les workspaces, sorties et configuration privée
  nécessaires à une restauration ; protéger les secrets et tester la restauration
  dans une installation isolée. La copie hors machine reste à choisir explicitement.

**Preuves obtenues** : [checks](qualification/recovery/checks.json), [restauration](qualification/recovery/backup.json), [UI](qualification/recovery/browser.json). Migration 013 et timer de sauvegarde déployés ; [bundle réel vérifié](qualification/recovery/managed-backup.json).

**Critères observables** : sur état jetable, arrêter un processus pendant une action,
reconstituer les effets, préserver les résultats précédents et reprendre sans doublon.
Restaurer base + fichier de travail + configuration et vérifier leur cohérence.
Pas d’écriture MCP externe avant ces preuves ; pas de nouveau framework d’orchestration.

## Complément livré — Stockage interchangeable

Demande supplémentaire du propriétaire : contrat SQL complet et suite de conformité
commune à PostgreSQL/SQLite, module SQLite natif et sélection CLI/web. Tests de
reprise, snapshot et parcours web réels sur données jetables ; détails et limites
dans [SQL-STORAGE.md](SQL-STORAGE.md). Aucun transfert des données de production.
Le transfert entre moteurs et la sélection du stockage dans un installateur visuel
ne font pas partie de cet ajout.

## Lot 2 livré — Historiques accessibles et suivi delta

Catalogue paginé et recherche/projet côté stockage, ouverture directe d’un ancien
UUID ; anciens messages chargés automatiquement en remontant et nouveautés par curseur. Les anciens éléments restent
accessibles sans plafonner le fil aux premières pages. Contrat commun PostgreSQL/SQLite.
Projection des métadonnées et de la récupération incrémentale, audit privé inclus,
pages de lecture indexées et cache LRU réglable. Contrôleur de fenêtre séparé,
DOM réconcilié en conservant bulles, dates, détails, formulaires et ancre de lecture.

Qualification : 1 205 messages et 125 fils sur nora-tests avec les deux SQL, delta
0/1 événement ; navigateur avec brouillon/formulaire/détails et ancre. Le premier
accès aux métadonnées après redémarrage/éviction parcourt encore le journal par
pages ; pas de projection persistante ou virtualisation DOM ajoutée. Téléphones
physiques et journaux massifs restent à mesurer. [Preuves et API](HISTORY.md).

Les choix message/lot/compression/recherche et injection mémoire sont désormais
configurables, distincts des capacités réelles des modèles. Voir POLICIES.md.

## Lot 3 qualifié — Continuité entre deux cerveaux réels

ChatGPT abonnement `gpt-6.2-sol` puis DeepSeek V4 Flash 0731 via OpenRouter.
17 appels réels sur le parcours réussi : décisions/document/souvenir conservés,
bascule sans checkpoint forcé, vrai résumé sous budget de test réduit, service
réouvert, correction mémoire prioritaire face au résumé ancien et oubli respecté
dans les entrées d’un nouveau fil. Fichier écrit une seule fois. Assemblage web
réel et SQLite jetable ; aucun changement du moteur ou des données propriétaire.
[Protocole, coût cumulé des essais et limites](CONTINUITY.md).

Ne pas étendre cette preuve à toutes les paires, aux médias ou aux très grandes
fenêtres natives. Archives de charge synthétiques ; résumés/faits contrôlés via les
vrais modèles. Correction/oubli administratifs réels, pas une qualification universelle
des décisions autonomes de mémoire.

## Limites configurables livrées

Un onglet Limites regroupe quatre sections compactes : Messages, Outils, Contexte
et Mémoire. Valeurs globales au prochain tour, défauts rétablissables et zéro sans
plafond pour les compteurs. Instantané cohérent, permissions inchangées, stockage
par écarts dans le profil existant ; pas de migration ni d’inférence de réglage.
Validation ciblée, sauvegarde concurrente et qualification UI/SQL : [POLICIES.md](POLICIES.md).

## Revue logique et optimisation terminée

Seuil de compression distinct de la fenêtre dure, souvenirs effectivement injectés,
profil capturé une fois par tour, réponses d’état et d’éditeurs tardives contrôlées.
Sauvegardes Limites ciblées et sans écriture si inchangées ; composeur sans mutation
de longueur répétée. 189 tests, démo et 19 parcours navigateur ; aucun nouveau SQL
ou appel fournisseur réel. [Bilan et portée](qualification/runtime-review/README.md).

## Skills portables livrés

Catalogue Agent Skills enregistré par UUID indépendant du nom/chemin, source et
ressources consultables dans Capacités → Skills, activation globale et défauts explicites.
Les outils intégrés et connexions externes ont leurs onglets distincts ; les
catalogues sont chargés à la demande, sans modifier les permissions.
Descriptions dans le contexte, lecture complète par `skills.load`/`skills.read` ou
invocation `$nom`. Déduplication, protection après compression et retrait de la
guidance désactivée ; droits du fil conservés. Profil existant, aucune migration.
Premier skill `code-review`, 196 tests, démo et 20 parcours navigateur, workflow HTTP
avec modèle simulé visible dans le chat. [Portée et preuves](SKILLS.md).

## Tâches planifiées durables livrées

Service léger séparé du core, contrats SQL communs et calendrier Temporal. Modèle,
effort, projet et permissions hérités du fil, pas de copie divergente par tâche.
Occurrence unique, quotidien, jours ouvrés et semaine ; pause, exécution immédiate,
historique et notifications internes. Leader par verrou réel, réservations/CAS,
identifiant d’exécution stable et aucune reprise aveugle après crash. Migrations
PostgreSQL 014/SQLite 002 avec préservation des données qualifiée. 206 tests, démo,
21 parcours navigateur et 49 tests distants PostgreSQL/tâches. [TASKS.md](TASKS.md).

## Revue tâches livrée

Polling silencieux, cadence réduite au repos, historique et réponses tardives
préservés ; file sans famine et recherches indexées des occurrences. 208 tests,
21 parcours navigateur et 41 tests PostgreSQL avec restauration synthétique.
[Constats et mesures](qualification/tasks-review/README.md).

## Consolidation et qualification réelle

Code consolidé : journal incrémental, catalogue paginé et contrôleur Tâches typé.
210 tests, démo, 21 parcours navigateur et 53 tests backend sur nora-tests.
GPT‑6 Luna explicitement choisi : 88 appels réels, 14 scénarios réussis par backend
et SIGKILL après effet réel ; interface des vraies réponses contrôlée sur quatre
largeurs. Aucun repli API, aucune migration. [État sourcé](qualification/tasks-consolidation/README.md).

## Gestion des tâches depuis le chat

Même service et permissions : outils compacts list/read/write pour toutes les
opérations usuelles, reçus vérifiés et bloc d’instructions éditable. 213 tests,
22 parcours navigateur, 56 tests backend ; qualification Luna réelle sur les
deux SQL, y compris informations manquantes et consultation du vrai résultat.
[Portée et preuves](qualification/task-tools/README.md).

## Projets via MCP livrés

Toute gestion projet de l’instance raccordée passe par MCP Projects, source métier
unique : interface, rattachements et outils. Artefacts et conversations restent sur
Heart. Contrat neutre/adaptateur distant, UUID canonique, reprise de création par
operationId ; SQL 015/SQLite 003 sans effacement des données. Détail dans STATUS.md.
La gestion distante de l’historique des conversations est différée : conserver
l’historique actuel, sans nouvelle centralisation dans ce lot.

## Suite

Venice est connecté et qualifié sur une boucle fichiers réelle ; soldes/limites
sont visibles sans inférence. Les appels invalides sont corrigeables dans le même
tour, sans effet du lot rejeté ni rejeu des opérations déjà réussies.

Prochain lot recommandé : consolider les longs travaux sur les cerveaux utilisés.
Couvrir d’abord en local les chaînes lecture/édition/test, sorties terminal longues,
correction d’erreurs et interruption/reprise ; compléter par de petits scénarios
réels ciblés, avec coût mesuré. Étendre ensuite la qualification mémoire/compression
au modèle Venice utilisé, sans rejouer les conversations propriétaire. Les preuves
ChatGPT/OpenRouter existantes restent distinctes de cette qualification à venir.

Consolider sur les défauts mesurés, sans nouvelle couche d’orchestration ni changement
de stack. Ne pas réintroduire de catalogue métier local, ni créer de routine ou
notification externe sans besoin réel.

## Après ces lots

| Chantier | Déclenchement / résultat |
| --- | --- |
| Évolution des skills | Installation/édition/mises à jour selon usage réel, sans changer le format portable. |
| Compléments tâches | Archivage, notifications externes et autres fréquences selon besoin. |
| Mémoire/coûts | Usage réel par run si communiqué ; coût distinct des quotas. Améliorer la recherche sur défaut mesuré, sans embeddings préventifs. |
| Autres connexions MCP | Selon usages réels ; OAuth/stdio restent à développer ; écritures MCP approuvées livrées. |
| Publication | Installation reproductible, licence/documentation anglaise, puis dépôt distant seulement sur instruction couvrant la publication. |

La gestion projet utilise désormais le MCP ; la suite est guidée par l’usage réel.
L’entretien UI accompagne chaque lot. La copie hors machine des sauvegardes reste
un choix explicite du propriétaire ; les écritures MCP autorisées sont désormais disponibles.


## Raccordement Nora MCPs et mémoire distante livrés

Connexions Mémoire/Coffre-fort/Projets actives ; mémoire automatique désormais MCP.
Choix explicite « Commencer vide », aucune copie des trois anciens souvenirs.
Écriture/rappel dans une nouvelle conversation qualifiés avec GPT‑6 Luna réel sur
un compte MCP de test isolé, puis nettoyage. Données locales conservées, pas de
migration de conversations. Gestion projet désormais raccordée au MCP comme source
unique ; artefacts physiques locaux. [Contrat et limites](NORA-MCPS.md).
