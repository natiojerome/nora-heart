# Reprise mémoire et conversations depuis Nora

Examen statique du 13 novembre 2026 de `/projects/nora`, révision
`ecb473c8156be912a1b0ad4be764ae37b56e4821`. Aucun code, service, fichier de
configuration ou donnée de Nora n’a été modifié. Aucun accès à sa base et
aucune importation de mémoire/conversation. Les tests source ont été lus,
pas exécutés ; leurs résultats ne sont donc pas certifiés par cet examen.

## Conclusion

Reprendre les comportements et extraire des fonctions courtes, avec leurs
scénarios de tests. Ne pas importer le serveur Nora comme dépendance et ne pas
copier ses repositories entiers. Ils mélangent règles, PostgreSQL et services
de l’application ; une partie de la continuité dépend de threads Codex.

Cette note propose un portage ; les fonctionnalités ci-dessous ne sont pas
encore implémentées dans Heart. Ses contrats et son journal restent la base.
La politique cible de sélection, de compression et de réinjection est décrite
dans [CONTEXT.md](CONTEXT.md) : aucune injection systématique d’un quota de
souvenirs à chaque message.

## Éléments réutilisables

| Élément source | Apport | Adaptation pour Heart |
| --- | --- | --- |
| `domain.ts`, `MemoryRecord` | Titre, contenu, type, portée personal/company/project, confiance, source session/run, dates, expiration et état. | Métadonnées neutres dans les contrats ; aucun type SQL ou Codex. La confiance déclarée n’est pas une preuve de vérité. |
| `modules/memory/repository.ts` | Création, recherche, correction, oubli et restauration. Validation des champs et déduplication. | Extraire les règles dans un module mémoire structuré ; conserver SQL et atomicité dans le stockage PostgreSQL. |
| `findRelevantMemories` | Souvenirs actifs non expirés, filtrage du projet et sélection bornée. Recherche textuelle native PostgreSQL. | Première recherche sans embeddings ; filtrage/sort explicites et stockage remplaçable. Pas de nouvelle base vectorielle nécessaire. |
| `modules/tools/nora-tools.ts`, `buildAdditionalContext` | Injection avant chaque tour, souvenirs identifiés et budget de contexte. | Préparation du contexte indépendante du modèle et des outils concrets. Sélectionner des éléments entiers ; éviter de couper un souvenir au milieu. |
| `modules/memory/hygiene.ts` | Diagnostics de doublon, conflit potentiel, expiration et ancienneté ; revue et fusion explicites. | Extraire un détecteur pur puis injecter son repository. Exécution à la demande d’abord ; ne pas importer le scheduler et sa cadence imposée. |
| `modules/sessions/repository.ts` | Plusieurs conversations avec UUID, titre, projet, workspace, réglages et état ; aperçu du dernier message. | Catalogue de conversations séparé du journal `SessionStore`. Le nom affiché ne devient pas une identité technique. |
| `createRunForMessage` et `updateSessionSettings` | Transaction verrouillant la conversation, un run actif maximum par fil, réglages bloqués pendant son exécution. | Petite logique de coordination durable ; conserver aussi une contrainte de base explicite pour les runs actifs. |
| `modules/runs/processor.ts`, `#claim` | Acquisition transactionnelle d’un run en attente, identité du worker et heartbeat. | Reprendre les invariants utiles ; ne pas importer tout le worker, pg-boss, les tâches récurrentes et les finalisations annexes. |
| `modules/events/repository.ts` | Événements persistés avec séquence et relecture depuis un curseur. | Réutiliser le principe pour actualiser/reprendre l’UI. Garder le format neutre du journal Heart. |
| `MemoryPanel`, `SessionRail`, `ChatView` | CRUD mémoire, oubli/restauration, liste des conversations, état occupé, brouillon par fil et fenêtre de rendu pour historique long. | Reprendre les parcours UX, pas imposer React/lucide et leurs appels API à l’UI statique actuelle. |

Sources principales :

- [Modèle mémoire et conversation](/projects/nora/apps/server/src/domain.ts:430)
- [Repository mémoire](/projects/nora/apps/server/src/modules/memory/repository.ts:95)
- [Contexte injecté](/projects/nora/apps/server/src/modules/tools/nora-tools.ts:246)
- [Hygiène](/projects/nora/apps/server/src/modules/memory/hygiene.ts:266)
- [Conversations et runs](/projects/nora/apps/server/src/modules/sessions/repository.ts:390)
- [Acquisition d’un run](/projects/nora/apps/server/src/modules/runs/processor.ts:290)
- [Journal et curseur](/projects/nora/apps/server/src/modules/events/repository.ts:39)
- [Interface mémoire](/projects/nora/apps/web/src/components/MemoryPanel.tsx:1)

## Précautions de portage concrètes

1. **Séparer mémoire et SQL.** Le module mémoire source importe directement
   `DatabasePool`/`withTransaction`. Dans Heart, il reçoit un `MemoryRepository`.
   La préparation de contexte ne doit pas devenir une méthode de l’adaptateur
   modèle ou un fourre-tout dans le module outils.
