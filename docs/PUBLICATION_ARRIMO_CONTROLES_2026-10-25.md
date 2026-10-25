# Arrimo — contrôles de publication du 25 octobre 2026

## État réel

La recette SSH `/root/arrimo-recette-ssh-20261025T080046Z-1383330` exécute le commit `7177e2245801ad30c7e6dd420a27e6e879a0b579` sur des bases neuves. Ses journaux ont été relus directement ; ce ne sont pas des simulations locales.

Résultats constatés à la rédaction :

| Étape | Résultat réel |
|---|---|
| API | 68 réussis, 6 échecs, aucun ignoré sur 74 |
| Sécurité multiétablissements | 13/13 |
| Interface et parcours | 5 réussis, 4 échecs sur 9 |
| Priorités navigateur | 4/4, dont ordinateur, tablette et mobile |
| Structure navigateur | 1/1 |
| ERP SH | 19/19 |
| Navigation SH | 1/1 |
| XSS | Pas de résultat terminé constaté à la rédaction |

La recette initiale du commit a81b35b avait déjà validé priorités SQL 10/10, interopérabilité SQL 10/10, scénarios A/B/C 7/7 et dashboards A/B/C/Réseau 4/4, ainsi que sauvegarde fictive, restauration et migrations répétées sans perte. Ces preuves ne certifient pas une nouvelle version modifiée.

## Correctifs après lecture des nouveaux échecs

- La recette forçait ARRIMO_ENV=demo pour l’API. Cette variable a priorité sur ARRIMO_DEMO et invalidait les tests de refus hors démo. L’API choisit désormais elle-même ses modes ; les autres suites conservent leur configuration. Le simulateur lancé à tort expliquait aussi la modification inattendue de 44 ressources fictives.
- Le scénario de transfert attendait une urgence déduite de l’ancienne indication P1. L’API exige une action explicite : le scénario fournit désormais urgent=true, confirmé par l’équipe simulée. Aucune dérivation automatique de gravité n’est réintroduite.
- L’alerte de disponibilité attendait toujours un seul lit libre. Elle vérifie désormais le nombre réel en base et le texte français et anglais correspondant, tout en conservant les assertions de rayon, besoins et limitation des notifications.
- Les libellés et explications de priorité non validée restaient français dans OG et Urgences en anglais. Ils suivent maintenant la langue autorisée de l’utilisateur. Les libellés professionnels validés sont conservés ; aucune traduction clinique inventée.
- Le parcours SH utilisait waitForFunction, incompatible avec sa CSP sans unsafe-eval. Les attentes vérifient désormais les titres et confirmations visibles avec des locators. Aucun assouplissement de CSP.

## Vérification des correctifs

135 tests locaux JavaScript et 24 tests Python réussis. Preuve JavaScript : `preuves-corrections-recette-20261025/tests-locaux-publication.json`. Les nouvelles sources applicatives nécessitent une recette complète ; le garde-fou refuse volontairement une reprise partielle avec ces modifications. Aucun test PostgreSQL ou navigateur de ces nouvelles sources n’est encore déclaré réussi.

## Publication

Aucune bascule publique ni migration publique effectuée dans cette intervention. Les pointeurs locaux observés sont principal et démo : arrimo-fin-2ed912745f6338e185c8c31bd0cb97385a9fce1d ; SH : arrimo-audit-9a67e96e2a3d0b537609435b17bc2833c8eb7417. Ce constat ne vaut pas contrôle HTTPS ni validation connectée publique.

Le passage en publication exige une recette complète réussie du nouveau commit, puis des sauvegardes publiques restaurées sur copies neuves, migrations vérifiées sur ces copies, rollback applicatif préparé, déploiement démo puis contrôles HTTPS et parcours A/B/C/Réseau. Principal puis SH uniquement si leurs prérequis sont également satisfaits. Ne jamais restaurer le dump fictif sur une base publique ni réinitialiser A/B/C.

Statut Sainte-Justine : préparation non validée tant que ces conditions ne sont pas réalisées. Non validé pour usage clinique réel.
