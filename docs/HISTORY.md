# Historique paginé et suivi delta

Le journal persistant reste la source de vérité. Le contexte envoyé au modèle,
la compression et les règles mémoire ne dépendent pas de la fenêtre d’affichage.
Aucune migration ni inférence pour lire l’historique.

## Lecture par le modèle

`modules/tools/history` expose `history.read`, permission de lecture accordée aux
conversations persistantes. L’assemblage lie le SessionStore et l’UUID du fil ;
aucun paramètre ne permet de sélectionner un autre fil. `before`, `limit` (20
événements/page par défaut), `query` et `includeTools` utilisent le journal existant.
La recherche normalise casse/accents et exige chaque mot-clé. Elle remonte les
pages côté serveur jusqu’à une correspondance ou épuisement, ignore le run courant
et contrôle l’annulation à chaque page. Le résultat porte ID/date, hasMore et
continuation. Les anciens résultats restent expurgés comme à leur écriture et ne
prouvent aucun état courant. Lecture transitoire, sans recopier les archives ni
rejouer d’effet ; fallback SessionStore.read pour les stores sans pagination.

## Contrats et lectures

`SessionStore.page(sessionId, window)` utilise des identifiants d’événements
immuables comme curseurs propres au fil. `before` lit les précédents ; `after`
lit les suivants. `after: null` commence au début pour reconstruire une projection.
L’ordre retourné est toujours chronologique. Une ligne supplémentaire détermine
`hasMore`, sans calcul de total. Curseur d’un autre fil ou fenêtre invalide refusés.
PostgreSQL/SQLite utilisent l’index existant `(session_id, sequence)`.

`ConversationRepository.list` accepte limite, position, recherche de titre et
projet, dont « Sans projet ». Ordre `(updated_at DESC, id DESC)` ; la position
capture la date exacte du stockage et l’UUID. Le curseur HTTP encode ces valeurs,
sans perdre les microsecondes PostgreSQL. Modifier la ligne servant de frontière
ne déplace donc pas cette frontière. Le catalogue reste vivant : de nouvelles
modifications se retrouvent en actualisant sa tête, pas dans un snapshot figé.

- GET `/api/conversations?limit=100&before=<nextCursor>&q=<titre>&project=<uuid|none>` :
  conversations et `nextCursor`, nul en fin de liste.
- GET `/api/conversations/:id?limit=200` : derniers événements et métadonnées.
- GET du même fil avec `before=<eventId>` : page précédente.
- GET du même fil avec `after=<eventId>` : nouveautés, éventuellement plusieurs pages.

100/200 sont des tailles de page par défaut, pas des plafonds d’historique. `limit`
est un entier positif configurable par requête. Les anciens consommateurs sans
paramètre reçoivent toujours un instantané récent. Les mutations gardent ce format.

## Projection d’affichage

`app/conversation-view.ts` consomme les événements dans l’ordre et ne garde que les
compteurs, l’usage de contexte, l’inventaire du dernier run, les formulaires et les
preuves de récupération. `RecoveryTracker` partage le calcul incrémental avec
`recoveryPlan` ; aucun résultat d’outil ou corps de message ordinaire n’est gardé.
L’audit privé des fichiers a sa propre projection et ne rejoint pas le modèle.

Au premier accès après redémarrage/éviction, les métadonnées exigent encore un
parcours complet du journal, par pages de 500, sans tableau intégral en mémoire.
Ensuite seuls les ajouts sont lus. Les lectures simultanées d’une projection
partagent sa reconstruction. Cache LRU de 64 projections (32 paires fil/audit),
réglable via `Conversations.viewCacheSize`. Ce budget de cache ne limite aucun fil.
Une projection évincée se reconstruit depuis la base ; aucune donnée persistante
n’est supprimée. Un stockage custom/JSON sans `page` garde un repli explicite vers
`read` et ne bénéficie pas de la même optimisation SQL.

## Navigateur

`history.js` gère une seule fenêtre privée en mémoire. Il fusionne les pages sans
doublon, conserve les anciens messages chargés et protège les métadonnées contre
les réponses de révision antérieure. Une réponse de mutation sans recouvrement
avec la fenêtre provoque un rattrapage par delta avant fusion, pour éviter un trou.
Changement de fil : nouvelle fenêtre ; déconnexion : purge. Les brouillons par fil
restent gérés par le chat existant, sans cache disque des conversations.

Le chat charge automatiquement les précédents lorsque l’utilisateur remonte à
moins de 160 px du début. Aucun bouton permanent ni ligne réservée : chargement
discret en surimpression, sans changer la hauteur de lecture. Écoute scroll passive,
un seul appel en cours, aucune minuterie supplémentaire. Une page trop courte ou
faite d’événements invisibles est complétée jusqu’à remplir la vue. Erreur : arrêt
du chargement automatique et Réessayer explicite, sans boucle réseau. Fin du fil :
aucun autre appel. Les callbacks d’un ancien fil sont ignorés. La liste conserve
Plus de conversations avec retour de chargement. L’ouverture directe d’un UUID ne dépend plus de sa présence dans
la première page du catalogue. Recherche/projet s’appliquent au stockage complet.
Le suivi reste un polling actif/visible à une seconde, désormais par curseur.
Le rendu réconcilie les nœuds dans l’ordre : bulles, dates, détails et formulaires
inchangés restent attachés ; le prepend conserve l’ancre de lecture.

## Qualification et limites

[Preuves SQL/delta](qualification/history/README.md) et [chargement automatique](qualification/history-auto/README.md) : suite SQL commune sur les deux moteurs,
parcours navigateur avec brouillon/formulaire/détails/ancre, et volume isolé sur
nora-tests : 1 205 messages, 125 conversations, parcours complet et delta 0/1 événement.
Les tailles du rapport volume concernent la page d’événements, hors métadonnées HTTP.

Pas de streaming final, de virtualisation du DOM ou de projection SQL matérialisée.
Les pages ouvertes restent en mémoire navigateur ; un très grand nombre de pages
chargées augmente donc le DOM. Le moteur lit encore son propre contexte selon ses
contrats. Téléphones physiques et démarrage à froid de journaux massifs restent à
mesurer ; ces preuves ne sont pas un facteur global d’accélération de l’application.
