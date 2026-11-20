# Heart comme agent de développement

Cible demandée : les capacités opérationnelles de Codex CLI avec le moteur,
la mémoire, les permissions et les fournisseurs LLM indépendants de Heart.
Heart ne lance pas Codex CLI derrière son interface et ne lui délègue pas sa boucle.

La [documentation officielle Codex CLI](https://developers.openai.com/codex/cli/features),
consultée le 16 novembre 2026, décrit un agent travaillant dans un dépôt avec
inspection, édition, exécution et revue, puis des extensions (MCP, skills,
recherche web, délégation…). Cette référence ne constitue pas une promesse de
parité de toutes les fonctions ou de qualité identique avec tous les modèles.

## Utiliser le mode

1. Ouvrir une conversation, puis le dossier du chat ou le menu Fichiers.
2. Choisir **Développement · fichiers et terminal** dans l’accès de l’assistant.
3. Si nécessaire, autoriser le réseau dans les réglages d’exécution et appliquer.
   Les commandes peuvent alors joindre aussi les services accessibles depuis
   le serveur ; ce n’est pas un proxy limité aux sites publics.
4. Pour un accès au serveur entier, choisir **YOLO · serveur entier, root, sans confirmation**. Ce choix persiste pour ce fil ; le chat affiche un badge YOLO. Les autres fils restent inchangés.
5. Choisir son cerveau puis demander une tâche de développement. Pour une
   commande manuelle : bouton Terminal, ou carte Développement des Capacités.

Le projet est l’espace du fil : importer une archive puis l’extraire avec Python,
ou cloner un dépôt dans cet espace avec Git et le réseau explicitement autorisé.
Le répertoire courant du terminal est relatif à cet espace. En mode Développement, le rattachement
à un dossier arbitraire déjà présent sur l’hôte n’est pas livré. En YOLO, le terminal
accepte un cwd absolu ; outils fichiers et explorateur ont aussi accès aux dossiers
hôte en root. Le dossier du fil reste seulement le point de départ. Aucun dépôt ni runtime Nora n’est modifié par l’activation du mode.

## Livré et écarts

| Capacité | Heart aujourd’hui |
| --- | --- |
| Explorer un projet, lire des fichiers | Outils fichiers ; pagination configurable, tous formats pour les opérations génériques. |
| Recherche dans le code | `rg` via terminal, dans le projet. |
| Modifications ciblées | `files.replace` avec texte unique et révision ; Git apply disponible pour les diffs unifiés via fichiers ou terminal. |
| Scripts, tests et outils de build | Commandes shell réelles avec Node.js, Python et outils installés. |
| Git | Commandes Git natives : init, status, diff, branches, commits… Les opérations distantes dépendent du réseau et des accès explicitement configurés. |
| Commandes longues | Exécution asynchrone, identifiant, sortie intégrale sur disque, lecture par pages, statut et code de sortie. |
| Entrée standard et arrêt | Envoi de texte/EOF ; arrêt du processus et de ses descendants. |
| Instructions du dépôt | AGENTS.md à la racine injecté avant le run ; le modèle doit consulter ceux des sous-dossiers concernés. |
| Boucle de travail | Exploration → édition → tests → correction → bilan. Pas de plafond de tours dans le web par défaut : 0, avec budget positif configurable et arrêt utilisateur. |
| Choix du cerveau | Fournisseurs Heart existants, aucun repli implicite ; le modèle doit prendre en charge les outils. |
| Terminal PTY complet, applications TUI | Non livré : console par pipes, sans émulation de terminal ou redimensionnement PTY. |
| MCP, skills | MCP de lecture Streamable HTTP livré avec recherche auto-hébergée ; gestion automatique des skills non livrée. Aucun framework de plugins maison. |
| Web search, délégation, plans structurés/revue dédiée | Non livrés comme capacités natives. Un plan textuel ou une revue demandée au modèle n’est pas un mode spécialisé. |
| Projet partagé entre plusieurs fils, worktrees gérés | Pas de gestion dédiée. Le dossier du fil reste distinct ; YOLO peut travailler dans un répertoire hôte explicite via fichiers ou terminal. |

Le terminal permet d’utiliser des bibliothèques pour traiter des formats que
l’éditeur UTF-8 ne sait pas interpréter. Les commandes courtes rendent leur sortie directement ; `terminal.read` sert aux
commandes encore actives ou aux pages restantes (`more`). Le terminal manuel
reste asynchrone sans attente supplémentaire.

Une capacité à exécuter Python ne prouve
pas que toutes les bibliothèques ou tous les outils de génération sont installés.
Le modèle reste responsable de vérifier le résultat et de signaler les échecs.

## Modules et contrats

`contracts/execution.ts` expose `ExecutionService` : start/read/write/stop/list,
commandes, statut et sortie paginée. Aucun type ChildProcess, SQL ou SDK LLM dans
ce contrat. `modules/tools/terminal` implémente BubblewrapExecution et les
adaptateurs Tool ; il ne construit aucun autre module concret. Un exécuteur
SSH ou un worker distant pourra remplacer celui-ci via le même contrat.
L’application construit une instance partagée puis fournit les outils au core.

| Outil | Effet |
| --- | --- |
| `terminal.exec` | Lance command, cwd relatif facultatif, timeoutMs facultatif ; retourne id, statut et première sortie. yieldTimeMs règle l’attente (500 ms par défaut, 0 immédiat), sans délai maximal de commande. |
| `terminal.read` | État, code de sortie et sortie stdout/stderr fusionnée ; offset/length configurables. |
| `terminal.write` | Texte sur stdin, close facultatif pour EOF. |
| `terminal.stop` | Arrêt avec escalade SIGKILL si nécessaire. |
| `terminal.list` | Commandes appartenant à cet espace, sans fuite des autres fils. |

La permission `process.execute` est accordée en modes develop et yolo. Ce
mode accorde aussi les écritures : une commande shell peut modifier les fichiers
sans passer par les révisions de l’éditeur. Les autres modes ne proposent pas
les outils terminal au modèle et le core les refuse s’ils sont demandés malgré
tout. Changer de mode arrête les commandes actives de l’ancien exécuteur.
Le changement de réseau ne reconfigure pas un processus déjà lancé : arrêter
les commandes actives avant de modifier ce réglage.

Les commandes manuelles utilisent le même exécuteur et la politique du fil,
sans requête LLM. Leurs commandes/sorties sont conservées séparément du contexte
du modèle. Celles demandées par le modèle passent par le journal et les contrôles
du core ; seule la page de sortie demandée est envoyée au modèle. Aucune sortie
totale n’est supprimée pour respecter une taille arbitraire de transcription.

## Isolation Linux et exploitation

Le mode Développement utilise Bubblewrap :

- Projet monté dans `/workspace`, système `/usr` en lecture seule, HOME et tmp
  propres à l’environnement, namespace de processus.
- Aucun montage des credentials Heart, des autres conversations, de /projects
  ou du HOME du service ; environnement enfant reconstruit, sans clés du LLM.
- Réseau isolé par défaut, partagé seulement sur choix du propriétaire.
- Aucun repli sur un shell hôte si Bubblewrap ne démarre pas : le code de sortie
  et l’erreur d’environnement sont visibles dans la sortie de commande.

La disponibilité de l’exécution est distincte des modèles. Sur une installation
sans `/usr/bin/bwrap`, le web reste utilisable et le terminal est indisponible.
Le backend actuel est Linux ; la portabilité des contrats n’est pas une
implémentation d’isolation Windows/macOS.

Sur Ubuntu : installer les paquets `bubblewrap` et `ripgrep`. Conserver les avis
de licence des paquets. Si AppArmor restreint les user namespaces, installer
`deploy/heart-bwrap.apparmor` comme profil ciblé puis le charger avec apparmor_parser.
Aucun sysctl global de sécurité n’est désactivé. Le drop-in
`deploy/heart-sandbox.conf` ajoute AF_NETLINK au compte de service, nécessaire
à la création du namespace réseau. NoNewPrivileges, ProtectSystem, ProtectHome, ProtectControlGroups et
ProtectKernelModules sont conservés. Le drop-in désactive seulement le masque
ProtectKernelTunables de ce service : ses sous-montages de /proc empêchaient
le worker non privilégié de monter son propre /proc privé. L’UID du service ne
peut pas écrire les paramètres noyau de l’hôte ; le compte ne gagne aucune
capacité noyau ni privilège root. Ce réglage a été vérifié dans une unité reprenant
les protections effectives de Heart. Le binaire Node du harness
est monté en lecture seule dans /opt/heart/bin pour ne pas modifier le runtime hôte.

Les commandes partagent les ressources configurées du service web (sur Heart :
1 CPU, 1 Gio, 192 tâches). Ce sont les paramètres d’exploitation actuels, pas une
limite de fichier ou de sortie imposée par le module. Pour des builds lourds,
un worker distinct évitera de partager le budget de ressources du serveur web.
Les tests concernés sont déportés sur nora-tests, sans modifier le runtime Nora.

Les processus restent attachés au service : un redémarrage les termine. Les
métadonnées persistées encore running sont alors présentées comme interrompues ;
aucune commande n’est relancée automatiquement. Un fil dont le run a été interrompu
conserve les règles existantes de claim et de réconciliation. Les journaux de
commandes sont dans le répertoire privé d’état, hors du montage du projet.

## Persistance et interface

Migration additive 007 : file_access accepte develop, network_access vaut false
et max_steps vaut 0 par défaut. Les UUID, messages, souvenirs et fichiers restent
inchangés. Les types du SDK ne sont pas persistés.

API protégée par session, origine et CSRF pour les écritures :

- POST `/api/conversations/:id/execution-policy` : network et maxSteps.
- GET/POST `/api/conversations/:id/commands` : liste/lancement.
- GET `/api/conversations/:id/commands/:commandId?offset=...` : état/sortie.
- POST `…/:commandId/input` ou `/stop` : stdin/EOF ou arrêt.

Le terminal a son overlay mobile/tablette/desktop, statut, sortie défilante,
sélecteur d’historique et bouton d’arrêt fixe. Les processus du modèle et du
propriétaire sont visibles dans cette vue. Les commandes actives ne sont pas
interprétées comme des réponses finales réussies.

## Preuves

- Suite courante : 106 tests et démos simulées ; scénarios terminal/budgets/patch/politique YOLO,
  dont vérification dans les contraintes du compte de service et sur nora-tests.
- PostgreSQL jetable : 19 tests, dont droits develop, réseau/budget,
  persistance et refus des changements pendant un claim.
- Chromium : cinq parcours web ; terminal réel, sortie, stdin, arrêt, droits
  conservés au rechargement, 320/390/820/1440 px. [Captures](design/development/README.md).
- [Essai réel DeepSeek](qualification/development/b79bc25e-8e07-407f-94dd-3b4e96b9bde7.json) :
  huit appels, 0,00094746 USD déclarés, budget 0,02 USD. Dans un dépôt jetable,
  tests initialement rouges (code 1), module corrigé par le modèle, tests et
  git diff réellement exécutés. Vérification indépendante verte (code 0), fichier
  de tests inchangé. Aucune simulation de commande ou de réponse du modèle dans
  cet essai. La persistance du runner live est JSON, la politique PostgreSQL est
  vérifiée séparément ; cette preuve ne constitue pas une qualification de tous
  les modèles ou d’un grand projet complexe.

## Mode YOLO : autorisation durable et serveur entier

Décision explicite du propriétaire, par conversation : **yolo** accorde les outils
fichiers, mémoire et exécution sans confirmation répétée. Un futur outil doit aussi
être raccordé à cette politique ; le mode ne crée pas des modules absents.
La migration 008 ajoute seulement la valeur yolo au CHECK file_access, sans
modifier les choix existants. Le core conserve journal, arrêt, claims et erreurs.
Le modèle reçoit le mode et la portée réelle dans ses instructions.

Un worker optionnel root expose ExecutionService via un **socket Unix privé**, sans
port réseau : `app/host-terminal.ts` assemble HostExecution ; le web utilise
HostExecutionClient du même module terminal. Le serveur web conserve son UID et
ses protections. Pas d’EnvironmentFile web, de token LLM ou d’environnement parent
transmis automatiquement au worker ou aux commandes.

Chaque commande YOLO est une unité transitoire systemd root avec réseau et système
de fichiers de l’hôte, environnement reconstruit et HOME dédié. cwd absolu accepté.
Le groupe de service et umask 0007 rendent les fichiers créés utilisables par Heart.
Les commandes n’héritent pas des plafonds CPU/mémoire du web ; les ressources physiques
et les réglages du gestionnaire de services restent applicables. Aucun timeout
applicatif par défaut. Les journaux YOLO sont privés au worker et distincts des
commandes isolées ; l’historique reste disponible en revenant au mode correspondant.
ExitType=cgroup et KillMode=control-group permettent de suivre/arrêter aussi un
enfant ayant appelé setsid. PartOf lie les commandes au cycle de vie du worker.
Un processus root peut néanmoins volontairement lancer un autre service ou changer
les réglages du serveur : YOLO est une délégation d’administration complète.

Le terminal peut lire/modifier/supprimer les fichiers du serveur, accéder aux secrets
présents sur l’hôte, installer des logiciels et administrer les interfaces réseau.
L’absence d’héritage des clés n’empêche pas un administrateur root de les lire
explicitement. Ne jamais demander au modèle d’afficher les credentials : commandes
et sorties sont journalisées. SSH/VPN nécessitent encore logiciels, destination et
authentification adaptés ; aucune connexion SSH ou VPN réelle n’est qualifiée ici.
Les choix réseau du mode isolé restent conservés, mais sont sans effet en YOLO.

Installation explicite : adapter les chemins/utilisateurs de
`deploy/personal-harness-host.service`, installer cette unité et le drop-in
`deploy/heart-yolo.conf`, puis daemon-reload, enable/start du worker et restart du
web. Le socket appartient à root:personal-harness (0660, dossier 0750). Toute identité
pouvant utiliser ce socket obtient les capacités root du worker. Sans worker,
l’option est indisponible ; aucun repli implicite, y compris pour un fil déjà YOLO.
Revenir à Lecture/Développement arrête les commandes YOLO actives de ce fil. Pour
retirer complètement la capacité : arrêter/désactiver le worker, retirer le drop-in
et redémarrer le web. Les métadonnées encore running après interruption sont
présentées comme interrompues, sans réexécution.

Références de mécanisme : [systemd-run](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html)
et [systemd.service, ExitType](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#ExitType=).
Qualification spécifique : `tests/host-terminal.integration.ts`, opt-in root sur
nora-tests, vérifie accès hors workspace et cwd /, UID 0, réseau loopback réel,
absence d’héritage d’un secret de test, stdin, code d’échec, arrêt des enfants
détachés, annulation et refus d’un autre fil/socket absent. Le navigateur vérifie
choix, badge, terminal, persistance et retour aux droits protégés avec un worker de
test substitué ; cette preuve UI est distincte de celle du véritable worker root.
