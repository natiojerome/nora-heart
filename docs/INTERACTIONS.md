# Formulaires interactifs dans le chat

Le module `modules/tools/interactions` propose `interactions.request_input` aux
cerveaux capables d’appeler des outils. Permissions `user.input` indépendante des
fichiers et de YOLO : une information utilisateur manquante reste à recueillir,
même lorsque les outils d’administration sont autorisés sans confirmation.

Référence de comportement : Nora `NoraInteractionTools` et `InteractionPrompt`,
révision ecb473c8156be912a1b0ad4be764ae37b56e4821, inspectés en lecture seule.
Implémentation propre à Heart, sans composant React, donnée ou runtime importé.
Aucune dépendance ajoutée ; contrat JSON neutre et assemblage explicite dans app.

## Réponse humaine avant action dépendante

Les appels encore non exécutés après la question sont clôturés sans effet dans
la même transaction que la réponse. Le modèle reçoit cette réponse avant de
proposer de nouvelles actions. Les droits courants s’appliquent aux nouvelles
propositions et les effets précédant la question ne sont pas rejoués.
[Qualification réelle A/B](qualification/interactions/2026-11-17-replan.json).

## Parcours

1. Le modèle appelle l’outil avec titre, questions et identifiants stables.
2. L’outil valide les questions ; le core enregistre `interaction.requested` et
   rend la main. Aucun appel LLM ni timer d’attente pendant la décision humaine.
   Le formulaire reste disponible après rechargement ou reprise applicative.
3. Une question single obligatoire seule présente des boutons qui répondent en un toucher.
   Un mini-formulaire regroupe radios, cases multiples et champs texte ; contraintes
   de sélection et longueur facultatives, validation explicite et erreurs locales.
4. La réponse et le résultat d’outil sont enregistrés atomiquement, avant reprise
   du modèle. Les outils déjà exécutés ne sont pas rejoués. Les autres appels du
   lot suspendu sont marqués non exécutés : le choix humain peut invalider leur
   préparation. Une nouvelle inférence précède toute action suivante.
5. Le formulaire devient un récapitulatif des réponses ; le modèle reçoit leur
   JSON structuré comme résultat du même appel d’outil. Aucun message utilisateur
   artificiel ni seconde question répétée dans le prompt.

Annuler enregistre la clôture de la demande et les résultats d’annulation des
appels restants du lot. Aucun nouveau LLM ni outil dépendant n’est exécuté. Les
éventuelles actions ou commandes déjà démarrées restent conservées : annuler un
formulaire n’annule pas rétroactivement leurs effets. Un nouveau message peut
ensuite reprendre la conversation. Changer de fil laisse la demande dans son fil.

Le composeur et la relance des bulles attendent réponse/annulation ; un brouillon
peut être préparé. Le modèle et les permissions restent modifiables entre runs :
la continuation utilise la sélection et les droits courants. Annuler ne demande
pas de connexion fournisseur disponible. Les réponses déjà envoyées restent
reconnues : même soumission normalisée = aucune seconde inférence, autre réponse
sur une demande résolue = conflit. Demande inconnue ou autre fil = refus.

## Contrats et code

- `contracts/interactions.ts` : InputRequest, InputResponse, Interaction/ResumeInput.
- `contracts/tools.ts` : Tool générique, texte par défaut ; l’outil interactif
  retourne un InputRequest et valide la réponse via resolveInput. Pas de type SDK.
- `core/interactions.ts` : reconstitution de l’état depuis le journal immuable.
- `core/engine.ts` : pause, résolution, invalidation du reste du lot et contrôle des droits.
- `modules/tools/interactions/index.ts` : définitions, validation et normalisation
  des réponses ; aucune base ou autre implémentation importée.
- `app/conversations.ts` : service et route de réponse du fil ; composition web
  explicite dans app/web-conversations.ts. Pas d’ajout implicite à la démo CLI.
- `chat-interactions.js/css` : rendu natif, contrôles partagés, état d’envoi et
  spinner, erreurs locales, récapitulatif et restitution de la demande.

