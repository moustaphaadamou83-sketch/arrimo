# DSN international — audit initial et architecture retenue (22 nov. 2026)

Cahier : « Module Dossier Santé Numérique (DSN) international », v1.0 du 20 nov. 2026. Décision de Moustafa (22 nov. 2026) :
**DSN clinique en démonstration et en recette seulement, patients entièrement synthétiques ; refus prouvé par test ailleurs ;
aucune activation avec de vrais patients sans validation clinique, réglementaire et de sécurité du pays et autorisation écrite.**

## 1. Ce qui existe et sera réutilisé (aucune réécriture)
| Existant | Fichiers | Usage pour le DSN |
|---|---|---|
| Dossier maître de patients fictifs (identité, référence interne stable, rapprochement prudent sans fusion automatique), démo et recette seulement | `src/patients.js`, table `patients` | **Identité du DSN** : le DSN rattache ses données cliniques à `patients.id` |
| Passages administratifs | `src/patients-historique.js`, `patient_passages` | Historique longitudinal (timeline) |
| Évaluations fictives (pathologies, précautions) en démo seulement, accès journalisés | `src/evaluations-fictives.js` | Modèle de garde d'environnement et de journal d'accès |
| Lits, civières, règles d'état (verrou, version, journal) | `src/regles.js` | Hospitalisation reliée au lit sans dupliquer la source de vérité |
| Transferts, transports non urgents, demandes d'hébergement | `src/services.js`, `src/transports.js`, `src/nsa-hebergement*.js` | Parcours Hôpital B → Maison de retraite B |
| Horloge, Sillage, Vigilance (moteur commun) | `src/horloge.js`, `src/sillage.js` | Chronologie du parcours, confirmations manquantes |
| OG (local, sans IA externe par défaut) | `src/copilote.js`, `src/og-modules.js` | Résumé sourcé du dossier autorisé, état d'une transition |
| Modules activables par établissement, catalogue SH, cartes | `src/types-etablissement.js`, `src/sh/*`, `public-sh/modules-cartes.js` | Activation du DSN depuis Arrimo SH |
| Environnements (demo, recette, validation, production) | `src/environnement.js` | Garde : DSN refusé hors démo et recette |
| Journaux immuables (déclencheurs) | `journal`, `journal_admin` | Modèle pour le journal d'accès au dossier |

## 2. Écarts
- Aucune donnée clinique aujourd'hui (règle permanente) : à créer, sous garde d'environnement.
- Pas de « fonction clinique » (admission, infirmier, médecin, sortie, auditeur) : les rôles d'Arrimo sont opérationnels. **Ajout : des habilitations DSN par établissement**, sans nouveau rôle global.
- Pas de paquet de transition entre établissements : à créer, avec contenu choisi et validé par un professionnel.
- Pas de journal d'accès clinique (lecture, écriture, export, partage, accès d'urgence) : à créer, immuable.

## 3. Architecture retenue (la moins invasive)
- **Garde d'environnement** : `src/dsn/garde.js` — module `dsn` actif pour l'établissement ET environnement `demo`/`recette` ; sinon 403 (test).
- **Habilitations** `dsn_habilitations` (établissement, utilisateur, fonction ∈ admission, infirmier, medecin, sortie, auditeur). L'administrateur local les accorde ; il n'a pas lui-même accès aux dossiers sans habilitation. Arrimo SH n'a aucun accès clinique.
- **Relation de soins** : une personne habilitée de l'établissement du dossier. Hors de là : seulement les **paquets de transition** adressés à son établissement. **Accès d'urgence** (bris de glace) : justification obligatoire, 4 h, journalisé, signalé.
- **Données cliniques** : allergies, antécédents, rencontres, notes (versions, signature, amendement), observations, diagnostics, prescriptions **simulées** (brouillon → validée par un médecin ; aucun envoi réel), examens, documents (PDF/images ≤ 5 Mo, empreinte, version), séjours (admission, sortie, synthèse).
- **Aucune suppression** d'un élément signé : annulation ou amendement tracés (nouvelle version).
- **Journal d'accès** `dsn_acces` immuable (déclencheur), sans contenu clinique.
- **Interconnexions** (contrat minimal, idempotent, sans dossier complet) :
  - Transition → **demande d'hébergement** (si la destination est une ressource) et **transport non urgent** (si réservé) ;
  - **Horloge / Sillage** : objet `dsn_transition` (demande, décision, départ, arrivée) ;
  - **Vigilance** : transition envoyée et non reçue au-delà du délai ;
  - **OG** : résumé sourcé du dossier autorisé, état d'une transition ; jamais de diagnostic, d'écriture ni de décision ;
  - **Famille / Visites** : rien par défaut ; **Données** : nombres agrégés et masqués (< 5).
- **Interface** : page `/dsn` (comme `/formation`), bandeau permanent « ENVIRONNEMENT DÉMO — DONNÉES FICTIVES », FR/EN, tablette et ordinateur.
- **Démo** : Hôpital B (HY), Maison de retraite B (nouvelle, type maison de retraite), Transport B (organisation), comptes par fonction, 10 patients synthétiques marqués DEMO.

## 4. Phasage
Phase 1 socle (garde, habilitations, journal d'accès, SH) · Phase 2 dossier clinique · Phase 3 connexions et parcours Hôpital B → Maison de retraite B · Phase 4 tests · Phase 5 publication démo · Phase 6 (pilote réel) **non engagée**.
