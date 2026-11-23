# Arrimo — Audit et reprise du 22 novembre 2026

[Rapport consolidé de stabilisation du 23 novembre](RAPPORT_STABILISATION_ARRIMO_2026-11-23.md).

## Cahiers de référence

- [Consignes de reprise en 12 points](CAHIER_REPRISE_ARRIMO_2026-11-22.md).
- [Cahier de reprise, correction et déploiement autonome](CAHIER_DEPLOIEMENT_AUTONOME_2026-11-22.md).
- [Cahier final Secours, CCS, ambulances et transports](CAHIER_FINAL_SECOURS_CCS_AMBULANCES_TRANSPORTS.md), 47 sections sur la refonte et sa validation.
- [Professionnalisation ERP et iconographie](PROFESSIONNALISATION_2026-11-23.md).

Le cahier final complète les précédents. Les scénarios inter-acteurs, les critères d’acceptation et les livrables de ses sections 43 à 47 font partie de la validation finale. L’environnement de démonstration utilise exclusivement des données fictives.

## État au point de reprise

- Branche `moteur-commun-20261119`, base `b0eab1d0e5eabb2f91ae09e0b5a13726b287cc05`. Le journal de Claude Code indique que cette version a été publiée. Cette reprise n'a pas vérifié les instances.
- La session de Claude Code contient le dernier cahier « Professionnalisation ERP » et la directive sur les pictogrammes. Son [document de travail](PROFESSIONNALISATION_2026-11-23.md) décrit l'iconographie SVG, le catalogue des KPI, les notifications sonores, les tableaux et les actions depuis l'Accueil. Les modifications correspondantes étaient présentes dans l'arbre de travail.
- Le dernier journal CHSLD de Claude Code indiquait 42 réussites sur 43. Le dernier scénario attendait le bouton Annuler après création d'un transfert depuis Liaison CHSLD.
- Le point local `/root/arrimo-reprise-20261122.Q4z29u` contient le SHA de départ, un patch des fichiers suivis et une archive des fichiers non suivis. Aucune base métier n'a été modifiée.

## Corrections locales

| Besoin | Constat et correction | Fichiers |
|---|---|---|
| Départ NSA dans Sillage et Flux | Le service Transport écrit la demande, la décision, la prise en charge et l'arrivée dans l'Horloge. Il ne publiait pas de départ. NSA conserve une heure de départ dans la demande d'hébergement et Flux utilisait jusque-là l'heure de prise en charge. Sillage et Flux lisent désormais la confirmation NSA lorsque le lien, la référence, les établissements, le statut et les bornes temporelles concordent. Une heure explicitement inscrite dans l'Horloge a priorité. Sillage rattache les deux objets et contrôle la visibilité de chacun. La lecture ne crée aucune horloge historique. | `src/transports.js`, `src/sillage.js`, `src/arrimo-flux.js` |
| Recherche Patients et DSN | Les API acceptent les préfixes de nom et prénom dans les deux ordres, les espaces multiples et la référence exacte sans distinction de casse. Les caractères de recherche sont littéraux. Le filtrage par établissement et les habilitations DSN restent appliqués. | `src/patients.js`, `src/dsn.js` |
| Liaison CHSLD | Après création, le suivi sélectionne le nouveau transfert. Un choix manuel d'onglet interrompt le suivi. Le scénario navigateur attend désormais l'ouverture de l'onglet correspondant au transfert créé. | `public/chsld.js`, `tests/chsld.test.cjs` |
| Navigation | Réseau et National sont des espaces principaux dans le composant commun aux deux dispositions. Leur présence dépend des onglets visibles pour le rôle et le contexte. | `public/espaces.js` |

## Contrôles et publication

