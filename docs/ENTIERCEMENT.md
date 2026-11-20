# Dossier d'entiercement Arrimo

Ce dossier permet à une équipe technique indépendante de réinstaller et d'exploiter Arrimo à partir du dépôt seul, si l'éditeur ne pouvait plus le faire (garantie de continuité, cahier v2, C.11).
Le contrat d'entiercement lui-même doit être rédigé par un avocat. Ce dossier ne contient aucun secret : seulement des **noms** de variables.

## 1. Prérequis

- Linux (Ubuntu 24.04 testé), Node.js 24 (`/opt/arrimo-runtime`), PostgreSQL 16, Nginx (TLS), systemd.
- Un nom de domaine (réglage unique : `ARRIMO_DOMAINE`).

## 2. Variables d'environnement (noms seulement)

Fichier `.env` de chaque environnement (droits 600, jamais dans le dépôt) :

| Domaine | Variables |
|---|---|
| Base et service | `DATABASE_URL`, `HOST`, `PORT`, `ARRIMO_ENV` (demo, recette, pilote, production), `ARRIMO_DOMAINE`, `ARRIMO_URL`, `PG_POOL_MAX`, `PG_POOL_ATTENTE_MS`, `SESSION_HEURES` |
| Sécurité | `ARRIMO_MFA_ENCRYPTION_KEY`, `ARRIMO_2FA_ADMIN`, `API_LIMITE_SESSION`, `API_LIMITE_ANONYME`, `API_JETONS_PAR_IP`, `API_LIMITE_SH`, `PROCHES_LIMITE_IP` |
| Console SH | `SH_DATABASE_URL`, `SH_API_KEY`, `SH_MFA_ENCRYPTION_KEY`, `SH_PUBLIC_URL`, `SH_INITIAL_ADMIN_EMAIL`, `SH_DOCUMENTS_DIR`, `SH_PRODUCTIONS`, `SH_SESSION_HEURES`, `SH_FUSEAU` |
| Courriel | `SMTP_URL`, `COURRIEL_EXPEDITEUR`, `SH_COURRIEL_CONTACT`, `SH_COURRIEL_NOREPLY` |
| Itinéraires (OSRM) | `ARRIMO_ROUTEUR_URL`, `ARRIMO_ROUTEUR_NOM`, `ARRIMO_ROUTEUR_PROFIL`, `ARRIMO_ROUTEUR_CLE`, `ARRIMO_ROUTAGE_TIMEOUT_MS` |
| Notifications push | `ARRIMO_VAPID_PUBLIQUE`, `ARRIMO_VAPID_PRIVEE`, `ARRIMO_VAPID_SUJET`, `ARRIMO_PUSH_HOTES` |
| Démonstration | `ARRIMO_DEMO`, `DEMO_MOT_DE_PASSE`, `ARRIMO_PATIENTS_FICTIFS`, `ARRIMO_METEO`, `ARRIMO_METEO_LIEU`, `SIMULATION_MINUTES` |
| OG (facultatif) | `COPILOTE_IA_URL`, `COPILOTE_IA_MODELE`, `COPILOTE_IA_CLE` |

## 3. Installation pas à pas

1. Créer les bases PostgreSQL (une par environnement, plus `arrimo_sh` pour la console SH) et leurs comptes propriétaires.
2. Copier le dépôt (archive signée, voir § 8), puis `npm ci`.
3. `bash deploy/installer.sh <domaine>` (variables `ARRIMO_ENV=recette`, `ARRIMO_ENV=sh` selon l'environnement). Production : `CONFIRMER_HEBERGEMENT_CANADA=oui` (ou `PAYS_HEBERGEMENT=XX CONFIRMER_HEBERGEMENT=oui CONFIRMER_CADRE_LEGAL=oui`, voir `deploy/hebergement.sh`).
4. Premier compte d'un environnement vide : `node db/premier-compte.js` ; console SH : `node db/sh-premier-compte.js`.
5. Vérifier : `curl -s https://<domaine>/api/sante` (état « ok », base « ok »).

Environnements : `src/environnement.js` ; noms par environnement : `deploy/noms.sh`.

## 4. Base de données

- Schéma complet et rejouable : `db/schema.sql` (aucune donnée effacée en le rejouant).
- Migrations additives datées : `db/migrations/*.sql` (chacune identique à la fin de `db/schema.sql`).
- Journaux immuables (déclencheurs PostgreSQL) : `journal`, `journal_admin`, historiques d'étapes, `horodatages` (Horloge), `fermeture_avis`. Ne jamais les contourner.
- Sauvegarde : `deploy/sauvegarde.sh` (chaque nuit), `deploy/sauvegarde-complete.sh` ; restauration : `deploy/restaurer.sh <fichier.dump>`.

## 5. Console SH

- Serveur : `src/sh/server.js` ; migrations appliquées au démarrage (`src/sh/migrations.js`, versions numérotées dans `sh_migrations`).
- Clé de service vers chaque environnement : `SH_API_KEY` (même valeur des deux côtés).
- Export complet d'un client : fiche établissement > « Exporter toutes les données » (archive ZIP : CSV par table, JSON, dictionnaire `LISEZMOI`).

## 6. Tests

- `npm test` (API, règles, modules ; base de test dédiée `TEST_DATABASE_URL`).
- `npm run test:interface` et les fichiers `tests/*.interface.spec.cjs` (Chromium).
- Tests SH : `tests/sh-*.test.cjs` (base `arrimo_sh_lot1_test_*`).

## 7. Carte de l'architecture

| Fichier | Responsabilité |
|---|---|
| `src/server.js`, `src/app.js` | démarrage, tâches périodiques, routes de l'API |
| `src/regles.js` | **seul endroit** qui change l'état d'un lit ou d'une civière (verrou, version, journal) |
| `src/services.js`, `src/terrain.js` | capacité, recommandation, transferts, NSA, congés, indicateurs |
| `src/horloge.js` | heures horodatées immuables (source, auteur, corrections) |
| `src/demandes.js`, `src/motifs.js` | lecture commune des demandes, motifs fermés |
| `src/chrono.js` | temps des ambulances à l'urgence (H11 à H15) |
| `src/urgences-direct.js` | fermetures d'urgence, page publique (démonstration) |
| `src/transferts-suivi.js`, `src/transports.js` | fiche de transfert, centrale, rapatriements ; transports |
| `src/bourse.js`, `src/donnees.js`, `src/crise.js` | bourse des places, données régionales, mode crise |
| `src/chsld.js`, `src/liaison-chsld.js`, `src/nsa-*.js` | hébergement, liaison CHSLD, parcours NSA |
| `src/prealertes.js`, `src/vehicules.js`, `src/connect.js` | préhospitalier, Arrimo Connect |
| `src/copilote.js`, `src/og-*.js` | OG (propose, n'agit jamais) |
| `src/export-client.js`, `src/zip.js` | export complet d'un client |
| `src/sh/` | console SH (clients, modules, implantation, facturation) |
| `public/`, `public-sh/` | interfaces (sans framework), dictionnaires `public/i18n/` |

## 8. Remise du dépôt

1. `git archive --format=tar.gz -o arrimo-<date>.tar.gz <commit>` ;
2. empreinte : `sha256sum arrimo-<date>.tar.gz > arrimo-<date>.tar.gz.sha256` ;
3. signature de l'archive par l'éditeur (GPG) ; dépôt chez l'agent d'entiercement ;
4. vérification par l'agent : `node scripts/verifier-entiercement.cjs` sur l'archive décompressée.
