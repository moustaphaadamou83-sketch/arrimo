# Arrimo Préhospitalier, Liaison Établissements, SH et intégration — Livrable (12 novembre 2026)

**Branche :** `prehospitalier-20261112` · **Rien n'est publié** : publication de tout à la fin, avec l'accord de Moustafa (recette d'abord).
Références : `docs/cahiers-prehospitalier-20261112/`, `docs/AUDIT_PREHOSPITALIER_2026-11-12.md` (décisions, section 14), livrables `PREHOSPITALIER_PHASE1_*.md` et `PREHOSPITALIER_PHASES2-4_*.md`.

## 1. Construit

| Domaine | Contenu | Fichiers principaux |
|---|---|---|
| Préalertes (cahier 2) | Étapes horodatées, confirmation technique et humaine, bon véhicule, changement de destination conservé, idempotence, positions 24 h, historique immuable | `src/prealertes.js` |
| Arrimo Ambulance et CCS | PWA `/secours`, envoi différé, carte régionale, alertes de saturation, superviseur | `public/secours.*` |
| Hôpital – Liaison Secours | Onglet, carte et liste, préparation, proposition de service par OG, synthèse d'OG, statut déclaré de l'urgence | `public/liaison-secours.js` |
| Scénario D (démo seulement) | Correspondance par système hospitalier simulé, fiches fictives ; identité réservée à l'hôpital | `src/correspondance-simulee.js` |
| Liaison Établissements (cahier 3) | Demande de transport (CHSLD, RPA, RI, RTF, hôpital), module activable, préalerte qui prolonge le transport | `src/transports.js`, `public/transports.js` |
| Organisations de secours | Un seul modèle : types (CCS, entreprise ambulancière, Urgences-santé, premiers répondants) et profils (CCS, Ambulance) | `src/prealertes.js`, `src/admin-secours.js` |
| OG partout | Hôpital, ambulance, CCS, CHSLD et résidences, intégration ; jamais de destination, de service ni de priorité décidés | `src/og-secours.js`, `src/og-chsld.js`, `src/copilote.js` |
| SH | Clients de type secours (relier, profils, activation), modules transmis un par un, connexions par client | `src/sh/app.js`, `src/sh-api.js`, migration SH 45 |
| Connexions externes | Arrimo Connect v1, HL7 v2 sur HTTPS, ADT JSON, FHIR R4 (lecture), webhooks signés ; secrets jamais affichés (remise unique) | `src/connect.js`, `src/hl7v2.js`, `src/fhir.js`, `src/webhooks.js`, `src/connexions.js`, `src/remises.js` |
| Intégration | Page `/integration` et document pour les cliniques (DSN, DME) | `public/integration.html`, `docs/INTEGRATION-ARRIMO.md` |
| Démo | Établissements existants reliés aux CCS et ambulances ; scénario guidé `/demo-guide` ; remise à zéro existante | `db/demo-reseau.js`, `public/demo-guide.html` |

## 2. Tests

`tests/prealertes.test.cjs` : 14 tests (parcours complet, isolation, OG, écrans, préparation, disponibilités, transport, Connect, administration, scénario D, profils, parcours démo, SH et connexions, intégration). Résultats de la vérification complète : voir le compte rendu de fin de journée.
Non exécutables sur ce serveur : les tests SH (cluster isolé de recette, rôle restreint) — à lancer à la publication.

## 3. Publication (à faire avec l'accord de Moustafa)

1. Recette : déploiement de la branche, schéma rejoué, migration SH 45, suites SH (`scripts/recette-sh-lot1.cjs`, configuration privée de la recette).
2. Vérification dans la recette : écrans `/secours`, Liaison Secours, Liaison Établissements, SH (client secours, modules, connexions), courriel de remise (SMTP).
3. Démo : seulement après « oui » ; modules à activer dans SH pour les CHSLD de démonstration (Liaison Établissements).
4. Production : jamais sans accord ; hébergement au Canada.

## 4. Points ouverts

- Courriel (SMTP) à configurer pour envoyer les liens de remise des secrets.
- SFTP non proposé (port à ouvrir : accord requis) ; l'import passe par SH.
- Connexion réelle au DSN, à Epic ou à un système de répartition : documentation, autorisation, EFVP et essais avec le partenaire.
- Mots de passe temporaires des comptes : encore affichés une fois à l'administrateur (hors du périmètre « connexions » de la règle) — à décider.
