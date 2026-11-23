# Contexte conversationnel et mémoire active

Le module `modules/context/bounded` est raccordé aux conversations persistantes
web. Il reçoit des contrats neutres ; aucun SDK de fournisseur ou SQL ne se
trouve dans ce module. Les CLI et essais temporaires conservent leur assemblage
initial sans gestion de contexte. Voir [CONVERSATIONS.md](CONVERSATIONS.md).

## Données distinctes

- Le journal durable conserve les messages et résultats d’outils originaux.
- Le point de reprise versionné conserve le travail d’une conversation ; il ne
  devient pas automatiquement un souvenir personnel.
- La mémoire durable fournit des faits pertinents, indépendamment du cerveau.

## Budget et compression implémentés

Avant chaque appel de la boucle, le module recalcule la taille estimée du
contexte pour la capacité choisie. ChatGPT fournit `context_window` dans son
catalogue ; OpenRouter expose aussi une capacité adaptée depuis son catalogue.
Une capacité absente doit être configurée explicitement. Le comptage
est une estimation UTF-8 (`octets JSON / 3`, arrondis, plus 256 tokens de marge),
pas la mesure du tokenizer ou du fournisseur. Elle peut différer du coût réel ;
un tokenizer adapté et le suivi des tokens observés restent à ajouter.

Le budget utilisable est `capacité - réserve`. L’assemblage web réserve le plus
petit de 4096 tokens ou un quart de la fenêtre. Le seuil par défaut est **80 % du budget
utilisable**, configurable dans Configuration → Limites, avec place réservée pour sorties et outils. Une capacité inconnue
n’est jamais déduite du nom du modèle.

Le seuil déclenche une compression lorsqu’un ancien historique peut être résumé.
Il n’est pas un plafond dur : un tour indivisible qui tient encore dans le budget
utilisable reste accepté. Un résumé au-dessus du seuil est accepté s’il tient dans
ce budget. Les souvenirs sont ajustés à la place disponible. Si le tour courant seul dépasse ce budget, refuser
avant tout appel de résumé inutile.

Au seuil :

1. Conserver jusqu’à quatre tours utilisateur récents verbatim (réglables), selon
   la place disponible, avec leurs appels et résultats d’outils. Dans un long tour
   unique, conserver la demande active et le lot récent, puis résumer les anciens
   lots complets de ce même tour. Aucun effet déjà réalisé n’est rejoué.
2. Demander au modèle sélectionné un résumé adapté au budget cible, sans limite
   fixe de caractères par défaut : objectif, identifiants, dates, montants, décisions,
   contraintes avec exceptions, progression, questions ouvertes et résultats
   utiles ; conserver les incertitudes. Aucun outil dans l’appel de résumé.
3. Si le nouveau cerveau est plus petit, découper les échanges à résumer en
   morceaux compatibles avec sa fenêtre. Les lots normaux restent groupés ; un
   ancien lot ou checkpoint trop grand est paginé comme fragments de données
   inertes, jamais comme appels incomplets dans le protocole du fournisseur. Le
   nombre d’appels est réglable, sans plafond Heart par défaut ; le parcours
   des groupes est fini. Aucun retry ou repli payant.
4. Vérifier le résultat et le budget réduit, puis enregistrer atomiquement un
   événement `context.checkpoint` : version, UUID du segment, segment parent,
   résumé, modèle auteur et référence au dernier message couvert.
5. Après cet enregistrement seulement, envoyer instructions, résumé, souvenirs
   pertinents et tour récent au cerveau. L’UI garde le même fil et indique le
   nouveau segment. Aucun thread propriétaire de fournisseur n’est nécessaire.

L’historique reste intact. Au redémarrage, le point de reprise est relu et sa
référence source est contrôlée. Si le résumé, sa sauvegarde ou le budget échoue,
aucun contexte vide n’est envoyé. Une demande active ou le dernier lot nécessaire
qui dépasse à lui seul la capacité reste refusé explicitement ; pas de retrait
silencieux du contenu. Les anciens lots et checkpoints peuvent être fragmentés
pour la compression. Un checkpoint au milieu d’un lot incomplet est refusé.
Un changement de modèle sous le seuil conserve le contexte sans résumé forcé.

Le texte d’un résumé peut perdre des nuances malgré ces contrôles. Les tests
simulés valident les frontières, la continuité mécanique, les échecs et l’absence
de répétition d’outil ; ils ne prouvent pas la qualité d’une compression réelle.

## Mémoire active actuelle et évolution

La sélection structurée est déterministe, sans appel LLM supplémentaire.
Elle part du dernier message, y compris une correction courte, avec le sujet
précédent pour les suivis courts tels qu’un « continue ». Les candidats actifs sont limités aux souvenirs personnels
et au projet du fil, puis classés dans le module mémoire. Les faits entiers sont
injectés selon le budget réel restant, ID/version compris ; aucune contrainte
tronquée. Les plafonds fixes de nombre/caractères sont désactivés par défaut.
Un souvenir long est proposé par titre et référence à consulter via `memory.get`.
Ces deux limites sont configurables, 0 sans plafond, voir [POLICIES.md](POLICIES.md).
Le nombre de souvenirs limite les faits/références effectivement injectés :
les doublons et faits trop longs ignorés ne consomment pas de place.
Le corps déjà présent dans le résumé ou les messages conservés n’est pas répété ;
un souvenir versionné garde une courte référence active relue.

