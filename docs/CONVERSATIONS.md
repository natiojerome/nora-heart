# Conversations persistantes

Le panneau « Conversations » de heart.natio.re conserve plusieurs fils dans
une base PostgreSQL dédiée à Heart. L’atelier d’essai reste temporaire et séparé.
Créer un titre et un projet facultatif ; les valeurs par défaut de Configuration
sont copiées dans le nouveau fil. Le badge modèle/effort ouvre le dialog du fil,
où fournisseur, modèle et effort sont enregistrés sans appel LLM. Fournisseurs
gère uniquement les connexions OAuth/clés. Choisir un autre cerveau entre deux
messages change le fournisseur du même fil. L’URL contient son UUID pour le retrouver au
rechargement ; le titre ne sert jamais de clé.

## Composition

`app/web-conversations.ts` assemble le stockage SQL explicitement choisi (PostgreSQL
en production, SQLite optionnel), la mémoire `structured`, les outils,
`BoundedContext` et `Engine`. `app/conversations.ts` porte le catalogue et les
validations applicatives. Le serveur HTTP ne construit aucun module concret.
La factory modèle de l’atelier sert aussi aux conversations : abonnement ChatGPT
et clés API restent des voies distinctes, sans repli automatique.

`ConversationRepository` conserve le titre, les dates et la dernière sélection
fournisseur/modèle/capacité. `SessionStore` conserve les messages et les points de
reprise. Les mémoires et les credentials restent séparés de ces deux ensembles.
Chaque fil possède un workspace privé identifié par son UUID. Les outils
fichiers ont un accès réglable par fil : aucun, lecture seule (défaut), ou
lecture/écriture, développement avec commandes isolées, ou YOLO avec terminal root sur le serveur entier. Le propriétaire utilise l’explorateur décrit dans [FILES.md](FILES.md).
Les outils mémoire peuvent lire et
écrire des souvenirs sur demande au modèle. Le mode develop ajoute Bubblewrap ; yolo sélectionne le worker root optionnel sans confirmations répétées. Le mode persiste par fil, avec badge visible ; les outils MCP de lecture activés sont proposés si le réseau est autorisé. Voir [MCP.md](MCP.md).

La mémoire utilise les portées personnelle/projet. Créer un projet dans Projets ou le
panneau Mémoire et le sélectionner à la création du fil ; son UUID reste fixe
pour ce fil. Sans projet, seuls les souvenirs personnels sont proposés. Les
historiques des fils restent séparés. Un point de reprise n’est jamais
transformé automatiquement en souvenir durable. Voir [MEMORY.md](MEMORY.md).

## API privée

Toutes les routes exigent la session propriétaire ; les POST exigent aussi
l’origine attendue et le jeton CSRF.

| Route | Effet |
| --- | --- |
| GET `/api/conversations/work` | Catalogue léger des travaux et attentes, sans journal. |
| POST `/api/conversations/:id/cancel` | Arrêter ce seul run ; les effets terminés sont conservés. |
| GET `/api/conversations` | Catalogue paginé (100 par défaut), `before`, `limit`, recherche `q` et filtre `project`. |
| POST `/api/conversations` | Créer avec `title` et `projectId` optionnel. |
| GET `/api/conversations/:id` | Métadonnées et page récente (200 par défaut), `before`/`after`/`limit`, compteurs complets, contexte et activité. |
| POST `/api/conversations/:id/model` | Choisir fournisseur/modèle/capacité/effort sans inférence, comparaison atomique avec baseSelection. |
| POST `/api/conversations/:id/messages` | Envoyer `prompt`, `provider`, `modelId`, `contextWindow`, effort et références de fichiers facultatifs. |

