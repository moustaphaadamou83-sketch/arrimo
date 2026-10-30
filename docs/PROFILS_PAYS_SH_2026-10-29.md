# Arrimo.SH — profils hospitaliers et pays

## Correction réalisée

La création d'un établissement prenait le premier profil `config_pays`, indépendamment du pays de l'hôpital. Elle sélectionne désormais un profil compatible ; une absence ou une ambiguïté interrompt la création avant insertion. Le formulaire d'administration propose un choix explicite lorsque plusieurs profils existent.

Un code interne n'est pas une preuve de pays : `NE`, par exemple, n'est pas interprété automatiquement comme Niger. La correspondance est fournie par `ARRIMO_PROFILS_PAYS`, objet JSON associant codes internes et codes ISO, par exemple `{"REGION-NORD":"TG"}`. Seule la correspondance historique `QC` → `CA` est implicite. Une configuration invalide provoque une erreur explicite. Aucun profil ni paramètre de service n'a été créé ou modifié dans un environnement hospitalier pendant ce travail.

La liaison SH charge les profils compatibles de la cible et demande un choix si nécessaire. Elle transmet `pays_code` et `config_id`. La liaison à un établissement existant, son activation, le préflight et le Go Live vérifient son identité et son pays. Le pays devient non modifiable depuis SH après liaison. Une ancienne API incapable d'attester les profils est refusée.

Ces contrôles empêchent la sélection silencieuse d'un profil étranger. Ils ne démontrent pas à eux seuls l'isolation de toutes les données entre établissements ou pays, ni la conformité clinique, juridique et fiscale des profils.

## Preuves et limites

- **208 tests locaux réussis, aucun échec ou test ignoré**, dont 13 sur les profils, les refus avant écriture, le contrat de rollback et les formulaires exécutés en VM. Les appels distants et la base sont simulés dans ces tests.
- **75 fichiers JavaScript vérifiés**, aucune erreur de syntaxe ; `git diff --check` réussi.
- L'empreinte SHA-256 des sources correspond à celle enregistrée pendant les tests. Les résultats et le manifeste sont dans [preuves-profils-pays-20261029](preuves-profils-pays-20261029/resume.json).
- Un scénario PostgreSQL multi-pays a été ajouté à `tests/sh-erp.test.cjs` : refus d'un mauvais profil, liaison correcte, import fictif de structure, compte fictif et refus d'accès à un autre établissement. **Il n'a pas été exécuté.** Les nouvelles requêtes SQL et le parcours navigateur restent donc non validés en conditions intégrées.
- Le [diagnostic système](preuves-profils-pays-20261029/diagnostic-systeme.json) confirme `EPERM` sur le changement d'identité PostgreSQL, le socket PostgreSQL et l'écoute locale. Les capacités Linux sont nulles, avec `NoNewPrivs=1` et `Seccomp=2`. Aucun SQL n'est exécuté par ce diagnostic. La recette nécessite un environnement isolé autorisant ces opérations ; aucune protection n'a été contournée.

## Risques de livraison et travail restant

Les correspondances pays/profils doivent être revues et configurées dans chaque cible. Elles n'ont pas été écrites dans les services réels. Plusieurs profils compatibles sur une cible de Go Live provoquent encore un refus d'ambiguïté : ce parcours ne dispose pas encore du sélecteur de profil de production.

La livraison doit être coordonnée entre SH et les API hospitalières. Le script historique `scripts/publier-lot1-sh-demo.py` ne transporte pas tous les nouveaux fichiers racine et changements d'API ; il ne constitue pas un paquet de publication suffisant pour cette candidate. Aucun déploiement n'a été lancé.

Les six lots ne sont pas terminés. Le [cahier retrouvé et son audit](AUDIT_SH_2026-10-29.md), la [matrice des exigences](MATRICE_EXIGENCES_SH_2026-10-29.csv) et la [suite précédente](SUITE_SH_2026-10-29.md) restent les références pour les écarts généraux. Restent notamment la recette PostgreSQL et navigateur complète, l'activation avec services/chambres/lits/civières/personnel/comptes/permissions/modules/tableaux de bord/OG, l'isolation réelle multi-établissements et multi-pays, les écarts du portail support, le parcours pilote distinct et la promotion des référentiels non couverts.

**Décision : Arrimo.SH n'est pas encore démontré prêt à activer un premier hôpital pilote.** Aucune donnée réelle, migration destructive ou publication n'a été réalisée pendant cette tranche.
