# Fichiers et explorateur

Le menu **Fichiers** propose la racine des projets et les espaces de conversation.
Dans **Capacités → Outils**, Fichiers et Terminal ouvrent toujours les projets,
même sans discussion ouverte ou après avoir consulté un autre fil.
Dans le chat, le bouton dossier ouvre directement l’espace courant. Le badge
**Accès** au-dessus de la saisie ouvre directement la vue Accès des réglages du fil,
sans passer par les fichiers. Le réseau est dans Accès ; le budget de tours
est dans Exécution. Les options expliquent leur portée, y compris le mode YOLO root. Les droits existants
ne changent pas à l’ouverture. L’explorateur
et les éditeurs sont des overlays Nora, adaptés au mobile, tablette et desktop.
Les pièces jointes du trombone restent distinctes : elles sont stockées en
PostgreSQL et envoyées explicitement au modèle, tandis que les fichiers de
travail sont sur disque et lus par les outils.

## Racine des projets

Par défaut : `<installation>/projects` (actuellement `/projects/nora-heart/projects`).
`HARNESS_PROJECTS_ROOT` accepte un autre chemin **absolu** ; il est lu au démarrage,
indépendamment du nom affiché et du répertoire courant du processus. Le chemin
actif apparaît dans l’explorateur et le terminal. Les données de ce dossier sont
ignorées par Git et incluses dans le bundle chiffré géré.

L’espace global appartient au propriétaire : actions manuelles, journal distinct
`workspace-owner-projects`, aucun appel LLM ni conversation technique cachée.
`GET /api/projects-root` donne chemin et disponibilité ; `/workspace` et `/commands`
réutilisent les modules fichiers/exécution et l’authentification/CSRF/maintenance web.
Le terminal manuel est isolé sur cette racine, avec réseau autorisé ; il n’active
pas YOLO pour l’assistant. Les droits de chaque fil restent inchangés.

Installation : créer ce dossier avec le propriétaire du service et lui donner
l’écriture dans systemd (`ReadWritePaths=<chemin absolu>`). Changer le chemin
nécessite un redémarrage coordonné ; cela ne déplace aucun fichier existant.
Les espaces UUID des conversations existantes restent à leur place. La racine
n’est pas un projet SQL et un dossier n’est jamais utilisé comme identifiant durable.
Aucune liaison automatique d’un projet SQL à un dossier n’est ajoutée par ce lot.

## Disponible

- Naviguer par chemin cliquable ou dossier parent, créer un fichier texte ou un dossier, importer tous les formats.
- Filtrer les noms dans le dossier courant parmi les éléments chargés ; continuer avec Afficher la suite pour les pages suivantes. Dossiers avant fichiers dans chaque page.
- Sur téléphone, explorateur et éditeur plein écran, boutons tactiles, texte de 16 px et retour à la ligne facultatif. Ouvrir un fichier existant ne cible pas la saisie et ne déclenche pas le clavier.
- Lire et éditer un texte UTF-8. Télécharger les octets originaux de tout format.
- Renommer/déplacer tout fichier sans remplacer un nom existant.
- Supprimer tout fichier ou un dossier vide, avec confirmation visuelle.
- Régler l’accès de l’assistant pour chaque conversation : aucun, lecture seule,
  lecture/écriture, développement isolé avec terminal, ou YOLO root sur tout le serveur si disponible. Lecture seule reste le défaut.

En mode protégé, le contenu reste dans l’espace UUID du fil. En YOLO, cet espace
est le dossier de départ : les outils et l’explorateur accèdent au serveur entier
en root, avec chemins absolus et navigation « Serveur ». Sortir de YOLO rétablit
le confinement et ferme les vues de fichiers de l’ancien périmètre. Le réglage concerne
les outils du modèle. Le propriétaire conserve ses actions manuelles, même si
l’assistant n’a aucun accès. Une révocation ne supprime pas les informations déjà
présentes dans les anciens messages/résumés à la suite d’une lecture autorisée.
Les modèles du catalogue sans outils ne peuvent pas utiliser ces fonctions.

## Tailles, formats et contraintes réelles

Aucun plafond de taille de fichier n’est imposé par ce module. Import et téléchargement
utilisent des flux, sans accumuler le fichier en RAM ni le convertir en JSON/base64.
Une interruption d’import ne publie pas un fichier partiel ; une version existante
n’est remplacée qu’une fois le flux complet et la révision vérifiée.
Les formats binaires sont préservés à l’octet près. L’éditeur sait interpréter
le texte UTF-8 ; les autres formats gardent téléchargement, déplacement et suppression.
Un ZIP, un PDF ou une image n’est pas refusé parce que l’éditeur ne le décode pas.

