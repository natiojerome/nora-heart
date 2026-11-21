# Fournisseurs de modèles

`ModelProvider` reste un contrat propre au harness. Le core, les outils et les
sessions n’importent aucun type AI SDK. Le module `modules/models/ai-sdk` traduit
ce contrat vers AI SDK 7, OpenAI/Anthropic directs, OpenRouter ou Venice AI choisis explicitement.
Le module `demo` reste le choix par défaut, sans réseau ni clé.

## Parcours sans coût

Sous Node 24, `pnpm demo:sdk` lance le véritable adaptateur AI SDK avec un modèle
simulé : demande d’outil, exécution par le moteur, résultat puis réponse finale.
Les données sont temporaires et supprimées après la démo. `pnpm check` vérifie
aussi le changement de modèle avec historique, les erreurs et l’annulation.
Cela ne valide pas le comportement d’une API OpenAI ou Anthropic réelle.

## ChatGPT Pro

Le module `ai-sdk` utilise une clé API ; il ne connecte pas un compte ChatGPT.
Le module distinct `chatgpt` implémente Sign in with ChatGPT pour les applications
éligibles : voir [CHATGPT.md](CHATGPT.md) pour OAuth et les commandes de test.
Le module API actuel reste fonctionnel et indépendant. Anthropic est disponible
par API, sans connexion par abonnement Claude implémentée. Des crédits API peuvent
aussi être disponibles pour les abonnements Pro éligibles après activation.
Voir [TESTING.md](TESTING.md) pour les différences. Connexion et catalogue
ChatGPT et un essai réel GPT-6.1-Sol avec outil sont vérifiés. Les autres
parcours réels restent à qualifier.

## Sélection explicite

Exemple de configuration à enregistrer sous un nom distinct de la démo :

```json
{
  "displayName": "Nora Heart",
  "modules": { "memory": "basic", "model": "ai-sdk" },
  "model": {
    "provider": "openai",
    "modelId": "identifiant-du-modele-choisi",
    "apiKeyEnv": "HARNESS_OPENAI_API_KEY",
    "maxOutputTokens": 1024
  },
  "storage": {
    "driver": "postgres",
    "connectionStringEnv": "HARNESS_DATABASE_URL"
  },
  "workspaceDirectory": "workspace",
  "maxSteps": 8
}
```

Remplacer `modelId` par un modèle disponible sur le compte, acceptant texte et
appels d’outils. Pour Claude, utiliser `provider: "anthropic"`, son identifiant
de modèle et `apiKeyEnv: "HARNESS_ANTHROPIC_API_KEY"`. Les identifiants et tarifs
évoluent : aucun modèle commercial n’est imposé dans la configuration du dépôt.

Injecter les clés par l’environnement ou un coffre ; aucune clé en clair dans
le JSON. Les commandes ne chargent pas `.env` automatiquement. Une clé manquante
est refusée avant ouverture du stockage. Les clients fournisseurs sont créés
sans appel réseau ; l’appel commence seulement lors de `Engine.run`.

Après préparation de la base dédiée, lancer `pnpm demo --config chemin.json`.
Ce parcours appelle alors une API payante ; il n’a pas été exécuté pendant la
qualification. La CLI actuelle n’autorise que les outils de lecture.

## Responsabilités et limites

- Une requête SDK par étape, sans exécution d’outil par le SDK, sans retry ni
  fallback automatique. OpenAI utilise directement Responses ; Anthropic son
  fournisseur SDK direct. Aucune gateway Vercel n’est utilisée.
  Les URLs officielles sont explicites ; les variables de surcharge d’URL des
  SDK ne changent pas silencieusement la destination. Le transport est injectable
  dans le module pour tester les requêtes HTTP sans réseau.
- Les schémas JSON sont validés par Ajv, sans coercition ni ajout de valeurs
  par défaut. Les outils proposés viennent de la liste filtrée par le moteur.
  Celui-ci conserve le dernier contrôle des permissions et journalise l’action.
- Les noms d’outils envoyés aux fournisseurs sont des alias stables compatibles
  avec leurs restrictions. L’historique conserve les noms du harness, par
  exemple `memory.search`. Les anciens appels restent traduisibles même si
  l’outil n’est plus autorisé dans le run courant.
- Une réponse tronquée, filtrée, vide ou un appel invalide fait échouer l’étape.
  Les erreurs SDK sont remplacées par un message générique avant journalisation
  pour éviter de stocker des détails sensibles d’une requête.
