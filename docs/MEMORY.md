# Mémoire structurée

Le web utilise `modules/memory/structured` derrière un repository interchangeable. Le module `basic` reste disponible
pour les démos et les configurations existantes. Les deux consomment des
contrats ; ni le core, ni les règles mémoire ne dépendent de PostgreSQL.

## Portée et identité

Un souvenir possède UUID, titre, contenu entier, type (`fact`, `preference`,
`constraint`, `decision`), portée, statut, version, provenance et dates.

- Personnel : accessible dans tous les fils du propriétaire.
- Projet : accessible uniquement dans les conversations de ce projet, en plus
  des souvenirs personnels.

Les projets métier sont créés/gérés par le MCP Projets, depuis la vue Projets ou
les outils approuvés. Leur UUID distant stable sert à la portée mémoire, jamais
leur titre ou le nom du dossier. Seuls les artefacts physiques sont locaux. Le
projet du fil reste fixe après création ; les anciens fils restent personnels.
Voir [PROJECTS.md](PROJECTS.md).

La mémoire de l’installation gérée utilise le MCP Mémoire, sans double écriture
ni repli SQL implicite. Les modules SQL restent interchangeables pour les
assemblages explicites et tests ; ils ne décrivent pas l’autorité en production.

## Contrats et assemblage

`MemoryService` conserve `remember` et `search`, avec titre/version optionnels
sur les résultats. `StructuredMemoryService` ajoute création enrichie, lecture,
correction, changement de statut et versions. `StructuredMemoryRepository`
porte la persistance atomique ; aucun SQL dans `memory/structured`.

`app/web-conversations.ts` compose un service limité à la portée du fil et des
outils `tools/memory-structured`. Le core reçoit les mêmes contrats Engine,
ContextManager et Tool. Les outils n’importent aucune mémoire concrète.
L’administration propriétaire utilise le même service avec une vue de toutes
les portées, via `app/memories.ts`.

La CLI accepte `modules.memory: "structured"` avec PostgreSQL ; sa portée est
personnelle. Le stockage JSON de démo ne fournit pas ce repository et est refusé
avant toute création de fichier. Choisir `basic` conserve le mode existant.
Aucune nouvelle dépendance npm ni reprise de code externe dans cette étape.

## Écriture et versions

Titre : 160 caractères ; contenu : 4000. Chaque mise à jour/oubli/restauration
exige la version lue. L’UPDATE compare cette version, incrémente le compteur et
insère la révision dans la même transaction. Un éditeur ancien reçoit un conflit
et ne remplace pas la correction de l’autre. L’historique des versions conserve
le contenu et la provenance (`manual`, `conversation` avec UUID du fil, `legacy`).
La provenance affichée sur la fiche est celle de sa dernière version.

Une création de contenu identique déduplique atomiquement dans la même portée
et le même projet parmi les souvenirs actifs. Elle retourne l’ID existant sans
modifier ses métadonnées : corriger explicitement pour changer titre/type.
Un contenu identique dans deux projets reste deux souvenirs indépendants.
Après oubli, une nouvelle création peut produire un autre ID. Restaurer l’ancien
souvenir est alors refusé tant qu’un doublon actif existe dans cette portée.

Dans les repositories SQL explicites, l’oubli passe à `forgotten` et peut être
restauré. Dans le MCP actif, l’oubli supprime physiquement le souvenir et ses
révisions actives ; aucune restauration native. Cette capacité est annoncée dans
l’interface et les outils. Ni l’un ni l’autre n’efface les messages ou points
de reprise historiques déjà écrits.
Une correction fraîche sélectionnée est présentée comme version courante ; les
anciens échanges peuvent toujours contenir des valeurs historiques.

Les outils demandent de ne conserver que des faits durables établis, hors
secrets. Le service refuse plusieurs formats de credentials évidents (clé
privée, certaines clés API, bearer, JWT) ; ce filtre ciblé n’est pas un détecteur
universel et n’autorise pas à déposer des secrets dans les prompts.

## Décision de mémoriser dans une conversation