La capacité ChatGPT vient du champ `context_window` du catalogue connecté ;
OpenRouter utilise aussi sa capacité de catalogue lorsqu’elle est disponible.
Pour une API ou un catalogue sans capacité, la valeur doit être configurée ;
l’interface affiche explicitement cette origine et propose 32768 comme valeur
à vérifier, sans prétendre connaître la capacité réelle du modèle.
Le budget de tours web vaut 0 par défaut (jusqu’à réponse finale ou arrêt),
avec un plafond positif configurable par fil ; la compression peut ajouter
jusqu’à 16 appels de résumé au maximum. Les appels réels peuvent consommer le forfait
ou être facturés par le fournisseur choisi.

Un seul envoi travaille dans un fil ; plusieurs fils peuvent progresser
indépendamment. Le claim PostgreSQL est atomique et persiste en cas de crash.
Le chat permet une [réconciliation explicite](RECOVERY.md) des claims abandonnés
et résultats absents ; aucune expiration automatique ni répétition d’action.

## Validation et limites

Les tests couvrent isolation des fils, redémarrage du service applicatif,
changement de fournisseur sans compression forcée, capacité du catalogue,
concurrence et compaction vers un modèle plus petit sans réexécuter un outil.
Le navigateur local vérifie aussi création, rechargement et changement de fil.
Les parcours navigateur automatisés utilisent des fournisseurs simulés avec
HTTP/moteur réels. Un parcours réel DeepSeek a aussi validé résumé/checkpoint,
réouverture, continuité, correction et oubli mémoire : [rapport et portée](OPENROUTER.md).
Il utilise un seul modèle. Un [parcours ChatGPT/DeepSeek réel](CONTINUITY.md)
qualifie désormais la bascule, la compression sous budget réduit et la reprise. Les simulations ne démontrent pas la qualité des longs résumés.

L’UI charge les pages précédentes et suit les nouveautés par delta. Les métadonnées
sont reconstruites au premier accès par pages, puis actualisées par ajouts ; le
moteur et le contexte conservent leurs propres lectures du journal. [Contrat et
limites](HISTORY.md). Pas encore de renommage/suppression/archivage de fil,
de streaming de réponse ni de file d’attente. La fenêtre de réconciliation est livrée.

## Suivi pendant la réponse

La lecture d’un fil expose également `busy` et `activity` (phase, horodatage,
compteur de tours de boucle). Les phases sont propres au run actif et effacées
à sa clôture, sans ajouter de texte de raisonnement au journal. Les outils restent
reconstitués depuis leurs événements durables. Le navigateur vérifie ce suivi
toutes les secondes pendant le travail ; aucun nouvel appel au modèle n’en résulte.
Les réponses acceptent aussi les tableaux Markdown et liens d’images/fichiers
enrichis : [CHAT-CONTENT.md](CHAT-CONTENT.md). L’API expose workspaceRoot pour
résoudre les liens locaux ; le journal et ses types restent inchangés.
Les bulles affichent date et heure, avec séparateurs par jour selon le fuseau
local du navigateur. Voir [CHAT-UI.md](CHAT-UI.md).

Les réglages networkAccess et maxSteps sont persistés avec la conversation,
séparément de la sélection du cerveau. Le budget web par défaut est 0 (jusqu’à
réponse finale ou arrêt) ; un budget positif est configurable. Voir DEVELOPMENT.md.

## Travail simultané

Le bouton Conversations porte le nombre de travaux et attentes. Son panneau permet
de rejoindre ou arrêter un fil actif ; la liste principale affiche aussi son état.
On peut créer un autre fil pendant une réponse. Chaque fil garde son workspace,
modèle, droits, historique et brouillon. Fermer/recharger le navigateur laisse les
runs continuer ; utiliser Arrêter pour interrompre un seul travail. Le navigateur
ne sauvegarde pas les brouillons au rechargement.

Le catalogue conserve sa limite actuelle de 100 fils, complétée par les fils actifs
du processus si nécessaire. Ce suivi n’est ni une planification récurrente ni une
file de travaux reprise après crash. La réconciliation reste nécessaire après
interruption du serveur ; aucun outil n’est rejoué automatiquement.
