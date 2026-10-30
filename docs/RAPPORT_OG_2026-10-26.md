# OG — correctif préparé le 26 octobre 2026

## État réel

Correctif local préparé et testé. Aucun déploiement effectué. Aucune modification de Production, des bases, des dashboards ni des parcours opérationnels.

La session autorise l’écriture uniquement dans `/root` et `/tmp`. Les accès PostgreSQL et systemd sont refusés : `Operation not permitted` sur le socket PostgreSQL et le bus systemd. La lecture de la configuration du site principal est également refusée. Ces contrôles ne sont pas contournés. Les tests SQL, navigateur avec base et vérifications authentifiées sur les instances publiées restent à effectuer depuis un environnement autorisé.

## Causes et corrections

- Les références patient n’avaient pas d’intention dédiée et pouvaient retomber sur la file d’admissions en attente. Recherche maintenant par référence exacte dans les lits occupés/réservés, admissions actives, civières et transferts autorisés, sans retourner l’identité civile.
- « Combien de lits » privilégiait les lits libres, même avec « occupés ». Intention spécifique pour les occupations, filtrée par type d’unité.
- « Pourquoi MED-204B ? » déclenchait une recommandation interhospitalière. Explication locale des critères métier ; pour une proposition actuelle, rattachement à la demande associée. Lorsque les critères historiques ne sont pas disponibles, OG le signale au lieu de reconstruire une justification passée.
- Les questions sur les transferts en cours présentent les statuts `validee`, `transport`, `en_route`, sans les confondre avec `demande`, `recu` ou `refuse`.
- « Quatre heures » est reconnu ; « plus de » utilise un seuil strict. Les priorités affichées proviennent du circuit existant de validation, sans assimiler durée et gravité.
- Après transport organisé : départ confirmé par l’origine, puis réception confirmée par la destination, conformément au moteur existant.
- Le suffixe A/B/C des codes de lits n’est plus interprété comme une lettre d’hôpital. Un lit inconnu ne réutilise plus une intention mémorisée hors sujet.
- Les questions françaises passent par OG avant le chemin historique d’IA externe.

Les contrôles d’établissement existants restent appliqués. Citer un hôpital n’accorde aucun accès supplémentaire. Aucun élargissement des habilitations et aucune action sensible exécutée par OG.

## Priorités cliniques

Le référentiel, les habilitations, la validation et les champs associés existent déjà dans `src/priorites.js` et les modules d’admission. Ils sont conservés. Aucune migration nécessaire. OG présente leur état et maintient « Priorité clinique non validée » lorsque la validation n’est pas disponible. Il n’établit aucun diagnostic ni priorité clinique.

## Tests

Commande reproductible : `npm run test:local -- docs/preuves-og-20261026/tests-locaux.json`.

152 tests locaux réussis, zéro échec, zéro test ignoré : 17 nouveaux tests OG et 135 tests locaux existants. Le journal et le rapport JSON sont conservés dans `docs/preuves-og-20261026/`.

Les sept scénarios demandés sont couverts par les nouveaux tests avec services simulés et données fictives contrôlées. P-01004 y est explicitement admis à MED-204B dans Hôpital C ; cela ne constitue pas une confirmation de son état actuel dans la base Démo. Couverture supplémentaire : proposition actuelle et historique manquant, lit inconnu, frontière exacte des quatre heures, accès interhospitalier refusé, gestionnaire habilité, patient absent, priorité validée, horodatage des sources et routage avec IA configurée.

Les suites existantes couvrent notamment les règles de priorité, leurs contrats d’interface, la configuration opérationnelle, les connecteurs simulés et leur atomicité, le transport courriel et le routage. Les tests de non-régression SQL des admissions/transferts et les tests navigateur ne sont pas déclarés réussis.

## Instances et publication restante

Le correctif porte sur le moteur partagé, sans variantes par hôpital. La publication et les vérifications de Hôpital A, B, C, D et Arrimo principal restent à effectuer. Arrimo.SH utilise une console distincte ; les capacités OG hospitalières sont celles de l’environnement ciblé par SH. Aucune interface SH n’a été modifiée et son bon fonctionnement après publication n’a pas été vérifié.

Le lanceur historique `scripts/publication-arrimo.py` est épinglé à un ancien commit et à des preuves de recette antérieures. Il ne doit pas être utilisé tel quel pour prétendre publier ce nouveau correctif. Les noms de dossiers principal et SH ne prouvent pas à eux seuls que les environnements sont des démos : contrôler la configuration effective avant toute bascule et exclure impérativement Production.

## Retour arrière à conserver lors de la publication

Créer une nouvelle release immuable du correctif, sauvegarder et contrôler la restauration de chaque base Démo visée, puis exécuter la recette intégrée sur copie isolée. Consigner pour chaque cible l’ancien lien `current`, l’identifiant et l’empreinte du candidat et les résultats des tests. Après bascule, contrôler santé et sept scénarios authentifiés avec les permissions propres à chaque compte. Si la vérification échoue, réactiver l’ancienne release par la procédure existante et vérifier sa santé. Aucune migration ni écriture métier n’étant requise par ce correctif, son retour arrière est une bascule de code ; ne pas restaurer une base sur des données plus récentes sans nécessité ni contrôle.

Le patch inverse est possible dans une copie de travail avec `git apply -R` sur le patch fourni, après vérification préalable ; il ne remplace pas le retour arrière d’une release hébergée.

## Préparation SSH complémentaire

La procédure exécutable est décrite dans `docs/PUBLICATION_OG_SSH_2026-10-26.md`. Le lot autonome se trouve dans `/root/arrimo-og-publication-prete-20261026/`. Dix-sept tests supplémentaires vérifient les garde-fous du lanceur, sans accès à PostgreSQL ni à systemd. Une nouvelle suite PostgreSQL OG est préparée ; elle n’a pas été exécutée ici. Le seuil civière utilise désormais l’heure d’arrivée exacte plutôt que les heures arrondies du service. L’ancienne archive de livraison est conservée ; le nouveau lot contient cette dernière correction et les outils de publication.
