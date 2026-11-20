# Portraits animés V5

Direction actuelle : trois états lisibles en portrait (travail, repos, attente).
Orion reste un bot en céramique/métal ; Prisme reste le petit robot neutre.
Le retour utilisateur sur V4 relève une tête déformée sur Orion attente, un
travail illisible sur les deux robots et une attente Prisme identique au repos.
Les clips V4 concernés ne sont donc pas retenus.

## Poses et actions

- Travail : mains et clavier visibles dans le bas du portrait, doigts qui
  tapent et regard vers la tâche. Le travail doit se lire dans l’action,
  pas seulement dans une expression de concentration.
- Attente Orion : tête droite et stable, regard vers l’utilisateur, bouche
  fermée, clignement discret. Pas d’inclinaison, de hochement ni de déformation.
- Attente Prisme : main ouverte vers l’utilisateur, regard direct et sourcils
  attentifs. Une nouvelle vidéo, distincte de son repos.
- Repos : clips conservés, Orion V4 et Prisme V3.

La petite bulle 3D d’attente V4 est conservée et incrustée localement. Les
animations V5 sont retenues pour l’interface. Leur inspection et la validation
utilisateur ont complété les prompts : ceux-ci ne garantissent pas à eux seuls
l’absence de déformation.

Revue cible : https://heart.natio.re/avatar-portraits/v5/.

## Fabrication et provenance

`assets/avatar-portraits/v5` contient trois nouvelles images image_gen
(Orion travail, Prisme travail/attente), la copie de la référence Orion V4
pour son attente, les prompts exacts, les requêtes expurgées et les résultats.
Quatre vidéos Seedance 2.0 sont demandées, quatre secondes chacune, 480p,
sans son, première/dernière image identique. Les prompts imposent crâne rigide,
absence de rotation et d’ouverture de bouche ; le travail porte sur les doigts.

Le générateur `scripts/generate-avatar-video-pilots.mjs --action-portraits`
emploie un journal V5 distinct, une clé injectée en mémoire, les tarifs relus
avant chaque soumission, un contrôle du solde et un garde-fou d’estimation
1,20 USD pour cette série. Aucune recharge. Aucun rejeu automatique après une
soumission incertaine. Les secrets et URLs temporaires restent hors Git.

Le rendu `scripts/render-avatar-portraits.mjs --action [identité-état]`
réutilise les deux repos et exporte les six portraits en WebP transparents
64/128/256 px à 24 i/s, PNG fixes et GIF de revue à 16 i/s. Traitement FFmpeg
séquentiel et limité en threads. `results.json` décrit le fichier source et
sa version par état ; les coûts des sources réutilisées sont historiques,
ils ne représentent pas un nouvel achat vidéo. Les noms de ressources ne
sont pas des identifiants persistants d’assistant.

Jérôme a retenu les animations V5 pour l’intégration le 14 novembre 2026
(« ça ira pour les animations »). Les portraits sont raccordés au setup et à
la présence dans les discussions de l’[interface V1](UI.md). La page de revue
reste disponible pour comparer les états et télécharger les ressources.

## Validation et coût

Les quatre vidéos sont completed et téléchargées : 640 × 640, 24 i/s,
97 images, 4,04 s. Coût communiqué : 0,2716 USD par clip, soit **1,0864 USD**
pour cette série. Les deux repos et la bulle sont réutilisés sans achat vidéo.
Solde contrôlé après génération : **0,15335249 USD** (susceptible d’évoluer).
Aucun rechargement. Ne pas relancer de vidéo payante sans nouvelle demande.

Les quatre clips ont été inspectés sur planches de contact : frappe des doigts
sur les deux claviers, tête Orion attente stable sur les images contrôlées et
main ouverte de Prisme attente distincte du repos. Cette inspection n’est pas
une approbation esthétique de Jérôme ni une garantie géométrique de chaque pixel.

OpenRouter a refusé temporairement Prisme travail puis attente avec HTTP 402,
`openrouter_in_flight_budget` et `Retry-After: 120`. Les journaux conservent
les refus et IDs attribués ; les résultats existants n’ont pas été rejoués.
Après récupération d’Orion, les deux Prisme ont été lancés individuellement
avec `--only=identité-état --retry-declined`, en respectant le délai fournisseur.
Les refus n’ont produit ni vidéo ni charge supplémentaire constatée. Le script
sauvegarde `retryNotBefore` et interdit une soumission avant cette date.

Référence : [limites OpenRouter](https://github.com/OpenRouterTeam/docs/blob/main/api_reference/limits.mdx).

Contrôles réussis : `pnpm check` (typage + 57 tests), `pnpm test:avatars`
(quatre tests, incluant le mouvement de la zone mains/clavier et les tailles)
et `pnpm demo:sdk`. Revue HTTPS 390 × 844 : les six images chargent, pas de
débordement ni d’erreur JavaScript, pause/fond sombre et MP4 partiel 206.
Seul le service Heart a été redémarré, après contrôle de l’absence de run actif.
Les tests ne rejouent aucune génération payante. Les animations V5 sont retenues
pour l’interface ; aucune nouvelle génération n’est nécessaire à cette intégration.
