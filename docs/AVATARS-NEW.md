> Direction actuelle : [portraits V5](AVATAR-PORTRAITS.md). Les rigs décrits
> ici sont conservés comme références écartées ; aucun nouveau corps entier.

# Avatars masculin et neutre — essais articulés V1 écartés

Essais exportés le 14 novembre 2026, puis rejetés par Jérôme pour leur rendu
mécanique et leurs mouvements rigides. Les tests techniques ci-dessous ne
constituent pas une validation de qualité visuelle. Ne pas intégrer ces V1
comme versions finales. Deux [nouveaux essais vidéo Seedance V2](AVATAR-VIDEO-PILOTS.md) sont disponibles
séparément pour revue.

Livraison initiale : La précédente
livraison couvrait seulement les exports du personnage Nora existant : les deux
identités ci-dessous sont nouvelles et ne reprennent aucun clip de Nora.

Collection : https://heart.natio.re/avatar-pack/.

| Pack | Identité visuelle | Aperçu |
| --- | --- | --- |
| Orion | Masculin, quiff argentée, armure claire, visage à expressions lumineuses. | /avatar-pack/masculine-v1/ |
| Prisme | Neutre, petit robot à tête arrondie, sans marqueur de genre. | /avatar-pack/neutral-v1/ |

Orion et Prisme sont des noms de packs, pas les noms imposés aux futurs assistants.
Chaque pack a son UUID propre. Nom de l’assistant, genre des échanges,
personnalité, avatar et thème restent indépendants.

## Création réellement effectuée

Trois illustrations sources transparentes nouvelles ont été générées avec
image_gen : atlas masculin, tête masculine complète, atlas neutre. Elles sont
conservées dans `assets/avatar-sources`, avec les prompts exacts. Les têtes ont
volontairement un écran facial vierge ; les traits sont construits dans le rig.
Aucune image ou vidéo du pack Nora existant ne sert à ces nouvelles animations.

Animation articulée **2D**, non vidéo générative : les couches raster au rendu
3D sont composées par un rig Canvas original dans `scripts/avatar-rig`.
Les mêmes pièces conservent le visage et les proportions d’un état à l’autre.

- Repos : inclinaison calme, respiration, yeux fermés et variation de bouche.
- Travail : regard mobile, clignement, balayage discret, bras en frappe alternée
  sur un clavier holographique.
- Attente : regard attentif, clignement, sourire et bras levé avec léger salut.

Les mouvements des yeux, de la tête et des bras sont indépendants ; il ne s’agit
pas d’une simple oscillation appliquée à un PNG complet. Les bras sont des
pièces rigides pivotant aux épaules ; les coudes et doigts ne sont pas riggés
séparément. Le rendu reste une animation 2D de pièces au style 3D, pas un nouveau
personnage 3D calculé à chaque frame. Aucun lip-sync, parole ou son livré.

## Contenu par pack

- 18 portraits WebP animés : trois états × 32/48/64/96/128/256 pixels.
- 9 personnages entiers WebP animés : trois états × 256/512/768 pixels.
- 27 PNG fixes correspondants, trois GIF d’aperçu et un symbole SVG.
- 12 clips de transition : quatre passages entre états en portrait 128/256
  et corps 512. Repos ↔ travail et travail ↔ attente.
- Manifeste UUID, version, dimensions, cadence, durée, SHA-256 et origine.

Les boucles ont quatre secondes. Le rig est échantillonné à 24 i/s, puis exporté
à 8 i/s pour les petits portraits et 12 i/s pour les autres tailles. Les poses
sont périodiques ; les transitions d’environ 1,54 s interpolent les articulations
et expressions entre les deux poses, puis le lecteur démarre la boucle cible.
Les sprites sources restent inchangés ; les frames sont des compositions du rig.

Archives complètes : `masculine-v1.zip` et `neutral-v1.zip`. Chaque pack a aussi
`portraits-only.zip`. Environ 4,1 Mo et 3,8 Mo pour les portraits ; 19,7 Mo et
18,5 Mo pour les packs complets. Les ZIP sont générés, ignorés par Git, recréables.

## Utilisation et reconstruction

Les trois lecteurs partagent les mêmes choix d’état, comparaison de six tailles,
fond clair/sombre, PNG de secours, pause et réduction des mouvements. La collection
présente des images fixes pour éviter un autoplay massif sur mobile. Aucun run
ou compte fournisseur n’est appelé par ces aperçus publics.

```sh
pnpm avatar:build:new
pnpm avatar:package masculine-v1
pnpm avatar:package neutral-v1
pnpm test:avatars
```

Le build utilise Chromium/Canvas et FFmpeg/libwebp séquentiellement, sur un
serveur temporaire 127.0.0.1 dont les fichiers sont en liste blanche. Les PNG
intermédiaires sont créés en répertoire temporaire et supprimés après encodage.
Aucun crédit de service vidéo externe ni clé API vidéo n’est utilisé. L’outil
image_gen a produit les dessins originaux ; ses trois prompts sont archivés.

## Qualification

`pnpm check` : typage et 53 tests réussis. Pour chaque pack, contrôle des images
RGBA, dimensions, intégrité SHA, vraies frames distinctes et boucles/transitions.
`pnpm test:avatars` : lecture et décodage dans Chromium pour les trois packs,
transition, pause, transparence, identité du nouveau manifeste et mobile sans
régression du lecteur Nora. `pnpm demo:sdk` reste réussi.
Les aperçus HTTPS sont vérifiés sur viewport mobile ; pas de qualification sur
un iPhone physique. L’intégration au setup et aux conversations reste distincte.
