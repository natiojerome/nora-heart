# Interface web

Le design de `/projects/nora` est la référence directe pour **toute** l’interface,
sur demande de Jérôme : palette, thèmes, typographie système, contrôles compacts,
barre supérieure, menu global et conversations en tiroirs. Pas de barre latérale
permanente ni de navigation basse. Le chat garde une colonne centrale de 880 px
maximum à toutes les tailles ; les écrans de gestion réutilisent les mêmes
surfaces, séparateurs et champs. L’interface est déployée sur heart.natio.re.

Les adaptations concernent les fonctions réellement disponibles dans Heart :
setup de l’assistant, API/abonnement, mémoire et outils actuels. Aucun indicateur
de quota inventé ; le bandeau du chat montre les messages, le contexte estimé et
les métadonnées réelles de quota/budget/reset lorsqu’elles sont disponibles,
avec leur portée compte ou clé. Aucun coût exact par run n’est déduit.
Les captures utilisent des données fictives et peuvent précéder les dernières
modifications ; les vues Activité/Confidentialité n’existent plus. Voir
[STATUS.md](STATUS.md) pour l’état courant.

## Contrat visuel partagé

`components.css` est la référence des composants communs : titre de page 18 px,
sous-titre 12 px/interligne 1,35, titre de section 15 px, titre de dialogue 17 px,
libellé 12 px, champs 16 px et hauteur tactile minimale de 44 px. Les mêmes
marges, bordures, rayons et états servent sur toutes les pages. Les titres et
sous-titres sont dans `.page-heading` / `.page-subtitle`, y compris les projets
et la mémoire ; pas de hiérarchie propre à chaque écran. Le chat et la connexion
conservent leurs compositions spécifiques.

La navigation principale reste visible en haut (52 px + zone sûre), suivie
d’une barre de page fixe de 60 px sur toute la largeur. Elle porte l’icône de
la page, son titre et son sous-titre sur une ligne chacun, puis les actions à
droite. Les textes longs s’abrègent visuellement ; le contenu ne passe pas sous
la barre grâce à une réserve haute. La typographie ne varie pas avec la largeur.

Chaque icône provient du **même catalogue SVG que le menu**, rendu par
`paintIcons` dans `ui.js`. Les pages de détail de projet réutilisent aussi cette
source. Les libellés des pages correspondent à leurs entrées du menu.

Les créations disponibles utilisent le bouton `+` de 44 px à droite du titre :
conversation depuis l’accueil/la liste, projet et souvenir. Infobulle et nom
accessible donnent l’action exacte. Le projet ouvert propose une conversation
dans sa portée. Le tiroir des conversations a son propre `+` à côté de Fermer.
Les anciens boutons flottants ne sont plus utilisés. Les filtres et les actions
secondaires restent accessibles ; Actualiser est à côté de l’ajout en mémoire.

Le chat affiche identité/navigation/réglages en haut, puis projet/titre du fil
et les compteurs d’usage. Modèle, accès et effort restent au-dessus de la saisie.
Les fenêtres des compteurs ont un corps espacé, des cartes pour les quotas et
des actions ancrées pendant le défilement. La saisie reste
ancrée en bas et le fil est le seul scroller du chat.

Les cases, radios et switches ont un rendu CSS partagé, avec de vrais inputs
pour conserver labels, focus et état accessible. Les filtres utilisent des
cases ; fournisseurs et choix du setup
utilisent des radios. Les champs désactivés et le focus sont visuellement distincts.

`controls.js` présente chaque select utilisateur comme un bouton ouvrant une
feuille en bas, inspirée des feuilles iPhone : titre, sélection cochée, liste
défilante et Annuler. À partir de huit options, une recherche est disponible.
Flèches/Haut/Bas/Début/Fin, saisie par préfixe, Entrée et Échap sont pris en charge.
Annuler ne change rien ; sélectionner émet les événements natifs et rend le
focus au déclencheur, même dans un dialogue parent. Les options longues reviennent
à la ligne dans la feuille. Le clavier visuel réduit sa hauteur et relève son bas.

Les selects natifs restent la source des valeurs et des événements, masqués
visuellement et retirés du parcours d’accessibilité après enhancement. Le select
interne de catalogue de conversations reste un état technique invisible, pas
un contrôle utilisateur. Aucune nouvelle bibliothèque ni dépendance au moteur.
Les contrôles se synchronisent avec catalogue, préférences et valeurs d’édition,
y compris les champs ajoutés dynamiquement par le setup.

Les notifications globales se placent en bas de page, et au-dessus de la saisie
dans le chat. Les retours locaux ont priorité dans les dialogues ; aucun pourcentage de
chargement inventé. La réception d’un message est visible dans le fil, sans toast
redondant. [Captures actuelles](design/page-bars/README.md).

## Connexion et identité visuelle

