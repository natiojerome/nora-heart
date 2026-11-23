# État et reprise

Point du 23 novembre 2026. Lire aussi ARCHITECTURE.md, DECISIONS.md et PLAN.md.
Socle livré ; la parité complète avec Codex CLI et la qualification de tous les
fournisseurs restent partielles. Les preuves détaillées sont dans TESTING.md et
les rapports opérateur privés, pas dans le contexte permanent de l’assistant.

## Cohérence des capacités

Libellés et icônes partagés pour les connexions et leurs outils, regroupement
compact/repliable par service, titres français pour les outils intégrés et noms
techniques dans le détail. Onglets Outils / Skills / Connexions MCP. Les noms
personnalisés, snapshots approuvés, UUID et permissions restent inchangés. La
mémoire distante n’est plus présentée comme un outil intégré. 278 tests et démo
SDK réussis, régressions navigateur ciblées et suite complète documentées dans
TESTING.md. Quatre boîtes du propriétaire connectées côté Mail avec leurs UUID, identités et
signatures conservés : trois IMAP/SMTP par transfert serveur-à-serveur Natio V4
autorisé et Gmail par OAuth Google réel. Le client OAuth dédié appartient à
l’instance MCP ; aucun credential mail dans Heart ou les arguments du modèle.
Authentification, dossiers, recherche sans résultat et identités vérifiés via les
outils approuvés Heart, sans envoi ni lecture de contenu personnel.

## Mail MCP et pièces jointes

Service `/mail` actif et raccordé au compte propriétaire, 19 outils découverts :
comptes, dossiers, lecture/recherche, brouillons/envoi, signatures par identité,
export EML et PJ. Credentials configurés dans le portail HTTPS, pas dans le chat.
Transferts binaires `mail.attach_file` / `mail.save_attachment` sous droits du fil.
Images MCP transmises au cerveau, pixels volatils hors journal ; références
conservées pour relecture. 278 tests, démo SDK et 28 parcours navigateur réussis ;
GPT‑6 Luna réel a correctement lu une image synthétique issue d’un outil.
Nouveaux onboardings à quatre clés ; anciennes installations à trois préservées.
Quatre boîtes personnelles connectées et testées via Heart le 23 novembre :
Gmail OAuth réel et trois comptes OVH IMAP/SMTP TLS. Les accès sont chiffrés dans
OpenBao Mail, sans copie dans Heart. Transfert V4 rejoué avec les mêmes opérations :
aucun doublon ni changement de version. Prochaine étape : un parcours métier
de lecture/réponse/PJ demandé par le propriétaire ; aucun envoi implicite.

## Installation indépendante et onboarding

Commande GitHub avec `--path`, Debian 12+/Ubuntu 24.04+ et systemd. Prépare Node,
pnpm, PostgreSQL privé, migrations, web, fichiers/terminal, worker hôte YOLO,
recherche locale et coffre wallet vide. Services/ports/comptes isolés par UUID,
données privées dans le dossier choisi, sans importer notre installation.
Sans domaine, accès direct `http://IP:port` par défaut, détection automatique et
`--address` pour préciser. `--domain` ajoute Caddy/HTTPS ; `--private` réserve le
tunnel SSH aux installations qui le demandent. Anciens modes réseau préservés.
Nouvelles installations : connexion au compte MCP obligatoire avant le wizard,
via portail HTTPS (connexion ou création de compte depuis Heart, email autorisé) ; clés Memory/Projects/Vault/Mail créées/vérifiées et stockées en local
sans copier-coller. Compte lié à l’installation, reconnexion sans rotation des clés.
Lien privé initial à usage unique ; mot de passe local réservé à l’administration.
Les déploiements existants gardent leur accès et leurs credentials.

Onboarding : identité/thème/personnalité, fournisseur et modèle/effort par défaut
réellement enregistrés, simulation explicite, connexions MCP vérifiées par le serveur au retour du portail. Credentials en fichier privé, schémas en SQL, restart suivi et reprise.
Les nouveaux déploiements n’activent aucune mémoire SQL de remplacement ; mémoire
et projets distants demandent leurs connexions. Données métier et ancien runtime
préservés. Voir [INSTALLATION.md](INSTALLATION.md).

