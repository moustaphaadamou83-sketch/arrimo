# Arrimo — préparation de la présentation

22 octobre 2026. Ce rapport complète le rapport d'accès et de récupération, sans le remplacer ni modifier les sources originales.

## Résultat et périmètre

L'accès public a été rétabli puis confirmé par l'utilisateur. Une copie de développement distincte est préparée à partir du dépôt Git récent `8542278a6274a7bb4932bfb62fbc42c4c8c0a4c0`, sur la branche locale `preparation-presentation-20261022`. Elle conserve les fonctions récentes et ajoute les corrections utiles du projet local ancien. Aucun déploiement public n'a été réalisé.

Le projet initial et les deux références récupérées (Git et source déployée exacte) sont conservés. Aucun compte public, mot de passe public, mécanisme MFA, service, configuration ou donnée métier distante n'a été modifié pendant cette préparation. La seule consultation distante supplémentaire est la lecture de la version Node.js.

## Corrections effectuées dans la copie

1. **Connexion :** les échecs anciens expirent après quinze minutes, tout en conservant le blocage après huit échecs. Le message d'erreur bilingue reste inchangé. Le problème public initial venait toutefois des anciens comptes supprimés, et non de ce compteur.
2. **Confidentialité IA :** abandon de l'envoi d'un briefing textuel simplement expurgé par expression régulière. Les appels facultatifs utilisent désormais une liste de champs agrégés et des questions prédéfinies françaises ou anglaises. Les questions libres restent locales ; délai de huit secondes et repli local conservé en cas d'échec. Aucun fournisseur réel n'a été activé.
3. **Indicateurs :** ajout des nombres occupés/réservés/nettoyage et des taux `occupation_patients` et `non_disponibilite`, à une décimale. Le champ historique `occupation` conserve son calcul pour compatibilité. Le tableau Indicateurs affiche l'occupation par un patient ; Réseau nomme correctement sa non-disponibilité. Les règles et seuils d'alerte existants sont conservés.
4. **OG :** nom et formulation d'accueil intégrés en français et en anglais, avec rappel de validation humaine et de confidentialité. La palette et l'icône vectorielle existantes sont réutilisées.
5. **Dépendances :** Express 4.22.3, Nodemailer 10.2.1 et Playwright 1.64.1 installés et verrouillés dans cette copie. Le registre npm signale zéro vulnérabilité sur l'arbre final, dépendances de développement incluses. Cela ne constitue pas un audit exhaustif de sécurité.
6. **Présentation locale :** commande `npm run presentation:locale`, serveur limité à `127.0.0.1:3013`, base fictive neuve au premier lancement, réutilisée ensuite, accès privés. Aucun chargement de `.env`, courriel ou IA externe ; aucune remise à zéro automatique.

**Compatibilité à traiter avant un éventuel déploiement :** cette copie exige Node.js 20 ou plus, comme Nodemailer corrigé. Les tests s'exécutent sous Node 24.14.1. Le serveur public répond actuellement Node 18.19.1 ; un déploiement de cette copie nécessiterait donc d'abord une mise à niveau du runtime préparée, validée et autorisée séparément. Aucune mise à niveau distante n'a été tentée.

## Rapprochement Git / installation

Les quatre écarts sont examinés et leurs différences conservées dans `preuves/*.diff` :

| Fichier | Écart observé | Choix de la copie |
|---|---|---|
| `tests/api.test.js` | L'installation omet la vérification syntaxique du script de configuration B2 | Garder la vérification Git et ajouter quatre tests de régression |
| `deploy/installer.sh` | Git installe le script de configuration B2 ; l'installation récupérée omet cette ligne | Conserver Git ; aucun installateur exécuté |
| `deploy/sauvegarde.sh` | Git vérifie le résultat de la copie distante et signale l'échec ; la version installée est moins explicite | Conserver Git ; aucune sauvegarde ni restauration distante déclenchée |
| `CLAUDE.md` | Git documente plus récemment la sauvegarde externe et le dépôt distant | Conserver Git comme documentation historique, sans convertir ses affirmations en nouvelle preuve d'exploitation |

Le module `src/civieres.js` reste identique à Git et à la source déployée récupérée : aucune reconstruction. Les changements ne sont pas fusionnés dans le projet initial et aucun commit n'est poussé.

## Audit fonctionnel

« Validé localement » désigne les tests et données synthétiques de cette copie, pas une homologation métier ou une recette de production.

