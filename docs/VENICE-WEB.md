# Venice web : émulation expérimentale, accès réel bloqué

Demande du propriétaire, 23 novembre 2026 : essayer les outils émulés avec le
chat web Venice et le harness. Ce chemin est distinct de l’API Venice facturée.

## Résultat réel

Session navigateur existante vérifiée auprès de Clerk, catalogue web authentifié
accessible. DeepSeek V4.1 Flash Uncensored (`deepseek-v4-1-flash-uncensored`) y est
actif, `usesCredits:false`, contexte 524 288 tokens. Cela ne prouve pas que
l’inférence ou son automatisation est autorisée sur le compte.

L’essai agent `POST /api/inference/chat/agents/ad-hoc` reçoit HTTP 403 avec
`creator_access_required`. Un essai sur le chat classique
`POST /api/inference/chat` reçoit aussi HTTP 403, avec ce message explicite :

> Programmatic use of this API is forbidden by TOS. Continued attempted use will result in suspension of service.

Les essais externes ont été arrêtés à ce refus. Aucun achat, abonnement activé,
appel à l’API payante ou boucle d’outils réelle validée. Le pont temporaire a été
arrêté et la copie de session supprimée ; session navigateur originale conservée.
Pas de service installé, pas de redémarrage ou de bascule du cerveau de production.

## Code préparé et portée des tests

- Sélection distincte `venice-web` dans le harness, absente des clés API stockées.
  Activation explicite côté serveur via `HARNESS_VENICE_WEB_ENABLED=1`, désactivée
  par défaut. Les tests ne l’activent pas implicitement.
- AI SDK existant pour les messages et la validation JSON Schema. Le pont traduit
  l’enveloppe JSON du modèle vers `tool_calls` ; seul le moteur Heart exécute les
  outils autorisés. Arguments et noms invalides rejetés, refus sans repli API.
- Écoute uniquement sur `127.0.0.1:3456`, routes santé/catalogue/chat uniquement.
  Catalogue web frais relu avant les requêtes ; modèles payants, inconnus ou
  catalogue indisponible refusés. Pas de prix ou de quota illimité inventé.
- Logs de contenu/arguments/raisonnement et dumps désactivés. Juge supplémentaire
  désactivé, normalisation de noms inventés retirée. Aucun cookie exporté au LLM,
  au navigateur Heart, au dépôt ou au rapport.
- `tests/venice-web.test.ts` couvre le catalogue, refus/validation sans retry et
  une boucle moteur avec le véritable parseur du proxy, réponses modèle simulées.
  Le troisième contrôle est ignoré explicitement si le transport optionnel n’est
  pas installé. Ce test ne constitue pas une qualification Venice réelle.
- `tests/live-venice-web.ts --live` prépare un parcours lecture → écriture →
  réponse sur fichiers temporaires, maximum quatre inférences côté harness. Il a
  échoué au premier appel ; ne pas le relancer tant que le refus est présent.

## Dépendance optionnelle et provenance

Transport MIT, zéro dépendance npm d’exécution :
[CanArslanDev/opencode-venice-web](https://github.com/CanArslanDev/opencode-venice-web),
révision `6928f8a231931f10bda63c31e6a24ad14fcbeb72`. Licence originale conservée
dans le checkout sous `.tools/venice-web/upstream/LICENSE`. Node et curl natifs ;
pas d’installateur amont exécuté ni de configuration OpenCode modifiée.
`python3 scripts/install-venice-web.py` installe cette révision et les adaptations
locales sans connexion ni inférence. `scripts/venice-web-server.mjs` est le lanceur
restreint, pas le serveur brut amont qui expose aussi les images et les logs.

Le fichier privé indiqué par `VENICE_WEB_SESSION` contient le credential Clerk et
doit être hors Git, répertoire 0700/fichier 0600. Aucune session active n’est
livrée. Les endpoints web sont non officiels ; ne pas déployer le prototype ou
changer de route/identité pour contourner un refus du service.
