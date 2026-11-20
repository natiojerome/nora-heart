# OpenRouter : catalogue et qualification réelle

État : **parcours réel complet réussi avec DeepSeek V4 Flash 0731** sur
`nora-tests` : continuité, résumé réel, réouverture, mémoire corrigée et oubli.
Cette preuve couvre un scénario synthétique avec un seul modèle ; elle ne
généralise pas sa fiabilité à tous les modèles et toutes les conversations.

## Connexion

Dans Heart → Modèles → OpenRouter → Configurer la clé API. Saisir la clé dans le
champ protégé, jamais dans le chat, Git ou les logs.
Le catalogue texte complet est chargé automatiquement en choisissant OpenRouter :
modèles gratuits et payants, noms, tarifs USD par million de tokens, capacités
de contexte et recherche par nom ou identifiant. La feuille affiche des lignes
compactes ; les filtres Tous/Gratuits/Avec outils sont facultatifs et Tous est
le choix initial. Les identifiants techniques ne prennent plus la place du nom.
« Actualiser la liste » recharge depuis OpenRouter. Après cinq minutes, le retour
dans l’écran ou le choix du cerveau recharge aussi le catalogue. Un modèle retiré
est désélectionné ; un catalogue en erreur bloque l’envoi, sans saisie forcée.
Les modèles sans outils restent proposés et signalés ; leurs outils ne sont
pas annoncés au fournisseur quand cette capacité est connue. Stockage privé du service,
mode 0600, réponse API limitée à l’état configuré. Les clés OpenAI/Claude sont
conservées. Alternative : variable `HARNESS_OPENROUTER_API_KEY`.

Le modèle choisi est utilisé explicitement, gratuit ou payant, au tarif annoncé
par OpenRouter. Le module AI SDK utilise Chat Completions avec
`allow_fallbacks: false`. Aucun basculement vers OpenAI, Claude ou l’abonnement.
Pour un identifiant :free ou une qualification `freeOnly`, le plafond de prix
prompt/completion/requête reste nul. Le runner garde ce mode par défaut ;
un mode payant explicite est décrit ci-dessous. Ouvrir le catalogue ne lance
aucune inférence.
Les quotas gratuits OpenRouter peuvent interrompre le test ; aucune recharge,
création de compte payant ou répétition automatique n’est déclenchée.

