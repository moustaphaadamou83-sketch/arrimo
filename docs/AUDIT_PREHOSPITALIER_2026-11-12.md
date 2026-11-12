# Audit de phase 0 — Arrimo Préhospitalier et Liaison Établissements

**Date :** 12 novembre 2026 · **Nature :** audit seulement, aucune modification du code, de la base, des services ni du serveur.
**Sources :** `docs/cahiers-prehospitalier-20261112/` (1. consigne d'audit, 2. cahier de construction, 3. extension Liaison Établissements) et précisions de Moustafa du 12 nov. (modules Ambulance, CCS, Hôpital – Liaison Secours ; Québec : CHSLD, RPA, RI, RTF, pas d'EHPAD).

---

## 1. Architecture réelle

- **Serveur :** Node.js + Express (`src/`, environ 13 200 lignes), routes sous `/api/...` (pas de version). Démarrage `src/server.js`, routes `src/app.js`.
- **Interface :** JavaScript sans framework (`public/`), français et anglais (`public/i18n`). Carte Leaflet (`public/vendor/leaflet`, tuiles OpenStreetMap).
- **Base :** PostgreSQL, 72 tables dans `db/schema.sql` (rejouable, sans migrations versionnées côté Arrimo ; migrations versionnées côté SH, `src/sh/*-migrations.js`).
- **SH :** console séparée (`src/sh/`, base `arrimo_sh`) : clients, projets, finances, support, serveurs, profils de pays, catalogue des types et modules, supervision des environnements.
- **Services actifs sur le serveur de démonstration :** `arrimo` (démo), `arrimo-public-demo`, `arrimo-recette`, `arrimo-validation`, `arrimo-sh`, `arrimo-sh-validation` ; dossiers `/opt/arrimo*`, dont `arrimo-osrm-validation`. Santé vérifiée le 12 nov. : démo, recette et SH répondent `ok`.
- **Sécurité en place :** CSP stricte (`script-src 'self'`, `connect-src 'self'`), `X-Frame-Options DENY`, `no-store` sur l'API, limiteur par session et par adresse (`src/limites.js`), sessions à durée limitée, double authentification hors démo, secrets MFA chiffrés, journaux immuables.

## 2. Modules existants

| Domaine | Fichiers | Remarque |
|---|---|---|
| Lits, états, verrous | `src/regles.js` | seul endroit qui change un lit ou une civière |
| Urgence, civières | `src/civieres.js` | taux, > 24 h, > 48 h, niveaux d'alerte |
| Admission, NSA, congés, nettoyage | `src/terrain.js` | |
| Transferts interhospitaliers | `src/services.js` | étapes demande → validée → transport → en route → reçu ; proximité ; temps de route |
| Tableau national, carte | `src/national.js` | carte Leaflet des hôpitaux et de l'urgence |
| CHSLD (RPA, RI, RTF, maisons des aînés sous leur nom) | `src/chsld.js` | résidents, places, coordinations |
| Liaison CHSLD (hôpital) | `src/liaison-chsld.js` | arrivées, accueil, retours |
| Connecteurs HL7 ADT | `src/connecteurs.js` | A01, A02, A03, A16 en JSON ; clé par connecteur ; idempotence |
| Connecteurs simulés | `src/simulation-connecteurs.js` | dont `arrivee_urgence` |
| Itinéraire réel | `src/routage.js` | adaptateur OSRM (Table), sans repli inventé |
| Famille, proches | `src/famille.js`, `src/portail-proches.js` | seule PWA existante (manifeste, service worker, push) |

## 3. OG

- Moteur local par intentions (`src/og-outils.js`, `src/copilote.js`) et modules par domaine (`og-chsld.js`, `og-liaison.js`, `og-suivi.js`).
- Actions en deux temps (`src/og-actions.js`) : OG prépare, un humain confirme. Actions interdites déjà listées : `diagnostic`, `priorite_clinique`, `traitement`, `affectation_clinique_definitive`, `transfert_medical`…
- Mode IA facultatif sans référence patient (`sansPatients`).
- **À faire :** un module `og-prehospitalier` sur le même modèle (aucun deuxième assistant).

## 4. Notifications

- Table `notifications` (codes et variables traduits), `notifier()` dans `src/services.js`, `notifierCo` pour les coordinations.
- Autres canaux : notifications SH (`src/sh/automatisations.js`), push du portail des proches.
- Absents : son, accusé de lecture, règles par priorité, suivi des notifications non délivrées.

## 5. Utilisateurs, organisations, permissions

- 5 rôles fixés par contrainte : coordonnateur, gestionnaire, entretien, admin_etab, equipe_soins ; rattachement à un ou plusieurs établissements.
- Types d'établissement opérationnels : hôpital et CHSLD ; modules activés par type (`src/types-etablissement.js`).
- SH dispose d'un modèle plus fin (permissions par route, rôles personnalisés : `src/sh/permissions.js`), à prendre comme modèle.
- Absents : organisations non hospitalières (entreprise ambulancière, CCS), unités, équipages, rôles paramédic, superviseur, répartiteur.

