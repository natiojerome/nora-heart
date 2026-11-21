# État et reprise

Point du 21 novembre 2026. Lire aussi ARCHITECTURE.md, DECISIONS.md et PLAN.md.
Socle livré ; la parité complète avec Codex CLI et la qualification de tous les
fournisseurs restent partielles. Les preuves détaillées sont dans TESTING.md et
les rapports opérateur privés, pas dans le contexte permanent de l’assistant.

## Personnalité et continuité des informations

Défauts : amical avec l’utilisateur, amical et professionnel avec les interlocuteurs
externes ; personnalités personnalisées préservées. Limites de message/lot, appels
de résumé, taille fixe du résumé, candidats et injection mémoire sans plafond
Heart par défaut ; le budget réel du modèle reste déterminant. Configuration →
Limites expose taille de résumé et nombre de tours récents (défaut quatre).
Compression conserve les décisions et faits précis ; mémoire ajustée à la place
disponible. Les originaux ne sont jamais remplacés : history.read permet au modèle
de retrouver messages/date et outils historiques du fil après compression.

242 tests ; quatre parcours navigateur ciblés et démo. GPT‑6 Luna medium réel :
15 appels, deux compressions, code/date/heure/montant conservés, récupération
spontanée d’un détail puis référence et horodatage du message original, brouillon
externe cordial sans envoi. Aucun souvenir ni fil propriétaire modifié. Voir
TESTING.md pour les limites et les premiers essais exclus de la validation.

## Mission, autonomie et initiative

Le bloc Exécution et autonomie définit l’objectif principal : accomplir la demande
de l’utilisateur jusqu’au résultat vérifié, intégrer ses précisions et garder son
objectif en cours. Initiative sur les détails courants ; aller au-delà seulement
avec un bénéfice concret pour lui. Question seulement pour un manque indispensable
ou un engagement important non autorisé. Toute restriction supplémentaire doit lui
être soumise. Pas de recherche/vérification CGU/CGV ni d’analyse juridique hors
sa demande explicite : ces sujets sont confiés à son équipe.

Les consignes techniques d’inspection restent dans Développement. Textes modifiables
et réinitialisables dans Configuration → Instructions, sans changement de permissions
ni nouveau moteur de goals. 238 tests, deux parcours navigateur et démo ; GPT‑6 Luna
réel : 12 appels, suite paginée lue et bug corrigé/testé sans formulaire. Première
passe à 8 192 tokens trop pleine ; libellé des droits condensé sans retirer de règle
ni changer la fenêtre. Consignes déployées après sauvegarde chiffrée et redémarrage
web ; catalogue authentifié contrôlé (13 blocs, nouveau work actif), santé saine.

## Confiance et inspection

Les instructions de travail demandent des réponses directes sur les faits établis,
une inspection du code exécuté pour expliquer un logiciel accessible, des lectures
ciblées élargies selon le besoin et le suivi des parties manquantes utiles. Pas
d’audit de sécurité ni de liste de réserves hors demande. Les modèles de personnalité
préservent l’initiative choisie ; discret ne signifie plus ne pas exécuter la demande.
Les skills sont sélectionnés pour leur description, pas un simple sujet voisin.

L’app fournit la provenance du runtime : UUID réel de l’instance, stockage local des
conversations, backends mémoire/projets sélectionnés, chemin du code. Les exemples
et autres processus du serveur ne décrivent pas ce fil. Le fournisseur/modèle/effort
injecté est celui du tour courant, y compris juste après un changement de cerveau.
Ces faits ne prétendent pas contrôler la disponibilité des services distants.

Une sortie terminal partielle porte un avis et une continuation explicite avec id
et offset, placés avant le contenu volumineux. Les outils fichiers présentent aussi
la pagination et la référence de lecture avant le contenu.
Aucun drainage automatique ni nouveau plafond ; le modèle récupère la suite utile.
Une description du mécanisme mémoire n’est pas une affirmation de sauvegarde et ne
justifie pas une réserve générale. Les confirmations d’écriture restent vérifiées.

## Autorisations et exécution

En YOLO, fichiers, explorateur et terminal utilisent le même worker Unix root.
Le dossier UUID du fil est le départ ; chemins absolus et liens sont utilisables.
Mode protégé : confinement conservé. Aucun repli local si le worker est absent.
Sortir de YOLO retire l’accès hôte, arrête les commandes actives et réinitialise les
vues fichiers sans fermer les réglages.

