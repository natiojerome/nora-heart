# État et reprise

23 novembre 2026. Lire [ARCHITECTURE.md](ARCHITECTURE.md),
[DECISIONS.md](DECISIONS.md), [PLAN.md](PLAN.md) et [REVIEW.md](REVIEW.md).
Ce fichier décrit le présent ; les preuves détaillées sont dans [TESTING.md](TESTING.md).
Le socle est livré, sans prétendre à la parité complète avec Codex CLI ni à la
qualification réelle de chaque fournisseur/modèle.

## Socle actuel

- TypeScript strict, Node 24, pnpm. Contrats/core/modules/app/interfaces séparés,
  entrées publiques `index.ts`, aucun import concret entre modules. Le core ne
  dépend d’aucun SDK, stockage ou adaptateur. Frontières et cycles runtime testés.
- PostgreSQL en production, SQLite natif interchangeable via le contrat SQL et sa
  suite de conformité commune ; aucun transfert automatique des données entre SQL.
- Conversations, historique, résumés et tours du modèle restent dans Heart. Les
  programmes des projets ont leurs runtimes et services indépendants. Plusieurs
  fils peuvent travailler simultanément ; une seule exécution active par fil.
  Historique par curseurs, projections jetables, reprise et effets incertains
  journalisés, jamais de rejeu aveugle.
- Mémoire durable et projets : autorités MCP indépendantes. Les projets distants
  gèrent leur état métier ; seuls leurs artefacts sont locaux. Aucun repli mémoire
  SQL sur une installation gérée non connectée. Choix de départ mémoire vide conservé.
- Mémoire structurée proactive, consentement pour les cas sensibles/ambigus,
  injection bornée et compression selon le modèle. Lecture des originaux possible ;
  décisions mémoire et contrôles auxiliaires ne constituent pas une garantie universelle.
- Fichiers texte/binaires, édition, terminal protégé et hôte YOLO explicite,
  permissions et réseau par fil, outils MCP approuvés. L’inventaire effectif vient
  du moteur. Un appel fournisseur invalide peut être corrigé sans rejouer les effets.
- Recherche locale SearXNG + lecture de page, sans quota commercial. Les moteurs
  et sites peuvent bloquer ; navigateur JS intégré et citations structurées non livrés.
- Skills portables avec catalogue/lecture et activation ; tâches durables avec
  planification, réservations, concurrence, historique et gestion depuis le chat.
- Interface mobile/tablette/desktop : configurations et instructions par onglets,
  modèles/effort/droits par fil ou défauts, chat enrichi, formulaires et reçus mémoire,
  fichiers/terminal manuels, suivi léger des travaux indépendants.

## Fournisseurs et services réels

ChatGPT abonnement et API OpenAI/Anthropic/OpenRouter/Venice sont proposés sans
repli implicite. ChatGPT `gpt-6-luna` et OpenRouter DeepSeek Flash ont des preuves
réelles ciblées (outils, mémoire, continuité et changement de cerveau). Toutes les
paires et tailles natives ne sont pas qualifiées. Dernier parcours complet Venice
bloqué par HTTP 402 ; catalogue, consommation et reprise d’un appel invalide ont
leurs propres preuves. Ne pas confondre ces essais distincts.

Mémoire, Projets, Coffre-fort et Mail sont raccordés à Nora MCPs. Résultats Vault
transitoires dans l’historique, mais un secret lu est visible au modèle pendant
le tour ; aucune promesse d’invisibilité de sa réponse.

Mail : 19 outils, IMAP/SMTP TLS et Gmail natif, signatures par identité,
brouillons/envoi/rapprochement, fichiers/PJ et export EML. Quatre boîtes du
propriétaire connectées : Gmail OAuth et trois OVH par transfert V4 autorisé
serveur-à-serveur. UUID et signatures conservés, credentials chiffrés dans Mail,
aucune copie des accès des boîtes dans Heart. Envoi réel via Heart/Luna le
23 novembre : un message accepté par SMTP puis retrouvé une seule fois dans Gmail.
Aucun traitement automatique des messages ajouté. Voir [NORA-MCPS.md](NORA-MCPS.md).

