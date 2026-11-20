# État et reprise

Point du 20 novembre 2026. Socle opérationnel ; la parité complète avec Codex CLI
et la qualification de tous les fournisseurs restent partielles. Lire PLAN.md,
ARCHITECTURE.md et DECISIONS.md avant une reprise.

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
restent utilisables pour les fixtures/installations sans binding MCP explicite ;
aucun repli local en cas d’échec d’une connexion sélectionnée.

Mémoire de projet : contexte distant `nora-projects` avec UUID canonique. Anciennes
références `nora-heart.project` non converties implicitement. Les souvenirs personnels
restent communs au compte. Les conversations/historique et l’exécution restent dans
Heart ; centralisation ou sauvegarde distante des conversations différée sur demande
du propriétaire. Les artefacts restent sur le serveur Heart, sans déplacement.

## Vérifications et optimisation

228 tests de `pnpm check`, démo locale et deux tests de bundle chiffré passent.
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
historiques ; journal inchangé. Échec de revue : brouillon retenu, effets réussis
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