- Le signal d’annulation est transmis au SDK. Cela n’assure pas l’arrêt d’un
  calcul déjà lancé chez le fournisseur ni l’absence de facturation.
- `maxSteps` et `maxOutputTokens` bornent les étapes et la sortie par requête.
  Ils ne constituent pas un plafond financier. La taille du contexte est
  estimée et journalisée ; catalogues et métadonnées de consommation du compte/de
  la clé sont exposés selon fournisseur. Pas de coût réel systématique par run ni
  de plafond financier global. Les quotas du compte ne sont pas un budget Heart.
- Télémétrie SDK désactivée et `store: false` demandé pour OpenAI. L’historique
  envoyé au modèle reste transmis au fournisseur choisi, selon ses conditions.
- Pièces jointes neutres adaptées en texte/image/PDF ; qualification réelle
  par modèle encore nécessaire. Pas de streaming du texte final ni persistance
  du raisonnement ou de métadonnées privées du fournisseur. `onActivity` signale
  seulement des phases : l’adaptateur ChatGPT utilise les événements SSE
  d’analyse/rédaction, sans en transmettre le texte. L’API AI SDK n’émet pas
  encore ces phases détaillées.

Ajv reste ici à la frontière du module AI SDK. Les autres futurs fournisseurs
doivent aussi contrôler leurs arguments ; le core n’importe pas cette dépendance.

## Étendre

Pour un fournisseur déjà pris en charge par AI SDK, ajouter son constructeur
dans ce module et sa validation dans `app/config.ts`. Pour une autre interface
technique, créer `modules/models/<nom>/index.ts`, implémenter `ModelProvider` et
l’enregistrer dans `app/compose.ts`. La boucle et les sessions restent communes.

