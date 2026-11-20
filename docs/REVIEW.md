# Revue du code et priorités

Point du 19 novembre 2026 après revue/debug des tâches. Configuration unifiée, consignes
modifiables et revue mémoire restent livrées. Réconciliation, bundle chiffré et stockage SQL
interchangeable restent livrés. [Preuves du lot](qualification/recovery/checks.json),
[état courant](STATUS.md), [exploitation](RECOVERY.md).

## Conclusion

Le socle modulaire est utilisable. Les contrats et le core restent indépendants
des implémentations ; le test de frontières les contrôle. Aucun besoin établi de
changer la stack, d’imbriquer Codex/Claude ou de refaire l’interface dans un framework.
La parité complète avec Codex CLI et l’assistante quotidienne autonome restent
partielles. Reprise et restauration gérée sont livrées. Le prochain effort proposé porte sur
un usage quotidien choisi et ses compléments utiles. Recherche web courante suffisante ;
les fonctions avancées de sources restent différées.

## Livré et niveau de preuve

| Domaine | Livré | Limite de qualification |
| --- | --- | --- |
| Moteur | Boucle, droits, journal, outils et pause/reprise ; pas de fournisseur/base dans le core. | Réconciliation livrée, sans garantie d’exactly-once externe ; anciens claims sans owner à traiter par opérateur. |
| Cerveaux | ChatGPT abonnement direct, OpenAI/Anthropic/OpenRouter API, catalogue/effort et aucun repli implicite. | Qualifications réelles ciblées, pas toutes les combinaisons ; abonnement Claude absent. |
| Conversations | Projets, modèles par fil/défauts, plusieurs runs entre fils, fermeture navigateur sans annulation, arrêt ciblé. | Un run par fil ; crash serveur distinct d’une déconnexion HTTP. |
| Contexte/mémoire | Checkpoint/compression, mémoire personnelle/projet, provenance, versions, correction/oubli/restauration. | Parcours ChatGPT/DeepSeek avec compression, réouverture et mémoire qualifié sous budget de test réduit ; autres paires et médias non universellement qualifiés. |
| Outils | CRUD tous formats, terminal isolé/YOLO, mémoire, formulaires et MCP de lecture. | Pas de PTY, OAuth/stdio MCP ou écriture MCP ; programmes SSH/VPN à configurer, pas des modules livrés. |
| Web | Recherche SearXNG auto-hébergée et lecteur public, sans quota commercial ; Exa désactivé. | Moteurs/sites peuvent bloquer ; pas de navigateur JS ou citations structurées vérifiées par Heart. |
| UI | Mobile first, dialogues/contrôles, suivi des travaux, Markdown/tableaux/images/LaTeX et reçus communs mémoire/formulaires ; Configuration unifiée en cinq onglets, catalogue différé/versionné et DOM conservé. | Typage JS partiel, gros contrôleurs encore présents, pas de streaming final ; téléphones physiques non qualifiés. |
| Persistance | Contrat complet SQL, PostgreSQL 001–014 et SQLite 001–002 optionnel, transactions/claims/leases et snapshots/bundles natifs. | Même conformité testée ; pas d’outil de transfert entre moteurs, copie hors machine et image disque hors périmètre. |

## Écarts prioritaires constatés

### Reprise et restauration : livrées avec limites explicites

SIGKILL après effet réel qualifié sur état jetable ; résultats préservés, aucun
rejeu par la réparation, contrôle de propriétaire/version et écritures tardives
refusées. Journaux modèle et explorateur privé séparés. La déclaration du
propriétaire ne devient pas un faux succès d’outil. Un claim pré-013 sans owner
vérifiable demande encore une intervention opérateur.

Bundle de l’installation gérée chiffré par age, clé privée hors archive et repos
des writers coordonné ; travail actif → report. Douze tables + fichier + config
restaurés sur données synthétiques. Le vrai bundle a été déchiffré/vérifié localement,
sans activer ses credentials. Ni copie hors machine ni modifications YOLO hors
scopes incluses. [Portée exacte](RECOVERY.md).

### Historique et volume

- Pagination catalogue/événements et suivi delta livrés, recherche/projet côté
  stockage, ouverture d’un ancien UUID indépendante de la première page.
