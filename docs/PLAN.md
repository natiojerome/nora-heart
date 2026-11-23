# Plan courant

23 novembre 2026. Finalité conservée : une assistante quotidienne dont le
propriétaire contrôle orchestration, données, outils et permissions, avec des
cerveaux interchangeables selon besoin et coût. Le livré est dans [STATUS.md](STATUS.md),
les limites dans [REVIEW.md](REVIEW.md), les preuves dans [TESTING.md](TESTING.md).

## Consolidation livrée

Passes architecture/logique, ressources et persistance, concurrence HTTP/rendu,
puis régressions unitaires, SQL/restauration et navigateur. Contrats existants
préservés ; stockage injecté à la composition, cycle de vie explicite, aucun
framework maison ajouté. Les fournisseurs simulés restent séparés des preuves réelles.

Web et worker hôte mis à jour. Veilleur crypto arrêté à la demande du propriétaire,
commande de test exécutée/lue/arrêtée via le worker actif. Sauvegarde complète
créée et restaurée en environnement isolé ; helper de sauvegarde installé aligné
sur le dépôt pour inclure aussi configuration MCP et racine des projets.

## Exploitation indépendante des projets livrée

Les nouveaux programmes hôtes survivent à Heart, à son worker et à l’annulation
d’un tour. Sessions interactives temporaires distinctes. Vrai serveur de test
resté accessible avec le même PID pendant l’arrêt complet de Heart et pendant
son backup. Contrôle retrouvé sans redémarrer le projet. Les déploiements
permanents utilisent leurs propres services/runtimes/configuration et backups,
conformément à la décision du propriétaire, sans nouvelle plateforme maison.

## Suivi des objectifs livré

Objectif global, objectifs imbriqués, étapes et blocages dans le MCP, avec critères,
preuves et gardes de clôture. Fiche web, compteurs globaux, contexte léger par tour
et mises à jour via outils. Qualifié avec SQL/MCP réels, navigateur et Luna.
Aucune conversion automatique des anciens plans. Voir [PROJECTS.md](PROJECTS.md).

## Prochaines étapes utiles

1. Appliquer le suivi à un projet réel : définir critères/étapes utiles, puis
   observer et ajuster les mises à jour après résultats, sans inventer de plan.
2. Sur demande métier explicite, qualifier une lecture/réponse mail avec pièce
   jointe, identité et signature conservées. L’envoi simple Heart/Luna et sa
   réception Gmail sont déjà qualifiés ; aucun nouvel envoi de test implicite.
3. Formaliser le parcours de mise à jour et retour arrière d’une installation
   indépendante. Distinguer mise à jour, réinstallation et restauration ;
   conserver les données et migrations appliquées. Puis qualifier OS vierge,
   HTTPS/DNS/ACME et ARM64 selon moyens autorisés, sans achat implicite de serveur.
4. Mesurer les gros historiques et longs travaux sur les cerveaux effectivement
   utilisés. Étendre la qualification mémoire/compression selon les incidents
   observés ; reprendre Venice quand son accès API est réactivé. Les tests réels
   doivent rester ciblés, avec coût observé et fixtures synthétiques.

## Principes à conserver

- Contrats/core/modules/app/interfaces, points d’entrée publics, assemblage
  explicite et dépendances visibles. Mémoire distincte de son repository.
- UUID durables indépendants des noms et chemins ; renommage du produit possible.
- PostgreSQL et SQLite derrière la même frontière ; pas de migration implicite.
- Mémoire/Projets/Vault/Mail indépendants ; conversations et exécutions dans Heart.
- Droits du propriétaire et contexte du fil conservés ; aucun repli de cerveau,
  de stockage ou d’exécution inventé. Réconciliation avant reprise incertaine.
- Tests en répertoires temporaires, secrets hors Git/logs/mémoire, sauvegardes
  chiffrées et relues. Vérifier disque et ressources avant les builds ; préserver
  les autres projets. Main, petits commits testés et points de restauration.
- Interface mobile first, requêtes regroupées et vues incrémentales ; mesurer les
  optimisations plutôt que promettre une interface sans coût ou sans aucun bug.

## Évolutions différées

PTY, transports MCP OAuth/stdio, navigateur JS, citations structurées et éditeur
complet de skills restent guidés par un besoin concret. Application Windows,
centralisation des conversations et transfert automatique PostgreSQL/SQLite ne
sont pas livrés. Aucun changement de stack ou nouvel orchestrateur requis pour
les défauts corrigés. Les services de recherche à quota commercial restent exclus.
