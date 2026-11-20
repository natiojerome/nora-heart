# État et reprise

Point du 20 novembre 2026. Socle livré avec correctifs d’exécution ci-dessous ;
la parité complète avec Codex CLI et la qualification de tous les fournisseurs
restent partielles. Lire PLAN.md,
ARCHITECTURE.md et DECISIONS.md avant une reprise.

## Autorisations et exécution

Le terminal YOLO était root sur le serveur, alors que les fichiers et l’explorateur
restaient confinés au fil. Ils passent désormais par le même worker Unix privé,
sélectionné uniquement en YOLO. Chemins absolus et liens utilisables, révisions
conservées, propriétaire/groupe/mode Unix préservés à l’édition. Aucun repli local
si le worker est indisponible. Sortir de YOLO retire l’accès hôte, arrête ses
commandes et réinitialise les vues de fichiers sans fermer les réglages.

terminal.exec renvoie statut et première sortie après une courte attente réglable
(500 ms par défaut, 0 immédiat). Les commandes longues continuent ; terminal.read
sert aux commandes actives/pages restantes. Aucun timeout de commande ajouté.
Le bloc « Exécution et autonomie », visible/modifiable dans Instructions, demande
d’accomplir et vérifier le travail autorisé. Le template proactif évite d’inciter
le modèle à seulement proposer. Les personnalisations existantes sont conservées.

237 tests, démo locale et trois parcours navigateur passent, dont le contexte
8 192 tokens, les instructions et l’explorateur mobile. Worker root réel vérifié
sur nora-tests : fichiers hors fil, binaire, liens, révisions, commandes, stdin,
réseau, arrêt des descendants et annulation. Le transport teste aussi un import
annulé sans publier le contenu partiel. Les vrais essais ont révélé un checksum
recopié avec un suffixe doublé par le modèle : les outils exposent désormais des
références courtes, liées au chemin et au tour, tout en conservant le SHA-256 et
le contrôle de conflit dans WorkspaceFiles. Expiration et chemins croisés testés. GPT‑6 Luna medium réel : 11 appels dans l’assemblage web, édition protégée puis
édition absolue YOLO, vérification terminale, édition propriétaire via explorateur
et révocation fichiers/terminal réussies. Aucun formulaire de permission, aucun
terminal.read pour les commandes courtes, aucun repli API. Un essai antérieur a
été interrompu en attente fournisseur ; un autre a révélé la mauvaise copie du
checksum, corrigée par les références courtes. Cela ne garantit pas les décisions
ou la disponibilité de tous les modèles. Aucun changement des conversations ou permissions du propriétaire.

## Reprise après échec du contrôle mémoire

Le nouvel échange de Test reconnaît les outils, puis la demande de description
reçoit uniquement le message d’échec de revue. L’ancien mode replace supprimait
la réponse principale lorsque ce contrôle auxiliaire échouait. La cause précise
de l’échec n’était pas journalisée : l’audit ne contenait que failed.

La revue mémoire utilise désormais le mode revise aussi en cas d’erreur : un
nouvel appel principal reçoit ses outils, les résultats courants et l’état du
contrôle indisponible. Il répond à la demande sans affirmer une vérification
réussie. Une seule revue, aucune boucle de contrôles ; droits, budget, annulation
et historique conservés. Un code sûr indique désormais le type d’échec sans
message fournisseur ni données privées. Les actions déjà réussies ne sont pas
rejouées par le moteur ; leurs résultats restent disponibles pour la réponse.