## 6. Lits et disponibilités

- Fraîcheur déjà gérée : `disponibilite_confirmee_le`, statut `capacite_perimee`.
- Civières, niveaux d'alerte de l'urgence, capacité réseau et nationale.
- Places CHSLD déjà distinctes des lits d'hôpital (exigence 9.3 du cahier 2).
- Absents : statut déclaré de l'urgence (ouvert, capacité limitée, saturation, délestage), source et fiabilité par donnée.

## 7. API et intégrations

- HL7 ADT réel (JSON), simulateur de connecteurs, API SH des environnements (`src/sh-api.js`), import CSV.
- Absents : FHIR, Epic simulé, webhooks signés HMAC, file d'échec, API pour les systèmes de répartition des CCS.

## 8. Tests (état réel au 12 nov. 2026)

- 610 tests déclarés ; `npm test` lance 9 fichiers. CLAUDE.md annonce encore « 53 tests » (périmé).
- `npm run test:local` (sans PostgreSQL) : **235 réussis, 3 échecs**, tous dans `tests/profils-pays.test.cjs` (`config_introuvable`). Cause : la base simulée du test attend l'ancienne requête `SELECT id,code,nom FROM config_pays ORDER BY id`, alors que `src/admin.js:36` lit désormais aussi `pays_code` et exclut les configurations « -CHSLD » (commit 3c4b2ab). Test en retard sur le code ; non corrigé.
- `npm test` (base neuve et temporaire `arrimo_test_phase0_20261112`, supprimée après l'essai) :
  - `tests/api.test.js` : **71 réussis, 2 échecs** (console SH et C4 : rôle PostgreSQL restreint `root_scope` absent, préparé par la recette officielle). Ensuite, **le fichier ne se termine pas** : une ressource reste ouverte après le dernier test, la suite reste bloquée et les 8 autres fichiers ne démarrent jamais.
  - Les 8 autres fichiers lancés séparément : **138 réussis, 0 échec** (14 s).
- Non exécutés dans cet audit : tests d'interface (Chromium), suites SH (`test:sh-erp`, etc.), recette officielle complète.

## 9. Fonctions préhospitalières déjà présentes

Presque rien : libellé de transport « ambulance », vitesse d'ambulance pour le temps de route, événement simulé `arrivee_urgence`, adaptateur OSRM. Aucune intervention, préalerte, unité ou écran ambulancier.

---

## 10. Modules à construire

### 10.1 Socle commun
Organisations (entreprise ambulancière, CCS), unités (numéro, plaque), équipages, rôles (paramédic, superviseur, répartiteur, réception hospitalière), permissions par module ; tables `interventions`, `prealertes`, `prealerte_evenements` (15 statuts, confirmation technique et humaine distinctes, changement de destination sans suppression) ; table des positions (conservation limitée) ; mise à jour en direct ; notifications par priorité ; module `og-prehospitalier`.

### 10.2 Arrimo Ambulance (paramédics, superviseurs)
PWA embarquée : transports assignés, demandes des établissements, urgences proches, préalertes, départ et arrivée, position, file d'envoi hors ligne ; vue superviseur. Aucun accès aux dossiers des résidents (prouvé par test).

### 10.3 Arrimo CCS (répartiteurs)
Carte régionale (réutilise Leaflet et `national.js`), ambulances en route, préalertes, demandes des établissements, alertes de saturation. API vers leur système de répartition (clé par CCS, HMAC, idempotence, nouvelles tentatives). Arrimo ne commande jamais une ambulance.

### 10.4 Arrimo Hôpital – Liaison Secours
Module hospitalier dédié, activé depuis SH : carte et liste des ambulances en approche (entreprise, unité, plaque, équipage, heure prévue, position en direct, priorité, motif). Accusé de la préalerte ; confirmation à l'arrivée que c'est le bon véhicule. **L'arrivée d'un autre véhicule est enregistrée comme événement et ne ferme pas la préalerte.**

### 10.5 Préparation hospitalière et proposition de service par OG
Correspondances catégorie → service configurées par l'établissement ; OG propose, l'équipe confirme, modifie ou refuse ; états de préparation.

### 10.6 Disponibilités, Arrimo Connect, SH
Statut déclaré de l'urgence et fraîcheur par source ; simulateurs FHIR, Epic, HL7, webhooks HMAC ; administration et supervision dans SH (préalertes non délivrées, connecteurs, données périmées).

### 10.7 Arrimo Établissement (Liaison Établissements)
Déjà présent : hospitalisation, retour, transfert vers un hôpital ou un CHSLD, avec confirmations humaines horodatées. À créer : demande de transport (parcours distinct de la préalerte), préalerte depuis l'établissement, l'ambulance comme acteur, pont entre les moteurs `transferts` et `coordinations`, libellés RPA, RI, RTF partout (OG compris), nom « Liaison Établissements ».

---

## 11. Risques

**Techniques**
1. Régressions sur la contrainte des rôles, `notifications` et `etablissements`, tables utilisées partout.
2. Trois moteurs proches (transferts, coordinations, préalertes) : doublons si la frontière n'est pas fixée.
3. Schéma sans migrations versionnées côté Arrimo.
4. Temps réel : l'interface interroge le serveur toutes les 15 à 30 s ; la position en direct demande plus.
5. `Permissions-Policy: geolocation=()` bloque la géolocalisation ; à ouvrir à `self` pour le module Ambulance seulement.
6. Suite de tests : 3 échecs locaux (`profils-pays`) et blocage de `api.test.js` en fin de fichier, qui empêche `npm test` de finir : à corriger avant la phase 1.

**Sécurité et conformité**
1. **Conflit avec les règles permanentes :** les cahiers prévoient nom, date de naissance, informations cliniques (Epic) et motif ; CLAUDE.md n'autorise que des données fictives en démo.
2. Plaque, équipage et position : données personnelles des employés (Loi 25, EFVP, durée de conservation).
3. Isolation : pensée par établissement ; les ambulanciers et les CCS voient plusieurs hôpitaux.
4. Tuiles OpenStreetMap servies par un tiers : à revoir pour la production (politique d'usage, hébergement au Canada).
5. Double authentification des paramédics en véhicule (production) : solution adaptée à prévoir ; jamais sur les démos.
6. Simulation présentée comme réelle : l'interface doit toujours l'indiquer.

## 12. Ordre de construction et estimation

| Phase | Contenu | Jours |
|---|---|---|
| 0 bis | Tests existants exécutés et corrigés | 1 |
| 1 | Socle commun et socle préhospitalier (organisations, rôles, interventions, préalertes, événements, positions, notifications, OG) | 11 à 15 |
| 2 | Arrimo Ambulance | 10 à 14 |
| 3 | Arrimo Hôpital – Liaison Secours | 6 à 8 |
| 4 | Préparation hospitalière et proposition OG | 4 à 6 |
| 5 | Disponibilités | 2 à 3 |
| 6 | Arrimo CCS (carte, alertes, API de répartition) | 8 à 11 |
| 7 | Arrimo Connect (simulateurs) | 5 à 7 |
| 8 | Liaison Établissements | 8 à 12 |
| 9 | SH, tests, démo des scénarios A à H, deux langues | 7 à 9 |
| **Total** | | **≈ 62 à 86 jours** |

## 13. Fichiers concernés

- Existants : `db/schema.sql`, `src/app.js`, `src/auth.js`, `src/services.js`, `src/types-etablissement.js`, `src/chsld.js`, `src/liaison-chsld.js`, `src/og-outils.js`, `src/og-actions.js`, `src/connecteurs.js`, `src/simulation-connecteurs.js`, `src/national.js`, `src/routage.js`, `src/sh-api.js`, `src/sh/` (catalogue, supervision, permissions), `public/app.js`, `public/i18n/`, `db/demo-reseau.js`, `tests/`.
- Nouveaux (proposés) : `db/migrations/`, `src/prealertes.js`, `src/ambulance.js`, `src/ccs.js`, `src/liaison-secours.js`, `src/og-prehospitalier.js`, `src/connect/`, `public/ambulance.html`, `public/ccs.html`.

## 14. Décisions de Moustafa (12 nov. 2026, « validé »)

1. **Données patient et cliniques, motif compris :** fictives, en démo seulement (règle permanente inchangée). En production : référence, priorité, catégorie d'intervention en liste fermée et heure d'arrivée prévue ; identité et motif libre seulement après validation Loi 25 et EFVP, par décision écrite.
2. **Organisations ambulancières et CCS :** table d'organisations à part (ni lits ni places dans `etablissements`) ; mêmes utilisateurs, sessions et journaux.
3. **Moteurs de transfert :** séparés ; un simple lien entre une préalerte ou une demande de transport et le transfert ou la coordination qu'elle sert. Aucune fusion.
4. **Routes :** `/api/...` comme le reste d'Arrimo ; seule l'API ouverte aux systèmes externes (CCS, Arrimo Connect) est versionnée : `/api/connect/v1/...`.
5. **Module CCS :** remplace l'exclusion de la section 4.1 du cahier 2 ; le système de répartition des CCS reste le leur et Arrimo ne commande jamais une ambulance.
6. **Tests SH :** exécutés sur la recette officielle (rôle restreint déjà préparé) ; aucun rôle créé dans le cluster de ce serveur.

Ordre retenu : corriger les tests (phase 0 bis), puis phase 1 (socle), avec livrable de la règle 10 et validation à la fin de chaque phase.