Les outils fichiers exposent des références de lecture courtes, liées au chemin et
au tour ; l’adaptateur conserve le SHA-256 canonique pour contrôler les conflits.
Une référence expirée exige une relecture. L’édition conserve propriétaire, groupe
et mode Unix ; détails et contraintes natives dans FILES.md. Le format persistant
et l’interface propriétaire gardent leurs révisions canoniques.

terminal.exec retourne état/première sortie après une attente réglable (500 ms par
défaut, 0 immédiat). Les commandes longues continuent avec un identifiant et une
sortie paginée. Aucun timeout de commande ajouté. Les droits restent par fil.

## Données et autorités

Projets : source unique MCP pour création/catalogue/modification/archivage, dans
l’interface et les outils. UUID distant canonique ; pas de catalogue SQL miroir
ni de repli sans binding. La mémoire de projet utilise nora-projects et cet UUID.
Les anciennes références ne sont pas converties implicitement.

Mémoire : MCP actif, sans double écriture ni repli local ; anciens souvenirs locaux
conservés hors mémoire active suivant le choix de démarrer vide. Confirmation known
fondée sur une version active relue. Reçus anciens historiques ; journal conservé.
La revue mémoire cite une affirmation contestée, sans remplacer directement toute
la réponse. Une demande de correction ou un échec rend la main au modèle principal
avec ses outils et résultats. Une seule revue par run ; pas de rejeu des effets.
Diagnostics typés et sûrs ; la détection sémantique des affirmations reste au modèle.

Coffre : arguments/résultats transitoires exclus du journal et de la revue ; valeurs
visibles au modèle pendant le tour. Conversations, historique et exécutions restent
locaux à Heart. Centralisation des conversations différée sur demande explicite.
Les artefacts physiques restent sur l’hôte, aucun déplacement implicite.

PostgreSQL 015 / SQLite 003 : migrations conservées, retrait des seules clés
étrangères vers l’ancien catalogue local de projets. Aucun import ou effacement
métier implicite. Les modules SQL restent utilisables pour les fixtures.

## Vérifications

Passe précédente : 238 tests et parcours navigateur ciblés (instructions, revue mémoire,
assemblage web à 8 192 tokens). Les premiers ajouts de consignes dépassaient cette
petite fenêtre ; texte condensé, sans augmenter le budget ni retirer d’outils.
GPT‑6 Luna medium réel : 22 appels répartis en deux parcours. Inspection du moteur
et de l’assemblage via fichiers, reprise des plages nécessaires, description fondée
sur le code et métadonnées du bon runtime ; verdict récupéré en seconde page puis
bug corrigé et test exécuté avec succès. Aucun formulaire ni repli API. Un premier
contrôle QA exigeait à tort le nom technique plutôt que le nom affiché du modèle ;
le test accepte maintenant les deux. Les premiers essais docs seules, mauvais
runtime et arrêt sur sortie partielle ont servi aux correctifs, pas à la validation.

Preuves précédentes conservées : worker root sur nora-tests (fichiers hors fil,
propriétaire/mode Unix, binaire, stdin/réseau, annulation et arrêt des descendants) ;
GPT‑6 Luna medium, 11 appels pour édition protégée/YOLO, vérification terminale,
édition propriétaire et révocation. Import interrompu sans fichier partiel, références
expirées, autres chemins et conflits réels couverts par les tests automatisés.

Projets/mémoire/coffre : vrais MCP, PostgreSQL/OpenBao et HTTPS qualifiés sur comptes
QA retirés. Création idempotente, rappel/versions et refus après oubli, pas de ligne
projet SQL miroir. Tests SQL et anciens parcours complets datés dans TESTING.md ;
ils ne sont pas présentés comme tous relancés à chaque changement de consigne.

## Déploiement et suite

Déploiement précédent : mission/autonomie après sauvegarde locale chiffrée
et redémarrage web coordonné. Contrôle authentifié HTTPS : treize blocs visibles,
nouveau défaut de travail et déclencheur code-review chargés. Santé interne saine,
aucune modification des personnalités/overrides ni des droits des fils propriétaires.
Le worker existant reste compatible ; les changements portent sur l’assemblage et
les adaptateurs d’outils, pas le lancement des processus.

Publication publique autorisée : main, petits commits vérifiés et push ; secrets,
état privé et rapports opérateur exclus. Historique privé conservé localement.
Suite : suivre les usages réels et qualifier les autres fournisseurs sur les mêmes
tâches complètes, sans réintroduire de prudence générique ni de limites arbitraires.
