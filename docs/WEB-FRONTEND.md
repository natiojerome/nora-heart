# Interface web : responsabilités et entretien

Interface HTML/CSS/JavaScript native, mobile first. Ce document décrit le code
livré, sans annoncer une migration de framework ni une suppression de tout l’état
global existant. [Mesures ciblées](qualification/ui-cleanup/2026-11-17.json).

## Contrôleurs

| Fichier | Responsabilité |
| --- | --- |
| app.js | Orchestration de l’application, état de session, chargements et raccordement des contrôleurs. Encore volumineux : extractions progressives lors des chantiers. |
| api-client.js | Transport HTTP avec callbacks explicites pour CSRF, expiration et feedback ; aucun stockage de credentials, aucun retry automatique d’écriture. |
| external-tools.js / external-tools.css | Configuration, découverte et sélection explicite des MCP dans un dialogue, sans credential navigateur. |
| work.js | Catalogue léger des travaux, badges, ouverture/arrêt ciblé ; polling uniquement actif et visible. |
| chat-turns.js / chat-turns.css | Panneau de travail, commentaires publics et rendu commun des reçus mémoire/formulaire (vert/bleu), sans orchestration du modèle. |
| icons.js | Catalogue SVG commun et réconciliation idempotente ; un WeakMap conserve le nom/nœud déjà dessiné sans retenir les éléments retirés. |
| ui.js | Navigation, listes et personnalisation ; garde l’alias renderIcons pour les contrôleurs existants, dont l’implémentation appartient à icons.js. |
| controls.js / feedback.js | Contrôles personnalisés, synchronisation groupée, feedback/chargement et verrouillage des actions. Les réponses de formulaire ne sont plus annoncées comme une création de conversation. |
| chat.js / chat-content.js / chat-math.js | Historique lisible, contenu enrichi et LaTeX. Les blocs techniques d’outils ne sont pas rendus ; le journal reste complet. |
| chat-tools.js / chat-interactions.js / workspace.js / terminal.js | Prompts/pièces jointes, formulaires persistants, explorateur/éditeur et commandes. |

Les factories restent courtes et assemblées explicitement. Le client HTTP reçoit
ses dépendances ; il ne lit ni la personnalité, ni les modèles, ni la mémoire.
Les contrats backend et le core ne dépendent pas de ces contrôleurs navigateur.

## Lecture et mutation HTTP

Deux GET ordinaires simultanés vers la même URL partagent le transport, avec
réponses indépendantes pour les consommateurs. Il n’existe pas de cache persistant
pour ces données privées. Toute écriture invalide le regroupement des lectures
plus anciennes ; une fin de vieille lecture ne supprime pas une lecture récente.
Les mutations ne sont jamais regroupées ni rejouées automatiquement.

Une requête avec signal d’annulation, corps ou headers personnalisés reste
indépendante. Les headers CSRF, uploads binaires, credentials same-origin,
no-store, expiration et fin de feedback sont testés. Le regroupement ne résout pas
la pagination/delta, portée séparément par history.js ; il n’autorise pas une action supplémentaire.

## Styles

- styles.css : fondations et styles historiques communs.
- chat.css : chat, composeur, activité et consommation du fil.
- management.css : catalogue des discussions, mémoire, fournisseurs, configuration,
  consommation générale et personnalisation. Extrait contigu auparavant ajouté
  à chat.css ; lien chargé immédiatement après pour conserver la cascade.
- components.css : composants communs ; workspace.css et feuilles de contenu/chat
  portent leurs domaines spécifiques.

Le premier lot retire des déclarations remplacées du bloc déplacé et le formate.
Il ne prétend pas avoir normalisé toutes les anciennes surcharges CSS. Lors d’un
changement, modifier la règle propriétaire, vérifier ses thèmes/media queries et
retirer les règles remplacées plutôt que d’ajouter une nouvelle couche globale.

## Typage et formatage progressifs

`tsconfig.web.json` active checkJs/JSDoc sur api-client.js et icons.js, avec leurs
frontières dans browser.d.ts. Le reste du navigateur n’est pas encore entièrement
typé. `pnpm check` vérifie TypeScript backend, ces fichiers JS, leur formatage puis
les tests. Prettier est une dépendance de développement verrouillée ; les assets
sont toujours servis directement, sans nouvelle compilation ou framework runtime.

