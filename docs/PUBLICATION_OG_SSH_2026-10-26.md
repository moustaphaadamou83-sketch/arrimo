# Publication OG depuis le véritable terminal SSH

> Publication A/B/C et coordination régionale effectuée et vérifiée. Voir le [rapport final](PUBLICATION_OG_ABC_RESEAU_2026-10-26.md). Les commandes ci-dessous sont conservées pour une nouvelle exécution éventuelle.

## Commande prête à lancer

Ouvrir une session SSH root sur le serveur Arrimo, puis lancer :

```bash
bash /root/arrimo-og-publication-abc-reseau-20261026/publier.sh
```

Le lanceur contrôle automatiquement les empreintes du lot. Il ne demande aucune confirmation de publication. Il demande les mots de passe existants des comptes A/B/C et coordination régionale pour chaque environnement Démo éligible et, si nécessaire, leurs codes MFA. Aucun mot de passe n’est modifié et aucun compte ou droit n’est créé. Garder la session ouverte jusqu’au résultat final. Une interruption provoque un arrêt et, si une bascule a commencé, une tentative de retour applicatif vérifiée.

Un audit préalable sans sauvegarde ni bascule est disponible :

```bash
bash /root/arrimo-og-publication-abc-reseau-20261026/publier.sh --audit
```

L’audit ne certifie pas les scénarios authentifiés. Les deux commandes exigent un véritable accès SSH autorisé aux services et aux bases ; elles ne débloquent pas le bac à sable Codex.

## Périmètre et garde-fous

- `/opt/arrimo-demo`, service `arrimo-public-demo`, domaine `demo.arrimo.senseafri.com`.
- `/opt/arrimo`, service `arrimo`, domaine `arrimo.senseafri.com`, **uniquement si sa configuration effective et ses API confirment la Démo**.
- Une cible dont `ARRIMO_ENV=demo` et `ARRIMO_DEMO=1` ne sont pas présents est exclue avant tout accès à sa base ou son service. Les fichiers systemd et les configurations additionnelles sont ensuite vérifiés. Une divergence entraîne un arrêt.
- Arrimo.SH n’embarque pas le moteur hospitalier : pas de bascule ni de migration SH. Sa santé et sa seule liaison `SH_ENV_DEMO_*` sont vérifiées lorsque celle-ci correspond à une cible confirmée Démo. Le lanceur n’appelle pas la liste globale des environnements SH, qui pourrait interroger Production.
- Les comptes hospitaliers A/B/C restent isolés chacun dans leur établissement ; la coordination régionale conserve son rôle gestionnaire et son périmètre réseau vérifié.
- Seuls `src/og-outils.js` et `src/copilote.js` sont remplacés dans une copie de la release active. Les autres sources, les dépendances d’exploitation, les dashboards, les permissions et les données métier sont conservés.
- Aucune migration, remise à zéro, import ou restauration SQL n’est appliqué aux bases hébergées.

Pour limiter volontairement la publication au site Démo séparé :

```bash
bash /root/arrimo-og-publication-abc-reseau-20261026/publier.sh --cibles demo
```

## Déroulement automatique

1. Vérifier l’archive, le code hébergé de référence, la configuration effective, les services et les santés locale/HTTPS. Refuser les bases distantes, les liens de release inattendus et toute modification concurrente du code.
2. Rejouer les tests locaux, puis ouvrir des sessions par connexion normale des comptes hospitaliers existants.
3. Sauvegarder chaque base Démo par snapshot cohérent, ainsi que sa configuration, son unité systemd effective et son ancienne release. Calculer les empreintes des sauvegardes.
4. Restaurer chaque dump dans une base neuve `arrimo_publication_restore_og_*`, vérifier l’égalité des contenus et lancer les scénarios OG sur cette copie avec les sessions copiées. Vérifier qu’OG n’a pas modifié la copie. Aucun générateur de données ou test destructif n’est lancé sur ces copies restaurées.
5. Créer d’autres bases neuves et réservées aux suites intégrées. Lancer les douze suites existantes : API/admissions/transferts, priorités SQL, interopérabilité SQL, permissions, scénarios A/B/C, dashboards, parcours navigateur, priorités navigateur, structure navigateur, SH ERP, SH navigateur et XSS. Ajouter la nouvelle suite PostgreSQL OG avec les sept scénarios contrôlés et les comptes A/B/C et coordination régionale. Exiger un TAP complet, aucun échec, aucun test ignoré ou annulé.
6. Exercer le retour arrière dans un répertoire jetable. Préparer toutes les releases avant la première bascule. Renouveler normalement les sessions pour les contrôles publics.
7. Basculer atomiquement et redémarrer le service Démo ; vérifier le lien actif, les empreintes du code, la santé HTTPS, les sept scénarios via API comparés à PostgreSQL et une vraie question dans le panneau OG au navigateur, pour A/B/C et coordination régionale. Vérifier la liaison Démo de SH.
8. En cas d’échec après bascule, tenter de réactiver toutes les anciennes releases touchées, dans l’ordre inverse, puis vérifier leur santé. Ne jamais restaurer automatiquement une base hébergée. Fermer uniquement les sessions ouvertes par le lanceur.

