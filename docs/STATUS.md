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
- Conversations, historique, résumés et exécutions restent dans Heart. Plusieurs
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
- Une seule construction du contexte par tour ; dépendances et assemblage explicites.

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