266 tests, démo SDK et cinq parcours navigateur de régression réussis. Installations
jetables sur l’hôte existant : bootstrap GitHub, chemins avec espaces, IP HTTP,
PostgreSQL/systemd, fichiers, terminal protégé/root YOLO, reprise et persistance.
Les utilitaires navigateur UUID/copie et les formules fonctionnent sur IP HTTP.

**Qualification fournisseurs antérieure, avant la connexion unique :**
- ChatGPT abonnement, `gpt-6-luna`, effort `low` : fichier créé/relu, commande
  Node 24, recherche Projets MCP, mémoire distante créée, puis retrouvée depuis
  un nouveau fil après redémarrage. Dernier essai sans erreur d’outil/JavaScript.
- OpenRouter, `deepseek/deepseek-v4-flash-0731` : même parcours réel réussi après
  ajout de la clé via Fournisseurs et changement des défauts. Aucun repli de modèle.
  Baisse observée sur le compte : 0,001644954 USD, compteur partagé (pas une facture
  isolant formellement cet essai). Dernier essai sans erreur d’outil/JavaScript.
- Venice : onboarding/catalogue réel et MCP validés ; inférence refusée HTTP 402
  avec 0,08653047 USD, zéro DIEM/crédit inclus et accès API refusé. Ce seul parcours
  modèle reste bloqué ; cela ne bloque pas ChatGPT/OpenRouter.

Clés API/MCP réutilisées explicitement depuis les fichiers privés, pas fournies par
l’installateur. Pour ChatGPT, autorisation courte durée isolée, sans refresh/id token ;
une nouvelle connexion OAuth et son renouvellement ne sont pas qualifiés ici.
Mémoire CRUD, recherches Projets et métadonnées Vault également testées directement.
Souvenirs synthétiques et installations jetables supprimés ; services historiques
sains. Aucun serveur acheté/créé. OS vierge, ACME public et ARM64 restent à qualifier.
Proxy Caddy validé séparément par son binaire. Voir [TESTING.md](TESTING.md).

## Wallets locaux et reprise distante


Création/renommage et reprise livrés : UUID stable/idempotent, nom modifiable,
génération EVM/Ed25519 locale, mutations chiffrées atomiques sous verrou OS.
`wallets.backups` découvre les copies du compte ; `wallets.restore` fusionne dans
le coffre actif, conserve UUID/clés et noms locaux, refuse les conflits sans écrire.
Rechiffrement avec la clé locale actuelle et signataires utilisables sans restart.
Outils Heart, SDK JS/Python et CLI/socket raccordés. Backup par processus séparé,
statut de révision vérifiée. Clé Vault chargée uniquement par l’enfant ; archive
et clé de reprise via pipe privé, jamais une réponse d’outil modèle.
272 tests et 27 tests navigateur, dont le parcours mobile compte : succès. Portail : 103 contrôles HTTP/SQL
réels, isolation A/B, refus/expiration/rejeu, navigateur email/mot de passe + accord.
Installation native jetable sur l’hôte existant : vraies clés MCP automatiques,
onboarding, fichiers, terminal, redémarrage, reconnexion sans rotation et refus du
mot de passe local comme contournement ; autorisation du compte par opérateur,
chat simulé pour ce parcours. Aucune nouvelle VM ni inférence LLM dans ce lot.
Essai réel daemon/Vault : deux wallets synthétiques restaurés dans un coffre neuf
avec autre clé locale, signatures puis répétition sans doublon vérifiées ; archives
et fixtures retirées. Anciennes sauvegardes réessayables sans changer leur payload.
Aucun wallet personnel créé/restauré implicitement. Voir TESTING.md.
Déployé : sauvegarde du coffre existant vérifiée via la nouvelle API, quatre MCP
actifs et signataire sans token Vault dans son environnement.

Connexion de recherche commerciale supprimée du catalogue actif ; anciens IDs
UI renommés et descriptions obsolètes retirées. Recherche locale conservée.

Service Unix séparé livré : inventaire multi-réseaux, cache des actifs, signatures
EVM (message/typed data/transaction) et Ed25519 Solana hors ligne. Clients persistants
JavaScript natif et Python standard, outils Heart sous les droits du fil ; signature
déclarée en YOLO avec activation propriétaire. Aucun SQL, LLM ou MCP sur le chemin
de signature. XRPL et XPR restent en lecture seule dans ce nouveau module ;
les contrats ERC-20 à lire sont configurés, sans découverte universelle.

