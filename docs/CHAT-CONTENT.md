# Affichages enrichis du chat

Livré avant MCP sur demande du propriétaire. La référence est Nora, révision
`ecb473c8156be912a1b0ad4be764ae37b56e4821`, composants `ChatView.tsx`
(MarkdownImage/liens) et `ResponsiveTable.tsx`. Inspection en lecture seule :
comportements réimplémentés en DOM natif pour Heart, sans copier ces composants,
importer React/Lucide ou modifier le runtime/données Nora. Les tableaux et images
n’ajoutent pas de dépendance ; les formules utilisent KaTeX servi localement.

## Format commun à tous les cerveaux

Les modèles utilisent le Markdown existant, pas un nouveau protocole d’outil :

```markdown
| Étape | Statut |
| --- | --- |
| Interface | Validée |
| Intégration | En cours |

![Évolution du projet](rapports/graphique.svg)

[Ouvrir les notes](rapports/notes.md)
```

Les fichiers doivent réellement exister dans le workspace du fil. Un SVG de
graphique/diagramme peut être créé avec les outils fichiers autorisés, une image
raster avec un programme disponible. Le rendu ne fournit pas d’API de génération
d’image. App rappelle la syntaxe aux cerveaux sans modifier la personnalité,
les inventaires d’outils ni les permissions. Les messages restent du texte Markdown
persistant ; aucune migration SQL ni nouvel objet fournisseur dans le journal.

Privilégier des chemins relatifs, stables après déplacement de l’installation.
Le rendu reconnaît aussi `/workspace/...` (vue du mode isolé) et les chemins
absolus sous le workspace courant annoncé par l’API du fil. Il n’ouvre pas les
chemins arbitraires de l’hôte. En YOLO, un livrable à afficher doit être enregistré
ou copié dans le workspace du fil ; les commandes hôte gardent leur portée propre.

## Tableaux

- Aperçu dans la bulle, nombre de lignes/colonnes et bouton Agrandir.
- Sur mobile, deux lignes présentées en cartes, avec le nombre de lignes restantes.
- Vue agrandie native dialog : Cartes ou Tableau, copie en texte tabulé.
- En tableau, défilement horizontal contenu ; les cartes réutilisent les libellés
  de colonnes. Fermer/Échap et restitution du focus au déclencheur.

## Images et fichiers

Les images locales sont chargées paresseusement : PNG, JPEG, WebP, GIF, AVIF et SVG.
Carte avec nom, aperçu, agrandissement, masquer/afficher, téléchargement. Chargement
et erreur visibles, Réessayer après échec. Les liens simples vers un chemin image
ouvrent aussi cette carte. Les autres liens locaux ouvrent l’éditeur/explorateur
existant ; les formats non éditables gardent leur téléchargement.

Les images externes HTTPS demandent une action Afficher avant la première requête,
sans referrer ; une réouverture/recharge ne recharge pas automatiquement l’image
externe. Pas de proxy serveur vers une URL externe, pas de base64 dans le journal.

## Séparation des responsabilités

- `chat.js` : Marked/DOMPurify, Markdown sûr, bulles et contexte de rendu du fil.
- `chat-content.js` / `.css` : tableaux, cartes, images et dialog de lecture.
- `workspace.js` : ouverture des liens de fichiers dans l’éditeur existant, avec
  vérification que le fil propriétaire du lien est toujours ouvert.
- `Conversations` / `image-preview.ts` : accès fichier du workspace et reconnaissance
  d’une signature d’image, puis flux original sans lecture intégrale en mémoire.
- GET privé `/api/conversations/:id/workspace/preview?path=...` : image inline,
  no-store et nosniff, CSP sandbox avec scripts/ressources externes interdits.
  `/workspace/raw` garde le téléchargement tous formats.

Les images sont construites par le contrôleur après résolution des liens ; les
balises img/iframe/scripts/HTML actif fournies dans le Markdown restent interdites.
Les gardes du module fichiers (traversée, symlinks/hardlinks) restent appliquées.
La CSP globale permet les images HTTPS pour le chargement manuel ; elle n’autorise
pas d’HTML ou JavaScript arbitraire. Le mode du modèle ne change pas les droits de
consultation manuelle du propriétaire, déjà distincts de ceux de l’assistant.

Les bulles et leurs widgets sont réutilisés par le rendu existant : une mise à jour
d’activité/mesure technique ne reconstruit ni les images ni leur état d’ouverture.
Les dialogs sont créés à la demande, supprimés à la fermeture, sans observateur
ou polling supplémentaire. Les agrandissements se ferment au changement de fil.

## Vérifications et limites

