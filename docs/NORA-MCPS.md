# Raccordement Nora MCPs

20 novembre 2026. Trois connexions actives dans Heart : Mémoire partagée (8 outils),
Coffre-fort (9), Projets partagés (12), sur mcps.natio.re. Les clés appartiennent
au compte du propriétaire dans le portail MCP, avec une clé distincte par service.
Elles sont révocables depuis ce portail et restent hors SQL/journal de Heart.
La base locale conserve les conversations, tâches planifiées, fichiers et réglages.

## Première connexion des nouvelles installations

Compte MCP obligatoire avant le wizard. Portail HTTPS + RFC 8628, puis attribution
groupée Nora des clés Mémoire/Projets/Vault par UUID d’installation. Vérification
réelle des outils, fichier privé 0600 et redémarrage suivi. L’utilisateur ne copie
aucune clé ; la reconnexion garde les mêmes credentials et le même propriétaire.
Anciens déploiements non migrés implicitement. Voir [INSTALLATION.md](INSTALLATION.md).
Le stockage approuvé des sauvegardes wallet suit le même principe que la mémoire :
accessible sans activer le réseau général du modèle. Restauration explicite par
`wallets.backups` puis `wallets.restore`, fusion locale vérifiée sans exporter de clé.

## État de la mémoire

La mémoire automatique utilise désormais **le MCP**, sur choix explicite
« Commencer vide ». Zéro souvenir transféré. Les trois souvenirs actifs et leurs
révisions restent dans l’ancienne base locale, hors mémoire actuellement injectée.
La bascule a démarré vide ; les nouvelles écritures vont directement au MCP.
Les anciennes cartes ne retrouvent pas leurs souvenirs non importés via ce backend.
[Preuve de bascule](qualification/nora-mcps/memory-switch.json).

Le repository `modules/storage/mcp-memory` implémente StructuredMemoryRepository.
Les règles mémoire `structured`, revue proactive, contexte et cartes restent
communs. Le connecteur est injecté par l’assemblage web : aucun import entre modules.
`HARNESS_MEMORY_MCP_CONNECTION_ID` sélectionne explicitement la connexion approuvée.
Sans cette variable : stockage local. Si le MCP sélectionné est indisponible,
aucun repli ni double écriture locale implicite.

Les souvenirs personnels sont communs au compte MCP. Les projets Heart utilisent
le contexte `{namespace:"nora-projects",id:"UUID MCP stable"}` ; les projets
d’autres namespaces et les portées company ne sont pas injectés par cet adaptateur.
Leurs données restent accessibles par les outils MCP autorisés. Les recherches
respectent les budgets Heart, réunissent personnel/projet, paginent et ne chargent
pas les guides complets dans chaque message. Les informations de provenance
utilisent nora-heart.conversation/manual/legacy. Les échecs métier gardent leurs
codes NOT_FOUND/CONFLICT/GONE/INVALID/UNAVAILABLE sans corps d’erreur distant brut.

Une mémoire automatique distante est une infrastructure de persistance approuvée,
comme un PostgreSQL distant ; elle ne dépend pas du bouton réseau du modèle.
Les autres outils MCP restent soumis au réseau/YOLO et à la sélection propriétaire.
La connexion mémoire liée n’est pas présentée deux fois au cerveau : outils natifs
memory.* conservés, autres MCP en alias stables. Les appels valident toujours la
connexion, les schémas approuvés et la clé ; pas d’écriture automatique au démarrage.

L’oubli dans le MCP supprime le souvenir et ses révisions actives. L’adaptateur
annonce supportsRestore=false, retire memory.restore et informe l’UI. Les anciennes
sauvegardes ont leur propre rétention. Pas de restauration fictive depuis le MCP.

## Bascule explicite et retour arrière

`scripts/migrate-memory-mcp.ts --apply --without-copy` a été exécuté sous maintenance,
Heart arrêté et sauvegardé. Aucun souvenir local copié, modifié ou supprimé ; aucune
donnée distante effacée. Le fichier d’alias privé est vide, ce qui correspond au
choix sans import. Contrôle source par empreinte et UI du backend actif vérifiés.
Le mode de copie `--apply` existe pour d’autres installations, mais n’a pas été
exécuté ou qualifié en production pour ce chantier. Il ne fait pas partie de la suite.

Variables de sélection dans /etc/personal-harness/nora-mcps.env et alias privés sous
/var/lib/personal-harness/mcp-memory-aliases.json, inclus dans le bundle de Heart.
Les données MCP ont leurs propres sauvegardes sur nora-mcps ; restaurer Heart seul
ne restaure pas ces services distants. Les conversations restent dans Heart.
Retour local : retirer les deux variables HARNESS_MEMORY_MCP_* puis redémarrer
sous maintenance ; les données locales d’origine sont conservées. Ce retour ne
synchronise pas les écritures distantes ultérieures et n’efface aucune copie.