`app/memory-instructions.ts` rappelle l’initiative sur les faits durables utiles,
les doublons, les refus et la confirmation après réussite. Cette consigne seule
ayant manqué un fait inclus dans une question, le web compose maintenant
`modules/memory/review` avec la mémoire de portée courante.

`app/memory-policy.ts` définit la politique par défaut d’initiative/consentement, incluse
par les consignes principales et injectée dans le constructeur de `MemoryReview`
par l’assemblage. Le module n’importe pas app et ne construit pas un autre module.
Une donnée personnelle n’est pas automatiquement sensible : prénom/lien d’un
proche, métier, préférences et autres faits ordinaires stables utiles se conservent
sans formulaire supplémentaire lorsqu’ils sont établis directement par l’utilisateur.
Ne pas inférer d’autres détails à partir du lien familial. Une sensibilité réelle
(santé, vie intime, convictions, difficultés financières privées, conflit intime),
une ambiguïté ou une demande de confidentialité peuvent justifier un accord.
Un refus reste prioritaire ; une information sans intérêt durable est ignorée,
sans déléguer systématiquement ce tri à l’utilisateur. La même règle est donnée
aux deux appels pour éviter des politiques contradictoires. Aucune whitelist de
prénoms, regex de parenté ou nouvelle passe LLM n’est ajoutée.
[Qualification réelle](qualification/memory-consent/live-chatgpt.json) : sept cas
avec le même modèle, dont trois liens ordinaires sans formulaire et un cas de santé
nécessitant un accord. Le succès reste celui de ce modèle/parcours, pas une garantie
sémantique universelle. `tests/memory-consent-policy.test.ts` vérifie uniquement que
les deux étapes reçoivent la même politique, séparément de cette preuve réelle.

Le moteur accepte un petit contrat optionnel `CompletionReview` : nom, message
d’échec et méthode de revue ; le core n’impose aucune règle de mémoire. Lors de la première
réponse sans outil, avant de publier cette réponse et clôturer le run, la revue
mémoire reçoit le cerveau sélectionné, le contexte de requête et le brouillon.
Elle consulte les souvenirs pertinents et demande au même cerveau une décision
JSON Schema via une déclaration d’outil réservée à cette revue :

- `remember` : fait durable nouveau établi par le message humain ;
- `update` : fait modifié, avec ID/version d’un souvenir actif retrouvé ;
- `known` : fait déjà conservé, sans réécriture ;
- `forget` : demande explicite d’oubli, avec ID/version actuels ;
- `none` : rien de durable utile, fait temporaire ou refus ;
- `confirm` : accord ou précision nécessaires avant conservation.

La revue distingue le fait stable de la tâche immédiate : une date de naissance
reste utile même si le message demande un âge, qui change avec le temps. Elle
respecte les refus, n’extrait pas un fait personnel d’un document ou d’un résultat
web, exclut les secrets et demande un accord pour les données sensibles/ambiguës.
Les déclarations sont des données, pas des instructions de revue. Une écriture
exige une citation exacte du message humain ; cela vérifie sa provenance textuelle,
pas sa vérité ou toute sa sémantique. Les détails cités/fictifs restent à distinguer
par le modèle. Aucun détecteur universel de pertinence ou de sensibilité n’est garanti.

Le résultat est validé avec Ajv et les schémas des outils réellement autorisés.
Les mises à jour doivent viser un ID/version retrouvés et la portée projet courante.
Les doublons textuels déjà retrouvés n’émettent pas d’appel supplémentaire. Les
effets proposés retournent dans la boucle normale : permissions, journal,
comparaison de version, validation des secrets et cartes existantes s’appliquent.
Le module n’exécute aucun outil et ne dépend d’aucun stockage ou fournisseur concret.
`confirm` passe par le formulaire existant ; aucune autre écriture préparée dans
ce lot n’est exécutée avant la réponse humaine. Pas d’oubli sans demande explicite ni restauration automatique.

