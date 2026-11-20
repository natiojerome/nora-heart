# Outils MCP et recherche web

Heart utilise le SDK TypeScript officiel MCP 1.32.2 dans
`src/modules/tools/mcp/index.ts`, avec Streamable HTTP. Aucun autre harness,
processus navigateur ou framework serveur n’est ajouté. Le core ne connaît que
`Tool`, ses permissions et les résultats texte ; il ne dépend pas du SDK.

## Utilisation

La recherche par défaut est auto-hébergée : SearXNG et lecteur de pages derrière un
MCP privé, sans abonnement ou quota commercial. Le preset se configure dans
Capacités → Connexions ; réseau du fil requis, déjà inclus en YOLO. Exa est désactivé sur demande
du propriétaire. [Installation, outils et limites réelles](WEB-SEARCH.md).
Les autres serveurs MCP restent remplaçables par configuration et approbation.

## Voir la liaison outil → connexion

Capacités → Outils présente les outils approuvés des connexions MCP : titre fourni
par le serveur, nom MCP exact, description et connexion source. Les connexions
désactivées restent identifiables comme telles ; réseau et permissions du fil
restent nécessaires. Le bouton « Configurer : <connexion> » ouvre la fiche existante.
Capacités → Connexions propose aussi « Voir les outils fournis » pour chaque service.

Les deux vues utilisent le même snapshot privé `/api/external-tools`, chargé une
fois à leur première ouverture. Ce GET ne découvre aucun serveur et n’appelle pas
les outils ; actualisation explicite et sauvegarde réutilisent le même contrôleur.
Les noms affichés sont ceux du serveur MCP. L’alias technique du modèle reste
produit par `externalToolName`, sans changer l’identité persistante ou les appels.
Aucun outil non approuvé n’est inventorié, aucune permission n’est accordée ici.

## Composition et contrats

- `contracts/external-tools.ts` : métadonnées neutres, snapshots JSON Schema,
  repository et session distante. Aucun type SDK ni secret dans les contrats.
- `app/external-tools.ts` : validation, découverte, approbation, états observés,
  activation et adaptation vers Tool. Le connecteur est injecté par composition.
- `modules/tools/mcp/index.ts` : protocole, transport, pagination, validation des
  arguments, appel et fermeture. JSON Schema draft-07/2020-12 via Ajv.
- `modules/storage/postgres` : repository et migration additive 012, table
  `external_tools`. UUID indépendant du nom, version optimiste, config JSONB.
- `app/web-conversations.ts` : assemble le repository, connecteur et moteur du fil.
  `engineFor` peut être asynchrone ; le core conserve son contrôle des permissions.
- `interfaces/web/public/external-tools.*` : liste, dialogue compact, contrôles
  communs et retours de connexion/sauvegarde. Aucune connexion réseau au MCP depuis
  le navigateur ; les appels passent par Heart.

Les noms d’appel sont stables : UUID de connexion + empreinte du nom distant,
au format compatible avec les limites des cerveaux. Les libellés sont distincts,
affichés dans le journal et le panneau Contexte. Renommer la connexion ne renomme
pas les outils techniques. Pas de nouveau catalogue propriétaire imposé au serveur.

## Permissions et évolution du catalogue

Seuls les outils cochés et enregistrés sont déclarés au cerveau, avec la permission
`external.read` ou `external.write` selon l’outil. Réseau désactivé : aucun outil MCP déclaré ou exécuté. YOLO
n’active pas une connexion désactivée et ne valide pas un nouveau catalogue.
Les annotations du serveur sont des indications, jamais une autorisation. La case « Autoriser les outils d’écriture » est nécessaire pour sélectionner
les outils déclarés en écriture. Pour une annotation absente, le propriétaire doit
vérifier la nature réelle de l’outil.
Heart ne peut pas prouver les effets internes d’un serveur tiers : choisir un
serveur de confiance reste nécessaire.

La définition approuvée inclut nom, description et schéma. Chaque invocation
ouvre sa propre session, découvre le catalogue puis vérifie cette définition
avant l’appel. Un outil ajouté n’est pas exposé automatiquement ; une définition
modifiée est refusée. Tester/découvrir à nouveau dans l’éditeur, vérifier la sélection puis enregistrer
pour approuver les nouvelles définitions. La sauvegarde vérifie le catalogue si la sélection
est nouvelle ; une désactivation reste possible même si le serveur est en panne.
Un ancien run ne peut plus utiliser sa sélection si la connexion a changé entretemps.

