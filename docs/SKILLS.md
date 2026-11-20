# Skills portables

Le web propose Capacités → Skills : catalogue, instructions consultables et
activation globale. « Disponible » signifie autorisé pour les prochains messages,
pas chargé en permanence. Un premier skill `code-review` est fourni et actif par défaut.
L’activation est un choix du propriétaire ; le chargement est le choix de la tâche.
Un skill n’est ni un outil supplémentaire d’exécution, ni une mémoire utilisateur.

## Repères dans l’interface

Capacités sépare trois onglets : **Outils** (actions intégrées et outils des connexions MCP),
**Skills** (méthodes de travail installées), **Connexions** (services MCP externes).
Le bouton d’ajout appartient uniquement aux connexions ; il n’installe pas un skill.
Le catalogue Skills est lu à l’ouverture de son onglet. Le snapshot des connexions
est partagé par Outils et Connexions, lu une seule fois à leur première ouverture
puis conservé en mémoire jusqu’à actualisation/déconnexion. Routes directes : `#tools`, `#tools-skills`,
`#tools-connections` ; `#modules` reste un alias de la vue Outils.

La fiche d’un skill permet d’autoriser/désactiver son usage, consulter la méthode
complète et ses fichiers associés, et copier sa commande `$nom`. Les explications
indiquent le chargement à la demande ; aucun droit outil n’est ajouté par ce choix.
L’installation et l’édition de contenu restent locales, selon le manifeste ci-dessous.

## Format et enregistrement