- `npm run test:vnext-local` a donné 238 réussites, 0 échec et 0 test ignoré.
- Ajouter aux contrôles intégrés les scénarios de `tests/cahier-ultime.test.cjs` et `tests/dsn-clinique.test.cjs`. Ils couvrent le passage anticipé de la référence fictive P-90802 dans Sillage et Flux, l'absence de départ sans confirmation, la recherche d'identité et l'isolation entre établissements.
- Tester avec une base jetable dédiée, puis exécuter `npm test`, `npm run test:interface` et la suite `tests/chsld.test.cjs`. L'essai intégré s'arrête au montage avec `connect EPERM /run/postgresql/.s.PGSQL.5432`. Le démarrage d'une instance PostgreSQL isolée exige un compte système non-root que cet environnement ne permet pas d'utiliser.
- Rejouer sur la démo la référence P-90802 et inspecter les données existantes de DT-000010 avant toute conclusion sur la ligne historique. Vérifier dans le navigateur la création puis l'annulation d'un transfert de Liaison CHSLD et les accès Réseau et National avec plusieurs rôles dans les deux dispositions.
- Publication limitée à la démonstration, après les contrôles bloquants, une sauvegarde de la démo et un test après déploiement. Aucun nouveau commit final, aucune URL de déploiement vérifiée.

## Deuxième passe de reprise

- **Accueil**. Les blocs Réseau et National s’actualisent avec le rendu de l’Accueil. Le bloc Réseau hospitalier reprend les capacités et niveaux dont l’utilisateur dispose déjà, avec un compteur de transports locaux. L’hébergement lit son répertoire autorisé. La nouvelle réponse National expose quatre agrégats et applique le périmètre existant de la carte, le module actif et les droits de l’établissement. Les préalertes et recommandations du briefing OG sont visibles dans la même zone opérationnelle. Fichiers principaux : `public/accueil.js`, `public/app.js`, `public/chsld.js`, `src/national.js` et `src/app.js`.
- **Transport**. Le tableau de bord ambulancier filtre les missions par catégorie et véhicule. Le superviseur voit le périmètre de ses organisations indépendamment du véhicule courant. Le refus recueille un motif. Les affectations de transport planifié sont contrôlées sous verrou par véhicule. Le superviseur peut réaffecter avant départ, avec historique. L’arrivée d’un transport planifié sans préalerte ouverte maintient le véhicule à destination jusqu’à remise et clôture, sous réserve de son état courant. Le circuit historique de préalerte garde la responsabilité de son propre état. Fichiers principaux : `public/secours.js`, `src/transports.js`, `src/vehicules.js` et `src/prealertes.js`.
- **Chrono et Sillage**. Chrono calcule le nombre de passages au seuil, l’attente courante moyenne, médiane et cumulée. Une préalerte liée dont le transport correspondant a une arrivée réelle n’apparaît plus comme « en route ». Sillage relie explicitement préalerte et transport dans les deux sens. Ces règles ne déduisent aucun événement d’une proximité de véhicule. Fichiers principaux : `src/chrono.js`, `public/chrono.js` et `src/sillage.js`.
- **Vérification**. 238 contrôles locaux, 0 échec. Quatre cas de synthèse National vérifiés avec une base simulée, y compris l’accès hors établissement et le module désactivé. Les régressions ajoutées couvrent les agrégats, les autorisations, les métriques Chrono, la clôture et les affectations concurrentes. Le test d’affectation est bloqué dès le montage par le même refus de connexion PostgreSQL. Aucun déploiement.

## Modification des horaires de transport

Le superviseur peut modifier la plage confirmée avant le départ d’un transport planifié accepté. Le serveur contrôle la version, l’ordre des heures et la disponibilité du véhicule. La plage initiale est conservée, la nouvelle plage et l’ancienne sont inscrites à l’historique, et la prévision de sortie du lit lié suit l’horaire confirmé. Le test de régression couvre le changement, une plage inversée et le conflit de version.

## Brouillons et archivage des transports

Un établissement peut conserver une demande planifiée en brouillon puis la transmettre ou la retirer. Le retrait garde une trace interne et n’émet aucun événement aux partenaires. Les brouillons actifs et retirés sont réservés à l’origine dans les listes, les fiches, Flux et Sillage. Les transports clôturés peuvent être archivés par l’origine et restent consultables par leurs acteurs autorisés. L’écran de réservation offre un historique des 100 dossiers clos les plus récents. Les scénarios d’intégration couvrent la confidentialité, le retrait, la consultation après archivage et le rejet d’une préalerte liée au transport d’un autre véhicule de la même entreprise.