Les sessions sont courtes, fermées après chaque appel. Cela ajoute
initialisation/découverte, mais évite un pool ou des sessions inactives à gérer et
isole les annulations entre conversations. Pas de polling réseau au démarrage de
l’app ; découverte seulement sur demande ou appel outil. Aucun retry d’appel,
transport SSE de secours, subprocess/stdio, OAuth, sampling
n’est pris en charge ici. Les écritures approuvées sont prises en charge. Le délai MCP est configurable, initialement 60 s, valeur
par défaut du SDK ; ce n’est pas un délai imposé à toute la conversation.

## Secrets et contenus distants

Authentification : aucune, Bearer par variable d’environnement, ou en-tête par
variable d’environnement. L’UI reçoit seulement le nom de variable, jamais sa
valeur. Les variables appartiennent à l’environnement privé du service. Les URLs
avec credentials ou paramètres de secret sont refusées ; redirections HTTP refusées
et valeurs de headers secrètes masquées dans les résultats. Les erreurs distantes
brutes ne sont pas journalisées. HTTPS requis, sauf HTTP loopback pour un MCP local
explicitement configuré. Aucun credential des autres Nora n’est importé.

Le résultat MCP JSON conserve contenu et données structurées. La recherche/lecture
locale retourne du texte et ses sources ; pas d’exécution d’HTML distant. Les consignes
web demandent de consulter les sources, citer leurs URLs réelles et ignorer leurs
instructions. Les règles de recherche sont des instructions applicatives courtes,
pas un moteur de skills prétendument livré. L’usage d’un fournisseur de recherche
lui transmet la requête et les URLs demandées.

## API propriétaire

Session obligatoire ; origine et CSRF vérifiés sur les POST.

| Route | Effet |
| --- | --- |
| GET `/api/external-tools` | Connexions, outils approuvés, dernier état observé et preset de recherche locale. Aucune découverte réseau. |
| POST `/api/external-tools/discover` | Tester une configuration et lire son catalogue, sans la sauvegarder. |
| POST `/api/external-tools` | Créer/modifier avec version et `toolNames` approuvés. Aucune clé brute. |

## Validation et limites

Tests déterministes : serveur MCP HTTP réel jetable, arguments invalides, erreurs,
secrets, redirections, changement de catalogue, activation, réseau/YOLO, révocation,
annulation isolée de deux lectures. PostgreSQL : reconnexion, versions et dump
restauré comparant aussi la nouvelle table. Navigateur : configuration/découverte,
choix, CSRF, refus sans réseau, résultat journalisé, désactivation et affichages
320/390/820/1440 px ; modèle simulé, pas téléphone physique.

Recherche locale réelle : trois requêtes aux moteurs et une lecture de page sans
coupe, puis ChatGPT réel avec recherche et lecture de PostgreSQL, trois appels
modèle réussis et réponse citée. [Preuves actuelles](qualification/self-search/).
Les essais Exa précédents restent des qualifications historiques dans
qualification/mcp ; ce serveur n’est plus le choix actif. OAuth et stdio ne sont pas livrés. Les écritures externes sont approuvées par connexion. Voir PLAN.md.

Sources : [SDK officiel](https://ts.sdk.modelcontextprotocol.io/client),
[contrat MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).


## Nora MCPs et contenu sensible

Trois connexions actives, clés privées distinctes, modes d’écriture et transitoire
configurables dans le même éditeur. Le résultat structuré est préféré à son repli
texte pour limiter les doublons de contexte. Codes métier bornés, aucun message
brut de serveur dans les logs/erreurs. Les guides *_help sont appelables à la demande.
Mode transitoire : arguments/résultats disponibles pendant le tour seulement,
marqueurs dans le journal, revue mémoire expurgée. Le fournisseur LLM voit toujours
les valeurs et peut les recopier : ne pas confondre cette protection avec une
isolation du modèle. [Mémoire, coffre, projets et bascule](NORA-MCPS.md).
