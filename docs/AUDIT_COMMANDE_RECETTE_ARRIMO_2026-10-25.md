# Arrimo — audit de la commande SSH de recette

Lecture du lanceur `scripts/recette-serveur-arrimo.py`, de son rapport de validation et des scripts/tests qu'il invoque. La recette n'a pas été exécutée sur PostgreSQL dans cette session.

## Corrections nécessaires avant exécution

- Les URL générées portent maintenant `localhost` tout en conservant explicitement `host=/var/run/postgresql` : les tests A/B/C acceptent ainsi leur cible, sans changement d'authentification ni passage en TCP.
- L'ancien test du premier compte ne fait plus de `DROP DATABASE` préalable ni final. Il crée une base `arrimo_test_premier_<aléatoire>` et la conserve ; son nom est imprimé dans le journal API.
- Les 18 écoutes de test qui utilisaient `listen(0)` sont désormais limitées à `127.0.0.1`, comme les autres serveurs de recette. Aucun port applicatif public existant n'est réutilisé.
- Vérifications effectuées après ces changements : **15 tests ciblés Python réussis**, syntaxe des tests JavaScript modifiés et `git diff --check` réussis. Les 138 tests locaux précédemment réussis n'ont pas été relancés sans nécessité ; les tests PostgreSQL restent à exécuter dans SSH.

## Commandes et accès prévus

| Phase | Exécution | Cible et écritures |
|---|---|---|
| Préparation | `git status`, `git rev-parse`, `git archive` | Lecture du dépôt ; copie du commit propre dans un nouveau dossier privé sous `/root` |
| Dépendances | Lien vers `node_modules` existant et résolution Playwright | Lecture/réutilisation des dépendances ; aucune installation ou modification des applications actives |
| Précontrôles | Node 24, contrôle IPC Node, lancement/fermeture Chromium | Processus de test ; échec bloquant avant création d'une base |
| PostgreSQL maintenance | `psql -X -w` : identité/version, puis `CREATE DATABASE` | Connexion locale à `postgres` ; création de bases neuves uniquement, aucun changement de rôle ou droit |
| Données fictives | `scripts/preparer-base-fictive.cjs` | Nouvelle base `arrimo_recette_source_<session>` vide, avec schéma Git `2ed9127` et données fictives |
| Sauvegarde | `pg_dump --format=custom`, SHA-256, `pg_restore --list` | Sauvegarde de cette base fictive seulement ; aucun accès à une sauvegarde publique existante |
| Restauration | `pg_restore --exit-on-error --no-owner --no-acl` | Autre base neuve `arrimo_vnext_restore_<session>`, sans `--clean` ni écrasement de base existante |
| Intégrité | Comparaison des empreintes/contenus source-restauration | Lectures des deux bases fictives |
| Migrations | `scripts/verifier-migration-priorites.cjs` | Deux passages des migrations priorités/simulation sur la copie restaurée, transactions, verrous temporaires et contrôles des données préexistantes |
| Tests SQL/navigateur | Runner Node et suites du lanceur | Une nouvelle base dédiée par suite ; lectures, insertions, modifications et recréations de tables/schémas **dans ces bases de test uniquement** |
| Résultats | Journaux, captures et `rapport.json` | Dossier de recette et fichiers temporaires de test ; bases conservées pour inspection |

Les préfixes de bases générés sont : `arrimo_recette_source_`, `arrimo_vnext_restore_`, `arrimo_test_`, `arrimo_vnext_test_`, `arrimo_simulation_test_`, `arrimo_audit_multi_`, `arrimo_demo_trio_scenarios_`, `arrimo_demo_trio_ui_`, `arrimo_interface_`, `arrimo_vnext_ui_test_`, `arrimo_demo_trio_structure_`, `arrimo_sh_test_`, `arrimo_sh_ui_test_`, `arrimo_audit_xss_`. Tous reçoivent un suffixe de session horodaté et aléatoire ; la base auxiliaire du premier compte a son propre suffixe aléatoire. Une collision provoque un refus de création, pas une suppression.

Les scénarios SH nommés « production » utilisent des schémas `prod_c4`, `prod_ui` ou `prod_erp` **à l'intérieur des nouvelles bases de test**, et des API sur le loopback. Ils ne désignent pas Arrimo principal. Le test de rollback utilise des commandes `systemctl`/santé simulées et un dossier temporaire, sans redémarrer un service réel.

Les migrations ajoutent deux tables de priorités, des colonnes/contraintes de validation et quatre tables de simulation avec un index d'unicité. Aucun script du lanceur ne publie de release, ne change Nginx, ne modifie `pg_hba.conf`, n'accorde de droit et ne restaure une base publique. Les variables SMTP, connecteurs et environnements hospitaliers ne sont pas transmises aux tests ; leurs configurations sont fictives.

## Permissions et limites

- Session SSH root nécessaire pour accéder aux chemins `/root` existants et écrire le dossier privé de recette.
- Node `/opt/arrimo-runtime/node-v24.22.1/bin/node`, Python 3, outils PostgreSQL et Playwright installés et lisibles.
- Compte PostgreSQL local existant autorisé à se connecter à la maintenance, créer des bases et gérer ses nouvelles tables. La commande utilise l'authentification locale existante de root, sans mot de passe affiché, sans création de rôle et sans `GRANT`. Si cet accès manque, le lanceur s'arrête ; ne pas activer `trust` ni modifier les protections.
- Sockets locales et IPC Chromium autorisés dans cette session serveur.
- Une restauration fictive réussie ne vaut pas vérification d'une sauvegarde fraîche de la démo publique. Publication, sauvegarde publique restaurable, rollback applicatif et contrôle public restent des étapes ultérieures distinctes.

La commande remise à l'utilisateur fixe Node 24 et le module Playwright découverts, choisit un dossier de sortie unique, conserve les journaux en mode privé et utilise `nohup` pour survivre à une coupure SSH. Elle affiche le rapport à la fin. Elle ne touche pas aux scénarios publics A/B/C.
