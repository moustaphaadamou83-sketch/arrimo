# Arrimo Préhospitalier — Livrable de la phase 1 (socle)

**Date :** 12 novembre 2026 · **Branche :** `prehospitalier-20261112` (locale, non commitée, non déployée)
**Références :** `docs/cahiers-prehospitalier-20261112/`, `docs/AUDIT_PREHOSPITALIER_2026-11-12.md` (décisions de la section 14).

## 1. Ce qui a été construit

**Phase 0 bis — tests existants**
- `tests/profils-pays.test.cjs` : la base simulée attendait l'ancienne requête des profils ; le test reconnaît désormais toute lecture de `config_pays` (le code de `src/admin.js` n'est pas modifié).
- `tests/api.test.js` (C4) : une instance « production » de test restait ouverte quand le test échouait avant son bloc principal, ce qui bloquait `npm test` indéfiniment ; elle est maintenant fermée dans tous les cas.

**Phase 1 — socle préhospitalier (serveur)**
- **Organisations de secours** à part des établissements (entreprise ambulancière, CCS), sans lits ni places ; unités (numéro, plaque) ; rattachement des comptes.
- **Trois rôles** : `paramedic`, `superviseur_secours`, `repartiteur`. Accès limité aux routes `/api/secours/*` et `/api/moi` (refus `role_secours` partout ailleurs : lits, patients, résidents, réseau). Les administrateurs d'hôpital ne peuvent pas créer ces rôles.
- **Préalertes** (`src/prealertes.js`) : numéro temporaire `PA-000000`, priorité déclarée (immédiate, urgente, non urgente), catégorie en liste fermée, équipage, heure prévue, aucune identité ni texte libre.
- **Étapes horodatées** : envoyée → reçue (confirmation technique, à la première lecture par l'écran de l'hôpital) → consultée (fiche ouverte) → prise en compte (confirmation humaine explicite) → préparation → préparation terminée → arrivée → clôturée ; et annulée, remplacée.
- **Bon véhicule** : l'ambulance signale son arrivée ; l'hôpital confirme l'unité réellement arrivée. Une autre unité est enregistrée (`vehicule_different`) et **ne ferme pas** la préalerte. La remise exige l'arrivée du bon véhicule.
- **Changement de destination** : l'ancienne préalerte est conservée (`remplacee`), l'ancien hôpital est notifié, une nouvelle préalerte est transmise au nouvel hôpital.
- **Fiabilité** : renvoi après coupure sans doublon (clé d'envoi), une seule préalerte ouverte par unité, numéro de version contre les modifications simultanées, historique `prealerte_evenements` immuable (déclencheurs PostgreSQL), journal de l'hôpital.
- **Positions** : facultatives, transmises par l'équipe, affichées sur les préalertes ouvertes seulement, conservées 24 h (purge horaire dans `src/server.js`).
- **Isolation** : ambulance = son organisation ; hôpital = préalertes qui lui sont destinées ; CCS = sa région, lecture seule.
- **Module hospitalier « Liaison Secours »** (`liaison_secours`, optionnel) : désactivé partout tant qu'un hôpital ne l'a pas choisi.
- **Notifications** (réutilise `notifier`) : préalerte reçue, mise à jour, arrivée signalée, annulée, destination modifiée — en français et en anglais.
- **OG** (`src/og-secours.js`, branché dans `src/copilote.js`) : ambulances annoncées, préalertes à prendre en compte, état d'une préalerte `PA-…`, d'après les étapes enregistrées seulement ; refuse de choisir une destination, un service ou une priorité clinique. Sans le module, la question est laissée aux autres réponses d'OG ; les questions de transfert (TR-…) ne sont pas captées.

## 2. Fichiers modifiés ou ajoutés

| Fichier | Changement |
|---|---|
| `db/schema.sql` | 3 rôles ajoutés aux 3 contraintes de rôles ; tables `organisations_secours`, `utilisateur_organisations`, `unites_secours`, `positions_unites`, `prealertes`, `prealerte_evenements` (immuable), séquence `prealerte_seq` |
| `db/vider.js` | suppression de `prealerte_seq` à la remise à zéro |
| `src/prealertes.js` | nouveau : moteur des préalertes |
| `src/og-secours.js` | nouveau : OG pour la Liaison Secours |
| `src/app.js` | restriction des rôles de secours ; routes `/api/secours/*` ; organisations dans `/api/moi` |
| `src/copilote.js` | branchement d'OG Liaison Secours avant la Liaison CHSLD |
| `src/server.js` | purge horaire des positions |
| `src/types-etablissement.js` | module optionnel `liaison_secours` |
| `src/erreurs.js`, `public/i18n/en.js` | 8 codes d'erreur (FR, EN) |
| `src/langue.js` | 5 notifications (FR, EN) |
| `public/i18n/fr.js`, `public/i18n/en.js` | libellés des 3 rôles |
| `tests/prealertes.test.cjs` | nouveau : 3 tests (parcours complet, fiabilité et isolation, OG) |
| `tests/profils-pays.test.cjs`, `tests/api.test.js` | corrections de la phase 0 bis |
| `package.json` | `tests/prealertes.test.cjs` ajouté à `npm test` |

## 3. Migrations

`db/schema.sql` reste rejouable : tout est en `CREATE TABLE IF NOT EXISTS` / `ADD CONSTRAINT` idempotents ; aucune donnée existante n'est modifiée. Les contraintes de rôles sont élargies (jamais restreintes).
**Non fait (phase 7)** : migration SH 45 pour ajouter `liaison_secours` au catalogue d'un SH existant (sur une base neuve, le catalogue l'inclut déjà).