## Vue Transferts commune, flotte et supervision CCS

- Le tableau partagé est utilisé dans Flux pour les établissements, dans l’espace de demandes du CCS et dans les transports ambulance. Il montre notamment la référence, le trajet, les heures, la priorité lorsqu’elle est connue, la préalerte et le statut opérationnel. Le tri, la recherche et la pagination utilisent le composant des tableaux existants. Les actions spécialisées restent accessibles depuis leurs écrans.
- Une fiche véhicule s’ouvre depuis la flotte et les marqueurs de la carte Secours. Le serveur reprend le périmètre de la flotte et renvoie l’état, la dernière position récente partagée, l’historique des états et les derniers transports de l’organisation du véhicule. Sillage donne accès aux événements associés.
- Les KPI CCS ouvrent les écrans concernés. Une vérification commune bloque une déclaration manuelle de disponibilité, une proposition CCS ou le départ d’un transport planifié lorsque le véhicule exécute déjà une mission incompatible.
- Sillage lit aussi les affectations, modifications d’horaires, remises, clôtures et incidents enregistrés dans le journal Transport. Les huit assertions du tableau partagé ont réussi. La suite intégrée de la fiche véhicule et des permissions échoue lors de son montage sur la connexion PostgreSQL, avant les assertions.

## Interventions simulées au CCS

L’onglet Appels simulés est réservé aux répartiteurs en démonstration. Deux scénarios fictifs peuvent être reçus et affectés manuellement via le moteur des missions CCS. L’acceptation ou le refus est visible dans la liste des appels. Une mission refusée ou annulée peut être réaffectée, avec conservation des références précédentes. La migration `db/migrations/20261123-interventions-ccs-demo.sql` doit être appliquée avant le démarrage du candidat. Le scénario de concurrence et d’isolation est ajouté à la suite Secours.

## Consultation de Chrono

Les vues établissement, CCS et ambulance proposent des filtres par véhicule, entreprise et période de consultation des passages terminés (12, 24, 48 ou 168 heures). Les vues Secours proposent aussi un filtre par établissement. L’API accepte un identifiant de région dans le périmètre existant. Le rapport mensuel et son export CSV côté établissement reprennent les filtres sélectionnés. La suite Chrono couvre le filtrage et la validation des paramètres, mais s’arrête au montage sur le refus PostgreSQL.

## Départ réel et durées des transports planifiés

Le bouton de confirmation du départ vers la destination enregistre un événement distinct de la prise en charge. Pour un parcours NSA, Chrono et Flux réutilisent la confirmation liée quand elle est déjà connue. L’onglet Chrono de Secours présente les durées de réponse, mobilisation, déplacement vers le départ, attente de prise en charge, trajet patient, attente de remise, remise en condition et engagement des transports planifiés actifs ou récents. Une durée reste vide si un événement manque ou si les heures se contredisent. L’engagement se termine à la clôture des opérations enregistrée, indépendamment d’un changement manuel de disponibilité. Les cinq contrôles de calcul ont réussi. Le scénario intégré de confirmation, de rejeu et d’arrivée s’arrête à la connexion PostgreSQL.

## Seuils Chrono par établissement

Chaque passage hérite des seuils configurés pour l’établissement concerné. Le CCS, les ambulances, l’écran hospitalier et l’Accueil utilisent le même niveau calculé côté serveur. Les statistiques mensuelles comparent chaque passage à son propre seuil et affichent un tiret lorsque le regroupement combine plusieurs cibles. L’alerte sonore locale est dédupliquée par passage pendant la session et ne se déclenche pas au premier chargement. Quatre contrôles ciblés sur base simulée ont réussi, dont une même durée classée différemment pour deux établissements. Le test intégré reste bloqué à la connexion PostgreSQL.

## Motifs observés de retard Chrono

