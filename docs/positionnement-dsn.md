# Arrimo et le DSN (Epic) — positionnement pour Santé Québec Mauricie-et-Centre-du-Québec

Analyse en lecture seule du code d'Arrimo (branche `prehospitalier-20261112`, commit 3ab4141), 16 nov. 2026.
Rien n'a été modifié. Source pour le DSN : contenu de la page « Dossier santé numérique (DSN) — information pour le personnel » de ciusssmcq.ca, copié à la main, la page n'ayant pas été ouverte. Le DSN y est décrit ainsi : Epic regroupe l'information clinique de l'usager ; déployé à MCQ et à Nord-de-l'Île-de-Montréal depuis mai 2026 ; rôles attribués selon le titre d'emploi ; formation dans ENA ; superutilisateurs ; centre de service 24/7 ; postes de l'organisation et comptes @ssss.gouv.qc.ca ; Rover, Haiku/Canto, Mon dossier santé ; toutes les actions journalisées.
La page ne dit rien de la gestion des lits entre hôpitaux, des ambulances, des RPA, des RI ni des CHSLD privés.
Correspondance avec la demande : point 1 de la demande = section 1, point 2 = section 4, point 3 = section 5, point 4 = section 6, point 5 = section 7, point 6 = section 8.
Journalisation : comme Epic, Arrimo inscrit chaque action dans un journal impossible à modifier (déclencheurs PostgreSQL). C'est un point commun qui facilite l'audit, pas un doublon.
Les affirmations sur Arrimo viennent du code et des tests cités. Celles sur Epic viennent du contexte transmis par Santé Québec MCQ ; quand elles viennent de connaissances générales sur Epic, elles sont marquées **à confirmer avec eux**.

---

## 7. Verdict

**Partiellement positionné.** Arrimo sait recevoir des messages HL7 ADT et exposer ses propres données en FHIR R4, et il n'oblige pas à ressaisir l'identité du patient. Mais il n'a jamais été branché sur Epic, il ne reçoit que 5 types de messages ADT et il ne lit pas Epic lui-même. Il n'a ni connexion avec les comptes du réseau ni lancement depuis Epic, et il n'est pas encore hébergé au Canada.

## 8. Réponse à donner à la coordonnatrice (4 phrases)

> Arrimo ne remplace pas Epic : le DSN reste la source de vérité pour le patient à l'intérieur de l'établissement, et Arrimo s'occupe de ce qui se passe entre les organisations, c'est-à-dire les ambulances et le CCS, les CHSLD, la coordination entre hôpitaux et les proches.
> Techniquement, Arrimo sait déjà recevoir les messages HL7 ADT standards que votre moteur d'interfaces peut lui transmettre (admission, transfert, congé, congé prévu, arrivée à l'urgence) et publie la disponibilité des lits en FHIR R4. Ces connecteurs n'ont été testés qu'avec des données fictives, jamais avec Epic.
> Une vraie connexion demanderait un travail commun avec votre équipe d'interfaces : choisir les messages, faire correspondre les codes de lits, pseudonymiser les numéros de dossier, relier Arrimo à vos comptes du réseau et l'héberger au Canada, ce qui n'est pas encore fait.
> Nous proposons de partir de ce qu'Epic fait déjà chez vous pour la gestion des lits, afin qu'Arrimo ne couvre que ce qui manque, sans ressaisie.

---

## 1. Ce qui existe réellement pour se connecter à Epic

