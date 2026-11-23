# Arrimo — Rapport de stabilisation du 23 novembre 2026

**État du candidat** — reprise locale sur `b0eab1d`, avec modifications de travail à intégrer au candidat final. Les trois cahiers restent ouverts. La démonstration n’a reçu ni nouvelle version ni migration.

## Diagnostic PostgreSQL et navigateur

Une connexion Node directe aux sockets locaux `/run/postgresql/.s.PGSQL.5432` et `/run/postgresql/.s.PGSQL.55439` renvoie `EPERM`. L’ouverture d’un port éphémère sur `127.0.0.1` renvoie également `EPERM`. Le contrôle de lancement des tests isolés échoue avant les suites avec le même code. Le cluster PostgreSQL local est arrêté d’après `pg_lsclusters`. Ces contrôles distinguent le refus d’exécution d’un échec de mot de passe, de migration ou de scénario applicatif. Aucune protection système, configuration PostgreSQL, règle d’écoute ou permission n’a été modifiée.

La recette complète nécessite un environnement de recette autorisé à lancer des processus Node et Chromium, à écouter en loopback et à utiliser PostgreSQL avec un rôle déjà autorisé sur des bases fictives dédiées. Le lanceur de recette exige un arbre Git propre pour garantir que la copie testée correspond au commit déclaré.

## Résultats reproductibles

| Contrôle | Résultat |
|---|---|
| `npm run test:vnext-local` | 238 tests réussis, 0 échec, 0 ignoré |
| Analyse de syntaxe Node des fichiers JavaScript modifiés et ajoutés | Réussie |
| `git diff --check` | Réussi |
| Exercice local `bash deploy/test-releases.sh` | Réussi. Activation atomique, retour au pointeur précédent après panne simulée et écritures conservées |
| Concordance des trois migrations avec `db/schema.sql` | Vérifiée par lecture statique. Les trois fichiers sont transactionnels |
| Intégration Chrono et connexion du vérificateur SQL | Arrêt à `EPERM` avant les scénarios et avant toute écriture |
| Interface et temps réel | Contrôle de lancement refusé avec `EPERM`. Aucun scénario navigateur intégré vérifié |
| Recette sur archive Git | Refus du garde-fou parce que les modifications de travail ne sont pas encore réunies dans un commit propre |

Les résultats de tests locaux et de retour applicatif ne constituent pas une preuve de migration, de permission inter-acteurs ou de bon fonctionnement de la démo.

## État des quatre chantiers

| Chantier | Corrections présentes dans le candidat | Vérification ou travail encore ouvert |
|---|---|---|
| CCS, ambulances et transports | Tableau commun, appels fictifs et affectation CCS, fiche véhicule, compatibilité et chevauchements de réservation, refus motivé, modification de plage, brouillons privés, archivage, départ réel, remise et clôture | Parcours complet avec plusieurs comptes et véhicules, isolement par véhicule à l’intérieur d’une entreprise et propagation des changements entre les écrans. Le serveur vérifie l’organisation et certains liens explicites, dont le véhicule attaché à une préalerte. L’autorisation de chaque opérateur sur chaque véhicule reste à établir et à tester avant la validation |
| Transferts universels et Sillage | Tableau partagé par Flux, CCS et ambulance. Actions hospitalières réutilisées dans Flux. Liens explicites entre transport, hébergement et préalerte. Événements de départ, d’affectation, d’horaires, de remise et de clôture dans Sillage | Actions communes restantes selon le circuit. Parcours fictifs `P-90802` et `DT-000010` à rejouer sur copie autorisée. Les heures historiques doivent provenir de leurs événements existants. Les causes des anomalies observées sur `DM-101` et `DM-103` restent à confirmer dans les données |
| Chrono, Réseau et National | Synthèses d’Accueil, accès principaux Réseau et National, agrégats d’occupation, capacité Secours sans GPS, seuil Chrono par établissement, notification persistante dédupliquée, filtres, export et motifs de retard horodatés | Paramétrage complet des catégories et du pilote, agrégats régionaux autorisés de disponibilité ambulancière et validations multi-rôles. Aucun gain de pilote établi |
| Recette et publication | Trois migrations recensées, vérificateur sur copie étendu, suites Chrono, Sillage, Secours, Transport, CHSLD, DSN et temps réel ajoutées au lanceur de recette | Migrations, restauration sur base fictive, tests inter-acteurs, interface, notifications et actions sur navigateur. Aucune publication avant réussite. Le lanceur historique `scripts/publication-arrimo.py` fixe un ancien SHA et propose plusieurs cibles par défaut. Il ne doit pas être lancé tel quel pour ce candidat |

## Corrections supplémentaires de permissions et de synchronisation

- Un répartiteur conserve la lecture régionale des missions CCS. L’annulation est limitée côté serveur aux organisations CCS auxquelles il appartient. L’écran n’affiche l’action que dans ce périmètre et transmet la version de la mission.
- Sillage applique désormais les règles du DSN aux transitions. À l’origine, le dossier doit être lisible par le compte. À destination, la transition doit avoir été transmise et le compte doit appartenir à l’établissement. La Vigilance utilise la même règle. Les liens explicites transport, transfert et hébergement sont consultables depuis les deux côtés du parcours autorisé. Le compteur générique de Sillage ne révèle pas les liens DSN masqués.
- OG reconnaît la référence `MI-` utilisée par les missions CCS. Les anciens préfixes restent reconnus.
- Huit assertions de périmètre ont réussi avec des interfaces SQL simulées. Les nouveaux scénarios vérifient l’annulation entre deux CCS, la lecture DSN avant et après transmission et l’isolation du transporteur. La connexion réelle à PostgreSQL reste refusée. Cette passe ne clôture pas l’autorisation individuelle des ambulanciers par véhicule.

## Validation et retour arrière

1. Identifier le SHA exact du candidat dans un arbre propre. Préparer une copie de recette fictive dans un environnement autorisé.
2. Lancer `python3 scripts/recette-serveur-arrimo.py --stabilisation --reference b0eab1d --sortie <nouveau-dossier-de-recette>`. La référence sert à fabriquer la base d’avant migration. Le candidat testé est le SHA courant archivé par le lanceur. Le vérificateur rejoue les trois migrations deux fois, compare les empreintes des colonnes existantes et vérifie les nouveaux objets SQL.
3. Rejouer les parcours multi-sessions des cahiers avec les données fictives, relever les preuves et vérifier les interfaces sur ordinateur, tablette et téléphone. Valider en particulier les autorisations côté serveur. Tant que ces contrôles échouent ou restent incomplets, conserver la version actuelle de la démo.
4. Sur la démonstration seule, préparer une sauvegarde et en vérifier la restauration sur une base isolée. Vérifier sur cette copie la compatibilité du code précédent avec le schéma migré et celle du candidat. Comparer le SHA du candidat à celui de la recette et consigner la release active avant toute bascule.
5. Après une bascule unique, vérifier la santé, le SHA servi et les parcours de contrôle. En cas de panne, restaurer d’abord le pointeur vers la release applicative précédente. Conserver la base et les écritures intervenues après la sauvegarde. Si un défaut SQL critique empêche le retour applicatif, utiliser la copie de restauration validée pour préparer la reprise et préserver les écritures intervenues depuis la sauvegarde.

**Publication** — aucune. Aucun SHA de livraison ni contrôle de santé après publication à annoncer.
