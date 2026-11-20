# Nora — pack avatar V1

Pack réel dérivé des clips vidéo Nora existants, sans nouvel appel fournisseur.
L’identité interne est l’UUID du manifeste, jamais le nom Nora ni le dossier.
Aperçu : ouvrir index.html, ou la page publiée sous /avatar-pack/nora-v1/.

## Contenu

- Portraits WebP animés transparents : 32, 48, 64, 96, 128 et 256 pixels.
- Chaque taille comporte repos (idle), travail (working) et attente (waiting).
- Portraits jusqu’à 64 px : 8 images/seconde ; au-delà : 12 images/seconde.
- Personnage entier : 256, 512 et 768 pixels, trois états à 12 images/seconde.
- PNG fixes pour chaque taille et état ; icône monogramme symbol.svg.
- Quatre transitions non bouclées en portrait 128/256 et corps 512 :
  repos → travail, travail → repos, travail → attente, attente → travail.
- Trois GIF de démonstration sur fond neutre dans preview/.
- manifest.json : dimensions, cadences, durées, chemins, tailles, SHA-256,
  origine et identifiant stable du pack. manifest.js permet l’aperçu hors ligne.

Le visage est cadré à partir des vidéos du personnage, pas redessiné image par
image. Le portrait possède un masque circulaire transparent. Le personnage entier
conserve le cadrage de la scène et son fauteuil. Le symbole est une alternative
statique ; le logo du logiciel reste indépendant.

Les petites tailles réduisent la cadence mais conservent le mouvement du clip
source ; elles ne possèdent pas un nouveau jeu d’animation faciale simplifié.
Le pack ne fournit ni parole/lip-sync, ni nouvelle émotion, ni avatar masculin
ou neutre animé. Il s’agit de la variante Nora féminine choisie comme référence.

## Intégration recommandée

Charger seulement la taille utile, pas tout le pack. Prévoir un fichier deux fois
plus grand pour un écran Retina (96 px pour un rendu à 48 pixels CSS).
Préférer un portrait de 48 px dans le chat ; le corps entier reste facultatif.
Le thème peut changer les surfaces de l’interface, pas le personnage.

Utiliser le PNG quand les mouvements sont réduits, les animations coupées ou le
composant hors écran. Arrêter l’animation quand l’onglet est masqué ; conserver
un texte d’état. Les WebP animés bouclés ne disposent pas d’une commande pause :
l’aperçu remplace leur source par le PNG fixe et reprend au début de la boucle.
Le mode pause n’est donc pas un gel précis de la frame courante.

Les transitions sont marquées non bouclées. L’aperçu passe ensuite à la boucle
de destination. Les transitions manquantes changent directement d’état. Ce lecteur
reste une démonstration indépendante ; aucun signal de run réel n’y est raccordé.

## Provenance et limites

Sources : /projects/nora à la révision
`ecb473c8156be912a1b0ad4be764ae37b56e4821`, répertoire
assets/brand/animation/openrouter/seedance-pack-v1. Ces clips sont documentés
comme approuvés et intégrés dans ce projet. Génération vidéo originale Seedance
2.0. Fichiers employés : idle-loop-review, working-loop-trim, waiting-loop-review
et les quatre transitions portant les mêmes noms. Empreintes dans le manifeste.
Aucun script, code de lecteur ou donnée utilisateur Nora n’est incorporé.

Conversion vidéo locale FFmpeg/libwebp, source carrée 960 px, détourage vert,
cadrage par état, masque circulaire pour le portrait, redimensionnement et
encodage séparé pour chaque taille. Couleurs et bords du détourage restent à
juger sur les fonds de l’interface finale. Un raccord de boucle, notamment au
travail, peut rester perceptible dans la source : aucun label « boucle parfaite ».
Les références de droits/provenance doivent rester avec les assets redistribués.

Reconstruction depuis le dépôt Heart :
`node scripts/build-avatar-pack.mjs /chemin/vers/seedance-pack-v1`
Puis : `node scripts/package-avatar-pack.mjs` pour actualiser les archives et
le manifeste JS. Aucun credential et aucun coût d’API dans ces scripts.

L’archive portraits-only.zip contient les portraits et les transitions portrait,
les images fixes, le symbole et un manifeste filtré. L’archive complète contient
aussi personnage, aperçu HTML/CSS/JS et GIF. L’interface principale, le setup et
la connexion ChatGPT ne sont pas modifiés par le pack.
