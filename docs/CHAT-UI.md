# Chat — design Nora

Référence directe : `/projects/nora/apps/web/src/styles.css`, `App.tsx`,
`SessionRail.tsx`, `GlobalDrawer.tsx`, `ChatView.tsx`, `MemoryPanel.tsx` et
`ConfigurationPanel.tsx`, révision `ecb473c8156be912a1b0ad4be764ae37b56e4821`.
Inspection en lecture seule. La palette CSS et les proportions sont adaptées de
Nora à la demande du propriétaire ; composants React, API, données et runtime
Nora ne sont pas incorporés. Aucun ajout de dépendance pour cette adaptation.
Les icônes inline sont des tracés SVG locaux. Le portrait Nora Aurora est statique.

## Comportement

La barre supérieure regroupe menu, portrait statique/identité, réglages du fil,
conversations et accueil. Le bouton de réglages offre une cible tactile de 44 px.
La barre de contexte de 48 px garde le projet et le titre du fil. Les badges
modèle/accès/effort se trouvent dans une ligne discrète au-dessus de la saisie,
hors de son champ ; chaque badge ouvre sa vue de réglages. YOLO remplace l’accès
normal. L’effort apparaît uniquement pour les modèles compatibles, et précise
Auto lorsqu’aucun effort explicite n’est choisi. Le portrait Nora Aurora reste
statique, dans l’en-tête et les réponses. Le contexte affiché est une capacité
configurée/catalogue, avec estimation du dernier contexte et métadonnées fournisseur séparées des coûts réels par run.

Le chat occupe le viewport utile. Le fil seul défile, la saisie reste en bas.
La colonne centrale atteint 880 px ; aucun rail permanent, même sur desktop.
Deux tiroirs à gauche, limités à 350 px/88vw : navigation générale et liste des
conversations. L’icône Conversations du chat ouvre la liste au-dessus du fil,
sans perdre la relecture ni la saisie. Recherche et création réutilisent les
contrôleurs existants. Sélection/création ferme le tiroir. Échap, clic extérieur
et bouton de fermeture sont disponibles ; les dialogues natifs capturent et
restaurent le focus. La liste complète reste accessible depuis le menu/accueil.

`chat.js` gère le rendu et la géométrie ; `chat.css` contient les règles du chat.
La hauteur et le décalage de `visualViewport` adaptent la saisie à la zone visible,
y compris une réduction de hauteur par le clavier. Le titre et le modèle
s’abrègent dans l’en-tête ; leurs valeurs complètes restent disponibles au survol.
Les paramètres de contexte sont dans une feuille dédiée.

La saisie s’agrandit jusqu’à 140 px, sans pousser le bouton d’envoi hors écran.
Entrée envoie sur pointeur fin ; Maj+Entrée, clavier tactile et composition IME
conservent les retours à la ligne. Un prochain brouillon saisi pendant la
réponse est conservé. Les brouillons par discussion vivent uniquement en mémoire
navigateur et sont effacés à la déconnexion ; ils ne survivent pas au rechargement.
Le changement de fil reste possible pendant une réponse : chaque requête garde
son UUID, son résultat rejoint son propre fil et chaque fil conserve son brouillon.
Les fils actifs se rafraîchissent toutes les secondes, onglet visible uniquement,
sans appel LLM ; les détails utiles ouverts et la position de lecture sont conservés. Les blocs techniques d’outils ne sont plus rendus dans le fil.

Le défilement suit les nouveaux messages si on était en bas. Lorsqu’on relit
plus haut, il garde la position ; « Dernier message » rejoint la fin. Les appels
et résultats d’outils sont regroupés et repliés. Les messages affichent auteur
et heure, avec copie des messages utilisateur, réponses et code.

## Markdown et sécurité

Marked 18.2.0 et DOMPurify 3.4.17, versions épinglées, fournissent le rendu des
listes, titres, tableaux, liens et code. HTML assaini, styles et éléments actifs
interdits ; aucune image distante n’est chargée automatiquement. Les liens
n’acceptent que HTTP, HTTPS ou mailto. Les tableaux proposent agrandissement, cartes mobiles et copie ; les blocs de
code défilent horizontalement sans élargir la page. Images locales dans une carte
avec agrandissement/téléchargement ; images externes HTTPS sur action. Les liens
fichiers ouvrent l’éditeur existant. Voir [CHAT-CONTENT.md](CHAT-CONTENT.md).
Les bundles locaux conservent leurs avis de licence :
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). `pnpm web:vendor` permet de
les reproduire depuis les dépendances installées, sans service externe au runtime.

## Qualification

