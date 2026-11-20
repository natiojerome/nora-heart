# Continuité entre deux fournisseurs réels

Qualification du 18 novembre 2026 : ChatGPT abonnement `gpt-6.2-sol`, puis
OpenRouter `deepseek/deepseek-v4-flash-0731`. Assemblage web réel avec outils,
revue mémoire, résolution des pièces jointes et SQLite temporaire. Aucun envoi
dans une conversation propriétaire ni modification de ses souvenirs. Aucun
changement de moteur, adaptateur, stockage de production ou permissions.

## Parcours observé

1. ChatGPT crée un fichier une fois et enregistre réellement un souvenir personnel
   via les outils. Un document texte est joint. Les décisions budget/base/planning
   et les marqueurs aléatoires doivent rester exacts.
2. Une correction remplace vendredi par lundi. Bascule sur DeepSeek avec un budget
   de 100 000 : les faits, le document et le souvenir sont retrouvés sans checkpoint
   forcé par le seul changement de fournisseur.
3. Des archives **synthétiques explicitement étiquetées** chargent le contexte.
   Le budget effectif est réduit à 32 768 ; DeepSeek produit lui-même le résumé.
   Checkpoint de 649 caractères couvrant 22 messages, faits exacts après compression.
   Ni résumé ni réponse fournisseur ne sont simulés.
4. Le service est fermé et réassemblé sur la même SQLite. UUID, modèle enregistré,
   segments, document et empreinte du fichier restent identiques. La réponse réelle
   suivante confirme aussi les faits après cette réouverture.
5. Le souvenir est corrigé via le service d’administration ; DeepSeek utilise la
   nouvelle version malgré l’ancienne valeur dans le résumé.
6. Oubli via ce même service, puis nouvelle conversation : valeurs oubliées absentes
   des entrées réellement envoyées aux modèles et réponse `support: null`.

Une seule écriture fichier sur tout le parcours ; aucun rejeu. Toutes les revues
mémoire du parcours réussi ont un statut `decided`. Une sentinelle d’un autre
projet reste absente des entrées modèle.

## Résultats, coût et portée

[Rapport réussi](qualification/multi-provider/passed.json),
[bilan cumulé](qualification/multi-provider/summary.json),
[préparation et échecs](qualification/multi-provider/README.md).

- Parcours réussi : 17 appels réels, 7 ChatGPT et 10 OpenRouter, tous HTTP 200.
- Ensemble des cinq essais : 49 appels (30 ChatGPT, 19 OpenRouter), dont un HTTP 429.
- Coût OpenRouter communiqué : 0,00663822 USD pour les 18 réponses donnant un coût.
  Le 429 n’en communique pas. Réservation prudente cumulée : 0,0435528 USD,
  sous le plafond de 0,05 USD, incluant cette requête sans coût communiqué.
- Le plafond d’appels a été porté de 36 à 52 pendant le débogage du runner ; la
  limite financière et le cumul des essais n’ont pas été réinitialisés.

Les capacités natives lues dans les catalogues sont 500 000 pour ChatGPT et
1 048 576 pour DeepSeek. **32 768 est un budget de qualification configuré**, pas
la capacité native revendiquée pour DeepSeek. Le test réduit donc le budget de
contexte de Heart sans falsifier les catalogues.

Ce scénario ne qualifie pas toutes les paires de modèles, les images/PDF, les très
longs résumés ou les incidents fournisseur. Correction/oubli passent ici par
l’administration réelle ; la mémorisation initiale est pilotée par le vrai LLM.
L’oubli conserve l’ancien journal et le résumé : il exclut les souvenirs actifs
et les nouveaux fils, sans effacer rétrospectivement tous les prompts.
Les preuves PostgreSQL/SQLite et navigateur restent des qualifications séparées.

## Reproduire sans déclencher un appel par erreur

`pnpm qualify:continuity` seul ne lit aucune clé et ne lance aucun appel.
Sous Node 24, sur l’installation gérée avec accès à l’environnement privé :

```sh
HARNESS_QUALIFY_LEDGER=/tmp/heart-continuity-my-run.json pnpm qualify:continuity --live
```

Le ledger doit garder le même chemin pour toutes les tentatives du même budget.
Réservation avant chaque POST, tarifs vérifiés dans le catalogue, plafond de prix
OpenRouter, sorties de test bornées et aucune bascule implicite de modèle. Le
runner choisit les deux identifiants explicitement ; variables facultatives
`HARNESS_QUALIFY_CHATGPT_MODEL`, `HARNESS_QUALIFY_ROUTER_MODEL` et
`HARNESS_WEB_ENV_FILE`. Les plafonds concernent cet essai, pas les utilisateurs Heart.

Une seule nouvelle tentative LLM après 429 est permise par le runner avec pause
bornée ; elle ne rejoue aucun outil. Cette branche n’a pas été utilisée dans le
parcours réussi et ne modifie pas la politique du produit. Les réponses complètes
sont conservées dans la preuve et les assertions portent sur les valeurs JSON
exactes ; un texte additionnel n’est pas transformé en échec de continuité. Une
revue mémoire non terminée reste un échec explicite, pas un avertissement ignoré.

Les bases et workspaces sont retirés à la fin. `--keep-on-failure` conserve seulement
les données synthétiques pour un diagnostic immédiat ; les retirer ensuite. Les
clés restent dans leur stockage privé, jamais copiées dans ces bases/rapports.
Les traces SSE ne gardent que types, statuts et forme des sorties, sans raisonnement
privé ni arguments bruts. Le ledger privé garde les comptes entre les tentatives.
