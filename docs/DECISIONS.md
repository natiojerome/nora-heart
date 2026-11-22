# Choix techniques actuels

Décisions actives au 22 novembre 2026. Ce fichier conserve le choix courant et
sa raison ; les décisions remplacées et anciens plans restent dans Git.
L’état d’implémentation est dans [STATUS.md](STATUS.md) ; la suite et ses critères
sont dans [PLAN.md](PLAN.md).

| Sujet | Choix | Raison |
| --- | --- | --- |
| Installation publique | Bootstrap GitHub puis installateur Python standard, services systemd natifs par UUID, PostgreSQL/SearXNG Docker privés, Caddy optionnel, chemins relatifs à l’installation. | Une commande dans le dossier choisi, vrai accès hôte en YOLO et cohabitation avec les autres services ; pas de clone de notre runtime privé. |
| Onboarding et services | Persister le cerveau choisi dans les défauts ; vérifier les MCP compatibles avant stockage privé des clés, puis redémarrage suivi. Sans binding, mémoire désactivée sur installation gérée. | Premier accès utilisable, reprise après actualisation, aucune autorité inventée ni mémoire SQL de remplacement implicite. |
| Wallets et signature | Daemon local indépendant, socket Unix JSON-RPC, clients JS/Python persistants ; EVM via viem et Ed25519 via Node crypto. Solde en cache, RPC explicite ; pas de diffusion automatique. | Signer depuis le code sans inférence, SQL, lecture disque ou délai du serveur MCP. Aucun plafond financier arbitraire ajouté ; accès local par groupe et signature Heart sous YOLO explicitement activé. |
| Reprise des wallets | Coffre AES-256-GCM local, credential systemd ; sauvegarde par processus séparé dans le MCP Vault existant, archive et clé de récupération, relecture et restauration isolée vérifiées. | Restaurer après perte de la machine sans manipulation de seed par l’utilisateur. Le Vault et ses lecteurs autorisés sont des dépositaires de confiance, sans prétention de chiffrement inaccessible au serveur. Sources et ancien signataire non modifiés. |
| Langage | TypeScript strict. | Contrats lisibles, écosystème d’agents et contributions accessibles. |
| Runtime | Node.js 24 LTS, version qualifiée dans `.node-version`. | Dépendances et démos validées sans changer les runtimes des autres applications. |
| Dépendances | pnpm avec verrou versionné. | Installation reproductible. |
| Architecture | Core séparé, modules nommés, assemblage explicite. | Remplacement possible sans framework maison ni dépendances cachées. |
| Modèles | AI SDK encapsulé : OpenAI/Anthropic directs et OpenRouter explicitement choisi. | Contrat neutre et orchestration conservés ; qualification réelle ciblée OpenRouter/ChatGPT conservée, sans confondre tests simulés et validation universelle. |
| OpenRouter | Catalogue texte complet, gratuit et payant, tarifs/capacités affichés, filtres facultatifs. Aucun repli de modèle. | Choix libre demandé par Jérôme ; qualification gratuite par défaut via freeOnly ; essai payant opt-in sur un modèle explicitement choisi, plafond de prix et réservation avant requête, 14 appels par défaut, plafond configurable de 24 appels et 0,05 USD. Le budget financier reste indépendant du nombre de tours d’outils. |
| Fichiers | Contrat WorkspaceFiles, module tools/files, espace UUID protégé ou serveur root en YOLO, références de lecture courtes côté outils résolues vers les révisions canoniques, droits modèle none/read/write (défaut read) ; opérations tous formats, édition UTF-8 et explorateur. | Rendre les outils visibles et utilisables avant MCP. Aucun plafond de fichier arbitraire : flux pour les transferts, pagination configurable pour listes/lecture modèle ; capacités réelles du disque, navigateur et modèle explicites. Pas d’écrasement implicite, dossiers supprimés seulement vides, actions manuelles sans LLM et hors contexte du modèle. Journal manuel sans contenu de l’éditeur ; permissions PostgreSQL via migration 006. |
| Droits et mobile | Vue Accès dans les réglages du fil, badge dans la ligne de configuration au-dessus de la saisie ; explorateur/éditeur plein écran sur téléphone, chemin cliquable et filtre local paginé. | Rendre les droits découvrables sans ouvrir les fichiers, expliquer leur portée et faciliter le tactile sans modifier les autorisations existantes ni les contrats backend. |
| Développement | ExecutionService neutre, backend Linux Bubblewrap ; outils terminal asynchrones, stdin/sortie/arrêt ; files.replace ciblé et Git natif. | Cible fonctionnelle Codex CLI demandée par Jérôme, sans dépendance à son harness ou à un cerveau particulier. Namespace dédié sans credentials ; réseau explicite. Mode develop et budget de tours configurables (0 sans plafond), migration 007. PTY/skills restent des écarts, pas des fonctions prétendument livrées. |
| Reprise après choix humain | Clore sans effet le reste non exécuté du lot, puis nouvelle inférence et propositions avec les droits courants. | La réponse peut invalider le plan préparé ; atomicité, idempotence, annulation sans LLM et absence de rejeu conservées. Cas A/B qualifié. |
| Outils externes et web | SDK MCP officiel 1.32.2 encapsulé, Streamable HTTP, connexions et snapshots JSON Schema approuvés en PostgreSQL (012). Recherche locale SearXNG + lecteur public, sans abonnement ou quota commercial. | Configuration interchangeable, permissions external.read/external.write avec réseau/YOLO du fil, aucun outil ajouté automatiquement, secrets par référence d’environnement. Sessions par appel pour isoler les annulations, pas de retry ni OAuth/stdio. Écritures approuvées et résultats transitoires désormais pris en charge. Voir MCP.md. |
| Quotas du compte | Lecteur HTTP séparé, timer 60 s, session existante en lecture seule et snapshot sans secrets, identité/fraîcheur vérifiées. | SIWC ne fournit pas ces compteurs ; afficher les vraies fenêtres générales du même compte, distinguer le plafond Heart inconnu, sans dépendre du binaire Codex ni modifier le moteur. Session source renouvelée par son client propriétaire ; erreur ou donnée périmée signalée. |
| Inventaire outils | Liste générée par le core depuis les outils autorisés et la capacité du modèle, noms canoniques dans les descriptions, snapshot par run visible dans Contexte. | Corriger les listes périmées/inventées et distinguer droits du fil, outils réellement déclarés et programmes du terminal. Aucun catalogue manuel parallèle. |
| Interactions | Module tools/interactions, résultat neutre InputRequest ; pause du core et réponses atomiques dans le journal, migration 010. | Boutons/formulaires indépendants du cerveau ; reprise après rechargement, réponses idempotentes, annulation sans LLM ni outil dépendant. Aucun SQL dans le module. |
| Formules du chat | KaTeX 0.19.1 local à la demande ; extensions Marked et rendu DOM après assainissement, HTML/MathML accessible et trust:false. | Conserver le TeX dans le journal, protéger les blocs/code/prix, défiler les grandes équations sur mobile ; pas de dépendance du core ni de calcul symbolique. |
| Affichages du chat | Markdown/GFM commun aux cerveaux, contrôleur DOM pour tableaux/cartes/images/liens ; flux d’image du workspace authentifié. | Reprendre les usages Nora sans protocole propriétaire ni migration ; images externes sur action, HTML actif interdit, génération distincte. |
| Performance web | GET identiques simultanés mutualisés sans cache privé persistant, SVG inchangés conservés, lectures indépendantes parallèles, réconciliation DOM sans écritures inchangées, bulles réutilisées, ETag revalidé pour les seuls assets publics. | Réduire le travail et les transferts mesurés sans ajouter de framework ; données API privées no-store et nouveau déploiement vérifié à chaque ouverture. Protocole dans PERFORMANCE.md. |
| Sortie API web | Valeurs par défaut du fournisseur/SDK sans plafond implicite Heart de 1024 tokens ; budgets explicites CLI/tests conservés. | Éviter de tronquer les réponses et formulaires longs ; erreurs bornées distinctes et persistantes sans exposer la réponse brute. Limites natives et estimation de contexte toujours applicables. |
| Racine des projets | `<installation>/projects`, surcharge absolue `HARNESS_PROJECTS_ROOT` au démarrage. Espace manuel indépendant des conversations, fichiers/terminal depuis Capacités ; dans le chat, espace UUID inchangé. | Fonctionner sans ouvrir de fil, conserver les droits modèle, éviter conversation cachée ou déplacement implicite de données. Racine sauvegardée et droit systemd ciblé. |
| Présentation des capacités | Trois onglets : Outils intégrés, Skills, Connexions externes. Ajout contextuel aux connexions ; un skill autorisé est « Disponible ». Outils MCP et connexion source visibles dans les deux sens, depuis le snapshot approuvé commun. | Distinguer actions, méthodes et services ; expliquer le chargement progressif sans laisser croire qu’un skill ajoute des droits ou reste chargé. |
| Entretien frontend | Extractions par responsabilité, checkJs/JSDoc et Prettier de développement ciblés ; cascade CSS préservée. | Réduire le couplage et les opérations redondantes progressivement, sans nouvelle stack ou framework. |
| Validation | JSON Schema et Ajv dans le module AI SDK. | Schémas échangeables, arguments contrôlés sans coercition ni valeurs implicites ; autres fournisseurs responsables de leur validation. |
| Stockage SQL | Contrat complet SqlStorageConnection ; PostgreSQL avec pg et SQLite avec node:sqlite, sélection explicite CLI/web. | Même conformité des repositories ; dialectes/migrations/verrous propres aux modules, aucun SQL ni ORM imposé au core. PostgreSQL reste le backend de production actuel. |
| Mémoire | Module `structured` pour les conversations web, `basic` conservé ; repositories indépendants. | Portées personnelle/projet, provenance, versions, correction/oubli ; stockage remplaçable, sans SQL dans les règles mémoire. L’outil de lecture complète refuse les oubliés, tandis que l’administration conserve historique et restauration. |
| Projets Heart | Catalogue léger UUID/titre, choisi à la création du fil. | Partager les souvenirs entre fils d’un même projet, sans utiliser son titre comme clé ni importer le registre Nora. |
| Contexte | Module `context/bounded` ; compression à 80 % par défaut du budget utilisable du modèle, sauvegarde du point de reprise puis nouveau segment dans le même fil visible. | Capacité par catalogue ou configuration, estimation explicitement signalée ; historique conservé. Implémenté pour les conversations web, voir CONTEXT.md. |
| Activité du chat | Phases neutres, commentaires publics persistés en run.progress (migration 011) et cartes mémoire issues des résultats réussis. | Panneau inspiré de Nora, sans pensées privées ni compteur inventé ; progression hors messages LLM, aucun bloc technique d’outil dans le chat, carte ouvrant la mémoire actuelle. |
| Conversations | Catalogue SQL avec UUID, journal canonique et claim atomique par fil ; liste mobile pleine largeur avec projet/modèle/effort et filtre projet. | Runs simultanés isolés par UUID, suivis dans Conversations ; déconnexion HTTP sans annulation, arrêt explicite ciblé. Aucun rejeu après crash, pas de scheduler durable. Changement de cerveau entre messages ; Métadonnées enregistrées, filtre par UUID et recherche combinés ; compteurs d’usage réservés au chat ouvert. |
| Pack d’avatar | Catalogue de packs par UUID stable, ressources logo/portrait distinctes ; pack de base Nora statique proposé au setup et dans Mon assistant. | Identité visuelle indépendante du nom, du genre et du cerveau ; réutiliser le pack courant approuvé sans réactiver les anciens essais/animations. |
| Outils du chat | Prompts rapides et fichiers via contrat neutre, stockage SQL dédié (PostgreSQL 005, SQLite 001), annulation coopérative du run. | Reprendre la barre Nora avec raccordements réels ; références dans le journal, octets hydratés au bord modèle, pas de dépendance UI dans le core. Voir CHAT-UI.md pour formats et limites. |
| Accès privé | Token administrateur permanent via environnement privé ; invitations temporaires toujours possibles. | Demande du propriétaire le 16 novembre 2026 ; jeton réutilisable sans expiration, cookie navigateur limité à 24 h. Aucun secret dans le dépôt. |
| Compteurs fournisseur | Troisième barre du chat, messages complets et contexte estimé journalisé ; budget/crédits/reset selon métadonnées disponibles. | Pas de chiffres inventés : quotas généraux du même compte via collecteur indépendant, jamais présentés comme un plafond propre à Heart. OpenRouter en lecture seule ; portée compte/clé/budget et reset daté ou cadence distingués. Aucun reset déclenché. |
| Interface | HTML/CSS/JavaScript natifs, mobile first, navigation par écrans sans vues Activité/Confidentialité ; HTTP Node privé sur heart.natio.re. | Design global repris de Nora : palette, thèmes, topbar et tiroirs à toutes tailles ; chat central et saisie ancrée, Marked/DOMPurify locaux. Contrat visuel commun, barre de page fixe sous la navigation avec icône partagée et créations à droite, contrôles personnalisés et selects en feuilles ; ajouts/éditions en overlays et retours de requêtes ; gestion, setup, API et abonnement conservés. |
| Sauvegarde des préférences | Réponse confirmée réutilisée dans l’UI ; modifications ciblées et rapprochement des changements indépendants avec version et valeur de base. | Ne pas annoncer un échec après une écriture réussie parce qu’une lecture globale échoue ; aucun écrasement d’un changement concurrent sur les mêmes réglages. Formulaire conservé en cas d’erreur. |
| Nouveaux fils | Valeurs globales fournisseur/modèle/effort/mode/réseau dans le profil versionné, copiées à la création. | Dérogations par fil conservées ; aucun changement rétroactif. JSONB existant, validation et copie dans app, core indépendant des préférences ; YOLO reste un accès root explicite. |
| Consommation | Vue raccordée aux métadonnées des fournisseurs connectés, portée compte ou clé annoncée. | Dépenses OpenRouter et quotas disponibles, sans attribuer les usages externes à Heart ; facturation non disponible explicitement signalée. Atelier retiré du menu, diagnostics conservés. |
| Fournisseurs et modèle du fil | Fournisseurs gère seulement OAuth/clés ; Configuration garde les défauts ; un dialog propre au fil choisit fournisseur/modèle/effort. | Séparer connexion et sélection. Sauvegarde immédiate sans LLM, comparaison atomique de la sélection et refus durant run ; annulation et retour au modèle par défaut sans toucher aux autres fils ni permissions. |
| Réglages du fil | Vues exclusives Modèle/Accès/Exécution/Contexte ; Modèle ouvre le dialog du fil, réseau dans Accès. Explorateur séparé avec menu par fichier. | Hiérarchie compacte, contrôles personnalisés et actions fichiers accessibles sans lecture du contenu. |
| Effort par modèle | Capacités propres au fournisseur/modèle, validation app ; traduction dans les modules ChatGPT/OpenAI/Anthropic/OpenRouter et sélection JSONB. | Catalogue ChatGPT/OpenRouter, Models API pour les connexions directes et niveaux OpenAI documentés pour familles reconnues. Automatique omet le paramètre ; aucun choix fictif sur modèle inconnu. Aucun SQL supplémentaire. |
| Actions des bulles | Copier le texte brut ; Relancer ajoute un envoi à la fin avec texte/fichiers d’origine et réglages actuels, sans perdre le brouillon. | Demande du propriétaire ; préserver l’historique et réutiliser le chemin d’envoi contrôlé par le core, sans rejeu automatique de runs. |
| Personnalisation | Nom, genre, pack d’avatar et texte libre de personnalité ; modèle choisi à l’installation comme point de départ. Profil JSONB versionné et éditeur direct après setup. | Le texte utilisateur est la référence ; aucun modèle réappliqué silencieusement. Remplacement explicite, anciens clients/profils compatibles, données conservées et conflits contrôlés. Changement de cerveau sans réinitialisation. |
| YOLO | Choix par fil, outils autorisés sans répétition ; terminal et fichiers root sur le serveur entier via worker Unix optionnel ; commandes en unités systemd. WorkspaceFilesFactory sélectionnée par app, aucun repli local. Migration 008 ; défauts existants conservés. | Autorisation explicite de Jérôme. Garder le web non root, l’exécuteur isolé distinct, un badge persistant et aucune prétention de confinement en YOLO. Pas de plafond applicatif ajouté. |
| Tests | `node:test`, tsx, commandes par famille, tests de frontières et PostgreSQL isolé. | Tester un module seul et vérifier son intégration sans clé LLM payante. |
| Abonnement ChatGPT | Module direct Sign in with ChatGPT, distinct du module API ; OAuth/SSE testés en simulation et parcours ciblés qualifiés en réel. | Garder notre boucle, nos outils et les clés API fonctionnelles ; connexion et parcours court avec outil qualifiés sur GPT-6.1-Sol, aucun harness Codex imbriqué. |

