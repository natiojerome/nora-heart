# Pack avatar Nora V1

Les essais **masculin et neutre articulés V1** ont été écartés pour leur rendu.
La priorité actuelle est aux [portraits V5](AVATAR-PORTRAITS.md), visibles dans la
[collection](https://heart.natio.re/avatar-pack/).
Les limites ci-dessous concernent le pack Nora historique, pas la collection complète.

Le premier pack animé est disponible, avec un aperçu indépendant sur
https://heart.natio.re/avatar-pack/nora-v1/.
Ce lecteur ne remplace pas l’interface principale et ne reflète aucun run réel.
Le setup et le branchement de la présence aux conversations restent à développer.

## Livrables

Les assets sont dans `src/interfaces/web/public/avatar-pack/nora-v1/`.

- Portrait : 32, 48, 64, 96, 128 et 256 px ; chaque taille pour trois états.
- Personnage entier : 256, 512 et 768 px ; chaque taille pour trois états.
- Images PNG fixes correspondant aux 27 variantes de taille/état.
- 39 WebP réellement animés : 18 portraits, 9 corps et 12 transitions.
- Quatre transitions, en portrait 128/256 et corps 512 : repos/travail dans
  les deux sens, travail/attente dans les deux sens. Chaque clip joue une fois.
- Trois GIF d’aperçu, symbole SVG statique et manifeste avec UUID stable,
  dimensions, cadence, durées, SHA-256 et provenance.

Les boucles sont transparentes, détachées du thème. Les portraits sont cadrés
sur le visage du même personnage, avec un masque circulaire. Ce pack représente
Nora féminine ; les variantes masculine/neutre, parole et lip-sync ne sont pas
produites. Les petites tailles tournent à 8 i/s, les autres à 12 i/s : les clips
ne sont pas redessinés en une animation faciale différente pour chaque résolution.
Une seule taille utile doit être chargée, avec un facteur Retina si nécessaire.

## Origine et génération

Réutilisation autorisée dans le périmètre demandé : vidéos existantes de Nora,
révision `ecb473c8156be912a1b0ad4be764ae37b56e4821`, dossier
`assets/brand/animation/openrouter/seedance-pack-v1`. Le README source les décrit
comme approuvées et intégrées. Génération originale Seedance 2.0 ; les fichiers
sources restent inchangés. Le manifeste conserve leurs empreintes exactes.
Aucun code du lecteur Nora n’est copié, aucun service Nora n’est modifié.

Le script Heart convertit les vidéos avec FFmpeg/libwebp : détourage vert,
cadrage, masque de portrait, redimensionnement et encodage. Aucun nouvel appel
de génération ni coût fournisseur. Les raccords de boucle hérités de la source
peuvent rester perceptibles ; les exports ne sont pas présentés comme parfaits.
Le lecteur de démonstration est un nouveau code HTML/CSS/JS sans dépendance.

```sh
pnpm avatar:build -- /chemin/vers/seedance-pack-v1
pnpm avatar:package
pnpm test:avatars
```

La conversion complète utilise un thread par FFmpeg et un traitement séquentiel.
Une reconstruction ciblée des portraits est possible en passant le dossier
source puis `--portraits-only`. Le build nécessite FFmpeg avec libwebp ; la simple
utilisation du pack livré ne nécessite pas ces outils ni l’autre projet Nora.

`portraits-only.zip` fait environ 6,8 Mo, le pack complet environ 31,2 Mo.
Les ZIP reproductibles sont ignorés par Git pour ne pas doubler le stockage ;
`pnpm avatar:package` les recrée depuis les ressources versionnées. Les tailles
affichées par l’aperçu sont indicatives, arrondies en base 1024. L’archive complète
contient aussi un aperçu ouvrable localement grâce à manifest.js, sans appel API.

## Lecture et accessibilité

L’aperçu change de pose, joue une transition existante puis la boucle cible.
Il propose fond clair/sombre, comparaison de tailles et pause. Une animation
indisponible revient au PNG. `prefers-reduced-motion`, onglet masqué et composants
hors écran entraînent un affichage fixe. Le texte d’état reste présent.

Remplacer un WebP par le PNG arrête le mouvement ; ce n’est pas un gel précis de
la frame en cours, et la reprise recommence la boucle. Le corps entier est une
option, sans recouvrir les messages ou l’envoi dans l’interface finale.

La distribution HTTP est une liste blanche de ressources ; les gros fichiers
sont envoyés en flux. Aucune nouvelle route privée de données ni credential
n’est exposé. Le lecteur contient uniquement le personnage et des états simulés.

## Vérification

- `pnpm check` : typage et 51 tests, dont intégrité/dimensions/alpha PNG,
  vraies frames WebP, boucles infinies ou uniques et couverture des six tailles.
- `pnpm test:avatars` : décodage de frames distinctes dans Chromium, transparence
  réelle, transition, pause, fond sombre, fallback réseau, réduction des
  mouvements, viewports 320/390/820 et desktop, sans débordement global.
- `pnpm test:web:e2e` : parcours existant de l’atelier/conversations/mémoire
  toujours réussi. `pnpm demo:sdk` : parcours simulé complet réussi.
- Aperçu HTTPS public contrôlé sur viewport mobile : lecture, transition, pause,
  fond sombre, six tailles et absence d’erreur JavaScript. Pas de test matériel
  sur un iPhone réel à cette étape.
