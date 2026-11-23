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

Avant un tour rattaché à un projet, l’app lit sa fiche et les compteurs actuels.
Elle injecte uniquement l’objectif, les critères, la prochaine action, le statut,
la version et la date de lecture, avec les compteurs. Aucun plan détaillé ou
historique de preuves recopié systématiquement. Le modèle utilise ensuite les
outils Projets pour lire le détail et actualiser l’élément après un résultat
vérifié. Une indisponibilité est explicite, sans ancien état présenté comme frais.
Cela guide le modèle ; ce n’est pas une garantie d’initiative parfaite à chaque tour.

L’ouverture, une sauvegarde, le retour dans la fenêtre et **Actualiser** relisent
le suivi. Aucun polling périodique. Les lectures strictement simultanées identiques
sont regroupées, sans cache périmé entre les écritures. Les réponses d’une ancienne
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
