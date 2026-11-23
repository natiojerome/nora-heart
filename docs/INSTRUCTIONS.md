# Instructions modifiables du web

L’onglet **Instructions** de **Configuration**
présente quatorze blocs avec leur texte effectif, leur statut Par défaut/Personnalisé
et le moment d’injection. Édition dans un overlay commun, aperçu du défaut fourni,
retour de chargement/sauvegarde et conservation du brouillon en cas d’échec.
Rétablir charge le défaut dans le brouillon ; Enregistrer applique ce retour.
Une carte **Identité et personnalité** regroupe le nom, le genre de l’assistant et
le texte libre de personnalité dans l’onglet **Assistant**. Son aperçu de présentation est
exactement la chaîne produite par l’application pour le modèle. L’éditeur conserve
les modèles de personnalité et propose un retour au texte par défaut préparé à
partir du profil courant ; Enregistrer applique le brouillon. Le reset ne change
ni le nom, ni le genre, ni le thème. Le pack reste disponible sous Identité visuelle.
Les cinq onglets de Configuration sont Apparence (thème), Assistant,
Discussions (défauts des nouveaux fils et liens techniques), Instructions et Limites.
Mon assistant ouvre Assistant après installation. Le setup initial conserve ses choix.
`#settings`, `#settings-assistant`, `#settings-conversations` et
`#settings-instructions` ciblent ces onglets ; `#instructions` reste compatible.

Le catalogue se charge à la première ouverture puis reste en mémoire selon la
version du profil. Les panneaux et lignes inchangés conservent leur DOM. Un retour
à l’onglet ne déclenche pas de nouvelle lecture si la version locale est identique.
Actualiser force une lecture, utile après une modification sur un autre appareil.
Une réponse plus ancienne que le profil local est ignorée ; la déconnexion vide
le cache. Aucune sauvegarde ni inférence n’est déclenchée par la navigation.

## Ton selon le destinataire

Les modèles de personnalité donnent un ton amical, naturel et attentif avec
l’utilisateur, amical et professionnel avec les interlocuteurs externes, adapté
au destinataire. Les variantes et l’initiative choisies restent actives. Aucun
écrasement du texte personnalisé ; Rétablir permet d’adopter le nouveau défaut.
La compression conserve les critères de réussite, décisions actives, exceptions,
identifiants, dates, montants et suites utiles. Son budget vient du contexte cible,
au lieu d’une consigne fixe de 2500 caractères.

## Source et persistance

`app/instruction-defaults.ts` assemble les quinze blocs livrés.
La personnalité reste stockée dans `personalityInstructions`, le nom et le genre
dans leurs champs existants : pas de seconde source dans les surcharges.
`Assistant` dérive `presentationInstructions` et `personalityDefault` pour les
réponses HTTP, sans les persister. La même fonction construit la présentation
visible et celle utilisée par les requêtes modèle. Clés stables définies
par `contracts/instructions.ts`, distinctes des titres français. Les consignes de
mémoire/consentement restent dans leurs sources dédiées ; les textes de revue et
compression sont exposés par les entrées publiques de ces modules. Les autres
consignes auparavant dispersées dans Conversations sont centralisées ici.

Seules les différences sont conservées dans `AssistantSettings.instructionOverrides`,
via le repository du profil : JSONB PostgreSQL ou JSON SQLite existants. Aucun SQL
ou nouveau stockage dans les règles mémoire et aucune migration nécessaire. Un
reset retire la surcharge ; les prochains défauts livrés restent donc hérités.
Le texte vide est une personnalisation valide. Identifiants inconnus, types invalides
et caractères de contrôle sont refusés ; aucun plafond de texte ajouté. Un texte
qui dépasse la capacité du modèle restera soumis aux contrôles de contexte existants.
Les anciens clients qui sauvent le profil sans ce champ conservent les surcharges.

## Injection

Au début d’un envoi ou d’une reprise de formulaire, Conversations lit un instantané
des surcharges. Celui-ci sert aux consignes principales et à l’assemblage du même
run : politique de consentement, revues mémoire/projets et instructions de compression.
Il est réutilisé pendant les étapes outils. Modifier les réglages pendant un run
ne change donc pas ses consignes en cours ; elles sont relues au prochain échange.

| Bloc | Quand |
| --- | --- |
| Mémoire, consentement, affichage, mathématiques, suivi, formulaires, web, tâches | Chaque appel principal ; les outils restent filtrés par les permissions. |
| Suivi des projets (`projects`) | Préparations principales rattachées à un projet, avec sa fiche MCP relue et les outils autorisés. |
| Développement | Accès develop ou yolo. |
| Exécution et autonomie | Chaque appel principal : accomplir et vérifier les actions autorisées, fichiers pour lire/éditer, terminal pour exécuter. |
| YOLO | Accès yolo. |
| Revue mémoire | Décision avant réponse finale, hors démo/modèle sans outils, puis relecture des écritures sans nouvelle inférence. |
| Contrôle du suivi des projets (`projectReview`) | Après la revue mémoire dans un fil de projet avec écritures approuvées ; nouvelles lectures si nécessaire, puis vérification des effets sans inférence supplémentaire. |
| Compression | Lorsqu’une compression devient nécessaire. |

Les modules de revue/contexte reçoivent du texte par leurs constructeurs, sans
import d’app ou d’un autre module concret. Le core ne connaît pas ce catalogue.
Aucune requête LLM pour lire, éditer ou réinitialiser les consignes. Ce lot concerne
les conversations web ; la configuration CLI conserve son chemin existant.

## Texte et contrôles du moteur