233 tests et trois parcours navigateur ciblés passent, dont l’explication visible
malgré une revue invalide et une écriture mémoire conservée sans duplication.
GPT‑6 Luna medium réel dans l’assemblage web : dix appels, quatre scénarios réussis
(description après INVALID_QUOTE forcé, vraie lecture de fichier après panne de
revue forcée, inventaire avec vraie revue, même question après un ancien message
d’échec de revue). SQLite/fichiers jetables, aucune
écriture métier propriétaire et aucun repli API. Un premier essai du protocole
réel avait échoué à une assertion ; le rejeu instrumenté est passé. Cette preuve
ciblée ne qualifie pas tous les modèles ni toutes les causes de panne fournisseur.
Déployé après sauvegarde chiffrée ; service redémarré et santé vérifiée. Aucun
message propriétaire réécrit, aucun changement des droits ou du modèle du fil.

## Correctif — conscience des outils

Conversation Test : les outils fichiers et terminal étaient présents dans le vrai
inventaire. La revue mémoire, limitée à memory.assess, a pourtant réécrit une réponse
pour nier les outils fichiers (audit answerCorrected). Ce défaut du contrôle final
est distinct de la disponibilité des connexions ou des permissions du fil.

La revue ne peut plus publier un remplacement complet. Elle cite une affirmation
mémoire et son défaut de preuve ; le modèle principal régénère avec son inventaire
complet et les résultats actuels. L’inventaire primaire est aussi fourni à la revue.
Pas de nouvelle revue en boucle, appel primaire supplémentaire seulement sur demande
de révision. Le brouillon non retenu ne rejoint pas le journal conversationnel.

231 tests, démo et trois parcours navigateur ciblés passent. GPT‑6 Luna medium :
23 appels réels, 21 outils MCP exposés, 45 contrôles. Fichier de preuve découvert
par un vrai files.list après un historique niant cet outil ; même résultat après
injection volontaire d’une revue erronée. Le modèle principal répare aussi une
fausse assurance de sauvegarde après contrôle mémoire. Identités et données QA
retirées, aucune écriture métier propriétaire. Un premier essai avait échoué sur
la conservation de la note QA ; le rejeu instrumenté est passé, cause initiale non
établie. La preuve ne vaut pas garantie universelle de décision mémoire par le LLM.
Ce parcours couvrait la substitution de réponse, pas encore l’échec du contrôle
pendant une demande générale, corrigé dans la reprise ci-dessus.
Correctif déployé après sauvegarde chiffrée, service redémarré et santé vérifiée.
Aucun changement des messages de la conversation Test, de ses droits ou de son modèle.

## Projets : source unique MCP

L’assemblage web sélectionne `McpProjectsRepository` via
`HARNESS_PROJECTS_MCP_CONNECTION_ID`. Création et catalogue de l’interface,
validation des rattachements et outils du chat utilisent le même service distant.
L’identifiant renvoyé par le MCP est canonique ; celui de la demande sert à
l’idempotence de création. Objectif éditable dans le formulaire ; réessai identique
sans doublon. Modification/archivage disponibles via les outils MCP approuvés.
Une nouvelle conversation ne rejoint pas un projet archivé.
Parcours Chromium supplémentaire sur les vrais MCP, à 320/390/820/1440 px :
création depuis le formulaire et présence après rechargement, sans débordement
ni erreur JS ; 36 contrôles, données synthétiques retirées.

PostgreSQL 015 / SQLite 003 retirent les seules clés étrangères vers le catalogue
local des projets. Données existantes conservées, aucun import automatique ni
réécriture des références anciennes. En production, contrôle préalable : zéro
projet local, zéro conversation liée, zéro souvenir local de portée projet.
Pas de ligne miroir créée pour satisfaire une clé étrangère. Les modules SQL
restent utilisables pour les fixtures des adaptateurs. Sans binding Projects, la
création applicative demande sa configuration ; aucun catalogue SQL n’est exposé
ni utilisé par défaut. Aucun repli si la connexion sélectionnée échoue.

Mémoire de projet : contexte distant `nora-projects` avec UUID canonique. Anciennes
références `nora-heart.project` non converties implicitement. Les souvenirs personnels
restent communs au compte. Les conversations/historique et l’exécution restent dans
Heart ; centralisation ou sauvegarde distante des conversations différée sur demande
du propriétaire. Les artefacts restent sur le serveur Heart, sans déplacement.