| Canal | Code | État |
|---|---|---|
| **HL7 v2 ADT** reçu sur HTTPS (`POST /api/connecteurs/hl7v2`, clé de connecteur à portée `hl7v2`) | `src/hl7v2.js`, `src/connecteurs.js`, `src/app.js` | **A01 : fait et testé** (`tests/prealertes.test.cjs` : lit occupé, accusé `MSA|AA`, rejeu idempotent, nom et date de naissance jamais conservés, A28 refusé en `AE`). **A02, A03, A04, A16 : faits, non testés en HL7.** Ils passent par la même logique que les événements JSON, testée pour l'admission, le congé et le congé prévu (`tests/api.test.js:609`). **Le transfert interne et l'arrivée à l'urgence ne sont testés par aucun connecteur réel**, seulement dans la simulation. Pas de MLLP (HTTPS seulement, aucun port ouvert). |
| Messages ADT **absents** | — | A08 (mise à jour), A11/A12/A13 (annulations), A06/A07 (changement de classe), A17 (échange de lits), A20 (statut de lit), A21/A22 (congé temporaire). Tout autre message reçoit `AE hl7_evenement_non_pris_en_charge`. |
| **Événements ADT en JSON** (`POST /api/connecteurs/evenements`, portée `adt`) | `src/connecteurs.js` | **Fait et testé** : admission, congé, congé prévu, idempotence, envois simultanés, isolation entre hôpitaux (`tests/api.test.js:609`). Prévu pour un moteur d'interfaces qui traduit l'ADT en JSON. |
| **FHIR R4** | `src/fhir.js` | **Fait et testé, en lecture seule, Arrimo étant le serveur** : `metadata`, `Organization`, `Location` (lits, `operationalStatus`), `HealthcareService`, `Encounter` (ambulances annoncées, sans patient). Aucune ressource `Patient`, aucune écriture, aucun abonnement. **Arrimo ne lit pas le FHIR d'Epic** : aucun client FHIR dans le code. |
| **Arrimo Connect v1** (`/api/connect/v1`, signature HMAC, horodatage valable 5 min) | `src/connect.js` | **Fait et testé** (une trentaine de vérifications dans les tests). Conçu pour les systèmes **de secours** (CCS, entreprises ambulancières), pas pour Epic. |
| **Webhooks sortants signés** | `src/webhooks.js` | **Fait et testé** (signature, nouvelles tentatives, révocation, isolation). Envoie seulement deux événements : `prealerte` et `transport`. Aucun événement sur les lits. |
| **Import CSV / Excel** | `src/import.js` | **Fait et testé** (`/api/admin/import`) pour la **structure** (unités, chambres, lits, civières) et les **comptes**. Aucune donnée patient. **SFTP absent** (refusé dans `src/connexions.js` : il faudrait ouvrir un port). |
| Simulation de connecteurs | `src/simulation-connecteurs.js` | Faite et testée. Réservée à la démo et à la recette, avec une session humaine. La table de correspondance des codes n'existe que là. |
| **Connexion avec les comptes du réseau (SSO)** | — | **Absente.** Comptes locaux Arrimo et double authentification par code à 6 chiffres. Aucun SAML ni OpenID Connect. |
| **Lancement depuis Epic (SMART on FHIR)** | — | **Absent.** |

## 2. Ce qu'Arrimo recevrait d'Epic et ce qu'il en ferait

Le moteur d'interfaces de l'établissement envoie l'ADT à Arrimo. Arrimo lit seulement ces champs : PID-3 (référence, **qui doit déjà être pseudonymisée**), le code du lit dans PV1-3 (et PV1-6 pour l'emplacement précédent) et les dates. Le nom (PID-5) et la date de naissance ne sont jamais lus.

| Message Epic | Effet dans Arrimo (par `src/regles.js`, journalisé) |
|---|---|
| A01 admission | Le lit devient « occupé » s'il est libre ou réservé pour cette référence ; la demande d'admission correspondante est soldée. Sinon le message est **refusé** (409). |
| A02 transfert interne | L'ancien lit passe au nettoyage et le nouveau lit est occupé. |
| A03 congé | Le lit passe au **nettoyage**, ce qui crée une tâche pour l'entretien d'Arrimo. |
| A16 congé prévu | La date de sortie prévue du lit est enregistrée (prévisions, indicateurs). |
| A04 arrivée à l'urgence | La civière désignée est occupée, avec l'heure d'arrivée. |
| **NSA** | **Rien.** Aucun message ADT ne porte le statut NSA dans Arrimo : il se déclare à la main (onglet NSA). |
| Transferts entre hôpitaux | Rien côté Epic : la demande se crée dans Arrimo (onglet Transferts). |

Points d'attention :
- Le code du lit envoyé par Epic doit être **identique** au code du lit dans Arrimo. Il n'existe pas de table de correspondance pour un connecteur réel : il faudrait importer la structure avec les codes d'Epic.
- Si l'état d'un lit dans Arrimo diffère de celui d'Epic (par exemple un lit encore « en nettoyage » dans Arrimo), le message A01 est refusé et il faut le rejouer. Les refus sont journalisés.

## 3. Ressaisie de ce qui est déjà dans Epic

- **L'identité n'est jamais ressaisie.** Arrimo ne connaît qu'une référence. Les fiches nominatives fictives n'existent qu'en démo et en recette.
- **Sans connexion ADT, presque tout est ressaisi** : les admissions, les congés et les transferts internes se font à la main dans l'onglet Lits, et les arrivées à l'urgence dans l'onglet Urgence.
- **Même avec la connexion ADT, ces éléments restent à saisir dans Arrimo :**
  - la déclaration NSA (onglet NSA) ;
  - la demande de lit et sa priorité depuis l'urgence (file d'admission, onglet Admissions) ;
  - les besoins de la chambre (isolement, etc.) ;
  - la fermeture de lits faute de personnel ;
  - la fin du nettoyage ;
  - les corrections et annulations (A08, A11, A12, A13 absents).
- La **référence patient automatique** (commit aa44318) crée une référence `P-…` quand aucune n'est fournie. Si l'interface envoie la référence pseudonymisée d'Epic, c'est elle qui sera utilisée. Sinon, il y aura deux identifiants à rapprocher.

## 4. Ce qui fait doublon avec Epic

Les fonctions d'Epic citées ici sont connues de façon générale ; **leur activation à MCQ est à confirmer** (les infos publiques transmises n'en parlent pas).