Commandes : `pnpm format:web`, `pnpm format:check:web`, `pnpm check`,
`pnpm test:web:e2e`. Les nouveaux contrôleurs work/chat-turns et leur CSS sont aussi formatés. Le périmètre formaté est explicite dans package.json pour ne
pas reformater tout le dépôt à chaque petit changement.

## Vérifications et suite

131 tests avec typage backend et JS ciblé, douze parcours navigateur, 23 tests SQL
et restauration isolée ; scénario interactif réel qualifié séparément. Mesure
navigateur : deux lectures concurrentes donnent une requête, et dix réconciliations
conservent les 82 SVG du jeu d’essai sans mutation DOM. Ce ne sont ni un temps de
démarrage garanti ni une mesure de tout le coût du rendu.

Restent : extraire les responsabilités qui concentrent encore de l’état dans
app.js/ui.js, poursuivre le nettoyage des feuilles historiques, mesures sur de très gros journaux et appareils physiques
avant de promettre une amélioration générale, et validation sur appareils physiques.
Conserver les tests de brouillons, fichiers, formulaires, modèles et affichages.

`instructions.js`/`instructions.css` gèrent le catalogue et l’éditeur des consignes :
lecture différée et cache privé en mémoire selon version du profil, actualisation
explicite, purge à la déconnexion, réponses périmées ignorées, blocage pendant écriture,
conflit avec brouillon conservé, reset préparé puis enregistré. Éditeur et fermeture
partagés avec ui.js ; aucune inférence pour cette interface.

`settings.js`/`settings.css` portent les cinq onglets de Configuration. Le
contrôleur `heartConfiguration` n’effectue aucune requête et conserve les panneaux
montés ; navigation clavier et état ARIA suivent le hash. Le contrôleur
`heartSettings` existant garde les réglages par conversation. La liste des
instructions ne se reconstruit que si ses blocs changent. Les tests vérifient
l’absence de GET supplémentaire au retour dans les onglets, zéro mutation de la
liste à contenu inchangé et la protection contre un GET antérieur à une sauvegarde.

`history.js` possède la fenêtre privée et les curseurs ; app conserve orchestration
et sélection. Le chat réconcilie les nœuds dans l’ordre plutôt que de tous les
détacher. Le catalogue filtre/recherche côté stockage. [Détails](HISTORY.md).

`policies.js`/`policies.css` portent le cinquième onglet Limites : catalogue différé
versionné, cartes conservées si inchangées, quatre éditeurs numériques dans
l’overlay commun. Le composeur reçoit la limite effective sans tronquer son
brouillon. La barre d’onglets défile horizontalement sur mobile ; son observer de
taille garde la sélection visible sans polling. [Détails](POLICIES.md).

L’état global du navigateur garde le profil sauvegardé le plus récent et ignore une
lecture commencée avant déconnexion. Les catalogues Instructions/Limites ignorent
également leurs résultats d’écriture après reset de session. Les brouillons et
états de chargement correspondants sont purgés. Les formulaires Limites n’envoient
que les champs changés ; un formulaire inchangé se ferme sans POST.

`skills.js`/`skills.css` complètent Capacités : chargement différé du catalogue,
cache de version et cartes conservées si inchangées. La fiche charge sa source
à l’ouverture et reste fermable pendant cette lecture ; l’activation dispose du
feedback/verrou d’écriture commun. Les requêtes de liste et de fiche ont des
générations séparées ; une déconnexion purge le contenu et ignore les retours tardifs.
[Contrat et parcours](SKILLS.md).

`tasks.js`/`tasks.css` remplacent la vue d’attente des automatisations : éditeur et
historique dans les overlays communs, sélecteurs en feuille, conflits gardant le
brouillon, clé d’idempotence conservée après erreur réseau. Liste/compteur suivis
sans repoller les conversations, cartes inchangées conservées. Générations de
requêtes distinctes et invalidation après écriture/déconnexion ; historique toujours
présent après réouverture. [TASKS.md](TASKS.md).