## Venice AI comme fournisseur

Ajouter Venice au module AI SDK déjà utilisé pour les API compatibles OpenAI.
URL officielle fixe, modèle choisi uniquement, aucun repli ni exécution SDK.
Catalogue dynamique pour contexte, tarifs USD/1M, outils, vision et effort réel.
Désactiver le prompt Venice et ses recherches intégrées pour garder l’orchestration
et les accès réseau dans Heart. Réutiliser les clés privées et les sélecteurs
existants, sans nouvelle table, framework ou catalogue manuel. Ne pas assimiler
la lecture du catalogue à la validation d’une inférence avec une vraie clé.

## Ton et continuité des informations

Défauts amicaux avec le propriétaire et amicaux/professionnels avec les tiers ;
personnalisation existante préservée. Retirer les plafonds implicites de message,
lot d’outils, appels/résumé, candidats mémoire et injection ; conserver le seuil
80 %, les 12 résultats classés et les 16 termes, tous réglables. Garder jusqu’à
quatre tours récents entiers selon le contexte. Remplacer les limites cachées
2500/6000 caractères par le budget cible et un plafond facultatif visible.
Préserver les originaux et les rendre relisibles par history.read dans le fil :
un résumé n’est pas une archive exacte, la récupération doit rester possible.
Aucune migration, aucun écrasement d’override propriétaire, aucune nouvelle base.

