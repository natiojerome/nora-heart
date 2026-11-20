# Publication publique

Jérôme autorise le 20 novembre 2026 la création du dépôt public et le push de
l’état vérifié après correction et optimisation.

Dépôt cible : https://github.com/natiojerome/nora-heart, branche main.
Licence du code Heart : MIT ; dépendances et composants réutilisés conservent leurs
propres licences et notices, listées dans THIRD_PARTY_NOTICES.md.

La première publication est un instantané source relu, avec un nouvel historique
public. L’historique opérateur précédent est conservé localement sous une référence
archive et n’est pas poussé. Les preuves et captures privées de docs/qualification
et docs/design restent locales, ainsi que artifacts, les états, dossiers utilisateurs,
secrets, dépendances installées et runtimes téléchargés. Les rapports privés cités
dans certains documents ne sont donc pas tous disponibles dans le dépôt public.
Les tests de base restent exécutables avec les sources/assets et des données jetables.
Les essais distants et fournisseurs réels sont opt-in et nécessitent leurs propres accès.

Après cette initialisation, main suit normalement origin/main. Ne pas pousser les
références archive ni utiliser `git push --all` : elles conservent l’historique privé.
Les contributions publiques utilisent des commits ordinaires et des pull requests.

Publication réalisée et vérifiée le 20 novembre 2026 : premier commit public
`8ddfcfc`, 901 fichiers, branche main poussée sur origin/main et dépôt public relu
via GitHub. Référence privée locale : archive/private-before-publication-20261120.
Le scan de motifs de secrets sur les 1 413 fichiers suivis avant export ne détecte
aucune valeur correspondante ; cette vérification ne constitue pas une garantie
universelle. Les captures et rapports opérateur sont exclus indépendamment du scan.

Contrôle de l’export public : `pnpm check` réussit ses 228 tests avec uniquement
les fichiers de main (sans rapports privés, état ni historique opérateur). Les
dépendances installées ont été réutilisées ; ce contrôle ne prétend pas être une
nouvelle installation depuis le registre. Arbre de travail propre et HEAD distant
comparé au HEAD local après push.

Relecture finale : suppression de la sélection SQL implicite lorsque Projects
n’est pas configuré. Catalogue local historique masqué, création refusée avec une
consigne de configuration. 229 tests et démo passent ; parcours explorateur et chat
SQLite revérifiés. Une injection explicite demeure réservée aux fixtures des
qualifications de contrats, sans repli applicatif.
