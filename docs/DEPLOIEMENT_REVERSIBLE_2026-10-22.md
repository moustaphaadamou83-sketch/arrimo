# Arrimo — procédure de déploiement réversible

**Décision au 22 octobre 2026 : procédure applicative préparée et testée en local isolé; mise en ligne non autorisée à ce stade.** Le site public, sa base, ses comptes et ses fichiers n’ont pas été consultés ni modifiés dans cette opération.

## Cause corrigée

L’ancien installateur extrayait l’archive puis faisait `cp -r .../. "$DOSSIER"/.` dans le répertoire servi. Une panne pendant la copie pouvait donc laisser un mélange de versions; les anciens fichiers pouvaient être écrasés avant le contrôle de santé. Le script rejouait aussi `db/schema.sql` lors des mises à jour, et son ordre de travail n’imposait pas la validation préalable d’une restauration et d’un rollback.

## Nouveau mécanisme

- `deploy/installer.sh` prépare chaque archive dans `releases/<date-UTC>-<SHA-256 court>`, conserve `shared/.env` et le runtime Node hors des releases, rend le code non modifiable par le compte du service, puis démarre l’application via `current`.
- Lors de la première conversion depuis l’ancien répertoire en place, l’installateur copie celui-ci vers une release `legacy-*`, vérifie son démarrage, puis en fait la release précédente avant de remplacer l’unité systemd. Une erreur de santé sur la candidate revient donc au code historique, lui-même conservé.
- `deploy/releases.sh activate` crée le pointeur `current` par remplacement atomique du lien symbolique. Il redémarre le service et exige une réponse santé. Si la santé échoue, il rétablit le pointeur précédent, redémarre l’ancienne release et vérifie à nouveau sa santé.
- `deploy/releases.sh rollback` revient à `previous` sans appeler `psql`, `pg_restore`, `DROP` ou la restauration du dump. Il garde l’ancienne release et vérifie son état de santé.
- Les dossiers de release restent présents. Aucun script de purge n’est installé; leur suppression relève d’une opération distincte après validation de conservation.
- Les mises à jour existantes exigent désormais `ARRIMO_DEPLOY_PREFLIGHT_FILE` avant les changements système. Le fichier doit lier les preuves `backup_restore=PASS`, `isolated_restore=PASS`, `schema_compatibility=PASS`, `rollback_drill=PASS` et le SHA-256 exact de l’archive. L’installateur vérifie aussi l’intégrité du dump référencé et son index `pg_restore` avant `apt`, la migration ou la bascule.
- Sur une mise à jour, l’installateur ne lance plus `apt-get`; il refuse un outil système manquant. Il vérifie le site, l’hôte, le port, le lien Nginx actif et le certificat existants avant tout changement, puis les conserve. Une configuration inattendue entraîne un arrêt. L’unité systemd est remplacée par un fichier temporaire puis un rename atomique; elle pointe sur `current`, ce qui rend le retour vers la release legacy compatible.

La migration de production est limitée, hors console SH, à `db/migrations/20261022_capacites_og.sql`, dans une transaction avec verrous et délais. Elle ajoute des colonnes, contraintes et index; elle ne supprime ni table ni historique. La conversion `integer` vers `numeric(8,1)` conserve les distances entières existantes. L’ancienne application continue de lire ses colonnes et tables existantes. Une migration appliquée n’est pas annulée pendant le rollback applicatif : l’ancienne version fonctionne sur ce schéma additif et les écritures récentes restent dans la même base.

## Sauvegarde et restauration isolée

`deploy/sauvegarde-complete.sh ROOT SERVICE [DOSSIER]` produit un dossier horodaté protégé contenant le dump PostgreSQL custom, l’archive de la release active, la release précédente si elle existe, `.env`, l’unité systemd et le site Nginx. Le dump est vérifié par checksum et `pg_restore --list`. Le script vérifie que le pointeur actif n’a pas changé durant la capture. Il ne lance aucune restauration.

`deploy/restaurer-isolee.sh DOSSIER_SAUVEGARDE URL_BASE_VIDE` vérifie les sommes et restaure sans `--clean`/`--create`, uniquement dans une base vide `arrimo_restore_*` sur boucle locale ou adresse RFC1918 privée. La restauration doit se faire dans une instance de recette isolée; comparer ensuite le nombre de comptes, de transferts et les lignes d’historique avec le relevé pris au snapshot, puis exécuter la migration deux fois et tester l’ancienne application avant de marquer `isolated_restore=PASS`.