Wallet : daemon Unix local, inventaire multi-réseaux, création/nommage,
signature EVM/Ed25519 sans SQL/LLM/MCP sur le chemin chaud, clients JS/Python,
sauvegarde et restauration via Vault. Reprise réelle dans un coffre neuf qualifiée.
Le Vault conserve la clé de récupération : autorité de confiance explicite.
XPR/XRPL restent en lecture seule. Voir [WALLETS.md](WALLETS.md).

## Installation et sauvegarde

Installation GitHub en une commande, chemin choisi, services natifs systemd par
UUID, PostgreSQL/SearXNG privés. IP HTTP par défaut, domaine/Caddy optionnel.
Connexion ou inscription MCP avant onboarding (emails autorisés), attribution de
quatre clés et stockage privé, reconnexion sans rotation. Anciens accès et clients
à trois services conservés. Identité/thème/personnalité et modèle/effort persistés.

Installations jetables sur hôte existant qualifiées, sans nouvelle VM. Compte
approuvé par opérateur pour ce parcours, chat simulé distinct des essais réels.
OS vierge, parcours complet DNS/ACME et ARM64 restent à qualifier.

Sauvegardes chiffrées code/SQL/configurations/credentials avant et après cette
consolidation : déchiffrement et empreintes vérifiés dans un répertoire jetable.
La sauvegarde complète incluant état, fichiers de travail, worker, configuration
MCP et racine des projets a été créée après arrêt explicite du veilleur crypto.
Déchiffrement/empreintes/fichiers vérifiés, véritable restauration PostgreSQL
en conteneur isolé sans réseau (256 Mio), identité et compteurs identiques.
Le helper installé est désormais aligné sur le dépôt : l’ancienne copie omettait
la configuration MCP et la racine des projets. Données et journaux du veilleur
conservés. Archives complètes existantes sous rétention de sept jours ; aucun
volume/image ou dossier d’un autre projet supprimé. Les sauvegardes MCP hors
serveur et leur restauration isolée ont été vérifiées pendant la connexion Mail.

## Consolidation du 23 novembre

- Annulation avant démarrage : aucune écriture de faux tour dans le journal.
- Écritures atomiques : fichiers temporaires uniques et retirés sur échec.
- Terminal : une unité systemd survivante reste `running` même sans enfant JS ;
  son arrêt doit être confirmé. Les véritables interruptions sont persistées.
- Composition web : fermeture SQL sur échec initial, nettoyage poursuivi après
  une erreur, appels de fermeture simultanés idempotents, stockage injectable.
- HTTP navigateur : JSON illisible refusé, méthodes normalisées, anciennes
  réponses incapables d’expirer la nouvelle connexion ou de remplacer son CSRF.
- Suivi des travaux : réponses périmées ignorées, polling arrêté après déconnexion,
  zéro mutation DOM pour dix mises à jour dont l’état visible reste identique.
- Une capture cohérente du profil par tour, contexte budgeté reconstruit par appel ;
  dépendances et assemblage explicites.

287 tests `pnpm check`, démo SDK, 42 tests PostgreSQL avec dump/restauration,
2 tests de bundles chiffrés et 28 parcours navigateur réussis. Contrôle de rendu
renforcé relancé après la dernière optimisation. Fournisseurs simulés dans les
régressions ; qualification réelle distincte documentée dans TESTING.md. Après redémarrage web,
Luna réel a appelé `mail_accounts` une fois : quatre comptes connectés, tour
terminé sans erreur ni écriture mail.

Web et worker hôte à jour. Sur demande explicite du propriétaire, le veilleur
crypto de First try a été arrêté via l’outil de commande, unité inactive confirmée.
Le worker a ensuite redémarré ; vraie exécution Node 24, lecture des sorties et
arrêt d’une commande de test vérifiés via sa socket. Fixtures et conteneur de
restauration supprimés, services sains ; le blocage d’activation est levé.

## Indépendance d’exécution des projets

Nouvelle décision du propriétaire mise en place : Heart développe/administre les
projets, leurs services fonctionnent sans lui. Exécution hôte native indépendante
par défaut ; aucune dépendance PartOf, pipe ou Node embarqué. Annuler un tour,
changer ses permissions ou arrêter/redémarrer le worker ne coupe pas ces unités.
Le mode stdin interactive:true reste un outil temporaire de développement.