Un dossier contient `SKILL.md`, frontmatter YAML `name`/`description`, corps Markdown
et, selon son besoin, `references/`, `scripts/` ou `assets/`. Le format suit
[Agent Skills](https://agentskills.io/specification), avec le
[chargement progressif recommandé](https://agentskills.io/client-implementation/adding-skills-support).
Les champs optionnels du YAML sont acceptés ; ils restent dans le fichier original.
Le parseur est tolérant sur la forme des noms, mais refuse nom/description/corps
absents et YAML invalide. Ce n’est pas un validateur exhaustif de la spécification.

`skills/catalog.json` enregistre explicitement les dossiers de confiance :

```json
[
  {
    "id": "f2c7fa42-1a0e-46e4-93ab-68fb45101f26",
    "path": "code-review",
    "defaultEnabled": true
  }
]
```

L’UUID est l’identité Heart ; nom et chemin servent à présenter/localiser le skill.
Un renommage de dossier change uniquement `path`, sans changer l’UUID ni les choix.
Le fichier standard `SKILL.md` n’exige aucun champ propriétaire. Le manifeste est
un catalogue d’installation Heart, pas un nouveau format de skill.

`HARNESS_SKILLS_CATALOG` permet de choisir un autre manifeste. Les chemins sont
résolus relativement à ce fichier (ou explicitement absolus). Aucune recherche
implicite dans les dossiers Nora/Codex, le home ou les dépôts travaillés. Un skill
de `.agents/skills/` peut être enregistré avec le même format. Le premier lot ne
comprend pas d’installateur GitHub, de marketplace, d’éditeur de contenu web ou de
règles d’activation par projet. Ajouter localement un dossier et son entrée suffit.

Un nouveau skill sans `defaultEnabled` reste désactivé. Le skill fourni a un UUID
fixe et un défaut explicite ; le propriétaire peut le désactiver. Un skill invalide
reste visible avec son diagnostic, sans bloquer les autres entrées valides. Un
manifeste invalide est signalé, sans repli sur un catalogue externe.

## Chargement dans une conversation

1. Une lecture du profil capture limites, instructions et choix d’activation pour
   le prochain tour. Le catalogue de fichiers est vérifié ; le texte de chaque
   `SKILL.md` est identifié par SHA-256 et mis en cache selon son état fichier.
2. Seuls UUID/nom/description des skills activés entrent dans le catalogue du LLM.
   Aucun corps complet ni ressource n’est injecté avant utilisation.
3. Le modèle choisit `skills.load` lorsqu’un skill correspond à la tâche. Le résultat
   contient fichier complet et liste de ressources, pas leur contenu.
4. `skills.read` lit une référence relative à ce skill. Texte en UTF-8, binaire en
   base64, octets conservés. Aucun script n’est exécuté automatiquement.

Le propriétaire peut invoquer `$code-review` directement. Heart le charge avant le
premier appel, y compris pour un modèle sans outils. Les noms connus désactivés
produisent une erreur claire ; `$PATH`/`$HOME` et autres tokens inconnus restent du
texte ordinaire. Un nom ambigu peut être remplacé par `$<UUID>` ; le bouton de copie
dans la fiche choisit une invocation non ambiguë.

Un modèle déclaré sans outils reçoit cette distinction : le catalogue ne lui fait
pas croire qu’il dispose de `skills.load`. L’invocation explicite reste disponible.
Les modèles outillés gardent leur jugement de sélection ; la simulation ne prouve
pas qu’un fournisseur réel sélectionnera toujours le bon skill.

## Contexte, reprise et droits

`SkillRun` dans app enveloppe un `ContextManager` injecté. Les instructions chargées
sont conservées une seule fois dans les instructions de travail, hors résumé. Les
résultats d’outil présentés au modèle deviennent des reçus courts ; le journal
canonique garde les fichiers complets d’origine. Le nombre et l’ordre des messages,
les call IDs et la référence du checkpoint restent inchangés.

Une reprise reconstruit les skills chargés depuis les résultats `skills.load` et
les invocations utilisateur du journal complet, même si les messages sont couverts
par un checkpoint. Une désactivation enlève la guidance au tour suivant et remplace
les anciens corps d’outil par des reçus inactifs dans le contexte envoyé. Les données
historiques originales ne sont pas effacées. Une nouvelle révision ne réactive pas
le corps ancien ; une lecture à révision périmée échoue explicitement. Les ressources
sont lues à la demande, sans prétendre figer leurs octets pour tout le tour.

La permission `skills.read` donne seulement lecture des instructions/ressources des
skills activés. Elle est distincte de l’accès aux fichiers du workspace. Le core
continue d’appliquer droits fichiers, terminal et réseau ; `allowed-tools` du YAML
ne les élargit jamais. Les scripts doivent passer par les outils ordinaires et leurs
permissions, avec copie dans le workspace si nécessaire pour l’exécuteur isolé.
Les traversées et liens symboliques sortant du dossier enregistré sont refusés.

Un dossier enregistré est du contenu de confiance choisi par le propriétaire ; un
skill n’est pas un sandbox. Ne jamais y stocker de secret. Pas de limite arbitraire
ajoutée à la taille du corps ou des ressources ; la mémoire serveur et la fenêtre
réelle du modèle restent des contraintes. Les guidances effectivement utilisées
occupent du contexte : désactiver les skills inutiles ou ouvrir un nouveau fil si
nécessaire. Aucun chargement/inférence payant pour consulter ou configurer.

## Contrats, persistance et API

- `contracts/skills.ts` : descriptions, documents, ressources, `SkillCatalog` et
  `SkillReader` indépendants des fichiers, du modèle et de SQL.
- `modules/skills/local` : manifeste, YAML et ressources ; seul module de fichiers.
- `modules/tools/skills` : deux outils via le contrat de lecture.
- `app/compose.ts` ouvre le catalogue ; `app/web-conversations.ts` l’assemble avec
  l’application `Skills`, le tour et le contexte existants. Aucun import concret
  d’un module par un autre, aucun changement du core d’orchestration.
- `AssistantSettings.skillOverrides` stocke seulement les écarts aux défauts dans
  le profil JSON existant, PostgreSQL ou SQLite. Pas de migration ni nouvelle table.
  Anciens clients préservés, CAS du profil et fusion des changements indépendants.

`GET /api/skills` : profil/version, catalogue, activation effective et diagnostics.
`GET /api/skills/:id` : instructions et liste de ressources pour consultation propriétaire.
`POST /api/skills` : `id`, `revision`, `version`, `baseEnabled`, `enabled`.
Authentification/origine/CSRF ordinaires ; conflit sur l’activation renvoyé en 409.
Lire une fiche désactivée est possible pour le propriétaire ; le modèle ne peut
pas la charger. Activation inchangée : aucune nouvelle version du profil.

L’interface charge le catalogue seulement dans Capacités, le réutilise selon la
version du profil et conserve les cartes inchangées. Source par fiche à la demande,
fermeture possible pendant sa lecture, enregistrement visible et verrouillé,
erreur/conflit annoncé. Purge et contrôle de génération après déconnexion.
La gestion CLI des skills n’est pas ajoutée dans ce lot ; les contrats sont réutilisables.

## Sauvegarde et qualification

Le catalogue et le skill fournis sont versionnés et inclus dans l’archive source
du bundle géré. Le profil conserve les activations. Un manifeste ou des dossiers
externes doivent être ajoutés explicitement aux scopes de sauvegarde de l’installation ;
le choix d’une variable d’environnement ne les inclut pas automatiquement.

`pnpm test:skills`, `pnpm check`, démo et parcours Chromium. Le scénario HTTP charge
une référence, lit un fichier du workspace avec les permissions de lecture et affiche
la réponse dans le chat ; fournisseurs simulés, aucun jugement sémantique réel revendiqué.
[Preuves, captures et limites](qualification/skills/README.md).