Un événement `run.progress` de `kind: review` consigne statut et catégories de
décision, sans citation ni raisonnement privé ; il ne devient pas une bulle de chat.
Seuls les résultats réussis des outils confirment une sauvegarde. Après ses effets, la revue relit le stockage sans nouvelle inférence ;
un seul bilan final est publié.
Si elle échoue, renvoie une promesse sans décision ou dépasse le budget de contexte,
le brouillon est retenu et une reprise primaire demande une réponse honnête sur
les opérations non confirmées ; aucun diagnostic brut fournisseur n’est journalisé. Une annulation n’est pas transformée en réussite.

Coût/portée : un appel au même modèle par tour terminé, hors démo et modèle sans
outils ; un retour modèle après écriture comme pour tout outil. Le message humain,
le précédent message assistant, le brouillon, les souvenirs pertinents et les seuls
reçus mémoire/réponses de formulaire du tour sont envoyés ; aucun historique complet,
fichier, image ou retour web brut. Aucune troncature silencieuse pour faire rentrer
la revue : un dépassement est signalé. Les tailles restent dépendantes du message,
du brouillon et des souvenirs retrouvés. Pas de revue pendant une attente humaine,
après annulation ou dans la démo CLI. Pas de traitement rétroactif des échanges.

`tests/memory-review.test.ts` et `tests/completion-review.test.ts` qualifient les
refus structurels, versions, séparation des effets, permissions, annulation et
échec visible. Les cinq identités fournisseur simulées testent le raccordement,
pas leur jugement réel. [Qualification réelle ChatGPT](qualification/memory-review/live-chatgpt.json)
: cinq scénarios, dont une écriture déclenchée par la revue après oubli initial.
[Parcours Chromium](qualification/memory-review/browser.json) : résultat persistant,
carte, ouverture et rechargement. Les autres fournisseurs restent à qualifier en réel.

## Recherche et économie de contexte

Le module prépare les termes Unicode, retire les mots courants français et
cherche des candidats actifs dans la portée autorisée. Le repository filtre
par présence littérale d’au moins un terme, sans plafond de candidats par défaut. Le module classe les correspondances titre/contenu et retourne au plus
12 résultats déterministes par défaut. Ces valeurs et le nombre de termes
(défaut 16) sont configurables, 0 sans plafond, voir [POLICIES.md](POLICIES.md). Pas d’embeddings, de recherche sémantique ni d’appel
LLM pour cette sélection. Le classement peut manquer une paraphrase ou un
souvenir ancien ; il ne prétend pas être exhaustif.

Le constructeur de contexte utilise le dernier sujet développé, conservé pour
« continue ». Les souvenirs entiers sont injectés selon le budget restant du modèle,
sans plafond fixe par défaut et sans doublon avec le contexte disponible. ID/version accompagnent la sélection.
Un souvenir trop long peut être présenté par titre et référence, avec instruction
de consulter `memory.get` avant de conclure : sa contrainte n’est pas coupée.
La sélection est relue avant chaque appel, donc une correction ou un oubli
modifie les résultats suivants sans compteur « déjà envoyé » permanent.

Ces deux limites d’injection sont configurables, 0 sans plafond.

`memory.search` renvoie les résultats du service selon la limite configurée, avec contenu entier s’il
fait au plus 700 caractères ; sinon il indique `detailsAvailable`. `memory.get`
permet la lecture complète des souvenirs actifs, avec portée et version. Un
identifiant ancien ne permet plus à cet outil de lire un souvenir oublié.
La lecture du service administratif conserve les oubliés pour l’historique et
la restauration ; cette possibilité n’est pas exposée par `memory.get`. Les outils `remember`,
`update`, `forget` et `restore` restent soumis à `memory.write` dans le core.
Un outil disponible ne constitue pas une autorisation de mémoriser une supposition.

## Interface et API

Le panneau Mémoire permet ajout, filtre local, correction, oubli/restauration et
consultation des versions. Il affiche au plus 200 souvenirs récents, oubliés
compris côté API ; le filtre « Afficher les oubliés » n’est pas une pagination.