La page publique reprend la composition de connexion Nora : identité/logo et
formulaire séparés, empilés sur mobile et côte à côte sur grand écran. Un mode
compact garde le formulaire accessible en paysage et quand la hauteur diminue.
Le champ token offre afficher/masquer ; erreurs et nouvel essai conservent le
bouton et son icône. Aucun token n’est prérempli ni conservé dans le navigateur.
Le portrait statique Aurora de Nora habille la connexion, les tiroirs,
l’en-tête et les signatures des réponses ; il sert aussi de favicon. Provenance dans `public/brand/README.md`.
[Captures de la connexion](design/login/README.md).

## Écrans raccordés

- Accueil : discussions récentes, projets réellement présents et état textuel.
- Discussions : catalogue paginé, recherche et filtre par projet sur tous les fils, création avec projet,
  historique persistant, envoi, choix du cerveau dans une boîte de dialogue.
  Sur mobile, la liste occupe toute la largeur ; chaque ligne distingue titre,
  projet, dernier modèle enregistré et effort (auto pour le défaut ChatGPT,
  tiret sans réglage). Filtre par UUID de projet, y compris Sans projet, combiné
  à la recherche ; sélection partagée avec le tiroir du fil. Les compteurs
  d’usage sont réservés au chat ouvert et absents de cette liste.
  Le bouton Conversations ouvre le même tiroir sur mobile, tablette et desktop,
  sans quitter le fil. Le menu donne aussi accès à la liste complète.
  Chat plein écran utile, saisie fixe, Markdown assaini, outils repliés et
  défilement qui conserve la relecture, voir CHAT-UI.md.
- Projets : création, discussions et souvenirs associés. Le catalogue actuel
  contient un titre ; pas d’objectif, de jalons ou d’archivage inventés.
- Mémoire : recherche dans les 200 souvenirs chargés, portée personnelle ou
  projet, ajout, correction, oubli/restauration, provenance et versions.
- Fournisseurs : connexions ChatGPT par abonnement et clés OpenAI, Anthropic,
  OpenRouter, sans choix de modèle ou effort. La cible d’une connexion est
  indépendante du modèle de la conversation ouverte.
- Modèle du fil : dialog dédié depuis le badge modèle/effort ou les réglages du fil.
  Choix fournisseur/modèle/effort, Enregistrer et Modèle par défaut. Sauvegarde
  avant tout message, annulation restauratrice, brouillon/historique conservés.
  Aucun appel LLM pour changer ces réglages.
- Réglages : assistant, thème et valeurs par défaut des nouveaux fils : fournisseur,
  modèle, effort selon catalogue, mode et réseau. Copie à la création, sans effet
  rétroactif. Formulaire en overlay, YOLO/root explicite.
- Consommation : fournisseurs connectés, dépenses OpenRouter de la clé et
  budget/solde/reset, quotas du compte ChatGPT si disponibles ; données absentes
  signalées. Périmètre fournisseur, pouvant inclure des usages hors Heart.
- Atelier retiré des menus ; route technique conservée pour les tests.
- Outils : état documenté des fonctions réelles.
- Les vues Activité et Confidentialité sont retirées des écrans et des menus.

Le menu Fichiers et le bouton dossier du chat ouvrent l’explorateur réel :
CRUD texte révisé, dossiers, téléchargement et permissions par conversation,
avec formulaires en overlays. Voir [FILES.md](FILES.md).

Automatisations et contrôle des
sauvegardes ont leurs écrans et des états vides explicites. Les actions non
raccordées sont désactivées. Aucun coût, quota, fichier ou succès fictif.
Notifications, import d’avatar et recherche globale restent à développer. Les connexions MCP de lecture et la recherche web sont gérées dans Capacités, voir MCP.md.

## Ajouts, modifications et retours d’état

Les listes restent des listes : créer un projet ou une conversation, ajouter ou
corriger un souvenir, configurer une clé API et modifier l’apparence ouvrent un
**dialogue en overlay**. Pas de formulaire injecté dans la page ni de navigation
vers un autre écran pour ces opérations. L’assistant conserve son parcours de
personnalisation en overlay. Recherche et filtres restent directement accessibles.

Les dialogues ont un titre, un champ de départ focalisé, Annuler/Fermer, Échap
et un pied d’actions accessible sur mobile, même avec un viewport réduit par le
clavier ; seuls les champs défilent. Fermer rend le focus au déclencheur
lorsqu’il est visible. Annuler l’apparence restaure le thème enregistré. Une clé
API est effacée à la fermeture ou après succès ; un refus du serveur laisse le
champ masqué disponible pour corriger et réessayer dans le même overlay.