Déployé avec un coffre local AES-GCM et credential systemd ; inventaire existant
importé explicitement, sources/ancien signataire conservés. Sauvegarde dans le
MCP Vault du propriétaire et vérification quotidienne séparées du daemon.
Le Vault conserve aussi la clé de récupération : il est une autorité de confiance.
Sauvegarde réelle relue et restaurée dans un clone tmpfs, toutes les clés/adresses
et signatures de contrôle vérifiées puis clone supprimé. Challenge EVM et actifs
Base vérifiés en production, puis lectures réelles réussies sur les dix réseaux
avec un wallet représentatif par réseau ; aucune transaction diffusée ni crédit
LLM consommé. Réseau EVM sans actif natif (Tempo) traité explicitement, sans
solde natif fictif ; compatibilité de lecture du premier coffre v1 conservée.

261 tests et démo SDK ; parcours Unix JS/Python et boucle moteur à fournisseur
simulé. Médiane sur le daemon déployé : signature EVM JS 1,213 ms, Python 0,821 ms,
clients dans des processus séparés et connexions chaudes, sans RPC. Ni SLA ni promesse de délai
nul. Contrats, utilisation, restauration, limites et mesures : [WALLETS.md](WALLETS.md).
Suite : utiliser ce socle sur un flux réel de code ; ajouter des adaptateurs
de signature/répertoire ERC-20 selon un besoin concret, sans refaire le transport.

## Reprise après appel d’outil invalide

L’arrêt du fil First try révélait qu’une erreur de validation SDK interrompait
le tour au lieu de rendre la main au modèle. Correction à la frontière modèle :
traduction locale d’un nom Heart exact autorisé, puis validation stricte inchangée.
Le contrat ModelToolCallError permet au moteur de demander une correction au même
modèle, dans le budget d’étapes existant ; tout le lot invalide reste sans effet et
les opérations précédentes ne sont pas rejouées. Diagnostic sûr conservé, sans
arguments ni erreur fournisseur brute. L’ancien journal ne permet pas d’identifier
le champ exact invalide : aucune cause plus précise n’est prétendue rétrospectivement.

253 tests et démo SDK réussis. Essai réel sur
`e2ee-deepseek-v4-1-flash-1017-abliterated` : après injection volontaire d’arguments
invalides dans une réponse, trois requêtes fournisseur, une lecture fichiers valide
et restitution du marqueur. 2 300 tokens d’entrée et 483 de sortie. Aucun rejeu
du tour propriétaire ni effet métier. Déployé après sauvegarde locale chiffrée.

## Venice AI

Fournisseur ajouté aux connexions, modèles du fil et défauts des nouvelles
conversations. Catalogue public réel actualisable : 148 modèles texte observés,
capacités outils/vision/effort et tarifs adaptés. Clé privée via UI ou environnement,
indépendante des autres connexions. Contexte/effort vérifiés sur le catalogue ;
prompt, outils et permissions restent ceux de Heart.
246 tests locaux et cinq parcours navigateur ciblés validés ; parcours Venice
avec transport simulé, sauvegarde
et rechargement des défauts, chat, erreur/reprise de catalogue et quatre largeurs.
Clé Venice reconnue et compte rechargé le 21 novembre. Catalogue réel :
148 modèles texte, aucun tarif API nul. DeepSeek V4.1 Flash Uncensored qualifié
avec le véritable adaptateur et moteur Heart : deux appels fournisseur, une lecture
réelle par l’outil fichiers et restitution d’un marqueur inconnu du prompt.
Fixture temporaire supprimée ; aucune conversation ni mémoire propriétaire modifiée.
Solde et limites désormais raccordés à Consommation et à la barre du chat via un
seul GET authentifié, sans inférence. Cache une minute et requêtes simultanées
regroupées. USD, DIEM et crédits inclus séparés ; pas de reset inventé du solde USD.
L’historique détaillé requiert une clé administrateur chez Venice et reste absent
avec la clé d’inférence choisie. Déployé après sauvegarde locale chiffrée :
HTTPS authentifié et vue Consommation vérifiés aux quatre largeurs. Lecture réelle
qualifiée, sans coût LLM ; 250 tests,
parcours navigateur Venice (quatre largeurs, erreur/reprise) et démo SDK réussis.

## Personnalité et continuité des informations