L’établissement concerné ou l’entreprise ambulancière autorisée peut consigner une cause pendant un passage ouvert. Le CCS peut la consulter. Les huit motifs sont proposés dans une liste fermée sans texte libre ni attribution automatique de responsabilité. Les modifications sont versionnées et inscrites à un journal immuable. Le rapport mensuel agrège le dernier motif par passage et Sillage affiche l’historique. La migration `db/migrations/20261123-chrono-motifs-retard.sql` doit être validée avant la publication. La configuration des catégories par organisation reste ouverte.

## Alertes persistantes, pilote et capacités Secours

- Chrono enregistre une notification d’établissement par passage dès le franchissement du seuil configuré, tant que la civière n’a pas été libérée. La réservation du passage et la notification partagent une transaction. Le worker et les deux demandes concurrentes ne peuvent pas envoyer deux notifications pour le même passage. La lecture et l’acquittement sont réservés aux rôles autorisés de Chrono. La migration `db/migrations/20261123-chrono-alertes.sql` est requise.
- Le rapport mensuel affiche le nombre de passages terminés mesurés, les minutes d’immobilisation observées et les attentes hors cible. Il ne calcule pas de gain de pilote en l’absence d’une période de référence validée.
- Le tableau Secours affiche les capacités régionales autorisées sans position. Les distances et temps restent vides. Le comparatif inclut l’occupation mesurable des civières et les ambulances à la porte connues de Chrono côté CCS.
- Flux réutilise les actions de la vue des transferts hospitaliers, dont l’acceptation, le refus motivé, la préparation, le départ et la réception. Les contrôles restent dans les routes métier existantes.
- Six contrôles ciblés ont réussi. Les scénarios PostgreSQL de notification concurrente et d’absence de position ont été ajoutés. Leur exécution reste bloquée au montage sur `EPERM`.

## Périmètre restant des cahiers de reprise

- Compléter le tableau partagé avec les actions métier des transferts et une vue cartographique ou chronologique au besoin. Finaliser les liens entre les circuits en préservant les historiques et les droits.
- Compléter Transport avec la pagination de l’historique et son accès côté ambulance et CCS, la revue des états de flotte dans les autres circuits et la validation des affectations avec une base intégrée.
- Chrono conserve le circuit existant H11–H15 et lit les préalertes pour les véhicules attendus. Confirmer l'origine des lignes DM-103 et DM-101 sur les données fictives de la démo. Restent les événements du transport planifié, les mesures d'immobilisation, filtres, alertes configurables, causes de retard, recommandations OG et indicateurs de pilote.
- Finaliser la chronologie Sillage et les liens intermodules. Compléter les agrégats de l’Accueil avec la disponibilité ambulancière, les saturations régionales et les alertes pour les profils autorisés.
- Valider l'ensemble des changements de professionnalisation, les migrations applicables, les parcours de bout en bout et les régressions d'interface avant publication.

## Point de reprise de stabilisation du 23 novembre

Ce point actualise les mentions antérieures d’EPERM et les résultats de contrôle. Recette, SH et démo font partie de la préparation de publication. La publication reste soumise à la validation complète et à la confirmation explicite.

### Travaux sauvegardés

- PostgreSQL 16/main est en ligne. Le socket Unix et le serveur HTTP local fonctionnent avec l’autorisation d’exécution hors bac à sable. `SELECT 1` et la requête HTTP de contrôle ont réussi. Aucun changement de configuration PostgreSQL.
- Le serveur applique le périmètre véhicule aux missions CCS, transports, flotte, positions, préalertes, passages Chrono et consultations Sillage. L’organisation peut activer le contrôle strict après avoir associé les équipages à leurs unités. L’application conserve le comportement existant des organisations qui ne l’ont pas activé. Le test ciblé de préalertes vérifie la séparation entre véhicules et la visibilité du CCS.
- Les quatre migrations de stabilisation ont été exécutées deux fois avec empreintes de contrôle sur une base fictive initialisée avec le schéma Git de référence `b0eab1d`. Cette preuve ne couvre pas encore la restauration d’une sauvegarde.
- Le lanceur de recette renseigne le rôle PostgreSQL effectif lorsqu’une connexion locale utilise l’authentification implicite. La suite CHSLD reçoit un nom de base accepté par son garde-fou. Le scénario navigateur ABC ouvre désormais le détail OG avant de vérifier son contenu.