`feedback.js` rend les états HTTP, sans gérer les données métier. Une requête
annonce son objet avec un indicateur animé ; les requêtes concurrentes ne font
pas disparaître l’indicateur prématurément. Dans un overlay, l’attente, l’erreur
et le succès sont annoncés dans la couche active, pas derrière. Les notifications
globales sont masquées lorsqu’un retour local est visible ; elles ne bloquent
pas les clics sur l’écran. Pas de pourcentage inventé ni de repli/retry automatique.

Pendant une écriture, champs et actions du formulaire sont désactivés ; la
fermeture attend le résultat pour éviter une demande perdue sous un écran
fermé. L’envoi du chat garde la possibilité de préparer le prochain brouillon.
Un échec laisse le formulaire ouvert et conserve la saisie. Le succès confirmé
ferme l’éditeur puis actualise la liste. Une écriture confirmée suivie d’un échec
d’actualisation mémoire est annoncée comme enregistrée, avec invitation à
actualiser ; elle n’est pas présentée comme une écriture à recommencer.

Connexion, catalogue, historique, souvenirs, préférences, outils de test et
échanges chat passent par le même retour HTTP, en plus de leurs états dédiés.
Les erreurs restent visibles jusqu’à fermeture ou nouvelle action ; les succès
globaux disparaissent après quelques secondes. Rien n’est persisté côté navigateur.

## Premier lancement et préférences

Après authentification, une installation non configurée propose cinq étapes :
identité/genre/pack de base, thème, modèle de personnalité et texte éditable,
connexion fournisseur, récapitulatif.
Chaque « Continuer » enregistre le progrès côté serveur ; le profil est
retrouvé depuis un autre appareil. « Plus tard » ferme le parcours ; le
bouton de réglages en haut permet de le reprendre. Après complétion, Mon assistant
ouvre Configuration → Assistant : identité (nom/genre) et personnalité sont regroupées. L’éditeur d’identité/personnalité conserve le pack
sous Identité visuelle et les modèles de texte ; l’installation n’est pas relancée.
Configuration réunit cinq onglets : Apparence, Assistant, Discussions,
Instructions et Limites. Apparence propose le thème ; Discussions les défauts des nouveaux
fils ; Instructions les onze consignes modifiables. Une seule entrée de menu,
navigation clavier et liens directs, dont l’ancien `#instructions`.

`AssistantSettings` et `AssistantProfileRepository` sont des contrats neutres.
`app/assistant.ts` valide les choix et prépare les instructions ; les
repositories SQL assurent sauvegarde et concurrence optimiste. La migration additive
004 stocke un profil JSONB par UUID d’instance, indépendant du nom affiché et
du dossier. Un conflit renvoie HTTP 409, sans écraser l’autre appareil.
Les secrets et credentials restent hors de ce document.
La sélection du cerveau reste celle de la conversation/session de travail.

Nom, genre et texte courant de personnalité sont injectés aux prochains runs
persistants via l’option générique `instructions`. Le choix de personnalité
initial remplit un modèle de texte ; l’utilisateur l’affine ensuite librement.
Après installation, le bouton « Utiliser ce modèle » remplace seulement le
brouillon affiché ; Enregistrer confirme, Annuler conserve la personnalité.
Longueur et initiative historiques n’imposent plus un ton au texte personnalisé. Le core ajoute toujours sa règle sur les résultats d’outils et garde
ses contrôles de permissions. Avatar et thème n’influencent pas le cerveau.
Les essais techniques isolés gardent leur configuration de démonstration.

## Présence et thèmes

Le pack de base fournit logo et portrait de conversation statiques. Il est choisi
au setup et modifiable sous Configuration → Assistant → Identité et personnalité → Identité visuelle, indépendamment du nom. Un seul pack
approuvé est proposé actuellement. Aucun personnage animé n’est affiché ou chargé.
Les états de travail et d’attente restent textuels, avec les retours de chargement.
L’espace réservé au personnage au-dessus de la saisie est supprimé.
Thèmes Clair, Nocturne, Sauge, Graphite, Système via variables CSS.
Les fichiers et valeurs historiques du profil sont conservés, sans migration.
Les indices persistants des étapes restent stables ; l’ancienne étape avatar
est sautée, y compris à la reprise d’une installation interrompue.

## Organisation et vérification

HTML/CSS et JavaScript natifs, avec Marked/DOMPurify pour le rendu assaini.
`app.js` garde les appels API et les contrôleurs existants ; `ui.js` gère vues,
setup, thèmes et présence ; `feedback.js` annonce les requêtes et protège les formulaires en attente ; `chat.js`/`chat.css` gèrent le fil et la saisie. Une liste explicite d’assets est servie par HTTP.
Les tiroirs utilisent des dialogues natifs (focus captif, Échap et retour du focus).
Les cookies HttpOnly/SameSite, CSRF, contrôles d’origine et le relais OAuth
restent en place. Aucun stockage navigateur pour les clés ni pour le profil.

