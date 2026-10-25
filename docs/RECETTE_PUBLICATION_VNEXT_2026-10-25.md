# Recette, publication conditionnelle et démonstration VNext

Cette procédure n'a pas été exécutée sur les environnements publics. Elle ne constitue pas une autorisation de passer un contrôle échoué. L'autorisation de publication utilisateur existe ; les prérequis techniques restent obligatoires.

## Environnement nécessaire

Exécuter depuis un runtime autorisé, avec Node 24, PostgreSQL et Playwright installés. Il doit permettre sockets PostgreSQL, TCP/HTTPS et IPC Chromium. Ne pas modifier les protections du serveur pour adapter le serveur au sandbox actuel.

Les secrets restent dans la configuration protégée. Identifier les bases depuis les `EnvironmentFile` des unités recensées, sans les afficher. Les URL ci-dessous sont des variables à fournir ; elles ne désignent aucune base déjà créée.

## Séquence de validation

1. Identifier version chargée, base, rôle applicatif et périmètre de chaque environnement. Vérifier que la cible de restauration est une base nouvelle dédiée.
2. Produire une sauvegarde fraîche et en vérifier la lisibilité, l'empreinte et la restauration **effective** dans une nouvelle base locale `arrimo_vnext_restore_<suffixe>`. Ne jamais restaurer par-dessus une base existante.
3. Sur cette copie restaurée seulement, avec le rôle applicatif approprié :

   ```sh
   node scripts/verifier-migration-priorites.cjs
   ```

   La variable `PRIORITES_RESTORE_DATABASE_URL` doit désigner cette copie. Le script doit réussir deux migrations sans changement des données préexistantes. Vérifier également les propriétaires des nouvelles tables. Son résultat ne prouve pas à lui seul l'origine de la copie : conserver le journal de restauration et l'empreinte du dump.

4. Sur une autre base locale **neuve**, `arrimo_vnext_test_<suffixe>`, fournir `PRIORITES_TEST_DATABASE_URL`, puis :

   ```sh
   npm run test:priorites-postgres
   ```

   Cette recette prépare ses données fictives, ne réinitialise pas la base et conserve ses traces. Une suite ignorée n'est pas une réussite. Elle vérifie migration répétée, validations concurrentes, droits, modification du référentiel, compatibilité pédiatrique, réservation concurrente, admission depuis Lits et connecteur simultané.

5. Rejouer les suites existantes avec leurs bases **d'essai dédiées**, jamais les URL publiques : `npm test`, `test:scenarios-abc`, `test:demo-trio`, `test:interface`, `test:structure-ui`, `test:sh-erp`, `test:sh-erp-interface`. Vérifier les garde-fous et le périmètre de chaque suite avant de lui fournir une URL. Certaines suites historiques réinitialisent leur base d'essai : ne leur fournir aucune copie à conserver ni base publique.
6. Sur une base locale **neuve**, `arrimo_vnext_ui_test_<suffixe>`, fournir `PRIORITES_UI_DATABASE_URL`, puis :

   ```sh
   npm run test:priorites-interface
   ```

   Cette recette vérifie une validation professionnelle dans Admissions sur ordinateur, tablette et mobile, puis contrôle son auteur/version en base et produit de vraies captures. Elle ne remplace pas la recette des quatre dashboards, ni celle de SH.
7. Vérifier manuellement A, B, C et Réseau sur la copie : périmètres, absence d'identités dans les vues réseau non autorisées, parcours du cahier A à K et questions composées OG. Vérifier la configuration SH, ses rôles, ses modules ERP et le refus des synchronisations de données opérationnelles.
8. Répéter le rollback applicatif sur la copie. Revenir au code antérieur sans effacer les nouvelles colonnes/tables et sans restaurer aveuglément la base.

## Publication lorsque tous les contrôles réussissent