## Permissions et coffre

Écriture MCP : case propriétaire explicite par connexion + outils sélectionnés.
Permission external.write distincte de external.read ; le réseau du fil (ou YOLO)
autorise les deux uniquement pour ces outils déjà approuvés. Une annotation seule
n’accorde pas de droit. Chaque appel revalide version et catalogue, sans retry.

Le coffre utilise le mode « Contenu sensible · ce tour uniquement ». Ses appels
et résultats restent utilisables par le modèle dans le tour actif ; le journal
conserve des marqueurs, jamais les arguments/résultats bruts. Leurs valeurs sont
également retirées de la requête de revue mémoire. Au tour suivant ou après crash,
le modèle doit relire le coffre ; aucun secret n’est rejoué automatiquement.
La compression ne résume que les tours précédents, déjà expurgés dans le journal ;
le tour courant garde ses données et son estimation réelle de contexte.

Limite : le modèle/fournisseur voit ces valeurs et peut les recopier dans un texte,
un commentaire ou un autre outil. Ce mécanisme ne garantit pas le masquage d’une
réponse produite par un modèle ni le contrôle des logs d’un fournisseur. Les consignes
l’interdisent, sans prétendre à une isolation cryptographique de l’inférence.

## Projets et guides

Le MCP Projects est l’unique source des projets : création et gestion métier,
objectifs, tâches métier, blocages, décisions, archives et références. Heart garde
les artefacts physiques sur son serveur, les conversations et le planning local,
référencés par l’identifiant du projet MCP. Aucun second catalogue métier à gérer.
Le MCP ne crée pas les dossiers sur le serveur Heart et ne lance pas son ordonnanceur.

L’interface et les services Heart utilisent McpProjectsRepository lorsque
HARNESS_PROJECTS_MCP_CONNECTION_ID est défini. Aucun doublon local ni repli en cas
d’échec ; création idempotente par operationId, UUID retourné utilisé partout.
PostgreSQL 015 / SQLite 003 retirent les références obligatoires au catalogue local,
sans supprimer ses anciennes lignes. Les nouveaux souvenirs projet utilisent
namespace nora-projects et l’id distant ; aucune conversion implicite des anciens
namespaces. Les conversations et leur historique restent locaux dans ce lot.
Une référence de conversation peut utiliser namespace nora-heart.conversation
et son UUID ; aucun transfert de conversation implicite.
Les outils *_help fournissent les guides à la demande, sans nécessiter le support
MCP Resources par Heart. Aucune seconde copie complète de structuredContent et de
son repli texte n’est ajoutée au contexte.

## Exploitation et preuves

`provision-nora-mcps-keys.py` réserve trois clés sur l’installation propriétaire
explicitement désignée ; pas une procédure générique d’inscription. Valeurs jamais
affichées, fichiers privés root. Un accès révoqué n’est pas recréé implicitement.
Les autres installations créent leurs clés dans le portail et configurent leurs
propres variables NORA_MCPS_MEMORY_TOKEN/VAULT_TOKEN/PROJECTS_TOKEN.
`connect-nora-mcps.ts` découvre/approuve/enregistre les connexions ; aucun transfert.
Le drop-in systemd 40-nora-mcps.conf charge le fichier privé. Le bundle inclut ce
fichier et les overrides ; --force permet une sauvegarde fraîche le même jour.

217 tests, pnpm check, démo et deux tests du bundle passent. Parcours Chromium
réel avec modèle simulé : approbation d’écriture, contrôles sensibles, réseau,
révocation et affichages 320/390/820/1440 px. 21 contrôles via les MCP HTTPS publics
avec le client Heart SDK 1.32.2, serveurs SDK v2 : vrai PostgreSQL/OpenBao, adaptateur
mémoire, versions, clés et utilisateurs isolés, parcours Engine avec secret absent
du journal. Aucune inférence réelle : cette qualification ne prouve pas le jugement
d’un modèle pour décider d’utiliser les bons outils. Fixtures distantes retirées.
Production : découverte des trois catalogues via le processus Heart et contrôles
UI HTTPS, sans appel LLM, outil métier, sauvegarde de config ou transfert de données.
[Preuves](qualification/nora-mcps/).

Sauvegarde post-raccordement : archive age déchiffrée/vérifiée, vrai pg_restore
PostgreSQL isolé sans réseau (512 MiB), quinze tables, trois connexions et fichier
privé MCP restaurés. Temporaire retiré, aucun secret écrit dans les preuves.
Les douze tables métier comparées avant/après restent identiques ; seuls les
catalogues de connexions sont changés intentionnellement. [Preuve backup](qualification/nora-mcps/backup.json).


## Qualification après bascule sans import