| Route privée | Effet |
| --- | --- |
| GET `/api/memories` | Souvenirs et catalogue des projets. |
| POST `/api/projects` | Créer un projet avec `title`. |
| POST `/api/memories` | Créer avec titre, contenu, type et portée/projet. |
| POST `/api/memories/:id` | Corriger, en fournissant `version`. |
| POST `/api/memories/:id/status` | Oublier/restaurer avec `version` et `status`. |
| GET `/api/memories/:id/revisions` | Versions et provenance. |

Session propriétaire obligatoire, et origine/CSRF pour les mutations. Aucune
inférence pendant la gestion manuelle, aucune clé API exposée.

## Migration et vérification

La migration 003 enrichit uniquement la base Heart : anciens IDs et contenus
conservés, portée personnelle, statut actif, provenance legacy et première
révision créée. Les migrations 001/002 restent inchangées. Les repositories basic
ne recherchent plus que les souvenirs personnels actifs ; ils partagent la même
déduplication et journalisent aussi les nouvelles créations.

Tests avec fournisseurs/répertoires simulés : portées, provenance, versions,
conflits, oubli/restauration, références longues et réévaluation du contexte.
PostgreSQL jetable : course de déduplication, UPDATE concurrent, restauration en
conflit, migration depuis une base v2 peuplée et dump/restore des révisions/projets.
Chromium local : tout le parcours de gestion, rechargement et mobile.

Les blocs mémoire, consentement et revue sont visibles et modifiables dans
Instructions. Les surcharges du profil remplacent les défauts au prochain run ;
la même politique effective est passée au principal et à la revue. Le reset retire
la surcharge ; les validations des outils et versions restent exécutées par le
harness. [Contrat de configuration](INSTRUCTIONS.md).


## Repository MCP indépendant

L’adaptateur mcp-memory est livré, testé et actif. Jérôme choisit de commencer
vide : les trois souvenirs locaux ne sont pas transférés et restent archivés
dans leur base d’origine, hors mémoire active.
Il conserve les règles de portée/provenance/concurrence et retire la restauration
quand le serveur la déclare indisponible. Oubli distant : suppression des révisions
actives, contrairement à l’oubli local réversible. Les anciennes versions locales
et conversations restent conservées. [Bascule explicite et limites](NORA-MCPS.md).


## Historique et preuve de sauvegarde

Une ancienne réponse ou un ancien reçu ne prouve pas qu’un souvenir existe encore
dans le backend actif. Le contexte signale une recherche sans résultat, sans la
présenter comme une base vide. Pour une demande générale, query vide dans memory.search
liste les actifs dans la portée courante et respecte la limite de résultats choisie.
Cette énumération explicite n’est pas injectée automatiquement à chaque message.

La revue reçoit les lectures mémoire du tour et l’inventaire primaire. Elle peut
fournir memoryCorrection (citation du brouillon + défaut de preuve) pour demander
une révision. Son texte ne remplace jamais directement la réponse ; le modèle
principal répond à nouveau avec ses outils et résultats effectifs. Ce cas ajoute
un appel primaire, sans seconde revue. Les anciennes confirmations ne deviennent pas une
source autorisant une écriture. La vue Mémoire recharge à l’entrée, sans polling.

Incident du 20 novembre : date seule écrite, trois faits anciens présentés à tort
comme déjà mémorisés. Faits demandés réenregistrés via l’API Heart : quatre souvenirs
visibles ; date existante intacte, aucun import technique des anciens enregistrements.
Tests de contexte, recherche vide bornée, correction et parcours navigateur passent.
Qualification GPT‑6 Luna réelle après suppression d’une note QA : le faux reçu de
l’historique n’est pas confirmé, réponse corrigée. [Preuves](qualification/memory-state/).