La sélection est relue avant chaque appel, y compris après réduction, correction,
oubli ou changement de modèle. Les versions courantes sont signalées ; le texte
historique reste conservé et peut contenir des faits anciens. Ce n’est pas un
effacement des anciens prompts. Voir [MEMORY.md](MEMORY.md) pour les limites.
La stabilité vient du classement déterministe, sans cache invalidable ni LLM.
Les souvenirs conservés dans le prompt coûtent toujours des tokens d’entrée.

Restent à améliorer : recherche par paraphrase, coût des recherches volumineuses,
mesures d’usage, cache avec invalidation si un besoin mesuré le justifie, qualité
des longs résumés. La recherche/injection reste distincte de la revue mémoire
post-tour par LLM, désormais raccordée et qualifiée sur les scénarios ciblés.

L’audit de `/projects/nora` et les comportements réutilisables sont dans
[NORA-REUSE.md](NORA-REUSE.md). Aucun code ni donnée de ce projet n’est importé.

## Pièces jointes

Le budget inclut leurs métadonnées et une estimation prudente supplémentaire :
8192 tokens par image, taille en octets/3 pour les documents. Ce n’est pas le
compteur réel du fournisseur. Les références des échanges résumés accompagnent
les appels de compression pour ne pas résumer silencieusement sans leur contenu.
Un document trop volumineux pour le modèle est refusé ; pas de retrait implicite.

## Qualification réelle

Le [parcours DeepSeek initial](OPENROUTER.md#deepseek-v4-flash-0731-choisi-par-le-propriétaire)
a validé résumé/checkpoint PostgreSQL et mémoire avec un seul modèle. Le
[parcours ChatGPT/DeepSeek](CONTINUITY.md) qualifie maintenant la bascule entre deux
fournisseurs réels, un budget réduit à 32 768, une vraie compression, réouverture,
document/fichier conservés et souvenirs corrigés/oubliés. La capacité native des
modèles reste distinguée de ce budget de test. Les archives de charge sont
synthétiques ; le résumé et les réponses sont réellement produits par les LLM.

Les tests simulés couvrent séparément erreurs de sauvegarde et autres bords. Pas
de promesse de qualité universelle des très longs résumés, autres paires ou médias.
Voir [STATUS.md](STATUS.md) pour la portée exacte.

## Guidances de skills

L’assemblage peut envelopper `BoundedContext` avec le contexte de skills de l’app.
Les skills effectivement chargés restent hors résumé, une seule copie par skill ;
les anciens résultats sont présentés comme reçus sans changer le journal ni les
indices du checkpoint. Désactiver un skill enlève sa guidance au tour suivant.
Le module de contexte et le core ne dépendent d’aucun catalogue concret. [SKILLS.md](SKILLS.md).

## Relire les originaux après compression

`history.read` donne au modèle les messages originaux du fil courant, avec leur
identifiant et date. Le point de reprise indique un curseur vers les échanges
résumés. Recherche littérale normalisée, pagination et anciens outils facultatifs ;
les résultats ne certifient aucun état courant. Les lectures sont transitoires pour
ne pas recopier les archives dans le journal. Aucun accès à un autre fil.
Voir [HISTORY.md](HISTORY.md). Un résumé peut omettre un détail : les originaux
restent récupérables, sans prétendre rendre toute compression sans perte.

## Protection et observabilité de la reprise

Le moteur fournit une projection dédiée à la compression, alignée sur les
positions canoniques : arguments/résultats des outils transitoires retirés et
images d’outils volatiles exclues. Les skills remplacent aussi leurs anciens
corps par des reçus dans cette projection. Seule la requête principale du tour
autorisé garde les résultats transitoires en RAM. Le checkpoint n’est validé
qu’après résumé, budget et append atomique ; aucune sauvegarde intermédiaire.
Le modèle peut néanmoins recopier un secret dans son texte libre : cette limite
reste celle des outils transitoires, pas une promesse d’invisibilité universelle.

La fiche projet est relue avant chaque préparation via le contrat ProjectTracking
de l’app. Les consignes personnalisées, le catalogue courant et les guidances
actives sont reconstruits hors résumé. Un ancien plan, catalogue ou reçu mémoire
reste historique ; les sources et versions courantes priment. Les droits du fil
ne sont pas élargis par cette reconstruction.

Les diagnostics `context.usage` incluent estimation, segment, messages couverts
et disponibilité/nombre de résultats mémoire. Aucun contenu mémoire ni prompt
complet journalisé à cet effet. Une recherche échouée est distincte d’un résultat
vide ; les travaux indépendants restent possibles. Erreurs de budget, historique
ou compression typées, sans leur substituer un faux problème fournisseur.

Pour une compression au milieu d’un tour, les nombres de résultats réussis/échoués
par outil déjà reçus sont reconstruits depuis le journal hors résumé. La demande
réinjectée ne justifie pas de rejouer une opération ; les originaux restent
consultables. Ces compteurs n’attestent pas de l’état métier/mémoire courant.
Les fiches Projets démarrent une lecture indépendante, pour ne pas rejoindre un
instantané commencé avant une écriture acquittée dans une autre conversation.


Le suivi est aussi vérifié avant la réponse finale : MemoryReview puis
ProjectReview, indépendants derrière CompletionReview. La revue projet dispose
des contraintes principales et des preuves du tour non perdues par compression ;
arguments/résultats transitoires retirés. Sa décision none/inspect/update ne remplace
pas la réponse métier et les effets repassent par le moteur avant relecture MCP.
Une demande de statut ne réécrit pas gratuitement la prochaine action. Si le
contexte de contrôle dépasse le budget, le moteur demande explicitement au modèle
principal de réconcilier le suivi avec les outils ; aucun appel trop grand ni
résumé improvisé des preuves. Voir [PROJECTS.md](PROJECTS.md).