## Vérifications et optimisation

229 tests de `pnpm check`, démo locale et deux tests de bundle chiffré passent.
23 parcours Chromium complets passent, puis les parcours petit contexte/revue
mémoire ont été revérifiés après condensation des consignes. Première passe :
course dans un contrôle explorateur et surcharge à 8 192 tokens trouvées et corrigées,
sans augmenter la fenêtre ni retirer d’outils/permissions.

Serveur nora-tests : 220 tests hors terminal passent dans un conteneur limité,
plus 42 tests PostgreSQL sur base jetable, incluant la migration 14→15. La première tentative distante avait omis les assets
et le catalogue de skills ; protocole corrigé. Bubblewrap absent de l’image minimale :
les tests terminal restent exécutés sur l’hôte configuré, sans prétendre les qualifier
sur ce conteneur.

GPT‑6 Luna medium réel : onze appels, 21 outils MCP exposés et 38 contrôles réussis.
Création projet par le chat, parcours applicatif via le MCP, réémission sans doublon,
renommage, archivage, conversation et mémoire par UUID distant ; zéro ligne projet
SQL locale. Mémoire : écriture/rappel, relecture de version active, rejet après oubli
et correction d’une ancienne assurance. Vrais PostgreSQL/OpenBao et HTTPS. Identités,
clés et données QA retirées ; aucun souvenir propriétaire modifié.

Un test supplémentaire sème un ancien projet SQL puis vérifie qu’une instance sans
binding ne l’expose pas, ne peut pas s’y rattacher et ne crée aucune ligne locale.
Les données historiques restent intactes.

Optimisations : lectures mémoire/projets en parallèle ; catalogue distant mutualisé
uniquement pendant une lecture simultanée, sans cache périmé ; une seule lecture de
projet à la création d’une conversation. Pas de retry automatique des mutations.
Consignes par défaut condensées, overrides utilisateur conservés. Contrôle UI : deux
lectures simultanées identiques = une requête HTTP, dix réconciliations d’icônes =
zéro mutation DOM, aucune erreur JS. Pas de promesse de vitesse universelle.

## Mémoire et coffre

Mémoire active via MCP, sans double écriture ni repli local ; anciens souvenirs locaux
conservés hors mémoire active, conformément au choix de démarrer vide. Confirmation
known : id/version relus, révision active exigée. Reçus antérieurs projetés comme
historiques ; journal inchangé. Échec de revue : brouillon retenu puis réponse primaire régénérée, effets réussis
non annulés. La détection des affirmations textuelles dépend encore du modèle.
Coffre : arguments/résultats exclus du journal et de la revue ; valeurs visibles au
modèle pendant le tour. Aucune promesse de secret vis-à-vis du fournisseur LLM.

## Déploiement

Sauvegarde locale chiffrée réalisée avant migration, service drainé et arrêté,
PostgreSQL 015 appliquée puis redémarrage sain. Binding Projects explicite activé.
Les empreintes des onze tables métier comparées avant/après sont identiques ;
aucune réécriture de conversation, souvenir, réglage ou tâche. Contrôle HTTPS
propriétaire en lecture seule : catalogue distant lisible, quatre souvenirs actifs,
quatre largeurs sans débordement ni erreur JS ; aucune inférence ou écriture métier.

## Publication et suite

Publication publique autorisée le 20 novembre : code, modules, migrations, tests,
documentation et avis de licence. Historique opérateur, état privé et preuves de
déploiement exclus du premier historique public ; historique local conservé.
Voir PUBLICATION.md. Aucun secret dans les contenus publiés.

Suite : usages quotidiens et défauts mesurés, avec amélioration ciblée. La gestion
distante de l’historique des conversations reste différée ; aucune migration de
conversations ni nouveau mécanisme de synchronisation dans ce lot.
