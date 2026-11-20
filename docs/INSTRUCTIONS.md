# Instructions modifiables du web

L’onglet **Instructions** de **Configuration**
présente treize blocs avec leur texte effectif, leur statut Par défaut/Personnalisé
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

## Source et persistance

`app/instruction-defaults.ts` assemble les treize blocs livrés.
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
run : politique de consentement, revue mémoire et instructions de compression.
Il est réutilisé pendant les étapes outils. Modifier les réglages pendant un run
ne change donc pas ses consignes en cours ; elles sont relues au prochain échange.

| Bloc | Quand |
| --- | --- |
| Mémoire, consentement, affichage, mathématiques, suivi, formulaires, web | Chaque appel principal ; les outils restent filtrés par les permissions. |
| Développement | Accès develop ou yolo. |
| Exécution et autonomie | Chaque appel principal : accomplir et vérifier les actions autorisées, fichiers pour lire/éditer, terminal pour exécuter. |
| YOLO | Accès yolo. |
| Revue mémoire | Première tentative de réponse finale, hors démo/modèle sans outils. |
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
