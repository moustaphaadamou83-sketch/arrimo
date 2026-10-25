# Arrimo — correction de la recette SSH du 25 octobre 2026

## Périmètre et preuves réelles

Rapport examiné : `/root/arrimo-recette-ssh-20261025T044222Z-1344954/rapport.json`, commit `a81b35bc538e7d59f9dc0aaedb34d8d80add08e4`.
Les journaux attestent PostgreSQL, Chromium, sauvegarde fictive, restauration et deux passages des migrations sur copie avec préservation des données.
Empreinte SHA-256 du dump fictif, relue et vérifiée : `ffd8f20b74eb5ecef6a2bc11f371d9c10694b920fac088845e3edaa4ed2dc80e`.
Cette sauvegarde fictive ne remplace pas les sauvegardes des environnements publics.

Étapes réellement réussies de cette recette : priorites-sql 10/10, interop-sql 10/10, scenarios-abc 7/7, dashboards-abc-reseau 4/4 (comptages TAP incluant les tests parents). Aucun test ignoré dans ces étapes.
Huit étapes restent à revalider après correction : api, securite-multietablissement, interface-parcours, priorites-navigateur, structure-navigateur, sh-erp, sh-navigateur, securite-xss.

## Causes et correctifs

- Six étapes consultaient `server.address().port` immédiatement après un démarrage HTTP asynchrone sur loopback. Aucune erreur de bind antérieure ne figure dans leurs journaux. Le helper partagé attend maintenant `listening`, valide le port et propage les erreurs initiales ainsi que les dépassements de délai. Le loopback et les contrôles de sécurité restent actifs.
- Le parcours priorités attendait par défaut la visibilité de `#modale[hidden]`. L’intention est la fermeture après validation : attente explicite de l’état caché de `#modale`. Les assertions métier, SQL et erreurs JavaScript sont conservées.
- Le parcours structure réutilisait un fichier partagé de `/tmp`. Il utilise désormais un répertoire unique et privé sous `.local` dans la copie de recette. Aucun fichier tiers ni permission globale n’est modifié.

## Vérification locale

133 tests JavaScript réussis, zéro échec, zéro ignoré, zéro annulé ; détail dans `preuves-corrections-recette-20261025/tests-locaux.json`.
23 tests Python du garde-fou de recette réussis, dont huit contrôles de reprise et six contrats JavaScript du serveur HTTP dans le total JavaScript.
Ces tests locaux ne constituent pas une réexécution des huit étapes PostgreSQL/navigateur.

## Reprise isolée

Commande depuis la session SSH Contabo, après présence de ce commit dans le dépôt :

```bash
bash /root/arrimo-sh-erp/scripts/lancer-recette-ssh.sh --reprendre-echecs /root/arrimo-recette-ssh-20261025T044222Z-1344954/rapport.json
```

La reprise vérifie le SHA du dump, les journaux TAP des quatre réussites, les prérequis historiques et l’absence de modification applicative, de migration ou de dépendance depuis le commit initial. Toute modification de ce périmètre impose une recette complète. Les huit étapes sélectionnées utilisent chacune une base neuve et une nouvelle copie de HEAD ; les anciennes bases et les bases publiques restent intactes. Les contrôles minimaux du runtime sont répétés avant toute création. Le rapport distingue les preuves héritées et les nouvelles exécutions. Un test ignoré ou absent interdit la validation.

## Publication et retour arrière

Aucune publication ni migration publique effectuée pour ces corrections. L’application et les migrations sont inchangées ; les correctifs concernent les tests et leur orchestration.
Après réussite réelle des huit étapes : sauvegarder les bases et configurations publiques concernées, vérifier leur restauration sur nouvelles copies et tester les migrations sur ces copies. Préparer les versions applicatives précédentes et le rollback applicatif sans restauration aveugle des données. Déployer ensuite la démo par le mécanisme existant `deploy/releases.sh`, vérifier HTTPS, connexions, rôles et parcours A/B/C/Réseau, puis envisager principal et SH selon leur compatibilité et leurs propres sauvegardes. Aucun scénario, compte ou historique existant ne doit être réinitialisé.

La démonstration Sainte-Justine reste non validée tant que les huit étapes et les vérifications publiques ne sont pas réussies. Aucune validation pour usage clinique réel.
