# Performance de l’interface

Mesure du 17 novembre 2026 sur https://heart.natio.re, Chromium headless,
viewport 390 × 844, sans bridage CPU/réseau. Ce sont des mesures de laboratoire,
pas un test sur un téléphone physique. Ces chiffres précèdent l’ajout des
ressources chat-content.js/css ; ils mesurent le correctif de performance, pas
l’empreinte de tous les ajouts ultérieurs. Aucun appel modèle ni écriture de données
propriétaire. La compression gzip/zstd était déjà active dans le proxy.

| Mesure | Avant | Après |
| --- | ---: | ---: |
| Notifications MutationObserver au démarrage | 4 483 | 3 160 |
| Mutations sur quatre secondes au repos, vue Conversations | 0 | 0 |
| Ressources publiques retéléchargées à chaque ouverture | Toutes, no-store | Revalidation ETag, HTTP 304 si inchangées |

Le nombre de mutations comprend l’analyse initiale du HTML, pas seulement les
écritures JavaScript. La réduction est d’environ 30 %. L’observation au repos ne
confirme donc pas un rechargement permanent sur cette vue ; elle ne permet pas
d’exclure un autre scénario ou appareil.

Sur un second relevé avec le cache HTTP navigateur actif : 17 ressources publiques
hors document/API, 181 307 octets transférés à cache vide puis 5 100 à la réouverture.
Resource Timing comptabilise environ 300 octets par revalidation ; ce n’est pas
une mesure réseau au paquet près. Un GET conditionnel indépendant confirme le
304. Les API restent `private, no-store`. Aucun pourcentage de gain de temps
global n’est revendiqué à partir de ces seules mesures.

## Causes traitées

- Les observateurs des sélecteurs déclenchaient chacun une synchronisation globale
  et réécrivaient systématiquement les attributs de tous les boutons. Notifications
  regroupées par microtâche et écritures conditionnelles.
- Le pack visuel réaffectait les URLs de logo/favicon à chaque mise à jour générale.
  Application seulement lorsque les ressources changent, réinitialisée à la déconnexion.
- Les listes d’effort et de pièces jointes sélectionnées étaient recréées même
  sans changement. Réutilisation selon leur contenu ; icône réseau créée une fois.
- Les lectures mémoire/conversations attendaient les précédentes. Démarrage
  indépendant avec erreurs séparées et rapprochement du projet quand il arrive.
- Le suivi de réponse reconstruisait l’historique pour un changement de phase.
  Les événements sans contenu visible préservent les bulles ; les nouveaux messages
  réutilisent le Markdown déjà rendu des messages immuables existants.
- Les assets étaient interdits de cache. ETag fondé sur taille/date du fichier,
  revalidation obligatoire et téléchargement après changement de déploiement.

## Vérifier sans seuils de temps fragiles

```sh
pnpm check
pnpm test:web:e2e
pnpm demo:sdk
```

Les tests navigateur bloquent volontairement la réponse mémoire et vérifient que
les conversations arrivent avant sa libération. Ils vérifient aussi l’identité DOM
des bulles/Markdown lors d’un changement de phase et après plusieurs cycles de suivi,
et l’absence de mutation des sélecteurs/logo sur dix synchronisations inchangées.
Les tests HTTP couvrent 304, asset modifié puis 200, et API no-store.

Pour reproduire les relevés : ouvrir une session de test en 390 × 844, enregistrer
un MutationObserver sur document (subtree/attributes/childList/characterData) dès
le début de navigation ; relever le démarrage, remettre les compteurs à zéro puis
observer quatre secondes sans interaction. Pour les transferts : nouveau contexte
navigateur, cache actif, mesurer les ressources non-API via Resource Timing puis
recharger dans le même contexte. L’interception réseau Playwright désactive le
cache : ne pas l’utiliser pour la mesure des transferts. Ne jamais exporter de
contenu des conversations, cookies, credentials ou en-têtes d’authentification.

## Limites actuelles

Le suivi reste à une seconde pendant un run visible, avec delta d’événements.
Les métadonnées sont reconstruites au premier accès par pages, puis mises à jour
par ajouts ; pas de promesse de temps de démarrage constant. Les pages chargées
restent dans le DOM. Les nœuds inchangés sont conservés lors de la réconciliation.
Voir [HISTORY.md](HISTORY.md) et [mesures isolées](qualification/history/volume.json).
Téléphones physiques et très gros journaux restent à mesurer. Les règles de
mémoire/contexte et les fournisseurs restent indépendants de ces lectures web.

## Client HTTP et icônes : premier entretien UI

[Mesure navigateur](qualification/ui-cleanup/2026-11-17.json) : deux GET identiques
concurrents donnent une requête ; dix appels de réconciliation gardent les 82 SVG
du jeu d’essai, sans mutation DOM. Contrôlé aussi en HTTPS sans écriture propriétaire.
Les réponses partagées sont indépendantes pour les consommateurs. Une écriture
invalide les lectures en attente pour éviter de rejoindre une lecture précédente.
Pas de cache privé durable ni de mutation regroupée/rejouée. Les requêtes avec
signal/corps/headers particuliers restent indépendantes.

Le catalogue SVG a quitté ui.js ; le transport a quitté app.js. Les styles de
gestion ont quitté la fin de chat.css, dans leur ordre de cascade, avec nettoyage
et formatage du bloc. checkJs/JSDoc et formatage sont inclus dans pnpm check pour
ces frontières extraites. [Code et périmètre](WEB-FRONTEND.md).

Ces mesures ciblées ne prouvent pas une division du temps de démarrage ni la
suppression de toutes les relectures/redessins. Pagination/delta sont livrés séparément ; les très gros volumes et appareils
physiques restent à qualifier. Les E2E couvrent aussi les formulaires,
les fichiers, les cerveaux et le rendu Unicode/LaTeX après cette extraction.

## Revue du runtime et des réglages

Une lecture du profil d’exécution par tour web au lieu de trois ; identité, consignes
et politiques proviennent du même instantané. Une sauvegarde Limites inchangée
n’envoie aucun POST ; dix synchronisations identiques du composeur ne modifient
plus son attribut de longueur. Aucun nouveau cache persistant ou polling ajouté.
[Mesures et portée](qualification/runtime-review/README.md).