Format de questions : single, multiple ou text ; id/label, description et required
facultatifs, options id/label/description pour les choix. Texte : placeholder et
maxLength facultatifs. Multiple : minSelections/maxSelections facultatifs. Pas
exactement la même API que Nora, pas un standard universel : DTO Heart en JSON,
avec champs familiers et schémas JSON pour les outils. Pas de limite arbitraire
fixe sur le nombre de questions ou la longueur d’un texte ; le modèle doit rester
concis. L’API authentifiée lit les réponses JSON ; les contraintes d’une question
sont explicites et le budget réel du modèle reste applicable à la reprise.
Ne jamais demander de credentials ou de secrets dans ces formulaires. Un choix
utilisateur ne modifie pas les permissions techniques et n’active pas YOLO.

Réponse propriétaire : POST `/api/conversations/:id/interactions/:requestId`,
origine/session/CSRF obligatoires, corps `{status:"answered",answers:{...}}` ou
`{status:"cancelled",answers:{}}`. Choix unique = id, multiple = liste d’ids,
texte = chaîne. Les réponses multiples sont triées pour une comparaison stable.
GET du fil expose interactions et pendingInput, indépendamment des 500 derniers
événements affichés : une demande en attente ne disparaît pas avec cette fenêtre.
Les drafts non envoyés restent en mémoire navigateur ; la demande et les réponses
validées sont durables. Ils ne deviennent pas des souvenirs automatiquement.

## Persistance et reprise

Migration additive 010 : ajout de deux types d’événements à la contrainte SQL,
sans autre table ou modification de données existantes. Les migrations 001–009
restent inchangées. SessionStore.appendBatch fournit l’atomicité nécessaire à la
résolution : PostgreSQL par transaction et verrou de session ; JSON de démo par
remplacement atomique du journal, en mode mono-processus uniquement.

La pause libère le claim. Si le processus meurt entre l’écriture durable de la
pause/annulation et cette libération, PostgreSQL peut acquérir le claim puisque
ce marqueur prouve que l’ancien run n’exécutera plus d’action. Aucun délai/TTL,
rejeu de l’appel ou reprise automatique d’un run ordinaire interrompu. Après une
réponse acquittée, un crash durant de nouvelles actions garde les règles existantes
de réconciliation. Les réponses restent dans le journal, jamais perdues en faveur
d’une reprise aveugle. Une panne après résolution peut conserver une réponse
acceptée sans réponse finale du modèle ; le récapitulatif reste visible.

## Vérifications

Cinq tests dédiés couvrent choix B contre action A préparée, effet B proposé
ensuite une seule fois, conservation des effets précédents, droits retirés après
pause, annulation, plusieurs questions et idempotence. Les 21 tests PostgreSQL
couvrent aussi la résolution et les actions réévaluées avec redémarrage, atomicité
et claim. Le parcours navigateur simule désormais une nouvelle proposition après
la réponse, au lieu d’attendre l’exécution implicite du reste du lot.

[Essai réel ChatGPT](qualification/interactions/2026-11-17-replan.json) :
GPT-6.1 Sol medium, trois appels via abonnement. Premier lot réel : question puis
création A préparée ; pause, rechargement navigateur, choix B, proposition de
création B et fin. A absent, B présent. JSON temporaire, aucun fichier/fil/souvenir
propriétaire modifié. PostgreSQL qualifié séparément ; pas de parité universelle
inférée pour tous les fournisseurs/modèles.

## Fournisseurs API et échecs après réponse

[Qualification Gemma/OpenRouter](qualification/interactions/2026-11-17-openrouter.json) :
parcours réel via navigateur/HTTP/core, deux appels, rechargement en pause et
reprise unique après réponse. Aucun fil propriétaire modifié. Les essais expirés
ou non concluants sont mentionnés séparément ; la cause du premier échec
propriétaire demeure indéterminée, son diagnostic étant auparavant générique.

Le web n’impose plus 1024 tokens aux modèles API : le fournisseur/SDK applique
ses valeurs par défaut. Les plafonds explicitement configurés restent fonctionnels.
Une sortie tronquée n’exécute aucun appel d’outil partiel. Le chat affiche une
raison sûre et persistante (API, format, troncature, vide ou outil invalide).
Si la réponse utilisateur a déjà été acceptée, le formulaire reste résolu :
ne pas renvoyer les choix pour rejouer une action. Un nouveau message « Continue »
reprend avec l’historique et la réponse enregistrée, suivant les règles ordinaires
sur les actions interrompues. Aucun retry automatique ni substitution de modèle.
Le parcours navigateur couvre aussi ce cas d’échec après validation et son rechargement.