- Métadonnées/récupération mises à jour par ajouts, audit privé compris. Premier
  accès après redémarrage/éviction : parcours complet par pages. Pas de projection
  SQL matérialisée ; les formulaires restent en mémoire tant que leur projection est dans le cache LRU.
- 1 205 messages et 125 conversations qualifiés sur les deux SQL sur nora-tests.
  Les pages chargées restent dans le DOM ; téléphones physiques et très gros
  journaux restent à mesurer. [Contrat et preuves](HISTORY.md).
- Mémoire : classement littéral, par défaut 200 candidats et injection de trois
  souvenirs/3 000 caractères. Ces valeurs sont configurables ; la recherche reste
  non sémantique et ne promet pas l’exhaustivité.
- Message/lot/compression/recherche et injection mémoire : limites désormais
  explicites dans Configuration → Limites, avec 0 sans plafond hors pourcentage.
  Un instantané par tour préserve la cohérence. Les contraintes réelles des modèles,
  les permissions et les limites des fiches restent distinctes. [POLICIES.md](POLICIES.md).

### Entretien UI

app.js (~1 269 lignes) et ui.js (~899) conservent beaucoup d’état partagé ; leur
longueur n’est pas une preuve de bug. Extractions déjà faites : HTTP, SVG, activité,
configuration MCP et styles de gestion. Continuer par responsabilité au fil des
changements, préserver le DOM utile et retirer les styles remplacés. Pagination/delta sont livrés ; préserver leurs parcours mobiles et réduire les
relectures/mutations mesurées plutôt que réécrire l’interface.

## Qualifications encore nécessaires

Autres paires/variantes de modèles et efforts, médias, très grandes fenêtres
natives et utilisation physique sur iOS/Android. Le parcours ChatGPT/DeepSeek ciblé
est qualifié ; voir [CONTINUITY.md](CONTINUITY.md). Les essais Gemma ultérieurs
réussis n’établissent pas rétrospectivement la cause de l’ancien échec générique.
Les améliorations de citations/recherche de passages ne sont pas une priorité
avant un besoin réellement observé dans l’usage web courant.

## Validation du dernier passage

189 tests avec typage/format et démo locale, 19 parcours Chromium sur données
jetables. Quatre tests nouveaux vérifient seuil/fenêtre, absence de résumé inutile,
sélection des souvenirs et profil cohérent/unique par tour. Un parcours navigateur
vérifie champs indépendants entre onglets, absence d’écriture à vide, zéro mutation
de longueur du composeur, état périmé et déconnexion avec réponses tardives.
[Défauts corrigés et mesures](qualification/runtime-review/README.md).

Les preuves réelles ChatGPT/DeepSeek restent celles de [CONTINUITY.md](CONTINUITY.md) ;
aucun nouvel appel fournisseur ce passage. Les 39 tests PostgreSQL du lot précédent
ne sont pas comptés comme réexécutés : aucun SQL, migration ou repository modifié.
Les gros volumes et appareils physiques restent à mesurer.
Déploiement du passage : sauvegarde réussie, douze tables inchangées, HTTPS en
lecture seule sur quatre largeurs sans erreur JS. Aucune migration ni inférence.

## Stockage SQL optionnel livré

L’assemblage web ne dépend plus directement de PostgreSQL ; CLI/web sélectionnent
le module derrière SqlStorageConnection. SQLite natif Node, tables STRICT/WAL,
verrous réels séparés et snapshot avec preuves des claims. Suite commune de huit
groupes sur les deux moteurs ; fermeture PostgreSQL répétée corrigée.
[Portée et preuves](SQL-STORAGE.md). Aucun ORM ni outil de transfert PostgreSQL ↔ SQLite.
Le déploiement a conservé PostgreSQL et les douze tables opérationnelles ; nouveau
bundle PostgreSQL privé vérifié. Limites configurables et skills sont livrés ; planification également livrée.

## Revue logique effectuée

Le seuil de compression déclenche la réduction ; la fenêtre utilisable décide du
refus. Les souvenirs ignorés ne consomment pas les places d’injection. L’assemblage
capture une version cohérente du profil avec une lecture au lieu de trois. Éditeurs
Instructions/Limites protégés contre les retours après déconnexion ; réponse d’état
périmée incapable d’annuler une sauvegarde. Limites : seuls champs modifiés envoyés,
aucun POST inchangé et aucune écriture répétée du maxlength identique.

