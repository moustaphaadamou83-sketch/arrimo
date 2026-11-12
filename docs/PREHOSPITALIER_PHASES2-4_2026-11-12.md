# Arrimo Préhospitalier — Livrable des phases 2, 3 et 4

**Date :** 12 novembre 2026 · **Branche :** `prehospitalier-20261112` (locale, non déployée)
**Références :** `docs/cahiers-prehospitalier-20261112/` (cahier 2 : sections 2, 5, 7, 8, 18), `docs/PREHOSPITALIER_PHASE1_2026-11-12.md`.
Consigne de Moustafa : suivre les trois cahiers et **introduire OG partout**.

## 1. Ce qui a été construit

### Phase 2 — Arrimo Ambulance et Arrimo CCS (écran `/secours`)
- Page dédiée, PWA (manifeste, service worker limité à l'enveloppe de la page, jamais les réponses de l'API), adaptée aux tablettes embarquées : grands boutons, actions principales visibles.
- Les comptes paramédic, superviseur et répartiteur sont redirigés vers `/secours` à la connexion ; ils n'ont jamais l'interface des établissements.
- **Ambulance** : unité, nouvelle préalerte (hôpital, priorité, catégorie, délai en un geste), suivi des étapes de l'hôpital (transmise, reçue, consultée, prise en compte, préparation, prête, arrivée confirmée), retard (+5, +10 min), changement de priorité, changement de destination (confirmation), arrivée, annulation, urgences de la région, dernières 24 h.
- **Superviseur** : en plus, toutes les préalertes ouvertes de l'organisation.
- **CCS** : ambulances annoncées dans la région et urgences de la région, en consultation seulement (« votre système de répartition reste la référence »).
- **Connexion instable** : la préalerte est gardée sur l'appareil et renvoyée avec la même clé d'envoi (aucun doublon) ; pastille En ligne / Hors ligne / Envoi en attente.
- **Position** facultative, activée par l'équipe, envoyée toutes les 30 s au plus ; géolocalisation permise par l'en-tête de sécurité sur `/secours` seulement.
- **OG** sur l'écran (`/api/secours/og`) : préalertes en cours, réception confirmée ou non, informations manquantes, état des urgences ; refuse de choisir une destination ou une priorité.
- Démo (`db/demo-reseau.js`) : 2 entreprises ambulancières (3 unités), 1 CCS, comptes `ambulance.a`, `superviseur.a`, `ambulance.b`, `ccs@demo.arrimo`, Liaison Secours dans 3 hôpitaux, une préalerte en cours vers l'Hôpital X.

### Phase 3 — Arrimo Hôpital – Liaison Secours (onglet hospitalier)
- Onglet « Liaison Secours », visible seulement si le module est activé pour l'établissement.
- **Liste et carte** (Leaflet déjà hébergé) : entreprise, unité, plaque, équipage, catégorie, priorité, heure prévue, position et son heure, statut.
- **Accusé** (prise en compte), préparation en cours, préparation terminée, **confirmation du véhicule** (numéro de l'unité réellement arrivée ; un autre véhicule est enregistré et la préalerte reste ouverte), remise, problème signalé, historique complet.
- **Son** configurable par poste pour les nouvelles préalertes ; rafraîchissement toutes les 15 s ; compteur des préalertes à prendre en compte.
- **OG** : bouton « Demander à OG » qui ouvre l'assistant sur la question des ambulances en approche.

### Phase 4 — Préparation hospitalière et proposition de service par OG
- **Proposition de service** (cahier, section 2.2) : d'après les règles de l'établissement seulement (`services.attributs.categories_secours`, service par défaut `secours_defaut`), avec justification ; attribuée à OG dans l'historique (aucune personne).
- L'équipe **confirme, indique un autre service ou refuse** ; aucun service, lit ni patient n'est affecté automatiquement.
- **États de préparation** (section 8.3) : non consultée, à prendre en compte, service à confirmer, préparation à effectuer, en cours, terminée, patient arrivé, patient remis, annulée ou modifiée.
- **Synthèse d'OG** (sections 2.1 et 7.3) pour l'hôpital seulement : heure manquante ou dépassée, position absente ou ancienne (plus de 10 min), aucune règle de service, capacité de l'urgence, priorité immédiate non prise en compte.
- **Notification adaptée à la priorité** (section 8.4) : préalerte immédiate signalée comme telle.
- OG de l'hôpital répond aussi à « Quel service est potentiellement concerné ? ».
- Démo : services du cahier (urgence générale, réanimation, cardiologie, neurologie / AVC, traumatologie, pédiatrie, obstétrique) avec règles dans les 3 hôpitaux.

## 2. Fichiers

| Fichier | Changement |
|---|---|
| `public/secours.html`, `public/secours.js`, `public/secours.webmanifest`, `public/sw-secours.js` | nouveaux : écran Ambulance et CCS |
| `public/liaison-secours.js` | nouveau : onglet hospitalier Liaison Secours |
| `public/index.html`, `public/app.js` | onglet (module optionnel), redirection des comptes de secours |
| `public/i18n/fr.js`, `public/i18n/en.js` | textes de l'onglet hospitalier (FR, EN) ; nouveau code d'erreur |
| `src/prealertes.js` | destinations, proposition de service, états de préparation, synthèse, services de l'hôpital |
| `src/og-secours.js` | OG pour les ambulances et le CCS ; service concerné côté hôpital |
| `src/app.js` | `/secours`, `/api/secours/destinations`, `/api/secours/og`, `/api/secours/services` ; géolocalisation sur `/secours` |
| `src/erreurs.js`, `src/langue.js` | `service_introuvable` ; notification prioritaire (FR, EN) |
| `db/schema.sql` | colonnes de proposition de service sur `prealertes` |
| `db/demo-reseau.js` | démonstration préhospitalière |
| `tests/prealertes.test.cjs`, `tests/api.test.js` | 5 tests ; test de la démo adapté (comptes de secours rattachés à une organisation) |

## 3. Vérification dans un vrai navigateur (Chromium)
Parcours joués sur une base de démonstration neuve, en largeur téléphone (390 px), tablette (820 px) et ordinateur (1366 px) : connexion de chaque rôle et redirection, préalerte transmise depuis l'écran, OG, onglet hospitalier en liste et en carte, véhicule « 99-99 » refusé sans fermer la préalerte, puis bon véhicule confirmé. Aucune erreur dans la console, aucun débordement horizontal.

## 4. Reste à faire
- Phase 5 : statut déclaré de l'urgence (ouvert, capacité limitée, saturation, délestage), source et fraîcheur de chaque donnée de disponibilité.
- Phase 6 : carte régionale du CCS et API pour les systèmes de répartition.
- Phase 7 : Arrimo Connect (simulateurs FHIR, Epic, HL7, webhooks signés) ; SH (administration des organisations, unités, comptes ; migration du catalogue ; supervision).
- Liaison Établissements (cahier 3) : demande de transport depuis un CHSLD, une RPA, une RI ou une RTF vers l'ambulance.
- Interface d'administration pour saisir les règles catégorie → service (aujourd'hui : champ `attributs` des services, par l'API d'administration ou l'import).