### Résultats et travaux ouverts

| Contrôle | État constaté |
|---|---|
| Contrôles locaux | 238 réussis, 0 échec, 0 ignoré, 0 annulé. Journal `/tmp/arrimo-stabilisation-local-final.log`. |
| Migrations | 4 migrations, deux applications, vérifications réussies. Journal `/tmp/arrimo-stabilisation-migrations-reelles.log`. La sauvegarde et le retour arrière restent à tester. |
| Interface | Parcours complet ordinateur et tablette réussis. Téléphone en échec dans le premier passage. Voir `/tmp/arrimo-stabilisation-navigateur-reel.log` pour la pile d’erreur et le total définitif. |
| Inter-acteurs ABC | 11 réussis sur 12, dont les huit scénarios métier. Échec navigateur sur un panneau OG replié. Premier rejeu en échec car plusieurs panneaux correspondaient au sélecteur. Le scénario cible désormais le panneau contenant le plan OG. Rejouer sur une base neuve. Journaux `/tmp/arrimo-stabilisation-abc-valide.log` et `/tmp/arrimo-stabilisation-abc-neuve.log`. |
| API et CHSLD | Suites lancées sur des bases fictives distinctes. Le contrôle intégré de séparation des équipages a réussi. Le passage API signale au moins quatre échecs dans les scénarios SH, C4, état des véhicules et urgences côté hébergement. Consulter les totaux et les piles dans `/tmp/arrimo-stabilisation-api-reelle.log` et `/tmp/arrimo-stabilisation-chsld-role.log`. |
| ERP SH | Le second essai a rencontré un schéma pilote résiduel dans une base réutilisée. Rejouer sur une base neuve avec un rôle explicite conforme. |
| Données historiques et démonstration | L’exécution des scénarios fictifs ne vérifie pas la ligne historique DT-000010 ni les passages et préalertes DM-101, DM-102 et DM-103 signalés lors des essais manuels. Relire les événements d’origine et comparer les identifiants, auteurs et heures sans créer d’horodatage. |

Il reste à fermer les écarts ci-dessus et à vérifier sur une même candidate figée les permissions serveur, la propagation en temps réel entre établissements, CCS et véhicules, les transferts et Sillage, les KPI et notifications de Chrono, Réseau et National, ainsi que les actions et l’affichage sur les trois largeurs. Vérifier aussi les écarts fonctionnels de la section précédente avant de clore les cahiers. La présence d’un test ciblé ne valide pas le scénario complet.

### Commandes de reprise

À exécuter depuis `/root/arrimo-sh-erp`. Les valeurs de connexion doivent pointer sur des bases **fictives, neuves et distinctes**, avec un utilisateur PostgreSQL explicite. Utiliser la demande d’autorisation d’exécution si le socket ou HTTP local est bloqué.

```sh
npm run test:vnext-local
TEST_DATABASE_URL="$ARRIMO_API_FICTIVE_URL" npm test
TEST_DATABASE_URL="$ARRIMO_UI_FICTIVE_URL" npm run test:interface
TEST_DATABASE_URL="$ARRIMO_CHSLD_FICTIVE_URL" node --test tests/chsld.test.cjs
TRIO_TEST_DATABASE_URL="$ARRIMO_ABC_FICTIVE_URL" npm run test:demo-trio
TRIO_TEST_DATABASE_URL="$ARRIMO_ABC_SCENARIOS_FICTIVE_URL" npm run test:scenarios-abc
TEST_DATABASE_URL="$ARRIMO_SH_ERP_FICTIVE_URL" npm run test:sh-erp
TEST_DATABASE_URL="$ARRIMO_SH_UI_FICTIVE_URL" npm run test:sh-erp-interface
```

