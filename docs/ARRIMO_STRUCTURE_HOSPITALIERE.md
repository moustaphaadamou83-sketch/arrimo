# Structure hospitalière Arrimo et SH

État de la candidate de travail après le commit parent `66311c7`. Travail réalisé sur la branche isolée `codex/arrimo-sh-lots3-7`; aucun site ni aucune base publique n’a été modifié.

## Fonctionnalités livrées dans cette branche

- Les utilisateurs autorisés d’un établissement voient sa hiérarchie depuis **Lits** : départements, services, unités, étages/ailes, chambres, lits et civières, états, attributs, équipements et confirmation disponible.
- La nouvelle API `GET /api/structure?etablissement_id=…` vérifie l’appartenance de l’utilisateur à l’établissement. Elle retourne les ressources de structure sans référence patient. Elle ne permet pas de lire la structure d’un établissement tiers.
- Dans **Administration → Unités et lits**, un administrateur avec MFA peut créer et modifier les ressources existantes. Les formulaires couvrent attributs JSON, équipements, capacité déclarée, capacité calculée, accessibilité, restrictions, étages/ailes, état opérationnel et rattachements.
- Les commandes de désactivation réutilisent les routes et contrôles du serveur. Elles refusent la désactivation d’une ressource encore occupée, réservée ou utilisée. Un lit peut être désactivé après son passage à l’état indisponible selon le workflow prévu. Les transitions opérationnelles restent dans les écrans de lits et civières.
- Aucune migration de données ou de schéma n’a été requise.
- SH dispose d’un éditeur manuel pré-Go Live en recette pour les départements, services, unités, étages/ailes, chambres, lits et civières. L’éditeur permet création, mise à jour et désactivation sécurisée, avec attributs JSON, restrictions de chambre, équipements, capacités, état et rattachements. Il s’appuie sur les routes de vérification/import existantes : aucune seconde écriture ni aucun nouveau référentiel.
- Les imports CSV/XLSX acceptent désormais `attributs_json`, `restrictions_json`, `actif` et l’état opérationnel des chambres. Les champs absents d’un ancien fichier préservent leurs valeurs existantes. Les mises à jour restent idempotentes; les désactivations qui laisseraient une ressource utilisée sont refusées. Les modèles et l’export Go Live transportent ces attributs.
- L’éditeur SH est masqué et l’API le refuse hors recette ou après Go Live. Arrimo reste la source de vérité opérationnelle après activation. L’API de lecture détaillée SH ne retourne que la structure autorisée, jamais des références patient.

## Rôles et séparation SH / Arrimo

- **Avant le Go Live**, SH prépare la structure administrative et hospitalière dans le dossier d’implantation. La voie déjà disponible est l’import CSV/XLSX prévisualisé, validé, transactionnel et journalisé. Elle crée ou met à jour les lignes; elle ne supprime pas de ressources.
- **Au Go Live**, SH transfère la structure validée vers l’environnement Arrimo choisi.
- **Après activation**, Arrimo est la référence opérationnelle pour les états des lits/civières, confirmations, équipements et modifications de structure. SH conserve le suivi d’implantation et l’historique des imports. Il n’y a pas de synchronisation bidirectionnelle automatique.
- `admin_etab` avec MFA peut administrer sa structure; `gestionnaire` peut l’administrer à l’échelle de son réseau. Les rôles de coordination ont la vue de structure en lecture et gardent les actions opérationnelles permises par leurs droits. Le rôle entretien reste limité à son interface autorisée.
- Les comptes publics A/B/C ne sont pas modifiés. Les coordonnateurs restent en lecture pour la structure. Le test jetable crée des comptes `admin_etab` distincts A/B/C avec MFA et mots de passe aléatoires en mémoire; le gestionnaire réseau et les coordonnateurs ne sont ni promus ni modifiés.

## Limites restantes à connaître

- Le formulaire SH permet une ressource à la fois; les fichiers CSV/XLSX restent le moyen prévu pour des lots volumineux. La prévisualisation et la validation transactionnelle sont communes aux deux parcours.
- L’import ne supprime aucune ressource. Une désactivation est une mise à jour explicite `actif=non` et respecte les mêmes garde-fous d’usage que l’interface Arrimo.
- Les modèles d’import actuels ne transportent pas tout l’historique des équipements/changements. Les valeurs opérationnelles détaillées et leurs états restent gérés dans Arrimo.
- Les nouveaux libellés de la vue hiérarchique sont français seulement dans ce lot, conformément au périmètre demandé. La vue hiérarchique n’est donc pas affichée quand l’interface est en anglais; aucune traduction ni fonctionnalité Firebase n’a été développée.
- Les comptes de coordination A/B/C n’ont pas été modifiés. Le test isolé crée des comptes administrateurs fictifs A/B/C, chacun limité à son établissement et avec MFA; ils n’existent pas dans la démo publique.

## Vérifications

Sur PostgreSQL local isolé `127.0.0.1:55432`, avec des données fictives :

- `npm test` : **71/71** tests API, courriel et routage réussis.
- `npm run test:interface` : **9/9** tests navigateur réussis après corrections, dont SH/Go Live sur ordinateur, tablette et téléphone.
- `npm run test:structure-ui` : **1/1** test navigateur dédié réussi. Il crée des administrateurs fictifs A/B/C avec MFA uniquement dans la base jetable, réalise le CRUD de département/service/unité/étage/chambre/lits, vérifie le refus d’accès A→B, puis contrôle la visibilité isolée des comptes coordonnateurs A/B/C.
- Les assertions API vérifient l’isolation entre établissements, les capacités calculées, les relations, les attributs, les modifications et l’absence de références patient dans la nouvelle vue.
- Les tests existants CSV et XLSX restent inclus dans les 71 tests et la recette SH de navigateur.
- `git diff --check` et `node --check` sur les fichiers JavaScript modifiés : réussis.

Captures générées par Playwright à partir de la véritable application locale de démonstration :

- [Administration de la structure et ressources fictives](/private/tmp/arrimo-sh-phase1/docs/captures-structure/arrimo-structure-admin.png)
- [Dashboard Hôpital A](/private/tmp/arrimo-sh-phase1/docs/captures-structure/dashboard-hopital-a.png)
- [Dashboard Hôpital B](/private/tmp/arrimo-sh-phase1/docs/captures-structure/dashboard-hopital-b.png)
- [Dashboard Hôpital C](/private/tmp/arrimo-sh-phase1/docs/captures-structure/dashboard-hopital-c.png)

## Plan de mise à jour publique — non exécuté

1. Traiter séparément SH et la démo A/B/C; garder leurs bases et configurations distinctes.
2. Pour chaque environnement, identifier la release active, prendre une sauvegarde horodatée et vérifier une restauration isolée.
3. Vérifier le commit/artefact, les permissions de service et la procédure de rollback applicatif. Cette livraison n’ajoute aucune migration.
4. Publier une release immuable et basculer atomiquement après préflight; garder la base et ses écritures intactes.
5. Vérifier d’abord la démo avec les comptes de coordination existants en lecture seule. Les administrateurs A/B/C testés sont des fixtures jetables et ne sont pas créés publiquement sans autorisation et procédure d’accès distincte.
6. Vérifier HTTPS, l’isolation A/B/C, les imports et l’écran SH. En cas d’échec, revenir à l’ancienne release applicative seulement.

Aucune mise à jour publique n’est autorisée par le présent travail.
