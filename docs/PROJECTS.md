# Objectifs et suivi des projets

Le MCP Projets est l’autorité métier. Heart héberge les conversations et les
artefacts physiques ; aucun plan n’est dupliqué dans sa base locale. Les services
produits par un projet continuent à fonctionner sans Heart.

## Utilisation

Dans **Projets**, ouvrir une fiche. Elle présente :

- l’objectif global, son statut, son critère de réussite et sa prochaine action ;
- les objectifs, sous-objectifs, étapes et blocages, avec leurs statuts réels ;
- les critères et résultats/preuves renseignés, accessibles dans les détails ;
- les conversations, souvenirs, décisions et références du projet.

Un objectif global avec quelques étapes suffit pour un petit projet. Plusieurs
objectifs peuvent être au premier niveau et contenir d’autres objectifs ou étapes.
**Ajouter** crée un élément sous l’objectif global ; **Ajouter une étape** le
rattache à l’objectif choisi. Le type reste sélectionnable. Les formulaires
s’ouvrent dans un overlay, avec états de sauvegarde et erreurs conservant les champs.
Pour changer un état, utiliser **Modifier**. Aucun résultat n’est déduit d’un clic.

Un objectif ou une étape terminé exige un critère et un résultat constaté. Un
objectif ne peut pas être terminé avec des descendants encore ouverts ou des
blocages non résolus ; le projet applique la même règle à son plan entier.
Rouvrir les parents avant de rajouter du travail. Une annulation est distincte
d’une réussite ; aucun descendant n’est fermé automatiquement.

Les compteurs portent sur tout le projet, même lorsque toutes les pages ne sont
pas chargées. « Documentés » signifie terminé avec critère et preuve renseignés,
pas validation indépendante de leur véracité. Les anciens éléments terminés sans
preuve sont identifiés séparément. Aucun pourcentage fabriqué ni modification
rétroactive de leur statut. Les autres pages se chargent à la demande.

## Assistant et actualisation

Avant chaque préparation principale rattachée à un projet, l’app relit sa fiche
et les compteurs actuels, y compris après les outils d’un long tour.
Elle injecte uniquement l’objectif, les critères, la prochaine action, le statut,
la version et la date de lecture, avec les compteurs. Aucun plan détaillé ou
historique de preuves recopié systématiquement. Le modèle utilise ensuite les
outils Projets pour lire le détail et actualiser l’élément après un résultat
vérifié. Une indisponibilité est explicite, sans ancien état présenté comme frais.
Heart ne se contente pas de cette lecture : il est responsable de la mise à jour.
Les outils internes `projects.read` et `projects.write` permettent de lire le plan,
créer les étapes/blocages et actualiser statut, critères, preuve et prochaine action.
Ils sont limités au projet du fil et restent disponibles lorsque le réseau des
commandes/outils externes est désactivé. Le binding MCP doit être actif, les outils
correspondants approuvés et les écritures autorisées ; aucun contournement des
permissions de la connexion. Les outils MCP globaux gardent leurs droits réseau.

Avant la réponse finale d’un tour de projet, après la revue mémoire, un contrôle
`ProjectReview` distinct demande au même cerveau une décision explicite : rien à
changer, lire un détail/page manquant, ou proposer les mises à jour nécessaires.
Il tient compte des contraintes antérieures et des résultats réels du tour, même
après compression. Une consultation seule ne justifie pas de réécrire la prochaine
action. Une panne peut produire un blocage, jamais une réussite fictive.

Les propositions passent par les outils ordinaires du moteur, avec versions et
journal d’effets, puis le contrôle relit le MCP pour confirmer les champs écrits.
Un conflit ne provoque aucun écrasement ni rejeu automatique. Une confirmation
impossible est signalée dans le bilan. Les lots ne sont pas transactionnels :
des écritures partielles restent possibles. Une lecture identique répétée par
le contrôle est refusée pour éviter une boucle sans progrès.

Ce mécanisme récupère un oubli du modèle principal, sans garantir toutes ses
décisions sémantiques. Un contrôle trop volumineux délègue explicitement la
réconciliation au modèle principal, sans tronquer les preuves ni dépasser le
budget. Le contrôle est omis en démo, sans outils ou sans écriture approuvée.
Le texte de contrôle est visible, modifiable et réinitialisable dans Instructions.

L’ouverture, une sauvegarde, le retour dans la fenêtre et **Actualiser** relisent
le suivi. Aucun polling périodique. Le catalogue regroupe ses lectures simultanées ;
une fiche de suivi démarre sa propre lecture pour ne pas réutiliser un instantané
antérieur à une écriture acquittée dans une autre conversation. Les réponses d’une ancienne
fiche/déconnexion sont ignorées. Un rafraîchissement du catalogue préserve un
formulaire du même projet en cours d’édition ; une version concurrente exige une
relecture au lieu d’écraser l’état distant. Les listes Mémoire/Projets se chargent
séparément : une panne de mémoire ne bloque pas le suivi.

Chaque réponse d’aperçu est cohérente côté SQL. Les pages successives sont des
vues courantes : des modifications concurrentes demandent une actualisation,
pas une promesse d’instantané de toutes les pages. Aucun plafond total ajouté.

## Architecture

`contracts/project-tracking.ts` sépare le suivi opérationnel du petit contrat
`ProjectRepository` utilisé pour les identités. `app/project-management.ts`
valide les commandes du propriétaire et le rattachement des éléments. Le module
`storage/mcp-projects` adapte les champs et outils MCP, valide leurs réponses et
ne contient aucun SQL. `app/web-conversations.ts` assemble ces contrats ; le core
ne connaît aucune implémentation.

`modules/tools/projects` expose le suivi interne derrière `ProjectTracking`.
`modules/projects/review` propose et vérifie, sans exécuter les écritures lui-même.
Le contrat générique `CompletionReview` accepte plusieurs contrôles ordonnés ;
la composition relie mémoire puis projets. Aucun client MCP/SQL dans ces modules.

L’interface utilise `/api/projects`, `/api/projects/:id` et
`/api/projects/:id/items`. Les créations portent un UUID d’opération réutilisé
uniquement pour une intention inchangée ; les éditions portent leur version.
`projects.js`/`projects.css` isolent la présentation sans framework supplémentaire.
Les versions, permissions, isolation utilisateur, relations et garde-fous de
clôture restent appliqués par le MCP, pour tous ses clients.

Migration MCP additive `002_goal_tracking.sql` : parentId, successCriteria, evidence,
contraintes de hiérarchie et clôture. Anciennes migrations/UUID/données conservés.
`projects_overview` complète les douze outils existants. Guides MCP et découverte
approuvée mis à jour. Aucun nouveau service ni dépendance technique ajouté.

Voir [TESTING.md](TESTING.md) et [les preuves](qualification/project-tracking/).