Le nom de la base CHSLD doit commencer par `arrimo_sh_lot1_test_` et les noms ABC par `arrimo_demo_trio_`. Pour vérifier la sauvegarde, la restauration et la matrice de recette sur un dépôt propre, figer d’abord le commit candidat et lancer la commande suivante avec un nouveau dossier de sortie. Conserver le rapport de preuve et les références de retour arrière par cible.

```sh
python3 scripts/recette-serveur-arrimo.py --stabilisation --reference b0eab1d0e5eabb2f91ae09e0b5a13726b287cc05 --sortie /tmp/arrimo-preuves-candidate
```

Aucune version publiée au titre de cette reprise. Une fois tous les contrôles réussis, identifier les cibles recette, SH et démo, vérifier leur isolation, préparer une candidate unique et demander la confirmation avant publication.

## Actualisation de reprise après exécution parallèle

- Le diagnostic de l’échec SH/C4 est confirmé : le pool de ces scénarios était connecté avec l’utilisateur PostgreSQL implicite et le garde-fou de périmètre SH exige un rôle explicite. Rejoués sur une base fictive neuve possédée par le rôle SH restreint, console SH et C4 réussissent (2/2). La suite ERP SH dédiée réussit (36/36). Aucun changement applicatif n’était requis pour cet écart.
- Le test ABC sur une base neuve réussit (4/4). Les contrôles locaux réussissent (238/238).
- La suite préalertes complète a révélé que la fiche transport retournée à un CHSLD incluait la priorité opérationnelle de la préalerte. Le champ `priorite` a été retiré de la sérialisation partagée. La suite complète a ensuite réussi (23/23), y compris le parcours CHSLD, le CCS et l’isolation par véhicule.
- Les interfaces n’ont pas toutes passé. Le journal antérieur montre des échecs sur téléphone, certaines vues SH et un montage qui interroge `sessions` avant la création du schéma. Le contrôle interface doit être réparé ou son défaut d’initialisation isolé, puis rejoué.
- Une nouvelle suite API complète est en cours sur une base fictive neuve avec le rôle SH explicite. Son journal est `/tmp/arrimo-integrations-final.log`. Le contrôle précédent ne peut pas servir de résultat final complet.
- Les tests Chrono/Sillage complets et l’ensemble des scénarios inter-acteurs doivent aussi être confirmés par leurs bilans définitifs. La migration réussie deux fois décrite plus haut ne remplace pas le contrôle de sauvegarde-restauration et retour arrière.
- Aucun déploiement recette, SH ou démo n’a été effectué. La publication globale sur démo demeure à préparer après validation, avec confirmation finale.

## Résultats complets de l’intégration du 23 novembre

- L’exécution complète de `npm test` sur une base fictive neuve possédée par `arrimo_sh` s’est terminée avec **365 tests réussis, 0 échec, 0 test ignoré et 0 annulation**. Journal `/tmp/arrimo-integrations-final.log`.
- Les deux parcours qui échouaient dans le montage API initial passent sur le rôle dédié : console SH et C4 **2/2**. La recette ERP SH reste validée **36/36**, journal privé `.local/preuves-sh-lot1/20261122235138_b1aeda/erp.log`.
- La suite secours/préalertes/CCS après correction de confidentialité est verte **23/23**, et ABC **4/4**. Les contrôles locaux restent **238/238**.
- Correction de sécurité : le JSON d’une demande de transport partagée avec un CHSLD ne transmet plus la priorité de préalerte, donnée opérationnelle destinée aux intervenants autorisés.
- Le rapport historique d’interface contient des échecs mobile et un essai avec table `sessions` absente. Une exécution fraîche d’interface est en cours sur `/tmp/arrimo-interfaces-final.log`.
- Le dernier contrôle des migrations indique quatre applications réussies sur schéma fictif de référence. La preuve de sauvegarde/restauration et retour arrière, les interfaces, les contrôles post-déploiement et la publication restent ouverts.

## Vérification de l’interface et sauvegarde du point courant