Déployé et testé en production : serveur Python de fixture hors code Heart, web
et worker complètement arrêtés, HTTP toujours disponible avec PID inchangé ;
reprise du contrôle après redémarrage et arrêt explicite. Backup Heart réussi
pendant son fonctionnement, manifeste live-copy explicite. Le veilleur crypto
initial reste arrêté et ses données sont conservées. Aucun ancien projet déplacé
ou migré implicitement. Services permanents à déployer via systemd/Compose
propres au projet ; une commande transitoire seule ne garantit pas le redémarrage
après reboot. Validation : 287 tests/démo, deux tests natifs opt-in, trois tests
de backup et trois parcours navigateur ciblés.

## Objectifs, étapes et suivi — 23 novembre

Livré : objectif global avec critères/preuve/prochaine action, plusieurs goals
et sous-goals, étapes et blocages. Fiche Projets web avec hiérarchie, formulaires
versionnés, détails et compteurs sur tout le plan. Aucun pourcentage inventé.
Clôture refusée sans résultat documenté ou avec descendants ouverts ; les anciens
statuts sans preuve sont conservés et distingués. Aucun plan métier local.

MCP 13 outils, migration additive et catalogue approuvé à jour. Fiche/compteurs
frais injectés dans les tours de projet ; détail chargé via outils à la demande.
Lectures simultanées regroupées, sans cache périmé ni polling. Projets et mémoire
se chargent séparément ; formulaires conservés sur rafraîchissement/conflit.

Validation : 291 tests `pnpm check`, démo SDK, 29 parcours navigateur ; 107
contrôles MCP/PostgreSQL réels, incluant hiérarchie, concurrence et restauration.
Luna réel medium : deux objectifs imbriqués et une étape terminés/documentés,
fichier produit puis relu par le test, projet non clôturé prématurément.
Base/compte de qualification séparés et retirés ; aucune donnée utilisateur
modifiée par ces scénarios. Voir [PROJECTS.md](PROJECTS.md).

Le suivi comprend désormais le contrôle des écritures décrit ci-dessous.
Aucun reclassement automatique des projets existants ni plan fictif créé pour eux.

Mise en service vérifiée sur heart.natio.re : ouverture d’une vraie fiche MCP,
objectif et compteurs affichés, aucune erreur JS aux quatre largeurs. Lecture
seule, aucun nouveau projet utilisateur créé. Sauvegarde complète de la révision
`a3594cb` déchiffrée et restaurée dans PostgreSQL isolé : identité/compteurs
identiques, fichiers/configurations récupérés. Backup MCP après migration copié
hors serveur et restauré aussi ; ressources de restauration retirées.

## Instructions et continuité — 23 novembre

Audit du 23 novembre : 15 blocs configurables, dont suivi et contrôle des projets. Projection
de compression sans résultats/arguments transitoires, reprise entre lots complets
d’un long tour, ancien checkpoint/lot surdimensionné fragmenté comme données,
réinjection des skills et état projet relu par préparation. Recherche mémoire :
précision courte prioritaire, référence/version conservée sans doublon du corps,
indisponibilité explicite et non bloquante pour les travaux indépendants.
Révocation MCP détectée : source retirée des schémas/inventaires, pas de rejeu.

302 tests, démo SDK et 42 tests PostgreSQL avec restauration passent. Suite web :
29 parcours réussis. Scénario combiné réel ChatGPT gpt-6-luna : 18 appels dont
3 compressions et 3 revues, MCP Mémoire/Projets et skill local, reprise après
redémarrage, nouvelles consignes/droits et valeurs mémoire corrigées puis oubliées.
Une lecture attendue d’un souvenir supprimé renvoie introuvable ; aucun échec
d’outil inattendu ni rejeu. Bases/rôles/tokens QA retirés. Activé en production ;
14 blocs présents lors de cette activation, profil version 26/personnalité inchangés, skill actif sain.
Sauvegarde complète de 321b8b2 déchiffrée et restaurée dans PostgreSQL isolé,
identité/compteurs et fichiers récupérés ; aucun restore sur la production.
Aucune instruction personnalisée écrasée.

