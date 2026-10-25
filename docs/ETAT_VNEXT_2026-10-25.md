# Arrimo VNext — état vérifié dans cette session, 25 octobre 2026

La mission complète n'est pas livrée. Ce rapport distingue les observations locales, les tests exécutés et les résultats historiques. Aucune donnée hospitalière ni donnée de démonstration n'a été modifiée dans cette session.

## Correctif développé et tests locaux

Le connecteur appliquait l'événement dans une transaction puis enregistrait son accusé d'idempotence séparément. Deux livraisons concurrentes pouvaient franchir ensemble la lecture initiale ; une interruption entre les deux validations laissait un événement appliqué sans accusé.

Correction dans `src/connecteurs.js` : verrou transactionnel PostgreSQL par connecteur/identifiant, lecture du journal sous ce verrou, effet métier et accusé dans la même transaction. Les événements ignorés sont aussi journalisés. Un événement précédemment rejeté peut être rejoué ; un événement appliqué ou ignoré n'est pas réappliqué. Aucune migration nécessaire.

Tests exécutés directement avec Node 24.21.0 :

| Suite | Réussis | Échecs | Portée |
|---|---:|---:|---|
| connecteurs-atomicite.test.cjs | 6 | 0 | Contrat transactionnel avec base simulée : accusé avant commit, doublons, reprise de rejet, rollback si panne d'accusé, lit inconnu, refus d'écriture réseau |
| courriel-transport.test.cjs | 1 | 0 | Production du message MIME sans réseau |
| routage.test.cjs | 6 | 0 | Fournisseur simulé, unités, clé, absence de route, profil, HTTPS |

`node --check` sur le connecteur et la suite API : réussi. `git diff --check` : réussi.

Un test de livraisons simultanées a été ajouté à la suite API PostgreSQL. Il n'a PAS été exécuté : accès PostgreSQL refusé. Les tests simulés ne prouvent pas le comportement réel des verrous PostgreSQL ni les parcours hospitaliers complets. Le correctif n'est pas admissible à la publication avant cette recette.

## Inventaire et versions observées

Dépôt : `/root/arrimo-sh-erp`, branche `finalisation-27oct`, base de session `5964375930f98c73b3d82c66ac735c91ae1aa7a7`.

| Environnement | Observation sur les fichiers locaux | Vérification publique actuelle |
|---|---|---|
| Démo A/B/C | Le lien `/opt/arrimo-demo/current` vise `arrimo-fin-2ed912745f6338e185c8c31bd0cb97385a9fce1d` | Impossible |
| Principal | `/opt/arrimo` présent ; fichiers terrain, interface et schéma différents de la démo ; pas de `.arrimo-release` à sa racine | Impossible ; commit actif non établi |
| SH | Le lien `/opt/arrimo-sh/current` vise `arrimo-audit-9a67e96e2a3d0b537609435b17bc2833c8eb7417` | Impossible |

Attention : les fichiers `.arrimo-release` de démo et SH indiquent encore `74b35fb…`, contrairement aux noms des répertoires ciblés. Ces marqueurs ne suffisent donc pas à identifier le code servi. La version réellement chargée par les processus n'est pas établie dans cette session.

L'existant comprend admissions, lits, civières, nettoyage, NSA, transferts, OG, réseau, catalogue pédiatrique, congés détaillés et SH ERP. Les rapports précédents annoncent API 81/81, scénarios A/B/C 7/7, navigateur 21/21 sur copie et 22 questions OG. Ces résultats sont historiques et n'ont pas été reproduits ici.

## Blocages vérifiés

- PostgreSQL : `psql -d postgres` échoue sur le socket local avec `Operation not permitted`.
- Réseau : `curl` vers la démo échoue avec `Could not resolve host`. L'ouverture des trois routes publiques `/api/sante` par l'outil web échoue également. Aucun contrôle HTTPS, rôle, connexion ou dashboard public n'est validé ici.
- Sauvegarde principale du 24 octobre : fichier recensé, mais `pg_restore --list` échoue avec `Permission denied`. Lisibilité et restauration non vérifiées dans cette session.
- Les prérequis de publication ne sont donc pas satisfaits. Aucun déploiement, aucune migration, aucune restauration ni modification de droits n'ont été exécutés. Aucun rollback nécessaire pour cette session ; les procédures historiques restent à revérifier sur le serveur.

## Écarts au cahier et ordre de reprise

1. Rendre disponibles les accès serveur/base autorisés et vérifier les versions des processus, les sauvegardes restaurables et les procédures de rollback.
2. Tester le correctif connecteur sur copie restaurée : concurrence réelle, interruption avant accusé, reprise après rejet et régression admissions/lits/civières. L'ordre des événements, les conflits, les mappings et les systèmes de référence restent à auditer ; aucune conformité complète d'interopérabilité n'est affirmée.
3. Compléter le moteur de priorités : le schéma actuel de `demandes_admission` contient trois valeurs fixes `p1/p2/p3`, sans colonnes dédiées auteur/date de validation clinique. Le référentiel configurable et la validation explicite demandés ne sont pas livrés par le présent correctif. Ne pas inventer de règles médicales ni considérer `cree_par` comme une validation clinique.
4. Compléter et tester les écrans SH de configuration opérationnelle, en distinguant les modules ERP/licences des modules hospitaliers. Préserver les opérations lors des synchronisations.
5. Rejouer les scénarios A à K et les questions OG sur copie : notamment admission depuis les deux écrans, attribution pédiatrique, refus B puis réception C, intégration, droits interétablissements et compte réseau.
6. Publier seulement après validation, puis vérifier les quatre dashboards dans le navigateur public sans réinitialiser A/B/C. Vérifier principal et SH selon les changements nécessaires.

## Captures, démonstration et statut

21 captures antérieures existent dans `/root/arrimo-finalisation/captures-pub/`. Le rapport antérieur précise qu'elles proviennent d'une copie de la base publique, pas d'une session authentifiée sur la démo publique. Aucune nouvelle capture réalisée ici.

Les guides et résultats historiques restent dans `GUIDE-DEMO.md`, `docs/RAPPORT_FINALISATION_2026-10-24.md`, `docs/RAPPORT_DEPLOIEMENT_2026-10-25.md`, `docs/Scenarios_Resultats.md` et `docs/OG_Questions_Reponses.md`. Ils ne remplacent pas la recette actuelle.

**Développé :** correctif d'atomicité du connecteur. **Testé localement :** 13 tests, dont 6 nouveaux avec base simulée. **Testé sur copie PostgreSQL :** non dans cette session. **Déployé publiquement :** aucun changement dans cette session. **Testé dans le navigateur :** non dans cette session. **Prêt pour Sainte-Justine :** non confirmé ; critères de priorisation et recette finale encore ouverts. **Usage clinique réel :** non validé.