- Le contrôle d’intégration API complet est confirmé : 365/365, zéro échec, zéro ignoré, zéro annulé (`/tmp/arrimo-integrations-final.log`).
- L’interface conserve des écarts non clos. Le dernier journal complet d’interface `/tmp/arrimo-stabilisation-navigateur-reel.log` signale le guide de démonstration téléphone, la console SH sur trois largeurs, le thème téléphone, le centre de paramètres téléphone après une erreur `relation "sessions" does not exist`, et la recherche Patients téléphone. L’anglais tablette/téléphone et le thème ordinateur/tablette sont passés.
- Le rejeu ciblé avec l’URL d’authentification de recette n’a pas produit de journal exploitable. Ne pas considérer ces interfaces validées. À reprendre avec le test navigateur isolé et une base explicitement migrée `arrimo_test_*`, en vérifiant les tables de session avant de lancer Chromium.
- Sauvegarde de reprise actualisée dans `/root/arrimo-reprise-final` avec patch des suivis, archive des nouveaux fichiers, état Git, SHA de base et empreintes SHA-256.

## Bilan de stabilisation à ce point

**Cahiers fonctionnels principaux validés en recette fictive :** contrôles locaux 238/238, API/intégration complète 365/365, ERP SH 36/36, préalertes/CCS/transports 23/23, ABC 4/4, SH/C4 2/2. La sérialisation transport destinée à l’hébergement ne divulgue plus la priorité de préalerte.

**Cahiers non déclarés clos :** les tests navigateur smartphone et SH ont des échecs connus dans l’ancien journal et leur rejeu fiable n’a pas encore retourné de résultats. Le test de restauration depuis sauvegarde et la procédure de retour arrière n’ont pas été exécutés. Le contrôle des instances recette/SH/démo et la vérification après publication ne sont pas faits.

Aucune publication ou modification de production. Les résultats de recette ne prouvent pas la présence des migrations dans les instances hébergées. La suite API complète et les suites métier ont été exécutées sur des bases PostgreSQL fictives dédiées.

### Correctif mobile en cours de validation

Le débordement de la vue d’accueil mobile provient de la première colonne `max-content` de `.acc-kpi-fiche`, qui laisse un libellé KPI trop long dépasser du viewport. Une règle mobile borne les deux colonnes et autorise le retour à la ligne. Le rejeu du test téléphone s’est interrompu avec `Promise resolution is still pending`; cette correction reste à confirmer sur une exécution stable avant de fermer le volet interface.

## Reprise immédiate après les corrections de Claude

- Le correctif d’affichage des urgences classées sur téléphone est présent dans `public/style.css`. Le contrôle navigateur minimal de l’Accueil téléphone, sur 390 px et avec les zones défilantes autorisées exclues, donne `scrollWidth=390` et zéro élément visible hors viewport.
- Les 238 contrôles locaux ont été rejoués et réussissent sans échec, test ignoré ou annulation.
- Une base API fictive a été sauvegardée puis restaurée dans `arrimo_vnext_restore_final_20261123`. Le validateur a rejoué deux fois les quatre migrations de stabilisation, confirmé la conservation des lignes métier et contrôlé la présence des nouvelles colonnes et tables. Le dump fictif est `/tmp/arrimo-fictif-final.dump`.
- La suite navigateur SH lancée sur base neuve n’a pas fourni de résultat de scénario. Node a terminé avec `Promise resolution is still pending but the event loop has already resolved` après 145 secondes. L’interface SH n’est donc pas validée.
- Reste le rejeu de l’interface SH avec un montage de test corrigé et le contrôle final sur les environnements hébergés recette, SH et démo. Aucune publication n’a été faite.

## Préparation de publication — 23 novembre