| Arrimo | Epic, possible équivalent | Risque |
|---|---|---|
| Tableau des lits interne, file d'admission, civières de l'urgence, congés prévus | Module de gestion des lits et des admissions d'Epic (bed board, centre de transfert) — **à confirmer** | **Élevé** si MCQ utilise ces fonctions dans Epic. |
| Nettoyage (tâches d'entretien après un congé) | Gestion de l'hygiène et salubrité dans Epic — **à confirmer** | Élevé. |
| Tâches du personnel (CHSLD) | Rover : gestion des tâches | Moyen. Le module Arrimo ne vise que les CHSLD et peut être désactivé. |
| Messagerie sécurisée avec les proches, Arrimo Famille | Mon dossier santé (portail patient) | Moyen. Arrimo vise les **proches de résidents de CHSLD**, Mon dossier santé vise le patient. |
| Clavardage interne | Rover / Secure Chat | Faible. Arrimo n'a pas de clavardage entre soignants. |

## 5. Ce qu'Arrimo apporte que le DSN n'a pas (ou pas entre organisations)

- **Ambulances et CCS** (`src/prealertes.js`, `src/missions-ccs.js`, `src/reservations.js`) : préalertes de l'ambulance vers l'hôpital, heure d'arrivée prévue avec alertes à 10, 5 et 2 minutes, réservation d'une civière avec confirmation en 60 secondes qui ne bloque jamais, missions proposées par le CCS que l'équipage accepte ou refuse, état des véhicules. Testé, en démo.
- **Liaison entre hôpital et CHSLD** (`src/liaison-chsld.js`, `src/nsa-chsld.js`) : sortie NSA vers un CHSLD, du plus proche au plus loin, hospitalisation d'un résident et son retour. Les CHSLD **privés** ont leur type (sous-type `chsld_prive`).
- **Demandes de transport** d'un établissement vers une entreprise ambulancière (`src/transports.js`).
- **Plusieurs établissements** : vue réseau, tableau national, recommandation de l'hôpital le plus proche qui a un lit adapté (`src/services.js`, `src/national.js`).
- **Proches** : Arrimo Famille, portail des proches de CHSLD (pilote), avis aux étapes du transport.
- **Parcours suivi d'un bout à l'autre** : Arrimo Sillage, de la sortie du CHSLD au retour, en passant par l'ambulance et l'hôpital.
- **RPA et RI : PAS opérationnels.** Les types existent mais sont « à venir » et refusés à la création (`src/types-etablissement.js`). Il ne faut pas les présenter comme disponibles.

## 6. Ce qui manque pour une vraie connexion (effort côté Arrimo)

| Élément | Travail | Effort estimé |
|---|---|---|
| Moteur d'interfaces | Côté MCQ : leur moteur envoie l'ADT à Arrimo en HTTPS (déjà accepté). Si seul MLLP est possible, il faudrait un relais MLLP chiffré, donc un port à ouvrir avec accord. | 16–24 h (relais), 0 h si HTTPS |
| ADT complet | A08, A11, A12, A13, A06/A07, A17, A20 et A21/A22 ; correspondance des codes de lits et d'unités pour un connecteur réel ; règle pour le statut NSA (à définir avec eux) ; resynchronisation en cas d'écart | 60–90 h |
| Tests sur de vrais messages | Tests HL7 pour A02, A03, A04 et A16 ; rejeu de messages Epic anonymisés fournis par MCQ | 16–24 h |
| Lecture FHIR d'Epic (option à la place de l'ADT ou en plus) | Client FHIR (`Location`, `Encounter`) ; dépend des API qu'Epic ouvre chez MCQ | 60–100 h |
| Authentification avec les comptes `@ssss.gouv.qc.ca` | SSO en OpenID Connect ou SAML vers leur fournisseur d'identité, correspondance des rôles, comptes locaux conservés pour les partenaires externes (ambulances, CHSLD privés) | 40–60 h |
| Lancement depuis Epic (SMART on FHIR) | Lancement depuis le dossier, OAuth2, affichage dans Epic ; **plus l'inscription et la validation chez Epic, délai externe de plusieurs mois** | 60–100 h |
| Hébergement au Canada | Production et console SH au Canada, sauvegardes au Canada, évaluation des facteurs relatifs à la vie privée (EFVP, Loi 25), test d'intrusion | 40–60 h d'infrastructure, plus des semaines de démarches externes |
| **Total côté Arrimo** | | **≈ 290–460 h**, sans compter le travail de l'équipe d'interfaces de MCQ ni les validations |

---

### Remarque sur la phrase de positionnement

« Arrimo lit Epic sans ressaisie » **n'est pas vrai aujourd'hui**. Arrimo ne lit pas Epic : il *peut recevoir* 5 messages ADT que le moteur d'interfaces de l'établissement lui pousserait. Rien n'a été testé avec Epic, et le NSA, les demandes de lit et le nettoyage restent saisis dans Arrimo. Formulation juste : « Epic gère le patient à l'intérieur ; Arrimo relie ce qui est à l'extérieur, et il est conçu pour recevoir les mouvements d'Epic par HL7 afin d'éviter la ressaisie ».