Les jeux fictifs et les historiques hébergés ne sont pas remplacés. Les tâches habituelles déjà configurées sur le serveur continuent à fonctionner : le script ne change ni les timers de simulation ni les paramètres de recalage. Il ne garantit donc pas l’immobilité des données pendant les contrôles ; une modification concurrente peut faire échouer une comparaison et provoquer un retour applicatif.

## Prérequis

Python 3 avec `tarfile` prenant en charge `filter='data'`, Node 24 au chemin déjà installé, outils PostgreSQL, `runuser`, systemd, espace disque pour les sauvegardes et au moins 2 Go libres sous `/var/tmp` pour la recette. Les dépendances de tests existantes sont reprises de `/root/arrimo-sh-erp/node_modules` après contrôle du lockfile ; leur chemin peut être fourni par `--dependances`.

Les tests isolés tournent sous le compte système PostgreSQL existant, par authentification locale peer, uniquement sur les bases neuves générées. Aucun rôle ni droit serveur n’est ajouté. Les sources et les dépendances sont copiées dans un dossier de recette privé sous `/var/tmp`. Les bases et les artefacts sont conservés pour audit ; aucune suppression automatique.

Les révisions Chromium déjà disponibles sont reprises si elles correspondent à Playwright. Si nécessaire, le lanceur télécharge les seuls binaires Chromium/FFmpeg dans le cache privé de recette avec le CLI Playwright, sans installer de paquet système. Le serveur doit donc disposer soit de la version requise, soit d’un accès réseau aux téléchargements Playwright. Tout échec bloque la publication.

## Accès non interactifs facultatifs

Un fichier JSON privé, appartenant à root et de permissions 0600, peut être passé avec `--acces /root/acces-og.json`. Pour chaque cible retenue, fournir exactement quatre entrées :

```json
{
  "demo": [
    {"nom":"a","code":"HX","email":"hopital.a@demo.arrimo","password":"A_REMPLACER"},
    {"nom":"b","code":"HY","email":"hopital.b@demo.arrimo","password":"A_REMPLACER"},
    {"nom":"c","code":"HC","email":"hopital.c@demo.arrimo","password":"A_REMPLACER"},
    {"nom":"reseau","code":"HX","email":"reseau@demo.arrimo","password":"A_REMPLACER"}
  ]
}
```

Ajouter une clé `principal` avec les quatre comptes autorisés correspondants si cette cible est une Démo. Ne pas inventer les accès s’ils diffèrent. Le MFA exige toujours une saisie du titulaire ; il n’est pas contourné. Aucun fichier d’accès contenant des secrets n’est livré dans le lot.

## Résultats et retour arrière

Chaque exécution affiche le chemin de son rapport privé :

`/root/arrimo-og-publication-<horodatage>_<identifiant>/rapport.json`

Consulter `statut`, `publication_verifiee` et surtout `environnements` : chaque cible est distinguée (`publie_et_verifie`, `exclu_hors_demo`, `retour_arriere_verifie`, `retour_a_verifier`, ou étape de préparation). Le succès global concerne uniquement les cibles Démo éligibles. SH possède son propre état de vérification de liaison, sans déploiement de code SH.

Pour un retour ultérieur, utiliser le script `retour-demo.sh` ou `retour-principal.sh` créé dans le dossier du rapport. Il vérifie à nouveau le périmètre Démo et le pointeur actif, puis restaure uniquement l’ancienne release et contrôle sa santé HTTPS. Les écritures métier postérieures à la publication sont conservées.

## État constaté dans Codex

Le correctif et les lots sont présents ; les empreintes de l’archive précédente sont valides et la baseline des sources Démo a été comparée en lecture seule. **152 tests locaux OG/non-régression et 17 tests des garde-fous de publication ont réellement réussi.**

L’état actif des services, la connexion aux bases, les sauvegardes, les treize suites intégrées, la publication et les contrôles après publication n’ont pas été exécutés depuis cette session isolée. Aucun déploiement n’est annoncé comme réussi.