- Le titulaire a autorisé l'étendue de publication, y compris la production. Aucune bascule n'a encore été exécutée.
- L'audit en lecture seule a retrouvé trois cibles distinctes (démo, principal, SH), toutes sur `releases/restructuration-20261123`. Leurs empreintes applicatives servies sont identiques entre elles, mais différentes de l'arbre de travail actuel. Cela impose une candidate et une recette finales avant toute bascule.
- Le lanceur historique est toujours épinglé à `98712dfb9b20c2b5ae21903a3c154da52bff5aa6` et aux preuves d'une ancienne recette ; il ne constitue pas la publication de la candidate actuelle. Son audit a été corrigé pour respecter `--cibles` et n'inspecter que les cibles demandées.
- Les liens `current` réels sont absolus. Le lanceur de release et la sauvegarde complète les acceptent désormais seulement lorsqu'ils désignent une release directe sous le `releases/` de la même installation ; les chemins hors périmètre, releases symboliques et identifiants contenant des séparateurs restent refusés.
- Vérifications de ces changements : 23 tests Python de publication réussis ; exercice shell d'activation atomique, panne simulée et retour arrière réussi ; `bash -n` et `git diff --check` réussis.
- Le test local final `npm run test:vnext-local` réussit à nouveau (238/238). L'audit demandé avec `--cibles demo` n'inspecte maintenant que la démo et confirme qu'elle est encore sur `releases/restructuration-20261123` ; l'empreinte de la release hébergée diffère de l'arbre source courant.
- Malgré l'autorisation de publication étendue, le cluster local est resté arrêté après les tentatives de démarrage autorisées. Le contrôle retourne `Could not change user id`, le socket PostgreSQL répond `EPERM` et le port 5432 ne répond pas. Aucune base ni donnée n'a été modifiée.
- Le contrôle navigateur complet n'est pas encore vert sur cette candidate. Aucun déploiement recette, SH, démo ou production n'est donc attesté par ce point.
- Après autorisation système, PostgreSQL 16 `main` est effectivement `online` et `sudo -u postgres psql -d postgres -c 'SELECT 1;'` réussit. La recette complète a validé le runtime, la sauvegarde/restauration et les migrations sur copie. Sa première suite API a cependant révélé que le runner conserve un handle après la fin des scénarios ; le lancement a été interrompu sans échec de test rapporté. Le lanceur de recette ajoute maintenant `--test-force-exit`, option disponible dans Node 24, pour obtenir le résultat TAP réel et laisser le garde-fou rejeter toute suite incomplète.
- La suite navigateur intégrale a rendu 15/16 tests réussis. L’unique échec est un garde-fou de nettoyage SH déclenché par le nom de base temporaire `arrimo_interface_…`, qui n’incluait pas `test`. Le préfixe du lanceur est corrigé en `arrimo_interface_test_`; il sera vérifié par une reprise ciblée sur une base fictive neuve.
- La suite dédiée aux priorités navigateur a aussi révélé que son test clique directement un onglet caché par la nouvelle navigation par espaces. Le parcours du test utilise désormais l’aide de navigation utilisateur `allerOnglet`, afin de valider le vrai chemin sur ordinateur, tablette et téléphone.
- Le test navigateur de structure a trouvé deux panneaux `details` (structure et historique) et utilisait un sélecteur ambigu. Le sélecteur cible maintenant explicitement le panneau de structure ; cette correction de test sera incluse dans la reprise des seules suites en échec.
- Les tests de préalertes ont révélé que le lanceur imposait `ARRIMO_ENV=demo` et `ARRIMO_DEMO=1`, empêchant leurs assertions explicites de vérifier les refus en développement/recette/production. Ces variables sont maintenant retirées pour la suite secours/transports, comme elles le sont déjà pour l’API ; les scénarios les réactivent eux-mêmes quand ils testent les fonctions réservées à la démo.
- Les dernières suites ont aussi mis au jour trois défauts de harness/assertions : DSN était forcé en démo malgré les tests négatifs, le test temps réel attendait un libellé absent plutôt que le bouton d’accusé, et le contrôle XSS cliquait des onglets cachés. La reprise retire les variables d’environnement pour CHSLD/DSN, attend l’action réellement rendue dans Flux, et navigue par le menu utilisateur. Le test CHSLD vérifie maintenant qu’un transfert annulé reste dans l’historique et que l’accès Réseau est présent pour une RPA.
