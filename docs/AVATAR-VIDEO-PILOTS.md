# Deux essais vidéo V2 — références antérieures

Direction actuelle : [portraits V5](AVATAR-PORTRAITS.md), trois états et Orion
avec visage de bot en céramique/métal. Aucun nouveau corps entier. Les deux vidéos de cette
page restent conservées comme sources de revue antérieures.

Le 14 novembre 2026, après rejet par Jérôme du rendu mécanique des rigs V1,
deux nouveaux essais ont été générés avec `bytedance/seedance-2.0`, le modèle
utilisé pour les clips Nora de référence. Ce sont des vidéos génératives, pas
une interpolation de pièces articulées. Ces deux essais n’ont pas
été validés comme direction finale ; le retour utilisateur a conduit aux portraits V5.

Aperçu : https://heart.natio.re/avatar-pilots/v2/.

## Livrables et coût réellement communiqué

| Essai | Personnage | Résultat |
| --- | --- | --- |
| Masculin | Orion, nouvelle image de départ cohérente, corps/chair/clavier. | MP4 960 × 960, 24 i/s, 97 frames, 4,04 s. |
| Neutre | Prisme, nouvelle image de départ cohérente, corps/dock/clavier. | MP4 960 × 960, 24 i/s, 97 frames, 4,04 s. |

Requêtes : 4 s, 720p, aspect 1:1, sans son ; image de début et de fin identique.
Deux soumissions uniquement, aucune relance. Estimation préalable conservatrice
1,2096 USD. Usage communiqué par OpenRouter : **0,6111 USD par essai**, soit
**1,2222 USD au total**. Le petit écart par rapport à l’estimation n’est pas détaillé par le fournisseur.
Les valeurs exactes sont conservées dans les JSON résultat du fournisseur.

Les fichiers source, images de référence, prompts de requête sans base64 et
résultats sont dans `assets/avatar-video-pilots/v2`. Les sources PNG ont été
créées avec image_gen à partir des personnages précédents, en corrigeant leur
assemblage et en préparant le fond chroma vert. Les prompts image sont archivés.
Les clés/jetons ne figurent ni dans ces dossiers ni dans les scripts versionnés.

L’aperçu public livre WebP transparents corps 384 px et portrait 256 px à 24 i/s,
GIF à 16 i/s pour le chat, PNG fixes et MP4 originaux avec fond vert. Le cadrage
portrait est un extrait de la vidéo, sans nouvel appel de génération.

## Contrôle effectué et limites

- Les vidéos ont été téléchargées après statut completed ; SHA-256 enregistrés.
- Les planches de contact montrent frappe, expressions et mouvement du corps,
  distincts du rig V1. Elles ne prouvent pas à elles seules la qualité temporelle.
- Les aperçus permettent une revue animée, pause et fond clair/sombre ; images
  fixes si réduction des mouvements ou lecture indisponible.
- Les API de lecture privées restent protégées ; seuls les fichiers de revue
  fictifs sont servis. Les MP4 acceptent les requêtes partielles HTTP pour mobile.
- Les tests techniques ne sont **pas** une approbation esthétique. Boucle,
  anatomie des mains, déformations, cadrage et expressivité restent à juger.
- Pas de pack final, de nouveaux états, de tailles multiples ni d’intégration
  au chat/setup dans cette étape. Ne pas produire une série avant revue.

## Reproduction et sécurité des soumissions

`scripts/generate-avatar-video-pilots.mjs` utilise uniquement la référence
`OPENROUTER_API_KEY` injectée en mémoire et une API d’origine fixe. L’accès
OpenRouter existant du propriétaire a été utilisé sans modifier le stockage
ou le runtime Nora qui possède cette connexion. Aucun rechargement de compte,
création de clé, changement de permissions ou secret copié en clair dans Heart.

Le script vérifie les capacités et prix avant soumission, réserve l’estimation
pour les jobs déjà lancés, garde les IDs hors Git et refuse une relance après
résultat de soumission incertain. Les contrôles sont un garde-fou d’estimation,
pas un plafond de facturation garanti par le fournisseur. Ne pas effacer son
journal pour forcer un nouvel essai : créer une nouvelle intention/budget explicite.

`scripts/render-avatar-video-pilots.mjs [masculine|neutral]` ne fait que traiter
localement des vidéos déjà présentes, avec FFmpeg. Aucun appel payant. Le
traitement est séquentiel et limité en threads ; il n’écrit pas dans Nora.

Contrat vérifié auprès de la documentation officielle :
[API vidéo OpenRouter](https://openrouter.ai/blog/tutorials/video-generation-api/),
catalogue authentifié `/api/v1/videos/models` et paramètres des générations Nora
existantes. Les données brutes d’authentification et les réponses contenant des
URLs d’accès temporaires ne sont pas publiées.

## Vérification

`pnpm check` : 54 tests et typage réussis. Le test dédié vérifie modèle, statut
completed, coût communiqué et identité SHA entre l’original et sa copie servie.
`pnpm test:avatars` : aperçu mobile, pause, fond sombre et plages HTTP 206/416.
`pnpm demo:sdk` : démo du moteur préservée. Les générations vidéo sont réelles ;
les tests ne les rejouent pas. Revue esthétique utilisateur toujours attendue.
