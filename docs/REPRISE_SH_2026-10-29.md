# Reprise SH — 29 octobre 2026

> Dernière étape : [notifications courriel du support](COURRIELS_SUPPORT_SH_2026-10-29.md), migration 23 et six services publiés ; 60 tests intégrés ciblés et un transport simulé réussis. Prochaine tranche : recherche de tickets par OG SH, puis colonne Kanban « Assigné »; prévoir la vérification de livraison SMTP sans envoyer de message hors destinataire autorisé.

> Dernière étape terminée : [portail support raccordé](RACCORDEMENT_SUPPORT_SH_2026-10-29.md). Migration 20, six services publiés, 41 établissements raccordés, accès publics A/B/C FR/EN vérifiés ; 152 tests intégrés et 221 locaux réussis. Les paragraphes antérieurs restent historiques.

> Dernière publication : [écosystème et parité du nouvel hôpital](PUBLICATION_ECOSYSTEME_PARITE_2026-10-29.md). Les six services existants sont à jour ; huit tests de parité réussis, connexions réelles et OG FR/EN vérifiés. Le raccordement opérationnel du portail support reste à configurer.

> Reprise en cours : [confidentialité des notifications, migration 19 et validation](CONFIDENTIALITE_NOTIFICATIONS_SH_2026-10-29.md). SH publiée après demande explicite : release `sh-v19-20261029t163913z`, migrations 10–19 et contrôles HTTPS réussis. Recette finale valide : 188 tests intégrés et 212 locaux ; applications hospitalières non publiées par cette livraison.

> Dernière tranche : [NOTIFICATIONS_PAGINATION_SH_2026-10-29.md](NOTIFICATIONS_PAGINATION_SH_2026-10-29.md), correction des notifications financières et pagination du portail ; migrations 17–18, recette isolée et limites documentées.

> Tranche ultérieure : [PORTAIL_SUPPORT_SH_2026-10-29.md](PORTAIL_SUPPORT_SH_2026-10-29.md), portail client, confidentialité des échanges et migrations 15–16. Voir ce document pour les résultats consolidés les plus récents.

> Travail autonome ultérieur : [NUIT_SH_2026-10-29.md](NUIT_SH_2026-10-29.md). Le blocage système a été levé par exécution autorisée sur un cluster temporaire distinct ; voir ce nouveau bilan pour le pilote fictif, les migrations 11 à 14 et les résultats réels. Le contenu ci-dessous reste historique.

> Dernière tranche : [PROFILS_PAYS_SH_2026-10-29.md](PROFILS_PAYS_SH_2026-10-29.md). Sélection explicite des profils hospitaliers par pays, 208 tests locaux réussis ; recette intégrée toujours bloquée par les restrictions système.

> Suite la plus récente : [SUITE_SH_2026-10-29.md](SUITE_SH_2026-10-29.md), avec la promotion des paramètres, le référentiel international, les montants par devise et les garde-fous des fixtures. Les preuves sont archivées séparément de celles de l'audit initial.

> Mise à jour : le cahier original du 28 octobre et le découpage en six lots ont maintenant été retrouvés. L'état détaillé, le diagnostic système, les corrections supplémentaires et les preuves actuelles sont dans [AUDIT_SH_2026-10-29.md](AUDIT_SH_2026-10-29.md). Le bilan ci-dessous est celui de la reprise initiale, conservé pour historique. Aucune publication automatique n'est autorisée par la mission actuelle.

L’utilisateur autorise la poursuite autonome des corrections et leur publication après validation. Cette autorisation ne lève pas les restrictions techniques de l’environnement.

## Corrections de cette reprise

- La création d’un rôle personnalisé conserve désormais `actif: false` au lieu de réactiver le rôle implicitement.
- Le champ `actif` refuse les chaînes à la place d’un booléen.
- Les permissions héritées du prototype JavaScript (`toString`, `__proto__`) sont refusées avec une erreur 400, comme les permissions hors rôle.
- Un périmètre pays vide ou mal formé est refusé avant insertion avec une erreur 400.
- Traduction anglaise des explications, confirmations et titre dynamique des écrans de rôles et de périmètres.
- Ajout de régressions locales et PostgreSQL. Les suites locales incluent maintenant les régressions des rôles et le bilinguisme.

## Vérifications effectuées

- Avant corrections : syntaxe des 55 fichiers JavaScript modifiés ou nouveaux vérifiée ; aucune erreur.
- Après corrections : `node scripts/test-vnext-local.cjs .local/reprise-20261029/tests-locaux.json` : 160 réussites, aucun échec, aucun test ignoré.
- `git diff --check` : réussi.
- Syntaxe des fichiers corrigés : vérifiée.
- Recette PostgreSQL tentée avec `scripts/recette-sh-lot1.cjs` : échec avant création de la base, `runuser: cannot set groups: Operation not permitted`. Aucune base publique modifiée par cette tentative.
- Les tests PostgreSQL ajoutés n’ont pas été exécutés. Le navigateur et les migrations ne sont pas validés par les tests locaux.

## Périmètre restant

Le cahier général `/root/CAHIER-DES-CHARGES.md` est ancien et décrit A/B/C. Le rapport `ARRIMO_SH_LOTS3-7_RAPPORT.md` décrit une première tranche du 23 octobre ; des fonctions qu’il annonçait manquantes existent maintenant dans `src/sh/erp.js` et sa suite de recette. Ces documents ne permettent pas d’attester la conformité complète au dernier cahier des lots 1 à 6. La localisation ou le contenu de ce dernier a été demandé à l’utilisateur.

Reprendre la recette accès, ERP et interface sur des bases fictives neuves dans l’environnement autorisé ; vérifier les migrations, droits, documents, facturation, projets, support et parcours navigateur ; corriger les écarts constatés ; seulement ensuite préparer la publication ciblée et sa vérification publique.

Le dépôt comporte de nombreux changements antérieurs conservés. Aucun commit global, migration, redémarrage ni déploiement n’a été effectué pendant cette reprise. Ne pas annoncer les six lots terminés ni cette candidate prête à publier.