Les modifications ont été préparées dans des assets séparés, puis qualifiées
avant remplacement du site. `pnpm check`, `pnpm test:web:e2e` et `pnpm demo:sdk`
passent. Le nouveau parcours navigateur utilise une vraie boucle avec fournisseur
simulé et un historique rempli : Markdown, XSS, images externes bloquées, longs
mots/tableaux/code, position de lecture, clavier visuel réduit à 360 px et
brouillon pendant réponse. Géométries 320/390/820/1440 et paysage 740 × 390.
L’émulation du clavier dans Chromium ne remplace pas un essai matériel iOS/Android.
Aucune inférence payante ni écriture dans les conversations du propriétaire.

Captures de vrais composants, avec données fictives :
[mobile, tablette, desktop et nuit](design/chat-static/README.md).

## Barre de saisie et outils

Le portrait Nora reste statique dans l’en-tête et les réponses. Les animations
de personnages sont retirées : aucun chargement de vidéo ou pack animé, aucun
espace réservé au-dessus de la saisie. La barre contient l’état du modèle
configuré, l’effacement du texte, les prompts rapides, les pièces jointes, l’explorateur de fichiers et
Envoyer/Arrêter. Le dossier ouvre les fichiers de travail et leurs permissions ;
le trombone conserve les pièces jointes. Voir [FILES.md](FILES.md). L’état « configuré » ne prétend pas tester une connexion réseau.
Les délais ont un retour visuel, les erreurs restent affichées et aucune requête
échouée n’est rejouée automatiquement. `chat-tools.js` gère ces interactions.

Les prompts sont persistés côté serveur : titre, description, contenu et portée
personnel/projet/toutes. La baguette ou `/` ouvre les raccourcis ; le crayon ouvre
le gestionnaire, puis les éditions en dialogue. Insérer un prompt remplit le
brouillon ; cette action n’envoie rien au modèle. Versions optimistes contre
l’écrasement depuis un second appareil, 100 prompts maximum.

Les fichiers sont propres à une conversation et authentifiés comme son
historique. Ajout avec progression réelle d’upload, sélection de cinq fichiers,
aperçu image/texte, téléchargement et retrait des fichiers non envoyés. Un fichier
envoyé est conservé pour garder ses anciens messages cohérents. Formats : texte
UTF-8 (1 Mio), PNG/JPEG/WebP/PDF (8 Mio), 20 Mio par message, 100 fichiers par fil.
Pas d’Office ni vidéo. Les octets sont en PostgreSQL ; le journal contient seulement
les références. L’application hydrate les pièces avant l’adaptateur du modèle,
avec un plafond de 32 Mio de fichiers distincts dans le contexte d’un run.
Les adaptateurs ChatGPT et API traduisent images/PDF/texte ; l’inférence multimodale
réelle n’est pas qualifiée, et le modèle choisi doit accepter le format envoyé.

Arrêter transmet un signal au run courant et attend sa clôture. Les actions déjà
terminées sont conservées, celles non commencées sont marquées annulées, sans
rejeu. Une action externe déjà commencée peut demander une réconciliation : le
bouton ne garantit pas son annulation distante. Fermer la connexion du POST
interrompt également le run ; les brouillons restent locaux à l’onglet.

## Fidélité au chat Nora

La comparaison du 16 novembre a utilisé `App.tsx`, `ChatView.tsx`,
`ConversationContextBar.tsx` et les règles CSS de la révision source `ecb473c`.
Les règles de contexte, de signature et les dimensions du composer reprennent
cette référence ; adaptées aux noms CSS/variables Heart, sans import React,
Lucide ou runtime Nora. Aucun ajout de dépendance.
Les réponses contiennent leur signature, heure et copie par icône dans la bulle ;
les messages utilisateur ont une icône distincte. L’effort adapté au modèle est proposé depuis le badge et son dialog dédié. Pas de personnage animé au composer.

## Dates et activité

Les bulles affichent date (année comprise) et heure ; des séparateurs de date
complète délimitent les jours. Les dates utilisent le fuseau du navigateur,
avec horodatages ISO inchangés dans le journal. Le test couvre le passage de
23:59 à 00:01 à La Réunion. Les nouveaux messages optimistes sont également datés.

Le panneau « Nora travaille » reprend la présentation compacte de
`ResponseActivity` de `/projects/nora` : filet vertical, en-tête sur grille,
compteurs en pastilles, icônes SVG et liste courte. Le compteur mesure les appels
effectivement lancés dans ce run, sans compter les appels ignorés ; la durée est
réelle. Aucun token/coût n’est inventé.

Deux commentaires publics utiles au maximum accompagnent l’étape courante :
contexte, attente, analyse/rédaction si le fournisseur le signale, ou catégorie
d’action. Les noms techniques, paramètres et retours d’outils n’apparaissent plus
en blocs dans l’historique, anciens échanges compris. Le journal canonique et
l’exécution restent complets. L’UI ne divulgue aucun raisonnement privé.