| Domaine | État et preuves | Limites / suite |
|---|---|---|
| Accès public | Connexion réseau confirmée par l'utilisateur ; recette WebKit précédente réussie | Utiliser les comptes actuels, pas les anciens `coordo.*` ; administration sensible soumise à MFA |
| Authentification / rôles | Refus sans session, isolation entre établissements, expirations, mots de passe temporaires et MFA testés localement | Activation MFA du compte public non faite ; aucun contournement |
| Lits et capacités | Cycle libre/réservé/occupé/nettoyage, indisponibilité motivée, versions et réservations concurrentes testés | Les données de personnel réelles ne sont pas intégrées ; indicateurs à harmoniser avec l'établissement |
| Urgence / civières | Régulières, débordement, arrivée conservée au déplacement, demandes liées, admission/transfert et nettoyage testés | Le taux peut dépasser 100 % ; en capacité régulière nulle, la valeur sentinelle actuelle ne doit pas être présentée comme un taux normalisé |
| Admission / entretien | Besoins d'équipement respectés, assignation, admission et accès du rôle entretien testés | Les critères propres aux unités pédiatriques ne sont pas validés |
| Transferts | Demande, acceptation, transport, départ, réception, refus, isolement et chambre prête testés | Le transport est renseigné dans Arrimo ; aucune réservation réelle d'ambulance n'est démontrée |
| Alertes | Niveaux, saturation, attentes prolongées et disponibilité voisine testés | Seuils et procédures à faire approuver par les équipes ; pas de seuil institutionnel supposé |
| Prévisions | Horizons 4/12/24 h et marges calculées, intégration au briefing et questions testés | Modèle par règles et historique ; aucune calibration prospective clinique ni performance prédictive réelle mesurée |
| Réseau / National | Tri, filtres, partage agrégé et pagination testés ; scénario local à 200 établissements dans le test de performance | Ce test local ne démontre pas une capacité de production multiétablissements à grande échelle |
| Indicateurs / CSV | Données d'activité, tendances et export testés ; occupation clarifiée dans cette copie | Aucune preuve d'amélioration hospitalière réelle ; définitions à convenir avant le pilote |
| OG / copilote | Briefing, recommandations exécutables sous contrôle humain, FR/EN et protection des appels externes testés | Fournisseur réel désactivé et non validé ; aucune compétence clinique revendiquée |
| Connecteurs | API JSON, événements, idempotence et isolation testés | Conversion HL7 ADT attendue du moteur d'interface hospitalier ; aucune liaison réelle Santé Québec / Sainte-Justine validée |
| Console SH / implantation | Parcours local : premier compte, MFA, hôpital, import, formation, go-live et PDF | La console publique SH n'a pas été authentifiée ; aucun hôpital distant créé ou activé |
| Courriels | Récupération de compte testée avec transport simulé ; MIME réel Nodemailer produit sans connexion réseau | SMTP réel, délivrabilité et domaine expéditeur à vérifier dans un environnement autorisé |
| Serveur / API / base | API et PostgreSQL locaux validés ; précédents contrôles publics consignés dans le rapport d'accès | Pas de test de charge sur le public ni de restauration distante ; la documentation de sauvegarde n'est pas un nouveau test de restauration |
| Langues / écrans | Recettes françaises et anglaises, ordinateur/tablette/téléphone, guide et console SH | Largeurs simulées ; pas de certification d'accessibilité ni de recette sur appareils physiques |

## Tests et traçabilité

- Projet initial : **33 tests API réussis**, relancés sans modification de son code (`preuves/tests-api-original-33.txt`).
- Copie préparée : **57 tests API réussis**, dont les quatre régressions supplémentaires sur authentification, confidentialité IA, repli et occupation.
- Transport courriel : **1 test réussi**, production d'un message MIME sans envoi réseau.
- Interface complète : **9 tests réussis**, dont les parcours de présentation aux trois largeurs, les écrans anglais et le parcours SH local.
- Audit npm final : **0 vulnérabilité signalée**, preuve JSON conservée.

Les bases de test sont nouvelles et distinctes. Les scénarios nommés « production » dans les tests utilisent uniquement des schémas locaux synthétiques. Les anciens rapports et preuves sont conservés ; les captures générées pendant les répétitions de tests sont des artefacts de cette nouvelle copie.

Les preuves JSON indiquent les noms des bases, les codes de sortie et les résumés. Le manifeste de préservation compare les fichiers du projet initial à leurs empreintes précédentes et la référence déployée à son manifeste. Le patch de revue accompagne la copie ; il n'a pas été appliqué ailleurs.

## Ce qui reste avant la présentation

1. Répéter le scénario sur Safari réel, le Mac, la projection et le réseau du jour J. Les captures servent de secours ; la répétition du présentateur reste nécessaire.
2. Obtenir la validation métier du scénario pédiatrique, des critères d'acceptation et des définitions des mesures. Ce travail exige les responsables concernés.
3. Si l'administration sensible doit être montrée sur le public, activer la MFA avec le titulaire du compte. Sinon, présenter le parcours local déjà testé.

**La copie locale contient les corrections et OG ; le public conserve sa version actuelle.** La démonstration locale est préparée. Une mise en ligne de ces corrections, une mise à niveau Node, l'activation SMTP ou des accès à des systèmes hospitaliers réels restent des opérations distinctes, non exécutées.

## Livrables

- `docs/PRESENTATION_SANTE_QUEBEC.md` : déroulé, messages, explications et répétition.
- `docs/OG_IDENTITE_ET_COMPORTEMENT.md` : identité intégrée et limites.
- `scripts/presentation-locale.cjs` : lancement isolé sur ce Mac.
- `preuves/` : résultats, audit, comparaisons et patch de revue.
- `captures/` : secours visuel, uniquement données synthétiques.
