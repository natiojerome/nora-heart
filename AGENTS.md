# Travail sur ce dépôt

- Avant une reprise, lire `docs/STATUS.md`, `docs/ARCHITECTURE.md` et
  `docs/DECISIONS.md`. Distinguer les décisions retenues du code déjà livré.
- Mettre à jour l’état et la prochaine étape après un résultat significatif.
  Mettre à jour aussi l’architecture et les choix concernés dès qu’une décision
  change. Retirer les descriptions, anciens plans et décisions obsolètes des
  documents actifs : Git conserve l’historique. Préserver les données utiles
  et les migrations SQL appliquées, qui ne sont pas du nettoyage documentaire.
- Le propriétaire contrôle l’orchestration, les données et les permissions.
- Garder les contrats modèle, outil, mémoire et persistance indépendants.
- Organisation obligatoire : `src/contracts`, `src/core`,
  `src/modules/<famille>/<nom>`, `src/app` et `src/interfaces`.
  Le core ne dépend d’aucune implémentation. Chaque module expose `index.ts`
  et ne construit/import aucun autre module concret ; `app/compose.ts` relie
  les implémentations via les contrats. Respecter le test de frontières.
- Séparer comportement mémoire (`MemoryService`) et stockage des souvenirs
  (`MemoryRepository`). Aucun SQL ni client de base dans le module mémoire.
- Prévoir l’évolution, sans compliquer le code : interfaces courtes,
  assemblage explicite, dépendances visibles, pas de framework maison générique.
- Rechercher les standards et conventions existants avant d’inventer un contrat.
  Une interface de bibliothèque n’est pas un standard universel ; l’adapter à
  la frontière du module plutôt que l’imposer aux données persistantes.
- Ne jamais utiliser le nom affiché ou le nom du dossier comme identifiant durable.
- Ne modifier aucun runtime existant Nora ni migrer ses données implicitement.
- Réutiliser du code libre seulement après examen de ses dépendances ; conserver
  les avis de licence et la provenance des extraits effectivement incorporés.
- Les tests utilisent des répertoires temporaires et des fournisseurs simulés.
- Garder les secrets hors du dépôt, des logs et de la mémoire. Un fournisseur
  simulé ne constitue pas une validation d’une intégration fournisseur réelle.
- Avant de déclarer une étape fonctionnelle : `pnpm check` et parcours de démo.
- Travailler sur main avec de petits commits vérifiés. Ne pas publier ni créer
  de dépôt distant sans instruction couvrant cette publication.