## Contraintes à conserver

- PostgreSQL et SQLite sont des options explicites ; aucun repli ni transfert automatique entre bases.
- Prévoir le futur sans compliquer le code : contrats courts, pas de couches
  de wrappers inutiles, pas de découverte automatique ou de microservices imposés.
- Un module vit sous `modules/<famille>/<nom>` et expose son entrée `index.ts`.
  Les implémentations ne s’importent pas entre elles ; `app/compose.ts` les relie.
- Le nom Nora Heart est provisoire. Nom affiché, dossier et fournisseurs restent
  indépendants des identifiants durables.
- Le stockage fichiers est un mode de démo explicite, jamais un repli automatique.
- Aucun import implicite des données des autres Nora et aucune modification
  de leurs runtimes.
- Pas d’ORM pour les requêtes actuelles. Pas de backend supplémentaire ou de
  base vectorielle à implémenter sans besoin concret.

## Compatibilité et réutilisation

Privilégier un standard établi, puis une convention répandue, avant d’inventer
un contrat. AI SDK est une interface de bibliothèque, pas un standard universel.
Ses objets internes ne seront pas le seul format des données persistantes.
Aucun hébergement Vercel ou gateway cloud n’est imposé par ce choix.

Les dépendances ajoutées sont AI SDK et ses fournisseurs OpenAI/Anthropic
(Apache-2.0), et Ajv (MIT). Leurs dépendances sont verrouillées dans pnpm ;
AI SDK inclut un package gateway transitif, sans utilisation par notre adaptateur
qui reçoit toujours un objet fournisseur direct. Aucun extrait de ces projets
n’est copié dans le dépôt ; leurs avis de licence restent dans les packages.
Le module ChatGPT ajoute `jose` et `eventsource-parser` (MIT, sans dépendances
runtime transitives) pour JWT/OIDC et SSE. Playwright est une dépendance de
développement pour tester le navigateur ; il n’est pas utilisé par le serveur web. Le devkit SIWC n’étant pas publié
dans le registre npm consulté, aucun vendoring de son code n’a été ajouté.