Défauts : amical avec l’utilisateur, amical et professionnel avec les interlocuteurs
externes ; personnalités personnalisées préservées. Limites de message/lot, appels
de résumé, taille fixe du résumé, candidats et injection mémoire sans plafond
Heart par défaut ; le budget réel du modèle reste déterminant. Configuration →
Limites expose taille de résumé et nombre de tours récents (défaut quatre).
Compression conserve les décisions et faits précis ; mémoire ajustée à la place
disponible. Les originaux ne sont jamais remplacés : history.read permet au modèle
de retrouver messages/date et outils historiques du fil après compression.

242 tests ; cinq parcours navigateur ciblés et démo. GPT‑6 Luna medium réel :
15 appels, deux compressions, code/date/heure/montant conservés, récupération
spontanée d’un détail puis référence et horodatage du message original, brouillon
externe cordial sans envoi. Aucun souvenir ni fil propriétaire modifié. Voir
TESTING.md pour les limites et les premiers essais exclus de la validation.

## Mission, autonomie et initiative

Le bloc Exécution et autonomie définit l’objectif principal : accomplir la demande
de l’utilisateur jusqu’au résultat vérifié, intégrer ses précisions et garder son
objectif en cours. Initiative sur les détails courants ; aller au-delà seulement
avec un bénéfice concret pour lui. Question seulement pour un manque indispensable
ou un engagement important non autorisé. Toute restriction supplémentaire doit lui
être soumise. Pas de recherche/vérification CGU/CGV ni d’analyse juridique hors
sa demande explicite : ces sujets sont confiés à son équipe.

Les consignes techniques d’inspection restent dans Développement. Textes modifiables
et réinitialisables dans Configuration → Instructions, sans changement de permissions
ni nouveau moteur de goals. 238 tests, deux parcours navigateur et démo ; GPT‑6 Luna
réel : 12 appels, suite paginée lue et bug corrigé/testé sans formulaire. Première
passe à 8 192 tokens trop pleine ; libellé des droits condensé sans retirer de règle
ni changer la fenêtre. Consignes déployées après sauvegarde chiffrée et redémarrage
web ; catalogue authentifié contrôlé (13 blocs, nouveau work actif), santé saine.

## Confiance et inspection

Les instructions de travail demandent des réponses directes sur les faits établis,
une inspection du code exécuté pour expliquer un logiciel accessible, des lectures
ciblées élargies selon le besoin et le suivi des parties manquantes utiles. Pas
d’audit de sécurité ni de liste de réserves hors demande. Les modèles de personnalité
préservent l’initiative choisie ; discret ne signifie plus ne pas exécuter la demande.
Les skills sont sélectionnés pour leur description, pas un simple sujet voisin.

L’app fournit la provenance du runtime : UUID réel de l’instance, stockage local des
conversations, backends mémoire/projets sélectionnés, chemin du code. Les exemples
et autres processus du serveur ne décrivent pas ce fil. Le fournisseur/modèle/effort
injecté est celui du tour courant, y compris juste après un changement de cerveau.
Ces faits ne prétendent pas contrôler la disponibilité des services distants.

Une sortie terminal partielle porte un avis et une continuation explicite avec id
et offset, placés avant le contenu volumineux. Les outils fichiers présentent aussi
la pagination et la référence de lecture avant le contenu.
Aucun drainage automatique ni nouveau plafond ; le modèle récupère la suite utile.
Une description du mécanisme mémoire n’est pas une affirmation de sauvegarde et ne
justifie pas une réserve générale. Les confirmations d’écriture restent vérifiées.

## Autorisations et exécution

En YOLO, fichiers, explorateur et terminal utilisent le même worker Unix root.
Le dossier UUID du fil est le départ ; chemins absolus et liens sont utilisables.
Mode protégé : confinement conservé. Aucun repli local si le worker est absent.
Sortir de YOLO retire l’accès hôte, arrête les commandes actives et réinitialise les
vues fichiers sans fermer les réglages.

Les outils fichiers exposent des références de lecture courtes, liées au chemin et
au tour ; l’adaptateur conserve le SHA-256 canonique pour contrôler les conflits.
Une référence expirée exige une relecture. L’édition conserve propriétaire, groupe
et mode Unix ; détails et contraintes natives dans FILES.md. Le format persistant
et l’interface propriétaire gardent leurs révisions canoniques.

terminal.exec retourne état/première sortie après une attente réglable (500 ms par
défaut, 0 immédiat). Les commandes longues continuent avec un identifiant et une
sortie paginée. Aucun timeout de commande ajouté. Les droits restent par fil.

