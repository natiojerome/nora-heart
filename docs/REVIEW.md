# Revue du code et priorités

Point du 23 novembre 2026. État détaillé : [STATUS.md](STATUS.md),
architecture : [ARCHITECTURE.md](ARCHITECTURE.md), preuves : [TESTING.md](TESTING.md).
Cette revue distingue les fonctions livrées des qualifications encore partielles.

## Socle livré

| Domaine | État actuel | Limites restantes |
| --- | --- | --- |
| Architecture | Contrats, core, modules et assemblage séparés ; frontières testées. TypeScript strict, Node 24, pnpm. | Pas de refonte de stack justifiée par les défauts constatés. |
| Cerveaux | ChatGPT abonnement ; OpenAI, Anthropic, OpenRouter et Venice par API. Catalogue et efforts par modèle, aucun repli implicite. | Abonnement Claude absent ; toutes les paires/modèles ne sont pas qualifiés en réel. |
| Conversations | Plusieurs fils travaillent simultanément ; droits, modèle et workspace par fil. Historique paginé, reprise et récupération journalisées. | Un run par fil. Historique local à Heart ; centralisation distante reportée. |
| Persistance | PostgreSQL de production ; module SQLite interchangeable et contrat SQL commun. Sauvegarde locale chiffrée et restauration isolée qualifiée. | Aucun transfert automatique entre SQL ; copie des sauvegardes hors machine à choisir explicitement. |
| Données distantes | Mémoire, projets et coffre via Nora MCPs. Projets : source métier unique distante ; artefacts physiques locaux. | Les résultats du coffre sont visibles au modèle pendant le tour ; pas de promesse de masquage de sa réponse. |
| Mémoire/contexte | Souvenirs structurés, revue, correction/oubli, compression et lecture des originaux. Instructions et budgets configurables. | Qualification réelle ChatGPT/OpenRouter ciblée ; mémoire/compression Venice pas encore qualifiées de bout en bout. L’oubli MCP n’a pas de restauration native. |
| Outils | CRUD texte/binaire, terminal protégé/YOLO, réseau selon droits, MCP avec écritures explicitement approuvées, formulaires et tâches. | PTY et transports MCP OAuth/stdio non livrés. SSH/VPN dépendent des programmes/configurations de l’hôte. |
| Recherche web | SearXNG auto-hébergé et lecture de pages, sans quota commercial. | Blocages possibles des moteurs/sites ; navigateur JS intégré et citations structurées non livrés. |
| Skills | Format portable, catalogue/lecture, activation et instructions de base. | Installation/édition/mises à jour à étendre selon les usages. |
| Tâches | Planification durable, concurrence entre fils, pause/run-now, historique, outils chat et réservations atomiques. | Pas de rejeu aveugle d’une occurrence incertaine ; compléments de fréquences/notifications selon besoin. |
| Interface | Mobile first, configurations unifiées, chat enrichi, fichiers/terminal manuels, formulaires et reçus mémoire. | Parcours Chromium aux quatre largeurs ; appareils physiques et très gros historiques à mesurer. |
| Mail | Quatre boîtes connectées, 19 outils, Gmail OAuth/OVH TLS, signatures/PJ, premier envoi Luna reçu dans Gmail. | Réponse avec PJ personnelle à qualifier sur demande ; pas de traitement automatique. |
| Consommation | Quotas ChatGPT, données OpenRouter ; soldes et limites Venice avec la clé normale et cache d’une minute. | Historique détaillé Venice réservé par le fournisseur aux clés administrateur ; pas de coût réel systématique par run. |

## Connexion initiale et wallets

Nouveaux installs : compte MCP avant onboarding, clés des quatre services attribuées
et stockées en privé, reconnexion sans rotation. Installation native/portail HTTPS
qualifiés ; accord opérateur limité à la fixture, navigateur email/mot de passe
sur vrai PostgreSQL synthétique. Aucun nouveau fournisseur LLM testé dans ce lot.
Restauration intégrée au service/outils/SDK : fusion vérifiée, autre clé locale,
activation sans restart ; conflits atomiques et répétition sans doublons testés.
Payload de sauvegarde immuable conservé pour la compatibilité des anciennes copies.
Les anciennes installations ne changent pas implicitement d’authentification.

## Dernière consolidation

Plusieurs passes ciblées, sans changement de stack ni nouveau framework :
annulation avant démarrage, journaux atomiques, supervision native systemd,
nettoyage des ressources après échec, réponses HTTP/session périmées, suivi des
travaux et mutations DOM inutiles. Les détails du livré et du déploiement sont
maintenant regroupés dans STATUS.md, pas répétés sous forme d’anciens plans.

287 tests, démo SDK, 42 contrôles PostgreSQL et restauration, 2 tests de bundles
chiffrés, 28 parcours navigateur. Dix réconciliations d’un travail inchangé : zéro
mutation DOM et nœuds conservés. Tests et limites dans TESTING.md.

## Limites opérationnelles actuelles

Web et worker hôte à jour. Le veilleur crypto a été arrêté sur instruction du
propriétaire ; données et sorties conservées. Nouvelle exécution/lecture/arrêt
qualifiées sur le worker réel. Sauvegarde complète relue et restaurée dans un
PostgreSQL isolé sans réseau, identité et compteurs comparés. L’ancien helper
installé a été remplacé par la version du dépôt pour couvrir aussi les accès MCP
et la racine des projets. Blocage d’activation levé.

Le serveur de test est plein ; aucun projet existant supprimé ni nouvelle machine
achetée. Régressions exécutées sur l’hôte avec concurrence navigateur limitée,
PostgreSQL jetable en tmpfs et image déjà présente. Environ 27 Go disponibles sur
l’hôte principal pendant le lot ; archives temporaires retirées après vérification.

## Suite

Suivre le plan courant : le lot de consolidation et son activation sont terminés.
Étendre ensuite les essais à des demandes métier réelles plutôt que déclarer une
qualification universelle de tous les outils, modèles, OS et volumes d’historique.