Réutiliser du code libre après examen des dépendances ; conserver provenance,
révision et avis de licence des extraits incorporés. Aucun extrait de Codex,
Hermes ou DeepSeek Harness n’est actuellement incorporé. Le chat Nora sert de
référence de structure, sans import de composant React. Marked (MIT) et DOMPurify
(MPL-2.0 ou Apache-2.0) sont servis localement pour le rendu, voir
[notices](../THIRD_PARTY_NOTICES.md). DSH est une référence
de modularité, pas une dépendance runtime.

## Contributions et maintenance

Main avec commits vérifiés. Pas de dépôt distant ou de publication à ce stade.
Prévoir une documentation anglaise avant publication. Maintenir les documents
à mesure des décisions et retirer les descriptions obsolètes ; Git garde
l’historique. Ne pas effacer des données ou réécrire une migration SQL appliquée
au nom du nettoyage documentaire.

## Références

- [OpenRouter : niveaux d’effort par modèle](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens#discovering-per-model-reasoning-options)
- [OpenAI : effort de raisonnement](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort)
- [Anthropic : effort](https://platform.claude.com/docs/en/build-with-claude/effort) et [capacités du modèle](https://platform.claude.com/docs/en/api/models/retrieve)

- [OpenRouter : métadonnées de clé](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)
- [OpenRouter : crédits du compte](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits)
- [ChatGPT direct : erreurs et limites de partage](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery#structured-responses-errors)

- [Node.js](https://nodejs.org/en/about/previous-releases)
- [AI SDK](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [SDK MCP](https://modelcontextprotocol.io/docs/sdk)
- [JSON Schema avec Ajv](https://ajv.js.org/json-schema.html)
- [Transactions node-postgres](https://node-postgres.com/features/transactions)
- [Architecture DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

- [SearXNG : installation auto-hébergée](https://docs.searxng.org/admin/installation-docker.html)

## Recherche web sans quota commercial

Le 18 novembre, le propriétaire refuse un MCP dont le niveau gratuit est limité
pour pousser au paiement. Exa est désactivé et retiré du preset actif. Choix courant :
SearXNG officiel auto-hébergé et lecteur HTML public derrière notre MCP local, avec
moteurs publics configurables. Aucun compteur de recherches, crédit ou repli payant
Heart. CAPTCHA/blocages, pagination des moteurs et ressources serveur/modèle restent
des limites réelles à rendre visibles. [Exploitation et code](WEB-SEARCH.md).

## Portée actuelle de la recherche web

Recherche/lecture avec liens vers les sources suffisantes pour les usages courants.
Conserver cette version et observer les besoins réels. Recherche de passages,
références structurées vérifiées et cartes de sources sont différées, pas déclarées
livrées ni prioritaires. Reprise/restauration, historiques et continuité multicerveau ciblée sont qualifiés ;
les limites de fonctionnement sont configurables ; la planification est livrée ; la suite porte sur son usage
réel et ses compléments ciblés, voir PLAN.md.

## Reprise vérifiable et sauvegarde gérée

Lot 1 autorisé le 18 novembre : réparation explicite du journal, sans appel outil
ni LLM, et sauvegarde chiffrée de la base/fichiers/configuration/code gérés.
Propriété PostgreSQL prouvée par lease de connexion, pas par un timeout ; clôture
atomique avec comparaison du dernier événement et clôture des écritures tardives.
Un résultat manquant reste incertain, même après déclaration du propriétaire.
La sauvegarde attend le repos et utilise le verrou consultatif partagé/exclusif
des runtimes ; elle se reporte si un travail existe. age pour le chiffrement, clé
privée séparée et aucune copie hors machine choisie implicitement. Détails, scope
et restauration isolée dans [RECOVERY.md](RECOVERY.md).

## Stockage SQL interchangeable

Le 18 novembre, Jérôme demande la conformité commune et un module SQL remplaçable
après l’exemple SQLite. Choix : SqlStorageConnection complet, SQLite natif Node
dans storage/sqlite, PostgreSQL conservé. Le même test comportemental s’applique
aux deux modules. Pas de client SQL universel, d’ORM ou de réécriture du moteur.
Propriété SQLite par verrous SQLite réels dans des fichiers techniques séparés ;
WAL seulement sur les données, pas de PID/TTL maison. Les commandes sélectionnent
un backend au démarrage ; changer d’instance requiert un transfert explicite des
données si leur conservation est souhaitée. [Contrat et exploitation](SQL-STORAGE.md).

## Présentation du travail dans le chat

Le 18 novembre, Jérôme demande de retirer les blocs d’outils utilisés et de
rapprocher davantage la réflexion en cours de `/projects/nora`. Le fil ne rend
plus les groupes Actions effectuées, arguments ou retours bruts. Le journal et
l’inventaire effectif restent complets ; les cartes mémoire et formulaires sont
conservés. Panneau unique actif, en-tête/compteurs/icônes/liste selon la référence
visuelle Nora ; seulement commentaires publics et phases effectivement signalées.

## Décision mémoire proactive et reçus visuels

Le 18 novembre, le propriétaire demande les cartes mémoire au style Nora et
signale son métier non sauvegardé avant relance. Politique partagée dans app,
rappelée dans les outils mémoire : initiative sur faits durables utiles à faible
risque, déduplication, respect du refus et accord pour une information sensible.
La consigne seule ayant manqué un second fait inclus dans une question, ajout d’une
revue explicite avant clôture : module memory/review, contrat neutre CompletionReview,
même cerveau, décision JSON Schema validée puis outils habituels. Un appel court
supplémentaire par tour terminé, hors démo/modèle sans outils ; pas d’extracteur par
mots-clés, de fournisseur implicite ni de revue asynchrone hors journal. Une revue
invalide/indisponible est signalée, une annulation reste une annulation. Le choix
sémantique dépend encore du LLM ; qualifier séparément les fournisseurs.
Le même jour, un prénom de conjoint a provoqué un accord inutile dans le modèle
principal avant revue. Décision clarifiée : les faits personnels courants, stables
et utiles déclarés par le propriétaire (dont les prénoms et liens de ses proches)
se conservent spontanément. Ne pas assimiler toute donnée personnelle à une donnée
sensible ni demander à l’utilisateur de faire le tri ordinaire. Politique unique
app/memory-policy.ts fournie aux deux étapes ; accord réservé à une sensibilité
réelle/ambiguïté, refus respecté, aucune inférence de détails sur le proche.
Aucune nouvelle passe ni mécanisme d’interception des formulaires généraux.
Les reçus reprennent la hiérarchie visuelle Nora avec icône/action/date/titre/aperçu ;
les versions et portées restent consultables dans la fiche, sans alourdir le chat.

## Reçus de réponse et attente ChatGPT

Le 18 novembre, demande de rapprocher les sauvegardes et les réponses de formulaire
du format Nora : composant DOM et géométrie communs, vert pour mémoire, bleu pour
réponse, détails complets repliables et date de réponse issue du journal. Pas de
nouvelle carte d’outil brute ni modification des données historiques.
L’échec de reprise observé correspond au délai total de 120 s, sans preuve du détail
réseau historique. Remplacer cette limite par le même délai d’inactivité réarmable,
avertissement distinct, aucun retry ni exécution d’une sortie partielle.

## Consignes visibles et contrôlées par le propriétaire

Le 18 novembre, le propriétaire demande de consulter/modifier les instructions de
base et de rétablir les défauts. Onze blocs centralisés dans app, éditeur web
compact, surcharges seules dans le profil JSON versionné existant. Reset supprime
la surcharge, texte vide autorisé, fusion des changements indépendants et conflit
sur le même bloc. Instantané partagé par run ; modification au prochain échange,
pas au milieu du travail. Aucun système générique de plugins ou skills ajouté,
aucun SQL dans la mémoire, aucune permission accordée par modification du prompt.

## Configuration unifiée par onglets

Configuration et Instructions partagent une entrée de menu et cinq onglets
fixes : Apparence, Assistant, Discussions, Instructions, Limites. Nom, genre et texte libre
restent les sources existantes ; présentation et défaut dérivés du même profil que
les requêtes LLM. Pas de duplication dans les surcharges. Le reset prépare le
brouillon sans modifier nom/genre/thème. Le pack reste sous Identité visuelle dans
l’éditeur Assistant ; le setup initial est conservé.

Contrôleur d’onglets explicite sans API ni framework supplémentaire. Panneaux
conservés, lecture du catalogue différée et cache mémoire versionné ; pas de polling.
Une réponse ancienne ne doit pas écraser une sauvegarde plus récente. Actualisation
manuelle et purge à la déconnexion. Liens historiques compatibles, clavier et
quatre largeurs qualifiés. Le contrôleur Configuration est distinct de celui des
réglages par conversation. Aucun changement de stockage ou de contrat métier.

## Historique par curseur et projection jetable

Pages de catalogue par date exacte/UUID capturés, événements par identifiants
immuables et séquence interne. Tailles de page configurables, sans plafond global
d’historique. Conventions de pagination par clé, pas de format SDK persistant.
La récupération et les compteurs ont une projection incrémentale privée en app,
reconstruite depuis le journal, avec cache LRU réglable ; aucune nouvelle table ni
mise en cache des corps de messages. Premier accès parcouru par pages, limite
annoncée. Le navigateur conserve sa fenêtre chargée et réconcilie le DOM sans
changer les contrats modèle/mémoire. Pas de SSE ni virtualisation prématurée.

Le chat charge les pages anciennes automatiquement en remontant ; aucun bouton
permanent. Un seul appel, feedback en surimpression et reprise explicite après
échec. Compléter les pages courtes/invisibles sans polling supplémentaire. Le
prepend préserve l’ancre de lecture et ignore les retours d’un ancien fil.

## Qualification multicerveau ciblée

Le parcours ChatGPT abonnement → OpenRouter DeepSeek est qualifié avec les modèles
réels, les outils et la revue mémoire de l’assemblage web sur SQLite jetable. Budget
volontairement réduit sans falsifier la capacité native ; archives synthétiques,
aucun résumé simulé. Contrôle des valeurs exactes plutôt que d’un JSON pur sans
texte additionnel ; réponses brutes et échecs préparatoires conservés. Coûts cumulés
et réservations gardés entre tentatives, aucun repli de modèle ni données propriétaire
modifiées. [Résultats, reproduction et limites](CONTINUITY.md).

## Limites configurables sans nouvel assemblage générique

Les plafonds message/lot/compression/recherche et injection mémoire deviennent des
choix globaux du propriétaire, dans Configuration → Limites. Zéro signifie sans
plafond pour le compteur concerné ; le seuil reste entre 1 et 100 %. Permissions,
capacités réelles, limites des fiches et transport des pièces jointes restent
séparés. Aucun plafond financier ajouté.

Stocker seulement les écarts dans le profil existant, dériver les valeurs effectives,
prendre un instantané par tour et transmettre les paramètres aux modules à
l’assemblage. Aucun service de configuration dans le core, aucune migration SQL,
pas de framework de politiques. Modifier une section préserve les autres données,
et un client ancien peut encore sauvegarder le profil. UI différée/versionnée,
reset préparé avant sauvegarde, conflits conservant le brouillon. [POLICIES.md](POLICIES.md).

## Seuil de compression et capture cohérente

Le pourcentage est un déclencheur de compression, pas un plafond dur supplémentaire.
Accepter le tour indivisible ou le résumé qui dépasse ce seuil s’il tient dans le
budget utilisable ; refuser avant résumé si le tour courant ne peut déjà pas tenir.
L’injection compte les souvenirs réellement ajoutés, pas les candidats ignorés.

Le web lit une seule version du profil pour personnalité, surcharges et limites au
début du tour. Aucun cache de configuration global ajouté ; le prochain tour voit
les modifications. Dans Limites, envoyer seulement les champs changés et éviter les
écritures inchangées. Préserver profil récent et déconnexion face aux réponses
tardives, sans retry automatique des mutations.

## Skills Agent Skills, enregistrement explicite et droits conservés

Fichiers portables `SKILL.md` avec YAML, parser éprouvé `yaml` (ISC) à la frontière
du module local. Un manifeste propriétaire de l’installation associe UUID et
dossier ; aucune identité durable dérivée du nom ni scan implicite d’autres Nora.
Activation globale dans le profil existant, défaut explicite pour `code-review`,
nouveaux skills désactivés par défaut. Pas de migration ou framework de plugins.

Descriptions seules avant sélection ; `skills.load`, `skills.read` et `$nom` pour
l’invocation. Préserver les guidances utilisées après compression sans dupliquer
les corps ni modifier le journal durable. `allowed-tools` ne donne aucun droit ;
lecture confinée aux dossiers enregistrés et aucune exécution automatique de scripts.
Premier lot web local, installation GitHub/édition de contenu et portée projet
différées. Les contrats restent indépendants du filesystem/SQL/fournisseur. [SKILLS.md](SKILLS.md).

## Planification persistante, moteur commun et héritage du fil

Premier lot autorisé : une fois/quotidien/jours ouvrés/semaine, fuseau explicite,
pause/reprise/exécution immédiate, historique et notifications internes. Les modèles,
efforts, projets et permissions sont hérités du fil à l’exécution afin d’éviter une
configuration dupliquée ; une discussion dédiée permet des réglages propres.

Deux tables additives par SQL (PostgreSQL 014, SQLite 002), contrats communs.
Temporal pour le calendrier, instants ISO UTC et données structurées neutres en
persistance. Service léger dans le web, séparé du core. Verrou réel de leader,
réservations atomiques, CAS et ID d’exécution stable ; jamais de rejeu automatique
d’une occurrence au résultat incertain. Rattraper une fois ou ignorer, sans rafale
d’échéances manquées. Aucune routine active ni notification externe implicite.
Parallélisme 2 et polling 5 s configurables, 0 sans plafond pour la concurrence.

## Suivi silencieux et file équitable

Le polling de métadonnées ne doit pas simuler un rechargement utilisateur. Aucun
feedback de chargement ni réécriture DOM pour des données identiques ; préserver
les pages d’historique déjà chargées. Cadence réduite au repos et pause pendant
l’édition. Les mutations et chargements explicites conservent leur retour visuel.
Parcours de file par séquence avec retour au début pour ne pas affamer les autres
tâches quand une conversation attend ; aucun rejeu d’une occurrence incertaine.
Recherche d’occurrence par ID indexé dans chaque module SQL, sans nouvelle table.

## Consolidation du suivi des tâches

Réutiliser la pagination neutre du journal pour les états d’occurrence : projection
jetable de métadonnées, aucune copie de réponses et reconstruction après éviction.
Pager les définitions par UUID stable et leurs seuls derniers résultats. Défilement
automatique, aucune nouvelle limite totale de tâches. Contrôle JS strict ajouté au
contrôleur concerné ; `content-visibility` natif pour le rendu hors écran sans
framework de virtualisation. La qualification réelle ne peut substituer un modèle
à un identifiant explicitement demandé mais absent du compte sans choix utilisateur.

## Outils de tâches via le service commun

Adaptateur JSON Schema tasks.list/read/write vers TaskService ; opérations métier
distinctes dans l’application. Regrouper les schémas évite une régression constatée
à 8 192 tokens, sans relâcher les validations serveur ni relever la capacité du test.
Création et run-now idempotents par UUIDv5 issu de l'identité moteur de l’appel.
Le fil occupé finit son tour avant l’occurrence ; pas de polling LLM pour attendre
son propre travail. Lire les réponses du journal, pas reconstruire depuis l’objectif.
Les reçus d’écritures sont compacts et ouvrent la fiche existante. Consigne tasks
visible/modifiable/resettable ; notifications internes seulement. Pas de migration.


## Services Nora MCPs indépendants

Le 20 novembre, Jérôme autorise le raccordement de Heart à Mémoire, Coffre-fort et
Projets. Réutiliser le client MCP, les schémas et les permissions, sans intégrer
les implémentations des serveurs. Clés distinctes par compte/service, secrets par
référence serveur. Écritures sélectionnées et autorisées explicitement par connexion.
Le coffre ne conserve pas ses arguments/résultats dans le journal du chat, mais
le modèle les voit ; aucune promesse de masquage d’un texte produit par un LLM.

Repository de mémoire MCP remplaçable, règles structured et contexte conservés.
Pas de double écriture ni repli ; Jérôme choisit « Commencer vide » :
bascule vers MCP sans copie des trois souvenirs locaux. Originaux et historique
conservés hors mémoire active ; aucun alias d’import ajouté. Aucun transfert de conversation ou planning.
Oubli MCP physique et sans restauration native, capacité annoncée aux outils/UI.
Raccordement qualifié avec modèle simulé et services réels, puis GPT‑6 Luna medium
réel : écriture et rappel dans un nouveau fil, compte MCP QA distinct et retiré. [Détail](NORA-MCPS.md).


Le validateur d’un cerveau doit accepter les dialectes JSON Schema des outils
MCP approuvés, sans convertir leur stockage en format SDK. Draft-07 et 2020-12
sélectionnés dans les adaptateurs, formats standards par ajv-formats 3.0.1/MIT.
Conserver strict et les erreurs sûres. Une qualification mémoire avec permissions
externes absentes ne valide pas un catalogue MCP : assert sur les outils réellement
exposés ajouté au parcours réel GPT‑6 Luna après le défaut du 20 novembre.


Le 20 novembre, une confirmation de mémoire fondée sur un ancien backend révèle
une lacune de preuve. Séparer connaissance conversationnelle et stockage courant,
permettre une recherche vide explicite selon les budgets configurés, et vérifier
les affirmations de sauvegarde dans la revue déjà existante. Pas de règles NLP
par expressions régulières ; observation mémoire structurée et auditée, puis
réponse régénérée par le modèle principal uniquement lorsqu’une correction est nécessaire. Vue actualisée à l’ouverture sans polling.

Renforcer la preuve au niveau moteur : une confirmation structurée known doit
référencer une version active relue, et les anciens reçus ne transmettent plus
leur contenu comme preuve actuelle. En cas d’échec de la revue mémoire, retenir
le brouillon plutôt qu’ajouter un avertissement à une possible fausse assurance.
Les effets exécutés ne sont pas annulés ; aucune reprise aveugle des écritures.
Le modèle continue d’identifier les affirmations dans le texte libre : ne pas
présenter ce contrôle comme une garantie universelle contre toute hallucination.

## Projets : source unique MCP

Clarification du 20 novembre 2026 : toute création et gestion métier de projet
passe par MCP Projects. Heart conserve les artefacts physiques et les références
locales nécessaires à ses conversations/exécutions. Réutiliser l’identifiant MCP,
indépendant du nom et du chemin ; pas de catalogue métier Heart parallèle ni de
synchronisation de deux fiches. L’ancienne séparation était une erreur de conception.
Raccordement des outils et remplacement applicatif par McpProjectsRepository livrés. Préserver les données existantes et traiter explicitement leurs références,
sans import, déplacement ou suppression implicite.

Conversations : conserver l’historique Heart actuel ; gestion/sauvegarde distante
reportée explicitement. Projets/mémoire/coffre restent les autorités distantes.
La publication publique autorisée commence par un instantané contrôlé ; historique
privé conservé localement et non publié. Licence MIT, notices tierces préservées.

## Revue mémoire limitée à son domaine

Incident du 20 novembre : les outils fichiers étaient fournis au tour principal,
mais la revue limitée à memory.assess a remplacé la réponse par un déni d’accès.
Interdire la substitution directe correctedAnswer. La revue cite l’affirmation
mémoire contestée et son défaut de preuve ; le moteur redonne la main au modèle
principal avec ses outils, droits et résultats réels. Fournir l’inventaire primaire
au contrôle. Coût supplémentaire seulement lorsqu’une révision est demandée ; une
seule revue par run. Tester aussi une revue volontairement erronée, sans confondre
ce test de faute avec une intégration fournisseur simulée.

## Un contrôle auxiliaire ne doit pas avaler une réponse normale

Le mode replace de la revue mémoire effaçait une explication du Harness après
échec du contrôle. Passer à revise : reprendre le modèle principal plutôt que
publier l’avertissement comme réponse unique. Le brouillon non vérifié reste
retenu ; ne pas confirmer un stockage sans reçu actuel. Une revue par run,
reprise primaire bornée par le budget existant, aucun rejeu moteur des effets.
Diagnostics typés et sûrs dans le journal pour distinguer protocole, citation,
preuve, version, portée, taille et indisponibilité. Tests avec fautes injectées
et modèle réel ; pas de promesse d’infaillibilité sémantique du modèle.

## Confiance, provenance et inspection

Les faits établis se présentent directement. Réserver les incertitudes aux limites
concrètes qui affectent la réponse, sans audit ou préambule défensif de routine.
L’économie de tokens conduit à choisir des lectures utiles et ne remplace pas
l’inspection nécessaire. Une explication de code s’appuie sur les fonctions exécutées.

Les faits du runtime sont fournis par app à partir de l’assemblage et de la sélection
validée du tour. Exemples et autres processus ne font pas autorité pour ce fil.
Les sorties partielles proposent une continuation explicite ; pas de lecture forcée
de toute la sortie, pas de plafond arbitraire et pas de permission supplémentaire.

## Mission centrée sur l’utilisateur

Sur demande du 21 novembre : autonomie guidée par l’objectif demandé, précisions
intégrées sans perdre la finalité et vérification du résultat. Les initiatives
au-delà de la demande nécessitent un bénéfice concret pour l’utilisateur ; les
détails ordinaires ne nécessitent pas d’approbation. Soumettre les restrictions
supplémentaires avant de les imposer. Les CGU/CGV et analyses juridiques relèvent
de l’utilisateur et de son équipe : aucun travail de ce type hors demande explicite.
Le bloc work reste visible/modifiable, sans nouveau module ni changement des droits.


## Consommation Venice avec la clé d’inférence

Lire les soldes et limites via le GET authentifié `api_keys/rate_limits`, sans
inférence ni navigateur. Séparer les unités de solde et le renouvellement DIEM du
solde USD ; ne déduire ni dépenses ni resets depuis une recharge ou un abonnement.
Les endpoints Billing exigent effectivement une clé administrateur, refusée par
le choix actuel d’une clé normale : afficher cette portée, sans demander davantage
de droits ni appeler ces endpoints en boucle. Réutiliser ProviderUsage et le cache
applicatif d’une minute, avec isolation des fournisseurs partageant un modèle ID.


## Un appel invalide ne doit pas interrompre une tâche corrigeable

Les erreurs de nom/arguments détectées avant tout effet rejettent leur lot et
rendent la main au modèle principal via le contrat neutre ModelToolCallError.
Les résultats déjà exécutés restent dans le contexte et ne sont jamais rejoués
par le moteur. Réutiliser le budget d’étapes et l’annulation du propriétaire,
sans retry HTTP, modèle de repli ni assouplissement des schémas. Traduire un nom
Heart exact actuellement autorisé vers son alias est une réparation locale ;
les noms voisins et outils non proposés restent refusés. Diagnostic journalisé
sans valeurs d’arguments ni erreurs SDK brutes.