`pnpm check` : 108 tests, dont signature/flux complet, fermeture des flux après
rejet/annulation. `pnpm test:web:e2e` : six parcours avec fournisseurs simulés ;
le nouveau parcours utilise HTTP, fichiers et SVG réellement servis sur un
workspace temporaire. Tableaux/cartes/copie, images, téléchargement, lien éditeur,
rechargement, erreurs, 401, traversée et faux PNG refusés, images externes chargées
seulement au clic, images préservées lors d’une mise à jour. Géométries
320/390/820/1440 px ; [captures](design/chat-content/README.md).
`pnpm demo:sdk` passe, sans coût LLM. Pas de SQL modifié : la qualification
PostgreSQL antérieure reste séparée. Aucune nouvelle inférence fournisseur réelle. HTTPS du site déployé : assets/rendu/dialogs
contrôlés en lecture seule, profil inchangé, API conversations/mémoire 200 ; les
lectures de fichiers d’essai restent celles du workspace temporaire local.

Ce sont des affichages de lecture, pas un outil de création d’images, moteur de
visualisations HTML interactives, renderer Mermaid ou lecteur Office/vidéo/PDF
inline. Les images locales suivent le fichier courant : modifier/supprimer le
fichier peut changer/casser son ancien aperçu. Pas de versionnement d’artefacts
ajouté. Les limites de pièces jointes envoyées au modèle restent distinctes.

## Qualification réelle et correctif transport

L’essai propriétaire du 17 novembre révélait un rejet de flux dans l’adaptateur
ChatGPT avant affichage, et non une exception du renderer. Corrigé : items SSE
finalisés conservés quand la réponse terminale confirmée n’en répète pas la liste.
La qualification suivante utilise un vrai GPT-6.1 Sol medium : création du SVG,
réponse Markdown, tableau/cartes et image décodée depuis le navigateur. Deux
appels, outils/core/HTTP/fichiers réels, données jetables. [Rapport](qualification/chatgpt-display/2026-11-17.json).
Les tests simulés initiaux ne couvraient pas cette forme SSE ; une régression
la couvre désormais (110 tests au total, six E2E). Pas d’écriture ou rejeu dans
les conversations du propriétaire.

## Unicode, direction et texte agrandi

Les textes utilisateur et le Markdown suivent la direction HTML `auto` ; les
paragraphes, listes, titres et cellules déterminent aussi leur propre direction,
afin de mêler des langues dans une même réponse. Le code en bloc reste LTR.
Les cartes de tableau conservent une direction automatique pour leur valeur et
les citations utilisent une bordure logique. Ni translittération ni normalisation
Unicode : copies de messages/code et réponses aux formulaires gardent leur texte.
Les résumés de texte multiligne conservent les sauts de ligne.

Les métadonnées peuvent revenir à la ligne lorsque le texte est agrandi, sans
réduire les icônes des bulles. La pile de fontes nomme les fontes emoji système,
sans bibliothèque ni téléchargement additionnel. Formes/couleurs des emojis
restent dépendantes du système ; aucune couverture Unicode universelle annoncée.
[Qualification étendue et captures](design/chat-typography/README.md).

## Formules LaTeX

KaTeX 0.19.1, bundle/CSS/fonts locaux chargés seulement à la première formule.
Le parseur utilise des extensions Marked pour protéger le TeX avant les règles
Markdown : `\(…\)` ou `$…$` en ligne ; `\[…\]` ou `$$…$$` isolés. Pour éviter
l’ambiguïté avec les prix, préférer les délimiteurs avec antislash. Un dollar
échappé et les blocs de code restent littéraux. Les dollars courts entourant
un prix restent intrinsèquement ambigus ; les tests couvrent les formes monétaires
usuelles, sans prétendre deviner l’intention pour chaque texte.

Le HTML Markdown est toujours assaini sans autoriser de SVG/MathML brut. Des
placeholders propres au message sont ensuite remplacés via `katex.render`, avec
`trust:false` et un dictionnaire de macros neuf pour chaque formule. Le HTML/MathML
accessible provient de KaTeX uniquement ; pas de changement de la CSP. Les erreurs
ne sont pas injectées comme HTML : une formule reconnue mais invalide conserve sa
source. Le moteur conserve son budget technique natif d’expansion des macros.
Aucun plafond de longueur supplémentaire Heart. Les formules larges défilent dans
leur propre cadre, sans étirer la conversation. La copie de la réponse retrouve
le texte LaTeX original ; le journal et les autres fournisseurs restent indépendants.

`chat-math.js` / `.css` porte cet affichage ; les instructions du fil annoncent
les syntaxes rendues. Aucune API mathématique, résolution symbolique, calcul ou
validation de la justesse des formules n’est ajouté. Fonctions limitées à KaTeX,
pas une installation TeX complète. [Qualification et captures](design/chat-math/README.md).
Références : [API](https://katex.org/docs/api), [options](https://katex.org/docs/options),
[sécurité](https://katex.org/docs/security).