L’état technique restant dispose maintenant des skills portables ; le scheduler
durable est livré également. Pas de refonte de stack ou d’embeddings préventifs recommandée.

## Skills qualifiés

196 tests, démo et 20 parcours navigateur. Modèles simulés pour ce lot : chargement
progressif, références, permissions conservées, guidances après checkpoint/reprise,
désactivation et persistance SQL via SQLite. Parcours HTTP visible dans le chat et
quatre largeurs pour les fiches ; aucune inférence réelle payante. Format du skill
livré validé et dépendance YAML sans transitives runtime. Installation locale
explicite ; pas de promesse de compatibilité avec toutes les extensions des autres
clients ou de bon choix sémantique par chaque LLM. [Preuves](qualification/skills/README.md).

Déploiement skills : sauvegarde/repos vérifiés, douze tables identiques, PostgreSQL
013 sans migration. Catalogue et fiche contrôlés en HTTPS sur quatre largeurs,
lecture seule sans erreur JS ou inférence fournisseur.

## Planification qualifiée

206 tests + démo, 21 parcours navigateur et 49 tests distants PostgreSQL/tâches.
Réservations concurrentes, leader unique, fuseaux/DST, pause/rattrapage, formulaire,
notifications et SIGKILL après effet réel couverts sur données jetables. Upgrades
13→14 et 1→2 préservent les données. Les modèles sont simulés pour ce lot ; aucun
usage réel propriétaire n’est inventé. Notifications internes seulement, gestion
via UI/API et réglages du fil hérités. [Preuves](qualification/tasks/README.md).

## Passage du 19 novembre : tâches, logique et performances

Corrigés : clignotement de chargement à chaque poll, historique ramené à sa
première page, reset bloquant les lectures suivantes et réponses de dialogues
fermés. Polling silencieux et moins fréquent au repos, pas de mutation DOM sur
données inchangées. File sans famine derrière une discussion occupée ; lecture
directe des occurrences par ID et association linéaire des derniers résultats.
208 tests, démo, 21 parcours navigateur et 41 tests PostgreSQL jetables.
[Mesures et limites](qualification/tasks-review/README.md).

Consolidation codée : suivi serveur par deltas, catalogue SQL paginé, contrôleur
Tâches typé et rendu hors écran natif. 210 tests et 21 parcours navigateur passent ;
53 tests backend sur nora-tests. Qualification réelle GPT‑6 Luna réussie sur les
deux backends, 88 appels, deux vrais résumés et SIGKILL après effet réel. La fenêtre d’historique chargée
reste dans le DOM accessible ; le rendu hors écran ne constitue pas une borne de
mémoire. Aucun framework de virtualisation, streaming ou worker séparé ajouté. Prochaine évolution utile : qualification d’une
un usage quotidien choisi avec les mêmes contrôles.

## Tâches conversationnelles

Service partagé, trois outils compacts, permissions distinctes et identité moteur
pour la réémission. Lecture canonique paginée, reçus sûrs et consigne éditable.
213 tests, 22 parcours UI, 56 backend ; 70 appels Luna sur la version finale.
Le profil 8 192 tokens a révélé une surcharge, corrigée sans relever son contexte.
Un test de course a été corrigé pour accepter le vrai gagnant, sans ignorer le cas.
[Preuves et limites](qualification/task-tools/README.md).

## Revue du 20 novembre — MCP Projects, contexte et performances

Ancien défaut corrigé : outils Projects raccordés mais création UI en SQL. Source
MCP unique par binding, aucun miroir, clés étrangères locales détachées avec
préservation des données. Relecture unique du projet, mémoire/catalogue en parallèle,
mutualisation des seules lectures simultanées et pas de cache métier périmé.
Défaut de petit contexte reproduit : consignes + outils dépassaient 8 192 tokens
après le retour fichiers. Consignes redondantes condensées, contrôles inchangés ;
parcours réel de l’assemblage web repassé sans relever la fenêtre. Assertion UI
corrigée pour attendre la réponse de l’explorateur, et non sa seule ouverture.
Voir STATUS.md pour les vérifications finales et leur portée ; elles ne constituent
pas une garantie d’absence de tout bug ou une mesure de tous les temps d’inférence.