Les anciens résultats d’outils mémoire sont transmis comme historiques, sans
contenu ni statut actif ; la source du journal demeure intacte. La revue exige
id/version pour known et relit chaque référence distincte via le service courant.
Une référence absente, oubliée ou obsolète invalide la revue ; son échec retient
le brouillon au lieu d’en publier les affirmations avec un avertissement. Un état
explicite est transmis au modèle principal pour reprendre la réponse normale ;
aucune action déjà réussie n’est annulée. Coût :
une lecture par référence distincte confirmée, aucun appel LLM pour cette relecture de référence. Une correction de réponse
ajoute en revanche un appel primaire. La sélection
sémantique des affirmations reste effectuée par le modèle, les contrôles de version
et d’échec par le code. Les règles s’appliquent aussi aux stockages locaux.

Une revue indisponible ne devient plus à elle seule la réponse utilisateur : le
mode revise conserve le brouillon hors journal puis fait reprendre le modèle
principal avec son inventaire, les reçus et le défaut de vérification. Il ne peut
pas annoncer une sauvegarde sans résultat vérifié. Ce chemin ajoute un appel
primaire, pas une seconde revue. L’audit contient un code sûr, jamais la réponse
brute du fournisseur ni les valeurs des souvenirs.

## Injection et continuité

Recherche sans nouvelle inférence avant chaque préparation. Une précision courte
reste prioritaire dans la requête, avec le sujet précédent si nécessaire. Un fait
déjà présent ne répète pas son corps, mais conserve la référence/version active
relue. Correction/oubli sont donc distingués du texte historique. Les anciens
reçus ne prouvent pas le stockage actuel ; les versions doivent être relues avant
confirmation. Une panne de recherche est signalée comme indisponibilité, jamais
comme mémoire vide, et ne bloque pas les travaux indépendants.

Après compression : identité, consignes, outils et skills actifs restent présents,
la fiche projet est actuelle à sa date de lecture et les souvenirs actifs sont
réinjectés selon le budget. Résumé et mémoire durable restent séparés. Voir
[CONTEXT.md](CONTEXT.md) et [INSTRUCTIONS.md](INSTRUCTIONS.md).


## Écritures contrôlées par Heart

Le suivi mémoire appartient au harness ; le MCP reste l’autorité des données.
Une décision de revue peut rattraper une création/correction omise par le modèle
principal ou une demande explicite d’oubli non exécutée. Les outils passent par
les permissions, schémas et versions existants. Aucun SQL/client MCP ni règle par
mots-clés dans le module de revue ; consentement et secrets restent inchangés.

La revue utilise les reçus mémoire/réponses de formulaire canoniques du tour,
même si le contexte principal les a comprimés. Aucun fichier/web/image brut ni
argument transitoire ajouté. Elle relit aussi les écritures réussies du modèle
principal ; si le même souvenir a été modifié plusieurs fois dans le tour, seule
sa dernière mutation réussie est comparée. Après les écritures qu’elle propose,
verifyAfterTools déclenche une relecture des ID/version/statut/champs actuels,
sans deuxième appel d’évaluation LLM. La portée projet est dérivée du fil comme
pour les outils, sans argument projectId inexistant à demander au cerveau.

Un oubli SQL est confirmé par le statut forgotten ; une suppression MCP par un
reçu réussi puis l’absence typée du même ID. MemoryNotFoundError distingue cette
absence d’une panne réseau/base ; un timeout n’est jamais une preuve d’oubli.
Une version concurrente ne doit pas être écrasée : la confirmation est refusée
et le modèle principal reprend pour expliquer le résultat réellement vérifiable,
sans rejeu automatique. Les écritures de plusieurs souvenirs ne sont pas atomiques.
Les propositions restent éphémères ; journal/reçus existants et MCP font autorité.

La décision ajoute toujours normalement un seul appel modèle ; la vérification
ajoute des lectures de stockage, pas d’inférence. Plus de plafond fixe de 16
décisions dans le schéma de revue ; le budget de contexte reste contrôlé, sans
troncature silencieuse. La sélection lexicale des candidats et le jugement LLM
restent des limites : aucun mécanisme n’assure une pertinence sémantique parfaite.
Les instructions de revue restent visibles/modifiables/resettable dans le bloc
existant memoryReview ; aucun nouveau bloc ni service à configurer.