Références officielles vérifiées le 16 novembre 2026 :
[modèles gratuits](https://openrouter.ai/collections/free-models),
[routage et prix maximal](https://openrouter.ai/docs/guides/routing/provider-selection),
[limites](https://openrouter.ai/docs/api_reference/limits).

## Parcours live préparé

`pnpm qualify:openrouter` sans option ne lance aucun appel.
Pour la qualification réelle : `pnpm qualify:openrouter --live`, avec connexion
PostgreSQL et clé disponibles dans l’environnement ou le répertoire privé du web.
Le compte PostgreSQL doit pouvoir créer une base temporaire. Ne pas copier les
credentials dans une commande versionnée ni utiliser une autre base Nora.

Le runner crée une base PostgreSQL distincte et un workspace temporaire :

1. Premier modèle réel : faits synthétiques, outil fichiers réel, correction.
2. Second modèle : rappel des décisions avant compression.
3. Budget de contexte artificiellement réduit à 8192 tokens estimés pour franchir
   le seuil et demander un **vrai résumé** au modèle, puis contrôler la continuité.
4. Réouverture du stockage et du service applicatif, rappel et absence de rejeu.
5. Nouveau fil : mémoire structurée PostgreSQL, isolation projet et oubli,
   correction puis retrait de la mémoire active.

Par défaut : `google/gemma-4-31b-it:free` puis
`inclusionai/ling-3.2-flash:free`, listés gratuits avec outils lors de la préparation.
Ils sont revérifiés dans le catalogue au lancement, sans substitution automatique.
Le test plafonne par défaut à 14 appels, y compris résumés ; toute limite ou assertion
échouée interrompt la qualification. Cela reste soumis aux quotas du compte.

Le mode payant utilise `HARNESS_QUALIFY_PAID_MODEL` avec l’identifiant exact,
`HARNESS_QUALIFY_MAX_COST_USD` (au plus 0,05) et
`HARNESS_QUALIFY_MAX_CALLS` (au plus 24, défaut 14). Le catalogue est revérifié avant lancement.
Le prix maximal fournisseur est fixé aux prix du catalogue ; chaque requête
réserve avant envoi une borne prudente : octets JSON + marge de 4096 pour
l’entrée, plafond de sortie et prix par requête. Les réservations ne sont pas
remboursées pendant le test ; le coût communiqué par l’API est enregistré
séparément. Il s’agit d’un budget de qualification, pas d’un plafond financier
global de Heart. Aucun retry ni changement automatique de modèle.

`HARNESS_QUALIFY_SCENARIO=memory` permet d’isoler les trois contrôles mémoire
sans refaire la compression ; `full` reste le parcours par défaut. Le rapport
indique toujours le scénario et ne confond pas un essai mémoire avec le parcours
complet. `modelFailure` distingue notamment limite d’appels, limite de coût et
codes bornés de l’adaptateur.

Ce mode utilise deux fois le même modèle : il teste la continuité, le résumé
et la mémoire, **pas un changement entre deux modèles différents**. Pour
requalifier ce dernier cas, utiliser le parcours gratuit à deux identifiants.
Les essais réels tournent sur `nora-tests`, PostgreSQL jetable et conteneur borné,
sans écrire dans les conversations ou souvenirs du propriétaire.

Le rapport contient modèles, réponses synthétiques, checkpoint et résultats
sous `docs/qualification/openrouter/`. Il ne contient aucune clé ou pensée interne.
Base et workspace temporaires sont supprimés à la fin ; le rapport est conservé.
Le runner ne déclare pas de réussite si le checkpoint réel manque ou si un fait
attendu est perdu. Un parcours réussi ne prouverait pas une fiabilité universelle.

## Résultats réels du 16 novembre 2026

Quatre essais, 11 appels réels cumulés, tous sur des modèles :free. Les rapports
JSON sont dans `docs/qualification/openrouter/` et restent marqués `failed` :
refus d’inférence 429, sortie tronquée à 1024 tokens, puis parcours partiel avec
4096 tokens de sortie maximum. Les réponses HTTP réussies déclarent un coût nul.

Le dernier essai a validé le rappel exact d’un budget, d’une correction de jour,
du choix PostgreSQL et d’un marqueur aléatoire en passant de Liquid LFM 3 à
Ling 3.2 Flash. L’outil fichiers a réellement été exécuté. Le parcours a ensuite
été interrompu par une réponse 429 ; il ne qualifie donc pas la compression,
la reprise après réouverture ou la mémoire en nouveau fil. Aucun repli payant,
aucune réussite globale déduite d’un résultat partiel. Les ressources temporaires
ont été supprimées. Le runner conserve désormais les diagnostics HTTP autorisés
et l’état du checkpoint même en cas d’échec, sans clé ni corps d’erreur privé.

### DeepSeek V4 Flash 0731 choisi par le propriétaire

**Parcours complet réussi**, modèle `deepseek/deepseek-v4-flash-0731` :
13 requêtes HTTP 200, coût communiqué **0,00153012 USD**, réservation prudente
0,01981290 USD, plafond de cet essai 0,046 USD. Le résumé de 481 caractères
conserve décisions, contrainte du scénario d’essai et outil déjà exécuté.
[Rapport complet réussi](qualification/openrouter/harness_qualification_eebdd0c3f3964d9abd06eb3459c10b03_test.json).

| Contrôle | Résultat observé |
| --- | --- |
| Continuité et correction | Budget 1370, lundi remplaçant vendredi, PostgreSQL et marqueur aléatoire conservés. |
| Compression réelle | Résumé produit par DeepSeek, checkpoint PostgreSQL, mêmes faits avec capacité de test réduite à 8192. |
| Réouverture | Stockage et service réassemblés, même UUID d’instance, faits conservés. Un seul files.list exécuté, aucun rejeu. |
| Mémoire entre fils | Code personnel aléatoire retrouvé dans un nouveau fil. |
| Correction de mémoire | Nouveau code exact retrouvé après modification persistée. |
| Oubli | Nouveau fil : réponse JSON avec memoryCode réellement null. |
| Lecture directe après oubli | memory.get refuse l’UUID connu du souvenir oublié. Administration et restauration préservées. |

Le contrôle des décisions conserve des assertions exactes sur budget, jour,
marqueur et clés JSON. Seule la casse du nom PostgreSQL est indifférente ; la
réponse brute reste dans le rapport. Une base différente reste un échec.
Les requêtes réelles sont vérifiées pour l’absence des sentinelles d’un autre
projet et d’un souvenir initialement oublié.

#### Diagnostic et preuves conservées

L’essai initial à 14 appels s’arrêtait au contrôle d’oubli ; son diagnostic
incomplet ne prouvait pas une réponse fournisseur incompatible. Les reprises
ont montré deux faux blocages de qualification, plus un défaut réel de lecture :

- [Mémoire seule, 7 appels, réussi](qualification/openrouter/harness_qualification_04ea8a5d0b644b45bfb05be8520c80ac_test.json) : rappel, correction et oubli, coût 0,00045426 USD.
- [Parcours à 14 appels, arrêté avant le dernier contrôle LLM](qualification/openrouter/harness_qualification_51e0f9c9eade4e678e2794de4a5c7f12_test.json) : coût 0,00189852 USD. Les tours d’outils avaient épuisé le plafond. Les assertions de lecture directe après oubli avaient déjà réussi. L’erreur était masquée par le message générique de Conversations. Le runner identifie maintenant call-limit et spending-limit explicitement ; plafond configurable jusqu’à 24, défaut 14.
- [Assertion de casse trop stricte, 6 appels](qualification/openrouter/harness_qualification_d7d8bf1fa1f74274b2aee3ec96bd5005_test.json) : coût 0,00087708 USD. La réponse postgresql désignait la bonne base. Le jugement accepte désormais cette variante typographique, sans modifier la réponse rapportée.
- Lecture directe : memory.get pouvait exposer un souvenir oublié par UUID, même si la recherche et l’injection l’excluaient. Corrigé à la frontière outil, testé en régression et dans le parcours réel complet. Ce défaut n’est pas présenté comme la cause prouvée du premier arrêt.

Les **quatre essais de débogage** totalisent 40 requêtes, toutes HTTP 200,
et **0,00475998 USD communiqués**. Le plafond cumulé de 0,05 USD est respecté :
chaque relance tenait compte des coûts communiqués des essais achevés. Les
rapports d’échec sont conservés, sans requalification rétroactive en succès.

Aucun changement entre modèles différents dans ces essais. Les écritures mémoire
de préparation/correction/oubli passent par le service réel ; elles ne constituent
pas une qualification complète de chaque outil mémoire piloté par le LLM.
Les modèles ont aussi utilisé des outils mémoire pendant le parcours. Bases,
workspaces, conteneurs et credentials temporaires supprimés. Le correctif outil
est déployé sur Heart ; APIs privées de lecture contrôlées après redémarrage.

## Continuité avec un autre fournisseur réel

Le [parcours ChatGPT/DeepSeek](CONTINUITY.md) du 18 novembre qualifie la bascule
entre abonnement ChatGPT et OpenRouter V4 Flash 0731, puis compression réelle,
réouverture et correction/oubli mémoire, sur l’assemblage web et SQLite jetable.
Les essais monomodèle ci-dessus restent des preuves distinctes. Tous les coûts et
échecs de préparation du nouveau parcours sont conservés dans son bilan cumulé.