Les limites effectives restent l’espace disque, le système de fichiers, le réseau,
la mémoire du navigateur pour l’édition complète et le contexte du fournisseur LLM.
Elles ne sont pas une promesse de capacité infinie. Les noms/chemins sont soumis
aux contraintes natives du système, sans maximum de chemin supplémentaire imposé ici.
Aucun délai total d’upload n’est ajouté par le serveur applicatif ; le proxy Heart
et son snippet commun ne déclarent pas de plafond de corps. Les autres endpoints
(JSON de configuration, pièces jointes) gardent leurs contrats distincts.

La lecture d’outil est paginée en octets : offset/length, bloc par défaut de
65536 octets, configurable, avec nextOffset/truncated pour poursuivre jusqu’à
la fin. Le bloc se termine à une frontière UTF-8. Cette taille de bloc n’est pas
une taille maximale de fichier. Le modèle doit demander une plage adaptée à son
contexte réel. La liste est aussi paginée (offset/count ou offset/length côté outil,
200 par défaut, configurable), avec Afficher la suite dans l’UI, sans plafond total.
L’éditeur charge le texte complet dans le navigateur via flux HTTP, sans passer
le texte complet dans un JSON du serveur ou dans le contexte du modèle.

## Contrats et assemblage

`contracts/files.ts` décrit les entrées, les documents, `WorkspaceFiles` et
`FileAccess`, sans type Node ni SQL. `LocalFiles` et les adaptateurs `Tool` vivent
ensemble dans `modules/tools/files/index.ts`. `WorkspaceFilesFactory` permet à
l’app de sélectionner `modules/tools/host-files` en YOLO : client du même worker
Unix root que le terminal, opérations explicites et transferts en flux, sans
repli local si le worker est absent. Le core ignore cette sélection.
Le contrat transporte les flux via AsyncIterable<Uint8Array>, sans type Node.
Un autre backend de fichiers peut
remplacer l’implémentation sans modifier le core. Le contenu des fichiers n’est
pas stocké dans la mémoire structurée ou dans la table des pièces jointes.

`Conversations` assemble les permissions de chaque run à partir du réglage
persisté. Le core filtre les outils annoncés et contrôle leur permission avant
exécution, y compris si un modèle demande un outil non autorisé. Les droits
sont un instantané du run ; l’interface bloque les mutations/changements de
permissions pendant une réponse. PostgreSQL sérialise les opérations par claim.

Les actions du propriétaire passent par `app/workspace.ts` : commande locale
déterministe, mêmes outils et même Engine, aucun appel LLM. Elles ont un journal
technique séparé `workspace-<UUID du fil>`, exclu de l’historique du modèle, et
acquièrent aussi le claim du fil pour ne pas concurrencer une écriture du modèle.
Le texte saisi est transmis directement à l’outil en mémoire ; le journal manuel
conserve l’action, le chemin, les références et le résultat, **pas ce texte**.
Ce journal d’audit ne sert pas à rejouer une commande. Les lectures de navigation
du propriétaire utilisent directement le contrat `WorkspaceFiles`.

## Outils du modèle

| Outil | Permission | Résultat / condition |
| --- | --- | --- |
| `files.list` | files.read | Pages configurables, chemins/types/tailles/dates et révisions des dossiers ; nextOffset/truncated pour la suite. |
| `files.read` | files.read | Bloc UTF-8, référence de révision courte, offset/nextOffset/truncated. |
| `files.info` | files.read | Métadonnées et référence de révision, sans contenu dans le contexte. |
| `files.create` | files.write | Création exclusive, parent existant. |
| `files.update` | files.write | Nouveau contenu avec la revision obtenue par lecture. |
| `files.replace` | files.write | Remplacement ciblé d’un texte unique, révision courante, traitement en flux. |
| `files.move` | files.write | Destination libre et revision courante du fichier. |
| `files.delete` | files.write | Revision courante ; suppression non récursive. |
| `files.mkdir` | files.write | Création d’un dossier, parent existant. |

Les outils read/info donnent une référence de lecture courte, liée au chemin et
à cette instance des outils. L’adaptateur la résout vers le SHA-256 complet avant
la mutation : le modèle n’a plus à recopier 64 caractères. Une référence expirée
ou d’un autre chemin impose une nouvelle lecture ; un fichier réellement modifié
reste refusé. Aucune référence éphémère dans la persistance. L’interface propriétaire
et le contrat WorkspaceFiles gardent la révision canonique, acceptée telle quelle
pour compatibilité. Les références des anciens tours ne sont pas réutilisables.

Les sorties de `list` et `read` sont des JSON neutres, pas des formats SDK.
Les anciens résultats de journal ne sont pas réécrits. Les noms d’outils et
permissions restent indépendants du fournisseur LLM.

## Conflits et confinement