La restauration d’un dump ne constitue pas un rollback applicatif. Si une panne applicative survient, on garde la base active et on rebascule `current`. Si la base elle-même est corrompue, restaurer parallèlement dans une nouvelle base, comparer les écritures intervenues depuis le snapshot et préparer une bascule coordonnée. Ne jamais écraser la base active par un dump ancien.

Format requis pour le fichier de préflight (chemin privé, sans secrets) :

```text
candidate_archive_sha256=<SHA-256 complet de l’archive candidate>
backup_directory=<chemin vers le dossier de sauvegarde vérifié>
backup_restore=PASS
isolated_restore=PASS
schema_compatibility=PASS
rollback_drill=PASS
```

Ces lignes doivent être accompagnées d’un rapport de recette daté décrivant l’instance et les vérifications; elles ne remplacent pas les preuves elles-mêmes.

## Preuves exécutées

- Gestionnaire de release dans un répertoire temporaire : activation, bascule échouée sur santé, retour automatique à la release précédente, nouvelle activation et rollback explicite réussis.
- PostgreSQL local jetable : insertion d’une ligne avant les bascules et d’une écriture récente après activation; les deux lignes sont toujours présentes après le rollback. Le gestionnaire n’a exécuté aucune commande SQL.
- Migration sur base PostgreSQL jetable avec schéma ancien minimal : deux applications idempotentes, colonnes nécessaires disponibles, requêtes anciennes (`id`, `distance_km`) lisibles, deux transferts et leurs valeurs conservés. Base jetable supprimée.
- Suites : 69 tests API/courriel/routage, 9 tests d’interface et 4 tests A/B/C réussis (82 au total). Les suites navigateur ont été exécutées dans une copie temporaire; chaque base jetable et cette copie ont été supprimées.
- `bash -n` sur les scripts de déploiement et `git diff --check` réussis.

## Contrôles non exécutés et accès requis

Aucune sauvegarde fraîche de la base publique n’a été produite ou restaurée. `pg_dump` et `pg_restore` ne sont pas disponibles sur le poste local. Le précédent rapport mentionne un dump daté du 22 octobre 2026 à 01:00 UTC et une restauration anonymisée antérieure; cela ne répond pas à l’exigence d’une sauvegarde fraîche pour cette mise en ligne.

Pour fermer ce point, il faut un accès SSH autorisé au serveur public (nom d’hôte confirmé, compte et clé disponibles, empreinte du serveur vérifiée), les droits nécessaires pour lire la release active, `.env`, l’unité systemd et les configurations Nginx, ainsi qu’un accès `pg_dump` à la base Arrimo et un emplacement de sauvegarde chiffré/protégé. Il faut également une recette Ubuntu isolée permettant une restauration réelle et un exercice de bascule systemd; aucun de ces contrôles distants n’a été fait ici.

Les tests de release utilisent un service et un contrôle santé simulés; le test PostgreSQL valide la conservation effective des écritures, mais ne remplace pas l’exercice de l’installateur complet sur la version Ubuntu du serveur. Les modifications de systemd sont sauvegardées dans le paquet complet et la configuration Nginx existante est désormais préservée sur une mise à jour. Sur une première installation, l’installation de paquets, la création du rôle/base, des comptes, des fichiers Nginx/certbot restent des actions système qui ne se défont pas par rollback applicatif; elles exigent une recette distincte.

## Statut de publication

Contrôle public en lecture seule le 22 octobre 2026 : la page et `/api/sante` répondent HTTP 200; la santé indique `etat=ok`, `base=ok`, `version=1.0.0`. Comparaison SHA-256 des assets avec la candidate : `app.js`, `i18n/fr.js`, `i18n/en.js` et `copilote.css` diffèrent; `og.js`, `style.css`, `i18n/format.js`, `i18n/aide.fr.js` et `i18n/aide.en.js` sont identiques. Le site est donc actif mais son contenu est partiellement mélangé. Aucun compte n’a été utilisé et aucune action métier n’a été faite.

Pas de déploiement ni de commit publié. La candidate de base reste `3b0d808280e1cbd9a3a6e0f4c24255391fe58277`; les modifications de scripts et tests sont locales et non commitées. Aucun alias SSH Arrimo n’est configuré sur le poste; le contrôle SSH en lecture seule n’a donc pas permis d’accéder au serveur. Le déploiement demeure bloqué jusqu’à obtention d’un accès SSH autorisé, production et restauration de la sauvegarde fraîche, exercice complet sur recette Ubuntu et validation des preuves de préflight.
