# Prisme — pack neutre original V1

Nouveau personnage, nouveaux dessins et nouvelles animations. Aucun clip ou
portrait de l’ancien pack Nora n’est utilisé pour construire ce pack.
Le nom Prisme identifie cette proposition graphique ; le nom de l’assistant,
son genre grammatical, sa personnalité et son thème restent des choix distincts.

## Ressources

- Trois états : repos, travail, attente d’une réponse.
- Portraits transparents : 32, 48, 64, 96, 128 et 256 pixels, en WebP animé et PNG.
- Corps entier : 256, 512 et 768 pixels, en WebP animé et PNG.
- Quatre transitions dédiées, non bouclées, en portrait 128/256 et corps 512.
- Symbole SVG, GIF de démonstration, manifeste UUID/dimensions/SHA-256.
- Boucles de quatre secondes ; exports à 8 i/s pour les petits portraits,
  12 i/s pour les autres. Transitions de 1,54 seconde environ.

Animations articulées 2D, et non vidéos génératives : les illustrations 3D
raster sont animées avec un rig Canvas. Les yeux clignent, les expressions et
la bouche changent, la tête s’incline, le corps respire, les bras tapent sur le
clavier ou se lèvent pour l’attente. Les mêmes pièces sont conservées entre
les états : pas de redessin du visage entre deux frames. Aucun lip-sync.

Les atlas/couches de dessin ont été créés pour ce projet avec image_gen. Le rig
et les mouvements sont du code original de Heart. Les sources et prompts sont
conservés dans assets/avatar-sources et docs/AVATARS-NEW.md. Le manifeste contient
les empreintes des illustrations sources. Aucune API vidéo externe payante.

## Lecture

Ouvrir index.html pour le lecteur autonome. Il propose choix d’état, transitions,
pause et fond clair/sombre. PNG fixes si réduction des mouvements, erreur de
lecture ou élément hors écran. La pause remplace la boucle par sa pose fixe ;
elle ne fige pas la frame exacte. L’état affiché reste simulé dans cet aperçu.

Charger seulement la taille utile, avec le double de résolution sur Retina.
Le portrait est circulaire et le personnage entièrement transparent autour.
Le corps entier reste facultatif et ne doit pas couvrir les messages ou l’envoi.

## Archives et reconstruction

portraits-only.zip : portraits, images fixes, transitions portrait et symbole.
neutral-v1.zip : pack complet avec son propre UUID et son manifeste.

Reconstruction : pnpm avatar:build:new puis pnpm avatar:package -- neutral-v1.
La reconstruction nécessite Playwright/Chromium et FFmpeg/libwebp ; l’utilisation
des ressources déjà exportées ne nécessite ni ces outils ni accès au projet Nora.
Aperçu et pack ne sont pas encore intégrés au setup ni aux conversations réelles.
