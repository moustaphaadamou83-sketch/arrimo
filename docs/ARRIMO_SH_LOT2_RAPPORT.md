# Arrimo.SH — Lot 2 : établissements, modules et activation

**Branche :** `codex/arrimo-sh-lot2`  
**Base de travail :** commit `ce602f249de563e533727e7d3df16db125099277`  
**Périmètre :** environnement local isolé et base jetable; aucun site ni base publique modifié.

## Changements livrés

- Migration SH additive v3 : identité légale, identifiant administratif, pays, région, fuseau horaire et quotas prévus/autorisés; les anciens champs et relations restent conservés.
- Fiches de sites et de contacts, avec contrôle que les contacts restent rattachés à des sites du même hôpital. Réenregistrer le dossier met à jour les enregistrements correspondants et ne crée pas de doublons.
- Comptes prévus, autorisés, invités et activés, avec ventilation par rôle quand l’environnement répond. Un import d’utilisateurs est prévalidé contre le quota configuré; `0` signifie quota non configuré.
- Catalogue SH de six modules avec licences, dépendances et paramètres JSON. Les licences commerciales restent des métadonnées SH; elles ne prétendent pas activer chaque fonction dans Arrimo, qui n’expose actuellement qu’un état d’activation global du tenant.
- Assistant d’interface en six étapes. Les sept étapes et leurs vérifications actuelles restent stockées et utilisées pour les contrôles Go Live.
- Reprise Go Live : une même empreinte ne peut pas être lancée simultanément; un import rejoué met à jour sa ligne d’historique existante. Les imports déjà terminés restent idempotents après une panne intermédiaire.
- L’utilitaire de nettoyage de test supprime maintenant aussi les nouvelles tables SH dépendantes; il ne s’exécute que dans les fixtures de test.

## Démonstration D et panne simulée

Le test C4 utilise un établissement fictif Hôpital D, une API de recette locale et une seconde instance Arrimo isolée par schéma PostgreSQL. Il vérifie le profil, un site, un contact, les dépendances de modules, les quotas, l’import des unités/chambres/lits/civières/utilisateurs, la formation, l’activation en recette et les compteurs exposés par le dashboard de recette.

Une panne HTTP 503 est injectée pendant l’import des lits lors du Go Live de test. L’opération passe à `interrompu`; le tenant, deux unités et trois chambres déjà importés persistent, sans lit partiel. La reprise termine le workflow, crée les cinq lits et ne duplique ni les unités/chambres ni les lignes d’historique. Les comptes invités et les données fictives restent séparés de l’application de recette.

## Validation

- `npm test` : **70/70** réussis (API, courriel et routage).
- `npm run test:interface` : **9/9** réussis; ordinateur, tablette et téléphone, dont le parcours SH complet aux trois largeurs.
- Test ciblé du scénario D après panne/reprise : réussi.
- `node --check` sur le serveur SH, les migrations, la console web et le test API : réussi.
- La base `arrimo_test` est une base locale jetable sur PostgreSQL isolé; le schéma `prod_c4` des tests est un schéma séparé de cette base, pas la production.
- La suite interface a imprimé une erreur ponctuelle `relation "sessions" does not exist` pendant qu’un test remettait à zéro ses fixtures de démonstration. Les neuf tests se sont terminés avec succès. C’est un bruit de concurrence du harnais à réexaminer si les tests de reset deviennent parallèles; ce n’est pas un changement de production.

## Limites encore présentes

1. Les imports proposés restent CSV, y compris les CSV exportés depuis Excel. Le format de classeur `.xlsx` natif n’est pas pris en charge.
2. Arrimo ne possède pas d’entité « service » distincte de ses unités/types d’unité. Le lot réutilise l’import et les modèles existants; il n’ajoute pas un deuxième arbre de structure. Une hiérarchie Service → Unité exige un contrat/API Arrimo explicite.
3. Le catalogue et ses paramètres sont gérés dans SH. L’API Arrimo ne connaît pas encore les licences ou les activations modulaires individuelles; seul le module global du tenant est activable.
4. Le workflow existant de Go Live vise toujours la cible de production quand elle est configurée. Ici, le test de cette cible pointe exclusivement vers un serveur local sur schéma PostgreSQL séparé. Aucun déploiement public ni connexion réelle SH→production n’a eu lieu.

**État du lot :** livré et testé localement; prêt pour revue du code. Pas de déploiement public.
