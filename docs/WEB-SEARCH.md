# Recherche web auto-hébergée

Décision du 18 novembre 2026 : aucun fournisseur dont l’offre gratuite impose un
quota pour pousser vers le paiement. Le preset de Heart est désormais le MCP de recherche locale.
Pas de repli vers une API payante ou un compte à crédits.

## Fonctionnement

```text
Cerveau → Tool Heart → client MCP → MCP local :4217
                                  ├─ web_search → SearXNG local :4216 → moteurs publics
                                  └─ web_fetch  → page publique → texte et liens
```

SearXNG est un métamoteur libre exécuté sur notre serveur. Il ne constitue pas un
index indépendant du Web. Brave et Bing publics sont activés dans la configuration
actuelle ; les moteurs se changent dans settings.yml. Aucun compte, clé d’API,
abonnement, crédit ou compteur de requêtes n’est ajouté par Heart. Le serveur
consomme CPU/RAM et sa bande passante. Les moteurs/sites peuvent limiter, bloquer,
demander un CAPTCHA, retirer des résultats ou ne pas paginer ; rien ne garantit
une recherche infinie ou exhaustive. Les incidents remontent avec les résultats.

Les requêtes sont transmises aux moteurs choisis, les pages aux sites consultés.
Le modèle conserve ses propres coûts et limites, distincts de cette recherche.

## Utilisation et outils

Capacités affiche **Recherche web locale**, avec deux outils approuvés.
Le réseau du fil reste requis (inclus en YOLO). Le changement ne modifie pas les
permissions des conversations. Les autres connexions MCP restent configurables.

- `web_search` : query, page facultative (pagination des moteurs), language,
  engines et time_range. Tous les résultats renvoyés par la page SearXNG sont
  conservés, avec titres, URLs, extraits, moteurs et incidents. Pas de numResults
  forcé ni de compteur journalier. La pagination réelle dépend de chaque moteur.
- `web_fetch` : url publique et max_characters facultatif. Aucun plafond de texte
  par défaut ; une coupe demandée est signalée par truncated/totalCharacters.
  Le lecteur parse HTML/texte, conserve les liens et ne lance pas de JavaScript.
  CAPTCHA, contenus nécessitant JavaScript et PDF peuvent demander un autre outil.
  Les limites mémoire/contexte du modèle s’appliquent aux gros résultats.

La lecture publique n’expose pas le réseau interne : URLs avec identifiants,
loopback, réseaux privés et redirections correspondantes sont refusés. Le DNS est
contrôlé lors de la connexion socket pour éviter le rebinding. Pour une ressource
serveur privée, utiliser les outils et permissions serveur appropriés. Aucun accès
fichier ou credential LLM n’est donné à ce lecteur.

## Modules et assemblage

- `modules/search/searxng/index.ts` : recherche JSON et lecteur HTML public ; reçoit
  son endpoint et son délai. Cheerio parse le HTML, Undici fournit le transport
  avec résolution DNS contrôlée, ipaddr.js classe les adresses. Pas de SDK LLM,
  mémoire, client SQL ou appel à un autre module concret.
- `modules/tools/mcp-server/index.ts` : petite surface MCP stateless en HTTP Node,
  recevant des Tool et leurs schémas, sans construire les implémentations. Arguments
  validés, erreurs, annulation et refus d’origine/hôte non locaux. Lecture seulement.
- `app/search.ts` assemble ces deux modules ; `interfaces/search.ts` démarre le
  service privé. Le client MCP et les contrats de Heart ne changent pas.

Le MCP est utilisable par un autre client compatible ; changer le moteur de
recherche ne nécessite pas de changer le cerveau. Les processus restent séparés
pour exploiter le moteur Python SearXNG existant sans l’incorporer au core TS.

## Installation et exploitation

1. Copier `deploy/search.settings.example.yml` vers
   `/etc/personal-harness/search/settings.yml`. Générer la valeur de secret_key
   hors dépôt, par exemple avec Python secrets.token_hex(32), et garder le fichier
   root 0600. Ne pas conserver le secret dans le fichier exemple.
2. `docker compose -f deploy/search.compose.yml up -d`. L’image officielle est
   épinglée par digest dans ce fichier ; mise à jour explicite après qualification.
   SearXNG est lié uniquement à 127.0.0.1:4216. JSON activé, limiteur de bots
   désactivé pour cette instance privée, aucune exposition publique.
3. Installer `deploy/personal-harness-search.service`, puis daemon-reload et
   enable --now. Le MCP écoute 127.0.0.1:4217. Le service utilise DynamicUser,
   n’importe pas web.env et ne peut lire les données/credentials privés de Heart.
4. Dans Capacités, le preset **Configurer la recherche locale** utilise
   http://127.0.0.1:4217/mcp sans authentification. Tester, cocher web_search et
   web_fetch, activer et enregistrer. Seule la recherche locale est préconfigurée.

Sondes : SearXNG `/healthz` sur 4216 ; MCP `/health` sur 4217. Ces sondes prouvent
la disponibilité des processus, pas le succès d’une recherche sur tous les moteurs.
Au démarrage, attendre la disponibilité de SearXNG avant une recherche. Les deux
services redémarrent automatiquement après panne ; ils ne rejouent pas un appel
outil échoué. Le délai HTTP de lecture/recherche est configurable par
HARNESS_SEARCH_TIMEOUT_MS (initialement 60000). Le délai de chaque moteur est dans
outgoing.request_timeout (6 s dans l’exemple). Ce sont des délais opérateur,
pas des quotas commerciaux ou plafonds de volume.

Le fichier privé settings.yml et les unités/configuration d’exploitation doivent
être inclus dans une sauvegarde de configuration hors base : le dump PostgreSQL
sauvegarde les connexions MCP, pas ces fichiers. SearXNG ne stocke pas l’historique
des conversations ; celui-ci reste dans le journal de Heart.

## Validation

Tests : 143 résultats conservés sans coupe, pagination/choix de moteurs transmis,
incidents remontés, page de plus de 60 000 caractères intacte, coupe explicite,
URLs/réseaux privés/redirections refusés et appels MCP HTTP réels sur backend
jetable. Les moteurs réels sont testés séparément : trois recherches et une lecture
sans coupe. ChatGPT réel a recherché puis lu PostgreSQL, et cité sa source en trois
appels HTTP 200, sur données temporaires. [Preuves](qualification/self-search/).
Les essais de l’ancien fournisseur restent des preuves historiques, pas le choix actif.

Sources : [installation SearXNG](https://docs.searxng.org/admin/installation-docker.html),
[API de recherche](https://docs.searxng.org/dev/search_api.html),
[source et licence](https://github.com/searxng/searxng).