- Le candidat préparé porte volontairement `publication_admissible: false`. Ne pas l'activer avant d'avoir archivé les résultats réels manquants et établi une nouvelle décision de publication.
- Préserver les versions et pointeurs précédents. Appliquer la migration additive avec le rôle applicatif, dans une transaction, seulement après sauvegarde restaurable et répétition réussie. Aucun reset ou reseed de A/B/C.
- Publier d'abord sur l'environnement isolé, puis sur `arrimo-public-demo.service` (`/opt/arrimo-demo`). Vérifier HTTPS, connexion, rôles et les quatre dashboards avant de poursuivre.
- Principal : `arrimo.service`, racine de releases `/opt/arrimo`, configuration sous `/opt/arrimo/shared`. SH : `arrimo-sh.service`, racine `/opt/arrimo-sh`. SH ne nécessite pas de migration de sa base pour cette fenêtre ; ses nouvelles routes nécessitent la version compatible de l'API Arrimo ciblée.
- Reprendre les vérifications du cahier après chaque bascule : Admissions, Lits, Urgences, Nettoyage, Congés, NSA, Réseau/National, Transferts, OG, âges, priorités, données et journaux. Aucun test modificatif sur des données réelles.
- Ne pas modifier les applications hors Arrimo, les comptes publics ou les scénarios A/B/C pour simplifier la recette.

## Rollback

`deploy/releases.sh` existant gère les liens atomiques et le retour applicatif avec contrôle de santé, sans toucher PostgreSQL. Les pointeurs `previous` recensés sont :

| Racine | Version précédente recensée | Service |
|---|---|---|
| `/opt/arrimo-demo` | `arrimo-audit-9a67e96…` | `arrimo-public-demo` |
| `/opt/arrimo` | `arrimo-audit-9a67e96…` | `arrimo` |
| `/opt/arrimo-sh` | `arrimo-erp-25dd22d…` | `arrimo-sh` |

Revérifier ces pointeurs juste avant une publication ; ils peuvent changer. Utiliser le script de la release préparée avec les racine/service/URL santé effectivement constatés. Le candidat n'a subi aucune bascule ; aucun rollback de ce lot n'a été exécuté ni requis. La compatibilité du code antérieur avec le schéma enrichi doit être vérifiée sur copie avant une bascule publique. Aucune suppression des colonnes de validation ne fait partie du rollback.

## Guide Sainte-Justine, après recette et publication validées

1. Afficher l'environnement et l'établissement. Rappeler données fictives, référentiel de démonstration, décision professionnelle et absence d'intégration réelle.
2. Depuis Admissions, un administrateur vérifie explicitement l'habilitation du professionnel fictif. Un administrateur également habilité approuve le référentiel fictif et son motif. Ne pas assimiler cette démonstration à une échelle officielle de triage.
3. Créer manuellement trois demandes fictives. Vérifier qu'elles restent « À valider » tant qu'aucune validation professionnelle n'est enregistrée. Ne pas réinitialiser les scénarios préparés par l'utilisateur.
4. Le professionnel valide trois catégories différentes. Montrer classement, auteur, date, version et règle d'ancienneté à rang égal. Demander à OG : « Quelles demandes ont la priorité la plus élevée ? » puis « Pourquoi ce classement des demandes ? ».
5. Arrivée fictive aux urgences, demande pédiatrique, proposition de lit compatible et exclusion du lit adulte. Confirmer l'attribution puis admettre depuis Lits. Vérifier demande clôturée, lit occupé, civière au nettoyage et compteurs.
6. Montrer congé prévu puis confirmé ; constater que seule la sortie réelle libère vers nettoyage. Vérifier NSA, blocages et explications OG.
7. Réaliser A→B ; présenter un refus puis une alternative C avec conservation du groupe d'âge, des équipements et de la référence pseudonymisée. Réceptionner et contrôler les deux établissements.
8. Montrer le connecteur **simulé** avec un événement rejoué sans double application, après recette PostgreSQL réussie. Ne pas prétendre qu'un système hospitalier réel est connecté.
9. Ouvrir SH : modules opérationnels, vocation, catalogue, référentiel approuvé en lecture. Constater la conservation des modules ERP et des opérations hospitalières.
10. Contrôler A/B/C/Réseau dans le navigateur public, capturer les écrans autorisés sans mot de passe visible et consigner les limites restantes.

Ce guide décrit le parcours à valider ; il ne certifie pas qu'il fonctionne déjà sur la démo publique. Aucun usage clinique réel n'est validé.