Le choix « Commencer vide » est appliqué : MCP actif, vue vide, supportsRestore=false,
source locale inchangée, aucun alias d’import. Vérification HTTPS de la vraie application
sur quatre largeurs, sans écriture de démonstration dans le compte propriétaire.

GPT‑6 Luna medium réel, 5 appels, sans repli API : enregistrement d’une note
synthétique dans le compte MCP de QA, puis rappel dans un nouveau fil. L’injection
est vérifiée dans la requête réellement envoyée au modèle. 24 contrôles incluant
les parcours techniques précédents ; aucune confusion avec le modèle simulé.
Les comptes/clé/données de QA sont retirés après le parcours ; aucune note de test
ne reste dans la mémoire propriétaire. [Preuve](qualification/nora-mcps/live-chatgpt-memory.json).

Sauvegarde après bascule sans copie : sélection MCP, credentials privés et alias
vide réellement restaurés, ainsi que les quinze tables SQL et les trois originaux
locaux. Conteneur réseau isolé et fichiers temporaires retirés. Les données des
services distants restent couvertes par les sauvegardes indépendantes nora-mcps.
[Preuve](qualification/nora-mcps/memory-switch-backup.json).


## Correctif du validateur modèle

Les schémas MCP SDKv2 annoncent JSON Schema 2020-12. Les validateurs des adaptateurs
ChatGPT et AI SDK utilisaient uniquement draft-07 : un outil connecté suffisait
à faire échouer tout le chat avant l’appel réseau au modèle. Le connecteur MCP
reconnaissait déjà ce dialecte ; son seul test ne qualifiait pas la chaîne complète.

Les deux adaptateurs modèles sélectionnent maintenant le bon validateur Ajv et
chargent les formats UUID/date via ajv-formats 3.0.1 (MIT), dépendance explicite
épinglée déjà présente dans le graphe MCP. Strict reste activé ; arguments erronés
rejetés, aucune coercition ou exécution permissive. Les objets MCP persistants et
les permissions ne changent pas. 219 tests et démo passent.

Le parcours réel expose désormais les 21 outils MCP actifs de Vault/Projects en
plus des outils mémoire natifs. Les permissions external.read/write sont présentes
et la requête réellement envoyée est observée : le test échoue si les outils MCP
ont été filtrés avant le modèle. GPT‑6 Luna medium : 5 appels réels et rappel
mémoire depuis un nouveau fil, sans repli API ; compte et données QA retirés.

## Qualification de la gestion projet unifiée

Le formulaire réel a créé un projet sur les MCP déployés, sous utilisateur QA
isolé ; présence après rechargement vérifiée à 320/390/820/1440 px, sans débordement
ni erreur JS. L’assemblage applicatif crée/rattache conversation et souvenir au
même UUID distant, avec zéro ligne dans le catalogue SQL local ; création réémise
sans doublon, renommage externe visible et archivage respecté. 36 contrôles sans
inférence, puis 38 avec GPT‑6 Luna medium (11 appels, création projet par le chat
et mémoire réelle). Les identités et données QA ont été retirées dans les deux cas.
PostgreSQL 14→15 et SQLite 2→3 préservent les données ; aucun import des anciennes
références. Voir STATUS.md pour le déploiement et la publication.

## Mail

`https://mcps.natio.re/mail` avec une clé Mail distincte liée au même utilisateur.
19 outils MCP : comptes/dossiers, lecture/recherche, identités/signatures,
brouillons/envoi/rapprochement, export EML et PJ, guide différé. Le portail HTTPS
configure les comptes IMAP/SMTP et signatures ; Gmail OAuth dispose du client Google
de l’instance, qualifié avec un compte réel le 23 novembre 2026. `HARNESS_MAIL_MCP_CONNECTION_ID` relie la connexion au transfert
binaire `mail.attach_file` / `mail.save_attachment`, sous droits réseau/fichiers
existants. Nouveau login : scope quatre services, sans rotation à la reconnexion.
Les installations historiques peuvent conserver leurs trois connexions.

Comptes préparés : l’état explicite `pending` distingue une configuration sans
credentials d’une boîte connectée. Les accès existants de Natio Connect peuvent être transférés via l’intention V4
`communications_sender_transfer` vers une destination préautorisée par opérateur,
limitée au groupe, à l’acteur et aux UUID des boîtes. Les outils ne retournent
aucune valeur privée : transfert HTTPS direct au serveur Mail, test fournisseur,
chiffrement OpenBao et reçu idempotent. Le portail reste la voie de saisie manuelle.
Pour Gmail en IMAP/SMTP, utiliser un mot de passe d’application Google lorsque
disponible (validation en deux étapes nécessaire), pas le mot de passe normal.
Google OAuth constitue une voie distincte, avec consentement et refresh token
privé sur le serveur Mail ; le compte préparé conserve son UUID et ses signatures.
La connexion du plugin Gmail de ChatGPT n’est pas un credential exportable Heart.
