# Revue du code et priorités

Point du 21 novembre 2026. État détaillé : [STATUS.md](STATUS.md),
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
| Consommation | Quotas ChatGPT, données OpenRouter ; soldes et limites Venice avec la clé normale et cache d’une minute. | Historique détaillé Venice réservé par le fournisseur aux clés administrateur ; pas de coût réel systématique par run. |

## Dernier défaut corrigé

Dans First try, le validateur SDK arrêtait le tour sur appel invalide. Le moteur
peut désormais demander au même cerveau une correction dans le budget existant.
Tout le lot rejeté reste sans effet et les résultats déjà exécutés sont conservés.
Un nom Heart exact autorisé est traduit localement vers son alias ; les arguments
restent validés strictement. Le diagnostic ne contient ni arguments ni erreur SDK
brute. Le champ fautif historique n’avait pas été conservé : il n’est pas inventé.

253 tests et démo SDK réussis ; parcours chat/outils et Venice relancés. Essai réel
sur le modèle Venice utilisé avec une faute injectée : reprise puis lecture valide
et réponse vérifiée. Cette preuve ciblée ne signifie pas que tout défaut de tous
les modèles est corrigé. Déploiement et publication réalisés après sauvegarde.

## Prochain effort recommandé

Consolider les longs travaux sur les modèles effectivement utilisés : chaînes de
lecture/édition/test, sorties terminal longues, refus récupérables et reprise après
interruption. Utiliser des fixtures jetables et les tests locaux pour l’essentiel,
puis quelques appels réels ciblés avec coût mesuré. Ne pas rejouer un long tour
propriétaire pour qualifier un correctif.

Étendre ensuite la qualification mémoire/compression au modèle Venice choisi :
conservation des faits, correction d’un souvenir, priorité sur un ancien résumé,
bascule de cerveau et reprise. Les preuves existantes sont celles de
[CONTINUITY.md](CONTINUITY.md) et [TESTING.md](TESTING.md), pas une validation
universelle de toutes les combinaisons.

L’usage quotidien et les incidents observés guident les correctifs. Aucun nouveau
framework, catalogue local miroir ou nouveau service n’est requis pour ce lot.
