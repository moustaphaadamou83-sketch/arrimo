# Arrimo.SH — reprise de la confidentialité des notifications

La reprise retrouve une tranche de développement déjà présente après la migration 18 : migration 19, rattachement des notifications aux ressources et contrôle des responsables. Elle la conserve et termine sa validation, sans réimplémenter les tranches antérieures.

## Périmètre

Les notifications CRM, relances, devis, projets, tâches, rappels, formation, support et hébergement disposent de contrôles de rôle et de périmètre. Les droits du destinataire sont réévalués à la lecture et au marquage comme lu. Les notifications historiques sans rattachement exploitable sont conservées mais masquées aux employés concernés. Les notifications financières gardent leur rattachement client de la migration 17.

Les affectations de responsables CRM, tâches et formateurs sont vérifiées avant écriture. La fonction PostgreSQL privilégiée contrôle le contexte et le périmètre de l’émetteur. Les rappels quotidiens peuvent être créés pour l’utilisateur courant sans ouvrir la notification d’autres employés en lecture.

## Correction pendant cette reprise

La nouvelle fixture PostgreSQL omettait les champs obligatoires `environnement` et `code_etab` des hôpitaux fictifs. Ces valeurs sont désormais explicites et les paramètres SQL pays/code sont distincts, conformément à leurs types PostgreSQL. La suite ciblée a ensuite réussi ses huit tests, sans test ignoré.

## Validation

La recette intégrée finale est **valide : 188 tests PostgreSQL/API/Chromium réussis sur 14 suites, sans échec, annulation ni test ignoré**. Les compteurs incluent les tests parents Node. L’empreinte commune des sources est `f56eef3abe3aa12337666ab6142a108daeac55a779ca38f96b4b52af65f79f36`, sans modification pendant les suites. Voir le [résumé machine](preuves-confidentialite-notifications-sh-20261029/resume.json) et le [rapport intégré](preuves-confidentialite-notifications-sh-20261029/rapport-integration.json). Les résultats locaux actuels sont 212 tests réussis ; les 75 tests Python utilisent des simulations. La syntaxe des 191 fichiers JavaScript passe et `git diff --check` réussit.

Après demande explicite de publication des blocs validés, SH seule a été publiée le 29 octobre à 16:39 UTC : release `sh-v19-20261029t163913z`, migrations 10–19, santé HTTPS et empreintes de tous les fichiers publics SH contrôlées. Une sauvegarde fraîche et une configuration privée de récupération sont conservées dans `.local`. La répétition sur copie restaurée a contrôlé la préservation des anciennes colonnes, la réexécution sans effet et les parcours de connexion/projets des deux versions applicatives. Le déploiement a de nouveau comparé les anciennes colonnes. La configuration est inchangée ; les PID des services Démo et recette contrôlés sont inchangés. Aucun changement SMTP réel n’a été effectué. Le portail côté application hospitalière, les évolutions vocales hospitalières et les intégrations distantes ne sont pas publiés par cette livraison SH. Les bases PostgreSQL de recette sont neuves et fictives sur le cluster temporaire dédié. La suite ne prouve pas une couverture exhaustive de tous les chemins indirects du produit.

## Suite du cahier

Les pièces jointes, SLA contractuels, escalades et file de courriels support sont maintenant publiés. La recherche de tickets SH par OG, les détails projets/déploiement/RH, budgets/coûts/marges, change daté, devises hors stockage actuel et paramètres personnels restent ouverts. La livraison SMTP en boîte n’a pas été testée; les tests d’envoi restent simulés. Les validations physiques vocales et l’infrastructure de livraison restent distinctes des tests simulés et isolés. Les six lots ne sont pas déclarés clos.

Preuves publiques sans sauvegarde ni secret : [publication SH](preuves-confidentialite-notifications-sh-20261029/publication-sh.json) et [répétition de migration](preuves-confidentialite-notifications-sh-20261029/repetition-migration.json).