Les commentaires du run actif restent dans ce seul panneau ; après la fin, les
événements publics run.progress peuvent rester en notes discrètes dans le fil.
Les cartes de souvenirs réussis et les formulaires interactifs sont conservés.
Le rendu des messages ne se reconstruit plus pour un simple résultat d’outil
masqué ; les bulles, leur Markdown et la position de lecture sont préservés.
[Qualification](qualification/chat-clean/checks.json),
[aperçu mobile](qualification/chat-clean/working-390.png).

Les phases ne sont pas conservées après le run : le journal des appels/résultats
et les horodatages restent durables. Le navigateur affiche une interruption de
suivi lorsqu’un rafraîchissement échoue ; ce contrôle ne relance aucune inférence.
Le bandeau global d’attente de réponse est masqué dans le chat, où le panneau
d’activité prend le relais. Les erreurs et autres notifications restent présentes.

## Actions sur les messages utilisateur

Copier transmet le texte brut, sans date/métadonnées, au presse-papiers ; repli
navigateur et retour visuel en cas de succès/échec. Relancer renvoie le texte et
les pièces jointes d’origine en fin de fil, avec le modèle/effort et les droits
actuels. L’historique n’est ni tronqué ni rejoué. Brouillon et fichiers préparés
pour le prochain message sont conservés, y compris en cas d’échec.

Les actions restent visibles sur mobile et accessibles au clavier. La relance
est indépendante de la présence de texte dans le composeur ; elle est verrouillée
pendant une exécution/upload ou lorsque le modèle n’est pas disponible. Les pièces
jointes sont relues par le même backend, avec contrôle d’appartenance au fil.
[Captures et tests](design/chat-actions/README.md).


## Fenêtres de compteurs

Messages, contexte, crédits/budgets et renouvellement utilisent le même cadre :
corps avec 16–20 px de marge intérieure, en-tête/fermeture et actions distincts,
contenu défilant en hauteur réduite. Quotas groupés en cartes : nom et durée,
part restante, jauge native accessible, part utilisée et renouvellement.
Les autres mesures gardent des libellés et valeurs alignés, empilés sous 360 px.
Aucune source vide ou bordure vide dans Messages/Contexte. Actions Fermer pour
ces deux vues, Voir l’usage/Actualiser pour les données fournisseur.

[Captures mobiles](design/usage-dialogs/README.md).

## Questions et formulaires

interactions.request_input affiche une vraie demande persistante dans le chat :
un toucher pour un choix simple, formulaire compact pour plusieurs questions,
validation/erreur et attente visibles. Le moteur reste suspendu sans inférence ;
réponse structurée puis continuation, annulation sans LLM ni appels dépendants.
Le composeur garde son brouillon mais attend la résolution ; les autres fils
restent utilisables. Voir [INTERACTIONS.md](INTERACTIONS.md).

## Progression et effets mémoire

Le panneau de travail reprend les deux derniers commentaires publics fournis par
le modèle et une phase neutre ou l’outil actif. Les commentaires restent consultables
dans les points d’avancement du journal. Il ne diffuse pas les pensées privées ;
sans commentaire utile fourni, aucune réflexion n’est inventée.

Les blocs génériques d’outils, arguments et résultats bruts ne sont pas rendus.
Un résultat mémoire réussi produit une carte selon Nora : icône dans une case,
libellé d’action et date/heure, titre, aperçu limité à deux lignes. Création,
correction, oubli et restauration ont leur icône ; l’oubli est atténué. Le libellé
de création utilise le nom de l’assistant (ou « Mémoire ajoutée » pour la provenance
manuelle). Aucun pied de carte portée/version ; ces détails restent dans l’éditeur.
Les cartes prennent toute la largeur sur mobile. Toucher la carte ouvre le souvenir
dans sa version actuelle ; le reçu garde les données de l’action passée.
[Qualification navigateur](qualification/memory-cards/browser.json).

La revue mémoire avant clôture peut annoncer l’utilité du fait puis déclencher la
carte habituelle après réussite. Ses catégories d’audit internes ne sont pas des
commentaires ni des bulles ; un échec de revue ajoute un avertissement à la réponse.
Un accord nécessaire utilise les formulaires du chat existants.

## Reçus compacts communs

`heartTurns.receipt` construit l’icône, l’action/date, le titre et l’aperçu communs
aux cartes mémoire et réponses de formulaire. Géométrie de Nora, fond vert doux
pour mémoire ; bleu doux pour formulaire répondu et gris pour annulation. Les
réponses résolues retirent description et contrôles devenus inutiles. Un choix
court reste directement lisible ; plusieurs réponses ou un texte long utilisent
un aperçu de deux lignes et un détail dépliable contenant les libellés complets.
Aucune réponse n’est tronquée dans les données ou rendue inaccessible. La date
vient de `interaction.resolved`, dérivée sous `respondedAt` sans migration, avec
repli sur la date de demande pour une donnée ancienne incomplète. Le cache garde
le panneau déplié pendant les actualisations du même fil.