2. **Ne pas régresser sur la déduplication concurrente.** Nora cherche un
   doublon puis insère ; deux transactions peuvent passer cette lecture avant
   l’insertion. `provider_call_id UNIQUE` protège un autre cas, pas le doublon de
   contenu avec des appels distincts. Heart possède déjà une sauvegarde atomique
   par hash. Pour ajouter les portées, adapter cette clé à la portée et au projet,
   avec une politique explicite pour les souvenirs oubliés et réenregistrés.
3. **Corriger le verrou d’hygiène avant extraction.** `scanMemoryHygiene`
   retourne `performMemoryHygieneScan(pool)` dans un `try/finally` sans l’attendre.
   Le `finally` libère alors le verrou pendant que le scan continue. Le motif a
   été reproduit en JavaScript isolé ; aucun incident de production n’a été
   diagnostiqué. Attendre le scan avant de libérer la connexion/verrou et tester
   deux scans concurrents. Ne pas modifier Nora dans le cadre de cet examen.
4. **Ne pas confondre heuristiques et décisions.** La similarité lexicale et
   un titre identique signalent des cas à revoir ; ils ne prouvent pas un conflit.
   Conserver la revue explicite et aucune suppression automatique. L’oubli
   réversible (`forgotten`) n’est pas une suppression physique des données.
5. **Les consignes ne sont pas toutes des validations exécutables.** La
   documentation exclut les secrets, mais le validateur mémoire local contrôle
   surtout structure, portée et longueur. Le filtre de motifs sensibles des
   capsules portables ne protège pas automatiquement l’écriture locale.
6. **Rendre la continuité indépendante du fournisseur.** Nora utilise
   `providerThreadId`, `providerTurnId` et `toolSchemaVersion` avec Codex. Le
   contexte de secours prend 24 messages, bornés à 8 000 caractères ; ce n’est
   pas une reprise complète entre fournisseurs, ni un système de résumés.
   Heart doit construire son contexte à partir de ses messages et appels/résultats
   d’outils neutres, en conservant leurs groupes cohérents.
7. **Limiter aussi les lectures et le rendu.** La fenêtre UI ne pagine pas à
   elle seule les données : `getSessionDetail` lit actuellement tous les messages.
   Prévoir des pages/cursors côté serveur pour les longues conversations.
8. **Distinguer exclusion et file d’attente.** Nora refuse un deuxième message
   lorsque le fil travaille ; il ne le met pas automatiquement en attente.
   Prévoir ce comportement explicitement dans l’UI de Heart avant une file future.
9. **Ne pas rejouer une action incertaine.** La récupération de tours Codex
   ne rend pas nos outils locaux rejouables. Conserver le refus actuel de Heart
   tant qu’une réconciliation/idempotence suffisante n’est pas implémentée.

Le module de continuité portable lit par défaut des capsules de Nora Core.
Son format et sa validation peuvent inspirer un export/import futur, mais aucun
branchement ni lecture de ces données ne doit être activé implicitement.

## Scénarios de tests à transposer

Les tests source décrivent déjà : persistance après réouverture, nommage depuis
le premier message, réglages par conversation, runs sur des conversations
différentes, refus d’un second run dans le même fil, recherche/correction/oubli/
restauration mémoire, exclusion des souvenirs expirés et diagnostics d’hygiène.
Renforcer les tests de concurrence avec des transactions réellement simultanées.

Le test navigateur d’historique long couvre 400 messages sur petit écran.
Il complète les futurs tests de pagination, sans prouver une pagination SQL.

- [Tests mémoire et sessions](/projects/nora/apps/server/src/integration.test.ts:161)
- [Historique long mobile](/projects/nora/tests/e2e/timeline-windowing.spec.ts:1)

## Ordre proposé pour Heart

1. Conversations PostgreSQL persistantes et UI de création/liste/reprise ;
   coordination d’un run par conversation et paramètres figés pour ce run.
   Garder `SessionStore` pour le journal et ajouter seulement les opérations
   nécessaires au catalogue de conversations.
2. Mémoire structurée avec provenance, portées et oubli/restauration, puis
   injection contextuelle bornée. Le SQL reste dans `modules/storage/postgres`.
3. Revue mémoire et détection d’anomalies, une fois le cycle de base utilisable.
   Ordonnanceur et import/export portable attendent un besoin explicite.

Réutilisation envisagée : petits validateurs, normalisation, détection et
scénarios de tests adaptés. Aucun extrait n’est encore incorporé. Les
dépendances source principales sont `pg`, le domaine applicatif Nora et, selon
la brique, Codex/pg-boss ou React/lucide. Aucun fichier de licence racine n’a été
trouvé lors de cet examen : ne pas présenter ce dépôt privé comme du code libre.
Lors d’un portage effectif, noter sa provenance/révision et préserver les avis
applicables aux extraits incorporés, conformément à AGENTS.md.