Une modification, suppression ou un déplacement exige la révision courante.
En cas de conflit, aucun écrasement ; l’éditeur garde le brouillon. Les mises à
jour remplacent atomiquement le fichier via un temporaire privé dans le même
dossier. La création et la destination d’un déplacement sont exclusives.
En mode protégé, les traversées `..`, chemins absolus, liens symboliques, liens
physiques multiples et chemins temporaires réservés sont refusés. En YOLO, les
chemins hôte et liens sont acceptés ; lecture/édition suivent la cible, suppression
et déplacement concernent le lien lui-même. Les fichiers spéciaux restent hors
de l’éditeur (terminal disponible). Les mises à jour conservent propriétaire,
groupe et mode Unix ; les ACL/attributs étendus ne sont pas copiés par l’édition atomique.
Le déplacement concerne tous les fichiers ; les dossiers non vides ne
sont pas supprimés, les dossiers ne sont pas déplacés/renommés dans cette version.
Les fichiers binaires conservent leurs opérations génériques ; seul le texte
UTF-8 est éditable dans cet éditeur.

Il s’agit d’un espace de travail de confiance, pas d’une sandbox système face
à un autre processus de l’hôte qui remplacerait simultanément les répertoires.
L’API est réservée au propriétaire authentifié, avec origine/CSRF sur les écritures.
Une interruption laisse les garanties de non-rejeu/réconciliation du core et
des claims existantes. Le mode Développement ajoute une exécution de commandes isolée et explicite ;
voir [DEVELOPMENT.md](DEVELOPMENT.md). Les outils fichiers restent non récursifs.

## Persistance et API

Migration additive **006_file_access.sql** : colonne `file_access` sur le catalogue
des conversations, contrainte none/read/write et défaut read ; la migration 008 ajoute yolo ; la migration 007 ajoute develop,
réseau et budget de tours. Aucun changement
aux données mémoire, aux messages ou aux fichiers existants. Les sauvegardes
PostgreSQL incluent les permissions et journaux ; les espaces disque demandent
encore une sauvegarde dédiée, comme indiqué dans STORAGE.md.

| Route privée | Action |
| --- | --- |
| GET `/api/conversations/:id/workspace?path=...` | Lister un dossier. |
| GET `/api/conversations/:id/workspace?path=...&read=true` | Lire un bloc de document UTF-8. |
| GET `/api/conversations/:id/workspace?path=...&info=true` | Métadonnées de tout format. |
| GET `/api/conversations/:id/workspace/raw?path=...` | Télécharger les octets en flux. |
| POST `/api/conversations/:id/workspace/upload?path=...` | Importer le corps binaire en flux ; revision facultative pour remplacement explicite. |
| POST `/api/conversations/:id/workspace` | action create/update/move/delete/mkdir, path, et contenu/revision/destination selon l’action. |
| POST `/api/conversations/:id/file-access` | access none/read/write/develop/yolo, entre deux runs. |

Les confirmations sont dans les overlays, les requêtes ont un retour de
chargement et les doubles soumissions sont bloquées. Chaque réponse tardive de
liste est ignorée si l’utilisateur a changé de fil ou de dossier.

## Vérification

Tests temporaires : CRUD, conflits, absence d’écrasement, liens/traversées,
UTF-8/binaire, fichiers au-delà de 1 Mio, pagination, imports interrompus, isolation des fils, droits filtrés, absence d’inférence
pour une action manuelle et exclusion des contenus privés du journal/contexte.
PostgreSQL jetable : persistance, défaut read et claims partagés modèle/propriétaire.
Chromium avec HTTP et moteur réels : CRUD complet, téléchargement, écran de
permissions accessible depuis le chat et les fichiers, filtre de noms, chemin cliquable, conflit conservant le brouillon, rechargement, 320/390/820/1440 px
et hauteur réduite pour l’éditeur. Le test binaire importe plus de 2 Mio,
télécharge et compare chaque octet, puis déplace et supprime le fichier. Le fournisseur LLM des tests reste simulé ;
aucune nouvelle qualification DeepSeek du CRUD d’écriture n’est revendiquée.

[Captures](design/workspace/README.md).

En YOLO, les fichiers, l’explorateur et le terminal utilisent le serveur entier
en root ; le dossier du fil reste le point de départ. Changer de mode arrête les
commandes actives précédentes. Voir [DEVELOPMENT.md](DEVELOPMENT.md).

L’explorateur distingue son en-tête, la barre recherche/import, le chemin, les
créations et la liste défilante. Le menu ⋯ par élément ouvre les actions du type :
ouvrir, télécharger, renommer/déplacer et supprimer. Les actions utilisent les
métadonnées et révisions, sans charger le contenu ; l’éditeur reste réservé à la
consultation/modification. Le bouton réglages de l’en-tête ouvre le même panneau
de conversation que le chat. [Captures](design/conversation-settings/README.md).
