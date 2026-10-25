# Arrimo — recette isolée validée le 25 octobre 2026

Commit effectivement testé : `98712dfb9b20c2b5ae21903a3c154da52bff5aa6`.
Dossier serveur : `/root/arrimo-recette-ssh-20261025T082510Z-1391873`.
Rapport final lu directement : **copie_validee**, sauvegarde fictive restaurée, migrations validées sur copie, aucune publication et aucune migration publique.

| Suite réelle | Réussis / total TAP |
|---|---:|
| API | 74/74 |
| Priorités PostgreSQL | 10/10 |
| Interopérabilité PostgreSQL | 10/10 |
| Sécurité multiétablissements | 13/13 |
| Scénarios A/B/C | 7/7 |
| Dashboards A/B/C/Réseau | 4/4 |
| Parcours navigateur | 9/9 |
| Priorités navigateur | 4/4 |
| Structure navigateur | 1/1 |
| ERP SH | 19/19 |
| Navigation SH | 1/1 |
| XSS | 1/1 |
| **Total** | **153/153** |

Zéro échec, zéro test ignoré, zéro annulé. Les décomptes TAP incluent les tests parents. Les douze journaux ont été relus et leurs compteurs et empreintes vérifiés indépendamment. Ils sont conservés dans `preuves-recette-validee-20261025`, avec le rapport JSON et les captures des quatre dashboards.

La sauvegarde fictive a été restaurée dans une base neuve, comparée à sa source par empreintes, puis les migrations appliquées deux fois sans perte des lignes existantes. Son SHA-256 a également été revérifié lors de l’archivage des preuves. Elle ne remplace pas la sauvegarde des bases publiques.

Les parcours vérifient les admissions depuis Lits et Admissions, transactions et concurrence, priorités validées par des professionnels fictifs habilités, compatibilité adulte/pédiatrique, événements simulés idempotents et hors ordre, OG sur données synchronisées, isolation, congés, nettoyage, NSA, transferts et configuration SH. Les parcours principaux et le go-live SH fictif ont été testés sur ordinateur, tablette et téléphone. Il ne s’agit d’aucune intégration réelle avec un logiciel hospitalier.

Les correctifs applicatifs des étapes précédentes sont donc maintenant validés réellement. L’interruption de la recette précédente ne concerne pas cette exécution achevée. Les sources applicatives n’ont pas été modifiées pendant cette validation. Les résultats locaux précédents restent 135 tests JavaScript et 24 Python réussis.

## Publication réellement effectuée : aucune

Une sauvegarde complète de la démo publique a été tentée depuis cette session avec le script existant, vers un répertoire privé sous `/root`. Elle a échoué (sortie 1, seul diagnostic `pg_dump: error:`). Aucun dump public vérifié ou restauré n’a été produit par cette tentative. La configuration privée du principal est également inaccessible à cette session.

La commande de contrôle des services `systemctl is-active arrimo-public-demo.service arrimo.service arrimo-sh.service` a échoué avec `Failed to connect to bus: Operation not permitted`. Aucun accès distant SSH ou autre exécuteur serveur autorisé hors sandbox n’est exposé aux outils de cette session. Les refus n’ont pas été contournés. La lecture HTTP externe des endpoints de santé n’a pas été possible depuis l’outil web ; elle ne constitue pas un diagnostic d’indisponibilité des sites.

Les étapes restantes exigent une session serveur autorisée : sauvegardes fraîches des environnements visés, restauration sur nouvelles copies et vérification des migrations avec leur rôle applicatif ; préparation et exercice du rollback ; déploiement de la démo puis contrôle HTTPS et parcours publics A/B/C/Réseau, avant principal et SH. Les garde-fous existants de préflight et le mécanisme de releases doivent être conservés. Le script d’installation inclut maintenant les deux migrations du 25 octobre dans une seule transaction. Aucun seed ni réinitialisation des scénarios A/B/C n’est autorisé.

État final de cette intervention : **développé et testé réellement sur copies isolées ; non publié ; démonstration publique encore à vérifier**. La solution n’est pas validée pour usage clinique réel.