Les fiches projet ne rejoignent plus une lecture déjà en vol avant une écriture
acquittée : suivi indépendant par préparation, catalogue léger toujours regroupé.
La source et son outil d’aperçu effectivement déclaré sont indiqués au modèle.
Les compteurs des résultats d’outils déjà reçus du tour sont reconstruits depuis
le journal hors résumé, sans arguments ni données sensibles, pour éviter de
perdre toute trace d’une opération dans un long tour.

Suite : suivre un projet réel dans la durée et mesurer les longs historiques
sur les cerveaux utilisés, notamment les formulations qui échappent à la
recherche lexicale. Pas de promesse d’infaillibilité sémantique de tous les LLM.


## Heart pilote les mises à jour des projets — 23 novembre

Le suivi ne dépend plus seulement de l’initiative du modèle principal. Outils
internes projects.read/write limités au projet courant, puis contrôle avant bilan :
lecture ciblée si nécessaire, décision explicite, écritures versionnées et relecture
MCP. Mémoire traitée avant suivi, contrats/modules séparés, aucun plan local.
Une consultation ne réécrit pas le plan ; blocages/prochaine action enregistrables
sans rappel utilisateur. Réseau des commandes distinct des permissions de stockage :
connexion MCP active et écritures approuvées toujours nécessaires.

312 tests, démo SDK et 29 parcours navigateur passent. Vrai ChatGPT gpt-6-luna,
26 inférences, MCP Mémoire/Projets réels en base/tenant QA séparés : travail initial
suivi sans demande explicite, reprise/compression/droits réseau vérifiés, puis oubli
de mise à jour délibérément injecté dans la réponse principale. La revue Luna réelle
récupère cet oubli et le MCP confirme l’étape terminée. Une réponse principale est
simulée uniquement pour injecter cette panne ; le reste et la correction sont réels.
Aucune donnée utilisateur touchée ; bases/rôles/tokens/unités QA retirés.

Une course de version ne doit pas écraser une autre conversation ; une écriture
non confirmée est signalée. Contrôle trop grand : délégation explicite au modèle
principal, pas de troncature des preuves. Qualité sémantique non universelle,
pas d’atomicité entre plusieurs écritures. Texte visible et réinitialisable dans
Instructions, quinzième bloc. Détails dans PROJECTS/TESTING.


Activation du contrôle d’écriture vérifiée sur heart.natio.re : 15 blocs hérités,
profil version 26/personnalité inchangés, skill code-review actif sans erreur.
Fiche MCP réelle en lecture seule aux largeurs 320/390/768/1440, zéro erreur JS,
aucune inférence ni modification de projet utilisateur. Web et worker hôte sains.
Backup `heart-postgres-20261123T093215303253Z.tar.age` de `5a0c408` déchiffré,
fichiers/configurations récupérés et PostgreSQL restauré sans réseau (256 Mio) :
identité et compteurs identiques. Conteneur et fichiers privés retirés ; aucun
restore sur la production. Veilleur crypto toujours arrêté, disque libre 25 Gio.


## Contrôle des écritures mémoire — 23 novembre

Implémenté et testé : la revue mémoire existante relit aussi les écritures réussies
du modèle principal et celles qu’elle propose, dernière mutation réussie par ID.
Création/correction proactives et oubli explicitement demandé ; consentement et
refus des secrets inchangés. Versions/champs/statut comparés au stockage, absence
MCP typée distincte d’une panne. Conflit ou résultat incertain : bilan à réviser,
sans rejeu ni écrasement. Reçus canoniques filtrés conservés après compression,
portée projet correctement dérivée du fil. Aucun nouveau module/SDK/bloc requis.

320 tests `pnpm check` et démo SDK passent. Qualification Luna/MCP réelle et
validation navigateur en cours avant activation ; ne pas les confondre avec
les tests simulés. Le code précédent de suivi projets reste actif entre-temps.
Suite immédiate : terminer ces qualifications puis sauvegarder/activer et vérifier.
