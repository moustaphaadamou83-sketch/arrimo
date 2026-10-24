# Arrimo.SH — référence avant phase 1

Date : 2026-10-23. Candidate de départ : `f6db0e021698424d4618f851b4cc31ef17ccad59`.

## Environnement isolé

- Branche : `codex/arrimo-sh-phase1-security`.
- Worktree : `/private/tmp/arrimo-sh-phase1`.
- PostgreSQL jetable : `/private/tmp/arrimo-sh-phase1-pg/data`, port `55432`, base `postgres` uniquement pour les tests.
- Dépendances installées hors ligne depuis le verrou du candidat; `npm ci` a rapporté 0 vulnérabilité.
- Aucune connexion aux bases ou services publics pendant les tests.

## Résultats avant changement

- `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm test` : 69 réussis, 0 échec (API, courriel, routage).
- `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npm run test:interface` : 9 réussis, 0 échec (ordinateur, tablette, téléphone; incluant SH).
- Le test interface a émis une erreur transitoire `relation sessions does not exist` pendant une remise à zéro fictive; le parcours concerné et la suite complète ont réussi. À vérifier si elle réapparaît après phase 1.

## Provenance et intégrité

Les empreintes SHA-256 du serveur actif et du candidat correspondent pour `src/sh/app.js`, `src/sh/etapes.js`, `src/sh/cibles.js`, `src/sh/rapport.js` et `db/sh-schema.sql`. Le dossier actif public n’a pas de métadonnées Git; ces empreintes établissent la correspondance de ces fichiers, pas celle de chaque fichier de la release.

Ce document constitue le point de comparaison. Les résultats postérieurs seront ajoutés après les changements et les tests finaux.
