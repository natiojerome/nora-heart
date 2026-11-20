---
name: code-review
description: Rechercher bugs et régressions quand une revue de code est demandée. Ne pas charger pour une simple explication, une commande à exécuter ou un bug déjà identifié à corriger.
metadata:
  display-name: Revue de code
---

# Revue de code

Lire les consignes du dépôt et examiner le code réellement concerné avant de conclure.
Relier chaque problème à un scénario observable : déclencheur, comportement obtenu,
comportement attendu et emplacement précis. Distinguer défaut confirmé et hypothèse.

Choisir les vérifications qui permettent de confirmer ou réfuter les problèmes,
en tenant compte des outils et droits réellement disponibles. Ne pas modifier le
code si la demande porte uniquement sur une revue. Pour une demande de correction,
vérifier ensuite le scénario initial et les régressions pertinentes.

Lire [references/report.md](references/report.md) au moment de préparer le bilan.
Ne pas annoncer un test réussi sans l’avoir exécuté ; signaler les vérifications
impossibles et leur impact sur la conclusion.