Références : [génération de texte](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text),
[modèles simulés](https://ai-sdk.dev/docs/ai-sdk-core/testing),
[fournisseurs](https://ai-sdk.dev/docs/foundations/providers-and-models).

## OpenRouter

Le même adaptateur prend `provider: "openrouter"` et l’identifiant choisi, gratuit
ou payant, via Chat Completions. Aucun repli de modèle. `freeOnly: true` est réservé
aux qualifications gratuites : :free et prix nul sont alors obligatoires. Les
identifiants :free gardent également le plafond nul en usage normal. Les clés
OpenAI/Anthropic et le formulaire privé sont conservés.
[Qualification réelle et état courant](OPENROUTER.md).

## Catalogue OpenRouter

`openRouterModels` est exposé par l’adaptateur AI SDK. Il transforme le catalogue
public officiel en identifiant, nom et capacité neutres, déduplique et conserve
les modèles texte gratuits, payants et sans outils. Les prix absents restent
explicitement inconnus, et ne sont pas présentés comme gratuits. Pas de clé transmise pour
ce GET. Le web le publie derrière son authentification, sans cache serveur.

L’interface garde au plus le catalogue courant pendant cinq minutes. Elle charge
au changement de fournisseur, au retour dans le choix de cerveau si périmé et
sur demande via « Actualiser la liste ». Elle garde le modèle choisi tant qu’il
existe, bloque l’envoi sur erreur de catalogue et ne choisit pas de remplaçant.
La capacité remplit le budget visible ; un quota ou une indisponibilité d’inférence
reste possible même si le modèle est présent au catalogue.

## Sélection et effort dans le web

Fournisseurs configure uniquement OAuth et clés. Configuration définit le défaut
copié dans les nouveaux fils. Chaque fil possède son dialog fournisseur/modèle/effort,
avec enregistrement sans LLM et refus en cas de conflit ou run actif. Le changement
ne réinitialise ni souvenirs, ni personnalité, ni historique ; la compression est
conditionnée par le budget du nouveau cerveau, pas par son seul changement.

Les efforts disponibles viennent des capacités adaptées par chaque module ; la
valeur neutre reasoningEffort est persistée et traduite à la frontière fournisseur.
Automatique omet le paramètre. Les transports sont testés avec fournisseurs simulés ;
les essais réels ciblés ne qualifient pas tous les couples modèle/effort.

## Sortie et erreurs

Le web ne fixe aucun plafond implicite de 1024 tokens. En l’absence de budget
explicite, AI SDK et le fournisseur sélectionné déterminent la limite de sortie.
`AiSdkOptions.maxOutputTokens` reste facultatif ; les configurations CLI existantes
et les runners de qualification gardent leurs budgets explicites. La réserve de
contexte Heart est une estimation, pas une garantie sur le nombre de tokens générés.

L’adaptateur traduit les erreurs en messages bornés sans données brutes : statut
HTTP de connexion/crédits/usage/refus/indisponibilité, réponse mal formée, vide,
tronquée ou appel d’outil invalide. L’application les conserve jusqu’au chat et
après rechargement. Aucun appel partiel exécuté, retry ou repli automatique.

## Venice AI

Dans **Fournisseurs → Venice AI**, enregistrer la clé API dans le champ privé, puis
choisir Venice dans le modèle du fil ou dans Configuration → Discussions → Modèle
et autorisations par défaut. Le catalogue est actualisable ; aucun identifiant à
saisir de mémoire. La clé reste côté serveur dans le fichier privé existant (0600),
ou via `HARNESS_VENICE_API_KEY`. Aucun mot de passe Venice dans le chat.

L’adaptateur AI SDK réutilise Chat Completions à
`https://api.venice.ai/api/v1/chat/completions`. Le catalogue public
`/models?type=text` fournit les modèles actifs, noms, contexte disponible, tarifs
USD par million de tokens, vision, appels d’outils et efforts acceptés. Les niveaux
ne sont pas déduits du nom ; l’effort validé est transmis en `reasoning_effort`.
Cache de capacités cinq minutes pour les tours suivants ; Actualiser relit le
catalogue. Les modèles sans outils restent sélectionnables pour le texte.

Le core garde l’exécution et les permissions. Pas de retry, de modèle de repli,
de recherche web intégrée ni de prompt système Venice ajouté : les instructions
et les outils viennent de Heart. Les résultats/erreurs sont adaptés aux mêmes
contrats neutres ; les détails HTTP privés ne sont pas journalisés.

`readVeniceUsage` lit uniquement `GET /api_keys/rate_limits`, disponible avec une
clé d’inférence : solde USD du compte, autres soldes distincts et limites RPM/TPM
du modèle sélectionné. Consommation et le détail des crédits du chat les affichent.
Les autres soldes conservent leurs unités API, sans conversion ni addition au USD.
L’échéance DIEM ne devient jamais le reset du solde USD. Cache applicatif une minute,
par fournisseur/modèle/clé ; actualisation manuelle et requêtes en cours regroupées.
Aucun appel d’inférence ni essai de recharge pour lire ces données.

Les endpoints Billing (`balance`, `usage-analytics`, `usage-history`) refusent
réellement la clé d’inférence : « Admin API key required ». Ils ne sont pas appelés
à chaque actualisation, aucune clé administrateur n’est imposée et aucun historique
de dépense n’est reconstruit à partir du solde. Les erreurs restent sans détails
privés et un compteur inconnu ne devient pas zéro.
Aucune migration SQL ni modification des connexions existantes.

Sources officielles consultées le 21 novembre 2026 :
[Catalogue](https://docs.venice.ai/api-reference/endpoint/models/list),
[Effort](https://docs.venice.ai/guides/features/reasoning-models),
[Chat Completions](https://docs.venice.ai/api-reference/endpoint/chat/completions).
Catalogue réel lu : 148 modèles texte, 144 avec outils, 92 avec effort réglable
(valeurs observées, pas un inventaire figé dans le code). Les tests locaux vérifient le vrai adaptateur avec transport simulé et l’interface
mobile, sans prétendre valider le fournisseur réel.

Qualification réelle du 21 novembre : clé reconnue par
`GET /api_keys/rate_limits` (HTTP 200), catalogue de 148 modèles texte et aucun
modèle aux deux tarifs entrée/sortie nuls. Les premiers appels sans crédits
retournaient HTTP 402. Après recharge du compte lié à la clé, le véritable
adaptateur Venice et le moteur Heart réussissent sur
`deepseek-v4-1-flash-uncensored` : deux appels fournisseur, lecture d’un fichier
via l’outil Heart et réponse contenant son marqueur absent du prompt. Stockage et
fichiers QA temporaires supprimés ; aucune écriture métier ni simulation du modèle.
Ce parcours qualifie ce modèle et cette boucle fichiers, pas tous les modèles,
la mémoire, la compression ou l’interface web Venice en conditions réelles.

Le catalogue public ne prouve pas seul la validité d’une clé. Les modèles inclus
sans crédits dans le chat Venice ne sont pas gratuits via cette API.
[Limites et soldes API](https://docs.venice.ai/api-reference/endpoint/api_keys/rate_limits),
[Différence chat/API](https://venice.ai/faqs/all).