## Données et autorités

Projets : source unique MCP pour création/catalogue/modification/archivage, dans
l’interface et les outils. UUID distant canonique ; pas de catalogue SQL miroir
ni de repli sans binding. La mémoire de projet utilise nora-projects et cet UUID.
Les anciennes références ne sont pas converties implicitement.

Mémoire : MCP actif, sans double écriture ni repli local ; anciens souvenirs locaux
conservés hors mémoire active suivant le choix de démarrer vide. Confirmation known
fondée sur une version active relue. Reçus anciens historiques ; journal conservé.
La revue mémoire cite une affirmation contestée, sans remplacer directement toute
la réponse. Une demande de correction ou un échec rend la main au modèle principal
avec ses outils et résultats. Une seule revue par run ; pas de rejeu des effets.
Diagnostics typés et sûrs ; la détection sémantique des affirmations reste au modèle.

Coffre : arguments/résultats transitoires exclus du journal et de la revue ; valeurs
visibles au modèle pendant le tour. Conversations, historique et exécutions restent
locaux à Heart. Centralisation des conversations différée sur demande explicite.
Les artefacts physiques restent sur l’hôte, aucun déplacement implicite.

PostgreSQL 015 / SQLite 003 : migrations conservées, retrait des seules clés
étrangères vers l’ancien catalogue local de projets. Aucun import ou effacement
métier implicite. Les modules SQL restent utilisables pour les fixtures.

## Vérifications

Passe précédente : 238 tests et parcours navigateur ciblés (instructions, revue mémoire,
assemblage web à 8 192 tokens). Les premiers ajouts de consignes dépassaient cette
petite fenêtre ; texte condensé, sans augmenter le budget ni retirer d’outils.
GPT‑6 Luna medium réel : 22 appels répartis en deux parcours. Inspection du moteur
et de l’assemblage via fichiers, reprise des plages nécessaires, description fondée
sur le code et métadonnées du bon runtime ; verdict récupéré en seconde page puis
bug corrigé et test exécuté avec succès. Aucun formulaire ni repli API. Un premier
contrôle QA exigeait à tort le nom technique plutôt que le nom affiché du modèle ;
le test accepte maintenant les deux. Les premiers essais docs seules, mauvais
runtime et arrêt sur sortie partielle ont servi aux correctifs, pas à la validation.

Preuves précédentes conservées : worker root sur nora-tests (fichiers hors fil,
propriétaire/mode Unix, binaire, stdin/réseau, annulation et arrêt des descendants) ;
GPT‑6 Luna medium, 11 appels pour édition protégée/YOLO, vérification terminale,
édition propriétaire et révocation. Import interrompu sans fichier partiel, références
expirées, autres chemins et conflits réels couverts par les tests automatisés.

Projets/mémoire/coffre : vrais MCP, PostgreSQL/OpenBao et HTTPS qualifiés sur comptes
QA retirés. Création idempotente, rappel/versions et refus après oubli, pas de ligne
projet SQL miroir. Tests SQL et anciens parcours complets datés dans TESTING.md ;
ils ne sont pas présentés comme tous relancés à chaque changement de consigne.

## Déploiement et suite

Venice AI déployé le 21 novembre après sauvegarde chiffrée et redémarrage web
coordonné (source f2f0876). Contrôle HTTPS authentifié : connexion visible, catalogue
réel de 148 modèles, contexte et efforts cohérents, contrôles web présents ; santé
saine. Clé désormais reconnue et compte rechargé ; génération et lecture fichiers
réelles qualifiées sur DeepSeek V4.1 Flash Uncensored, sans écriture métier.

Personnalité et rétention déployées le 21 novembre après sauvegarde locale chiffrée
et redémarrage web coordonné (source 4d26fea). Contrôle HTTPS authentifié : tons
utilisateur/externe actifs, quatre tours récents, résumé et injection adaptatifs,
13 blocs d’instructions et nouveaux assets chargés. Santé interne saine. Aucun
profil personnalisé ni historique propriétaire écrasé ; aucun changement du worker.

Publication publique autorisée : main, petits commits vérifiés et push ; secrets,
état privé et rapports opérateur exclus. Historique privé conservé localement.
Suite : poursuivre les qualifications ciblées des fournisseurs et des boucles
mémoire/contexte sur les modèles utilisés,
sans réintroduire de prudence générique ni de limites arbitraires.