Nom/personnalité, date du serveur, droits, inventaire réel des outils, souvenirs
pertinents, checkpoint et AGENTS.md sont assemblés selon le fil. La vue explique
ces apports dynamiques ; AGENTS.md se modifie dans les fichiers du workspace.
Changer une consigne YOLO n’accorde pas d’accès root ou réseau : les permissions,
la validation JSON des outils et les contrôles de version restent exécutés par le
harness. Ce n’est pas un nouveau système de skills SKILL.md.

## API et conflits

- GET `/api/instructions` : version, profil courant avec présentation/défaut de personnalité dérivés, catalogue, défauts et statut des blocs.
- POST `/api/instructions` : `id`, `value` (texte ou null pour reset), `version`,
  `baseValue` (surcharge initiale ou null).

Session propriétaire, origine et CSRF obligatoires pour les écritures. Une mise
à jour indépendante du profil ou d’un autre bloc est fusionnée ; un changement
concurrent du même bloc renvoie 409. La réponse réutilise le profil confirmé par
l’écriture, sans lecture réseau/DB supplémentaire après succès. Pas de sauvegarde
automatique d’un brouillon ni de remplacement silencieux en cas de conflit.

## Vérification

`tests/instructions.test.ts` : conflits, fusion, ancien client, reset, texte vide,
SQLite/réouverture, injection réelle dans les requêtes de fournisseurs simulés,
instantané pendant un changement concurrent et compression avec consigne fournie.
`tests/instructions.e2e.ts` : HTTP et Chromium, consultation/édition/reset,
chargement, rechargement et conflit sans perte du brouillon ; quatre largeurs,
zéro appel modèle. Ces tests ne qualifient pas le jugement d’un fournisseur réel.
[Preuve navigateur](qualification/identity-instructions/browser.json).

La capture web lit maintenant une seule version du profil pour identité, consignes
et limites. Une modification pendant le catalogue modèle ne mélange pas deux
versions. Les lectures d’état global et retours tardifs de l’éditeur ne rétablissent
pas un ancien profil ou les consignes après déconnexion.

Le bloc `tasks` règle la gestion des tâches depuis le chat : demande explicite,
lecture des IDs/versions, absence de doublons, informations de planning manquantes
et distinction mise en file/résultat réel. Il est injecté aux appels principaux,
comme les autres surcharges, sans écrire dans le profil tant que le propriétaire
ne l’édite pas. [Outils et preuves](qualification/task-tools/README.md).

## Confiance et inspection

Exécution et autonomie guide la qualité : faits établis formulés directement,
inspection des fonctions exécutées, fichiers pour lecture/édition, terminal pour
recherche/exécution, lectures ciblées puis élargies autant que nécessaire. Une
sortie partielle demande la suite utile ; aucun drainage ni audit générique imposé.

L’app ajoute aussi des faits de runtime, issus de l’assemblage et non de la
personnalité : instance, stockage, backends sélectionnés, chemin du code, puis
fournisseur/modèle/effort du tour. Les fichiers d’exemple et autres processus ne
remplacent pas ces faits. Ils ne constituent pas un test de disponibilité distante.
Les overrides et personnalités personnalisées restent conservés ; les défauts sont
modifiables/réinitialisables comme auparavant. Une explication de la mémoire ne
constitue pas une affirmation de sauvegarde à faire corriger par la revue.

## Mission et autonomie

Le défaut work définit la mission d’accomplir l’objectif de l’utilisateur, avec
écoute des précisions, initiative utile et exécution jusqu’au résultat vérifié.
Les détails courants sont décidés sans formulaire ; seule une information
indispensable ou un engagement important non autorisé appelle une question.
Aller au-delà doit profiter concrètement à l’utilisateur. Pas de restriction
supplémentaire inventée ni de vérification CGU/CGV ou analyse juridique hors demande
explicite, ces sujets relevant de son équipe.

Ce cadre ne crée ni nouveau goal persistant ni permissions supplémentaires ;
les réglages d’accès restent ceux du propriétaire. La conduite technique
d’inspection/édition/test appartient au bloc development. Les overrides restent
conservés. Le défaut work est capturé au début du tour et réinjecté aux appels
principaux, y compris après reprise/compression selon le mécanisme existant.

## Reconstitution et sources courantes

L’instantané du profil garantit identité/consignes/politiques cohérentes pour un
tour ; il est relu au prochain envoi ou après reprise. Le moteur construit
l’inventaire à partir des outils enregistrés, des droits et de la capacité réelle
d’appel du modèle. Noms et schémas correspondent. Une révocation ou modification
d’un catalogue MCP détectée avant exécution retire les outils de cette source
du tour, y compris du prochain inventaire ; aucune approbation implicite. Une
panne réseau n’est pas confondue avec une révocation et ne déclenche aucun rejeu.

Avant chaque préparation principale : fiche/compteurs du projet relus, skills
activés/chargés réinjectés puis budget, résumé et mémoire active reconstruits.
Les textes d’outils/archives/souvenirs ne créent aucun droit. Les consignes de
compression et de revue restent séparées des instructions principales ; leurs
appels n’exposent pas les outils métier. Les résultats transitoires et leurs
arguments sont retirés de l’entrée de compression et des résumés persistants.
Un modèle peut recopier une donnée dans son propre texte : ce mécanisme n’est
pas une protection universelle contre toute divulgation par le modèle.

`context.usage` consigne segment, nombre de messages couverts, statut/compteur de
recherche mémoire et estimation de taille, sans corps d’instruction ou de souvenir.
Les erreurs de contexte sûres sont typées et affichées, sans faux diagnostic de
connexion fournisseur. Voir [CONTEXT.md](CONTEXT.md).