## 4. API ajoutées

| Méthode | Route | Rôles |
|---|---|---|
| GET | `/api/secours/prealertes` (`?etablissement_id=` pour l'hôpital) | ambulance, hôpital, CCS |
| POST | `/api/secours/prealertes` | paramédic, superviseur |
| GET | `/api/secours/prealertes/:id` | ambulance, hôpital, CCS |
| POST | `/api/secours/prealertes/:id/action` | ambulance : `mettre_a_jour`, `signaler_arrivee`, `annuler`, `changer_destination` ; hôpital : `prendre_en_compte`, `preparation`, `preparation_terminee`, `confirmer_vehicule`, `confirmer_remise`, `signaler_probleme` |
| GET | `/api/secours/unites` | paramédic, superviseur |
| POST | `/api/secours/unites/:id/position` | paramédic, superviseur |

## 5. Tests exécutés et résultats

| Suite | Résultat |
|---|---|
| `npm run test:local` (sans PostgreSQL) | **238 réussis, 0 échec** (3 échecs avant la phase 0 bis) |
| `npm test` (10 fichiers, base neuve) | **212 réussis, 2 échecs**, terminé en 1 min 50 (bloqué indéfiniment avant la phase 0 bis) |
| `tests/prealertes.test.cjs` seul | **3 réussis, 0 échec** |

Les 2 échecs (console SH, C4) viennent de l'environnement : rôle PostgreSQL restreint `root_scope` absent sur ce serveur ; à exécuter sur la recette officielle (décision 6). Non exécutés : tests d'interface (Chromium), suites SH, recette officielle.

## 6. Reste à faire

- Phase 2 : écran Arrimo Ambulance (PWA, hors ligne, superviseur) ; ouvrir `Permissions-Policy` à `geolocation=(self)` pour cet écran seulement.
- Phase 3 : écran hospitalier Liaison Secours (carte et liste, accusés, bon véhicule).
- Comptes de démonstration (ambulances et CCS) dans `db/demo-reseau.js` ; création des organisations et des comptes depuis SH (phase 7).
- Proposition de service par OG (phase 4), disponibilités (phase 5), CCS (phase 6), Arrimo Connect (phase 7).

## 7. Risques

- Les comptes de secours n'ont aucun écran pour l'instant : une connexion affiche l'interface actuelle vide (aucun établissement). À traiter en phase 2 avant toute démo.
- La première lecture par l'écran de l'hôpital vaut confirmation technique : OG interrogé par l'hôpital la déclenche aussi (c'est bien l'interface de l'hôpital).
- Catégories d'intervention : liste fermée provisoire, à valider avec un partenaire.

## 8. Instructions pour tester

```
createdb arrimo_test_pa
TEST_DATABASE_URL='postgresql:///arrimo_test_pa?host=/var/run/postgresql' node --test tests/prealertes.test.cjs
npm run test:local
TEST_DATABASE_URL='postgresql:///arrimo_test_pa?host=/var/run/postgresql' npm test
```