Les tests couvrent validation/CAS du profil, instructions transmises à deux
cerveaux simulés, reprise et isolation PostgreSQL, migration, setup navigateur,
CSRF/conflit HTTP, conversations/mémoire/API/catalogue et débordements sur
320/390/820/1440 px. Les services et données des autres Nora restent séparés.

## Conversations et barre d’outils

L’interface de conversation reprend la structure Nora, avec effacement, prompts rapides, gestionnaire de fichiers et arrêt réel.
Voir [CHAT-UI.md](CHAT-UI.md) pour les comportements, formats, persistance et limites.
Le shell et les outils MCP de lecture sont livrés et distincts de la planification, qui reste à développer.

## Réglages de conversation et fichiers

Réglages du fil = vues exclusives Modèle/Accès/Exécution/Contexte, avec rôles
ARIA tablist/tab/tabpanel et navigation clavier. Mobile en feuille compacte,
desktop centré, hauteur adaptée ; titres courts, aides conditionnelles. Le réseau
appartient à Accès, le budget à Exécution ; chacun enregistre ses options sans
appliquer les valeurs non enregistrées de l’autre vue.

La vue Modèle contient fournisseur et choix du modèle. Une vue séparée
Réglages du modèle regroupe connexion et paramètres applicables. L’effort ChatGPT
vient du catalogue par modèle et est transmis à l’adaptateur ; le choix par défaut
n’envoie pas de paramètre. Il est restauré depuis la dernière sélection du fil.
Les API existantes conservent leurs clés, sans exposer un réglage non implémenté.

La configuration du prochain message (modèle, accès/YOLO, effort compatible)
apparaît dans une ligne neutre au-dessus du champ de saisie, hors de celui-ci.
Le header supérieur porte les réglages ; la barre de contexte de 48 px garde projet/titre. Les pictogrammes de l’UI
utilisent les SVG du catalogue partagé, y compris les fournisseurs, menus et
états de sélection ; pas d’emoji décoratif. Le chat garde son contenu utilisateur.

Cases et radios de 20 × 20 px, switchs de 42 × 26 px. Les selects restent en
feuilles accessibles. Les fichiers gardent recherche/import, chemin cliquable et
menu par élément, indépendant de l’ouverture du contenu.
[Captures](design/conversation-settings/README.md).

Les bulles utilisateur ont Copier/Relancer. La relance ajoute un envoi à la fin
avec fichiers d’origine et configuration actuelle, sans perdre le brouillon.
[Captures](design/chat-actions/README.md).


Les recherches/filtres Conversations et Mémoire sont dans une barre fixe sous
l’en-tête de page. Marge intérieure de 12 px et espace réservé : champs séparés
du bord, contenu jamais masqué au défilement. Le filtre du tiroir de conversation
reste dans ce tiroir. Fournisseurs ne propose aucun retour ou sélecteur de discussion ;
le choix du modèle du fil vit dans son dialog dédié. Les permissions restent
dans les réglages du fil et les valeurs par défaut.
Mémoire propose Personnel (tous les fils) et les projets existants ; sans projet,
un lien explique comment créer cette seconde portée.


Consommation : cartes fournisseur avec chiffre principal, jauge des fenêtres,
périodes dans une grille compacte, source/périmètre repliables et relevé en pied.
Actualiser est séparé des cartes par 16 px. Défauts des nouveaux fils : formulaire
continu, sans sections ; effort selon capacités du modèle. Enregistrement annoncé
sur la réponse confirmée, sans relecture globale obligatoire ; modifications
indépendantes rapprochées, conflit sur les mêmes réglages signalé avec saisie
conservée. Le chargement initial empêche de modifier des valeurs encore périmées.

Le chat charge automatiquement les anciens messages quand on remonte près du
début, sans bouton permanent ; indicateur discret, Réessayer seulement sur échec.
La liste conserve Plus de conversations. Le suivi
du travail utilise un delta, sans effacer brouillon, détails ou réponses de formulaire.
Voir [HISTORY.md](HISTORY.md) pour la reconstruction initiale et les limites.

Capacités présente aussi les Skills : nom/état/description compacte, fiche overlay
avec switch partagé, copie de `$nom`, source et liste de ressources dépliables.
Activation effective au prochain tour, lecture et enregistrement visibles ; aucune
nouvelle vue de configuration concurrente. Quatre largeurs qualifiées. [SKILLS.md](SKILLS.md).

Tâches remplace le placeholder Automatisations : cartes compactes avec planning,
prochaine exécution et dernier état. Création à droite du titre, éditeur standard,
historique et actions dans une fiche. Notifications internes non lues persistantes,
liens vers la discussion de chaque occurrence et arrêt des futures exécutions via
Pause. Fuseau visible et champs horaires explicites. [TASKS.md](TASKS.md).
