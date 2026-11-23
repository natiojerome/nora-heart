# Économies de contexte — premier lot

Le comportement de référence reste le défaut. Aucun plafond de données ni
compression sémantique supplémentaire. Mémoire proactive et suivi projets restent
contrôlés à chaque tour selon leurs règles et autorisations existantes.

## Utilisation

Dans un fil : Réglages → Contexte et mémoire → Économies de contexte · essai.
Deux switches indépendants, initialement désactivés : mesurer les appels et
dédupliquer la revue projet (seulement si le fil appartient à un projet).
Choix par UUID de conversation et onglet navigateur, dans sessionStorage ;
ils survivent au rechargement de cet onglet et sont appliqués au prochain envoi.
Les couper rétablit le chemin de référence au prochain envoi, sans redémarrage.
Aucune modification des préférences serveur ou d’une autre conversation.
Le serveur annonce la compatibilité avant le chargement paresseux du panneau.

API propriétaire : champ optionnel de POST /api/conversations/:id/messages :

```json
{"contextExperiments":{"measureRequests":true,"compactProjectReview":true}}
```

L’absence du champ conserve la référence. Une reprise de formulaire hérite du
choix du tour initial enregistré dans run.started ; une nouvelle demande API
sans options revient aux défauts. Tâches planifiées inchangées. Aucun outil ne
peut modifier ces options à la place de l’utilisateur.

## Mesures

run.progress de kind model-usage : appel principal/compression/revue nommée,
statut, durée et compteurs d’entrée/sortie estimés. Répartition en octets UTF-8 :
instructions, schémas d’outils, messages utilisateur/assistant, arguments et
résultats d’outils, pièces jointes texte décodées. Médias séparés, sans inventer
leur coût fournisseur. Estimation texte : octets/3 ; ni tokenizer exact, ni
crédits facturés, ni lecture du cache fournisseur. Aucun contenu, prompt ou secret
copié dans ces compteurs. Ils ne produisent aucune bulle de chat.

La mesure est opt-in. Le tag purpose est ajouté après la préparation/budgétisation
et n’est pas sérialisé vers les fournisseurs par leurs adaptateurs : ni consigne
supplémentaire ni modification des seuils de compression de référence.

## Déduplication réversible de la revue

modules/context/exact-references transforme seulement le JSON de données de
ProjectReview. Les longs textes identiques sont présents une fois dans un dictionnaire,
avec des références explicites. Rôles, ordre, champs, contraintes, versions et
preuves restent reconstructibles à l’identique, y compris en cas de collision
avec les clés réservées. Aucun résumé ni extraction par mots-clés. La taille est
comparée au JSON original : sans économie, le module rend l’original inchangé.

Le module projets reçoit une fonction d’encodage injectée par app ; il ne dépend
pas du module de contexte concret. Aucun nouveau client MCP, SQL, worker ou SDK.
Les décisions/écritures et leur relecture restent celles de ProjectReview.
Le journal canonique, les résumés et la revue mémoire ne sont pas compactés ainsi.

## Preuves et limites

330 tests pnpm check et démo SDK ; parcours Chromium ciblés pour chat, instructions
et mémoire avec choix de mesure, persistance par onglet, désactivation et absence
de lignes techniques/vides. Régression de reprise de formulaire et retour au défaut.

Luna réel : 9 inférences, un point de reprise réellement généré, deux scénarios
projet en A/B (consultation sans changement, progression avec preuve et maintien
du projet global ouvert), mémoire proactive enregistrée puis relue dans les deux
modes. Frontière Projets et repository mémoire simulés/temporaire ; aucune donnée
propriétaire touchée, ce parcours ne requalifie pas les MCP distants. Première
réponse principale volontairement omise dans le contrôle mémoire ; revues et
réponses suivantes réelles. Un essai direct préalable avait échoué sur une réponse
fournisseur incompatible ; le parcours final passe par le moteur et sa récupération.

Sur ce jeu riche en observations répétées : entrées estimées 28 752 → 13 282,
soit 53,8 % de réduction pour les appels comparés ; résumé partagé de 1 415 tokens
estimés séparé. Latence et sorties détaillées dans la preuve. Ces chiffres ne
prédisent ni le gain quotidien ni une réduction équivalente de facturation.
Le format référencé peut être moins bien compris par d’autres modèles : qualifier
avant généralisation. Les originaux récupérables ne garantissent pas à eux seuls
une compréhension parfaite ; comparer les résultats fonctionnels reste nécessaire.

[Rapport synthétique Luna](qualification/context-economy/luna.json).
Catalogue dynamique, nouvelles synthèses sémantiques et cache fournisseur restent
hors de ce premier lot. Aucun changement automatique des conversations existantes.


Version en service avec les options désactivées : contrôles de production en
lecture seule aux quatre largeurs, profil et instructions conservés. Référence,
jalon de code et sauvegarde complète chiffrés ; restauration Git de référence+
incrément et PostgreSQL isolé vérifiés. Voir STATUS/TESTING pour les identifiants.
