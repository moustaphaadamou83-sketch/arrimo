# Cahier général — nouveaux modules Arrimo sur un moteur commun (version 2)

**Audit et plan seulement. Rien n'est construit, rien n'est publié.** Début du chantier prévu le **jeudi 19 nov. 2026**, après le « oui » de Moustafa pour le Chrono.
Date : 17 nov. 2026 · Base auditée : branche `demandes-hebergement-20261117`, commit `9d6ef24`.
Version 2 : remplace la version 1 du même jour (nouvel ordre, Urgences en direct, Visites confirmées, Éviter les transferts inutiles, OG et Sillage, garantie de continuité, écran d'activation SH).

## Règles permanentes du chantier

- Autres sites du serveur intouchables (SenseStorage, PharmaQuick, ShopControl). Aucun secret affiché.
- Données fictives seulement. Aucun nom de patient dans les préalertes ni vers les ambulanciers.
- **Arrimo informe, un humain décide** : toute proposition (OG, classement, orientation) est validée par une personne.
- Une branche par module, tests automatiques à jour, rien publié ni poussé sans le « oui » de Moustafa.
- FR/EN d'origine, multi-pays (profils de pays) ; chaque module s'active par établissement depuis SH.
- **Démo gelée jusqu'après la rencontre du jeudi 19 nov.** : aucune activation dans la démo avant le vendredi 20 nov.

## Ce qui doit démarquer Arrimo (vérifié dans chaque module)

1. **Les deux côtés voient la même chose** : infirmière et ambulance, hôpital et résidence, demandeur et receveur. Une seule fiche, mêmes heures, même statut.
2. **Arrimo ne remplace aucun logiciel** : il se branche (HL7, FHIR, Arrimo Connect, lecture de données publiques) ou fonctionne seul.
3. **Activation en quelques minutes dans SH**, utilisable par une petite organisation (une RPA, une petite entreprise ambulancière) : rôles allégés, écran sur téléphone, pas d'installation.
4. **FR/EN d'origine, multi-pays** : libellés, cibles, numéros d'orientation (811 au Québec) viennent du profil de pays.

Chaque module a dans ses tests une case « démarquage » : même vue des deux côtés, fonctionne sans connecteur, activation par SH, FR/EN.

## OG et Sillage, capacités transversales

Dans chaque module construit :
- **OG** : répond aux questions du module (« combien d'ambulances à la porte ? », « quelles places pour ce patient ? »), propose sans agir ; toute action passe par les mêmes règles que l'interface (`src/og-outils.js`, `src/og-actions.js`).
- **Arrimo Sillage** (`src/continuite.js`) : les étapes du module apparaissent dans le fil du patient ou du résident (arrivée en ambulance, transfert, transport, évacuation, retour).
- Environ **3 h par module construit**, comptées dans le récapitulatif.

---

## A. Ce qui existe déjà, ce qui est partiel, ce qui manque

### A.1 Le moteur commun

| Brique | État | Ce qui existe (fichiers) | Ce qui manque |
|---|---|---|---|
| **1. Organisations et places** | **Partiel** | `etablissements` (types `hopital`, `chsld`) ; RPA, RI, RTF, maison des aînés = établissement `chsld` avec `type_local_code` (`src/types-etablissement.js`) ; `organisations_secours` (ambulancier, CCS) ; `ressource_profils`, `places_a_venir` (`src/nsa-places.js`) ; lits, chambres, civières. | Types **soins palliatifs**, **hospitalisation à domicile (HAD)**, **lits psychiatriques**, **ressources en santé mentale**, **direction régionale** ; capacité déclarée en nombre (HAD, santé mentale sans chambres saisies) ; **vraies régions** (aujourd'hui, la région d'un CCS = profil de pays) ; **groupes** de résidences. |
| **2. Demande** | **Partiel, éclaté** | 5 objets : `transferts` (motif de refus en texte libre), `demandes_hebergement` (motif fermé, délai), `demandes_transport` (motif fermé, exige une coordination CHSLD), `prealertes` + `prealerte_confirmations`, `missions_ccs`. Historiques immuables. | Vue unique de toutes les demandes ; motifs fermés partout ; échéance de réponse commune. |
| **3. Mouvement** | **Partiel** | `transferts`, `coordinations` (Sillage), demandes d'hébergement admises, `resident_mouvements`, `patient_passages`. | Fil commun ; évacuation ; rapatriement. |
| **4. Transport** | **Partiel** | `unites_secours`, `etats_vehicules` + historique, `positions_unites` (24 h), heure d'arrivée OSRM ; l'état suit le transport (`src/transports.js:165`). | Type de véhicule (ambulance, avion, transport adapté) ; transporteurs non ambulanciers ; états « en préparation » et « désinfection ». |
| **5. Horloge** | **Partiel, éclaté** | Colonnes `*_le` sur chaque table, tables d'événements immuables. | Table unique d'horodatages avec **source** et **auteur**, correction qui n'efface rien, écart saisie / détection. |

### A.2 Les modules (nouvel ordre)

| # | Module | État | Ce qui existe | Ce qui manque |
|---|---|---|---|---|
| 1 | **Chrono** | **~30 %** | Préalerte : arrivée signalée, arrivée confirmée, remise ; civière réservée puis installée (`src/reservations.js`) ; positions, heure d'arrivée prévue ; écran des arrivées prévues ; statistiques de civières (`src/civieres.js`). | Zone autour de l'hôpital et détection H11 / H15 ; boutons H12, H13, H14 ; chrono à la porte (rouge à 20 min) ; ambulances sans préalerte ; rapport mensuel et CSV ; contrôle des écarts. |
| 2 | **Urgences en direct** | **~20 %** | Statut déclaré de l'urgence `ouvert`, `capacite_limitee`, `saturation`, `delestage` avec heure, auteur et fraîcheur (`etablissements.urgence_statut_*`, `src/prealertes.js:466-490`) ; « Urgences classées » OSRM (`src/vehicules.js:169`) ; flux en direct (`src/flux.js`) ; Arrimo Connect v1 (`/api/connect/v1/disponibilite`). | État **« fermée temporairement »** avec heure de réouverture ; **fermetures planifiées** et avis automatiques ; services touchés ; prise en compte dans le classement ; **page publique** et **API ouverte** ; lecture des données publiques (voir C.2). |
| 3 | **Transferts** (avec la centrale des transferts urgents et les rapatriements) | **~55 %** | `transferts` : demande, lit réservé du receveur (`regles.js`), acceptation ou refus, départ, réception, temps de route, alternatives, proximité (`src/services.js:378-590`). | Le transporteur et la coordination ne voient pas le transfert ; état du transport en direct ; alertes de blocage ; motif fermé ; **centrale** (file régionale) ; **rapatriement** ; délai décision → départ → arrivée affiché. |
| 4 | **Transport non urgent** | **~45 %** | `demandes_transport` (DT-), motif fermé, étapes ; `public/transports.js` ; lit « à libérer » (`lits.conge_statut = 'attente_transport'`) ; `transport_mode` (NSA lot D). | Demande sans coordination CHSLD ; plage horaire confirmée, réservation la veille ; type de véhicule ; transporteurs non ambulanciers ; lien automatique avec le départ du lit. |
| 5 | **Bourse des places** (destinations élargies) | **~50 %** | Classement sur 100 expliqué (`placesCompatibles`, `src/nsa-places.js:207`), milieux écartés avec raison, places à venir, profil de ressource, poids réglables, « Transférer à un autre milieu ». Orientations existantes : CHSLD public, privé conventionné, privé, RI, RTF, RPA, maison des aînés, palliatif. | Types palliatif, HAD, **lits psychiatriques**, **ressources en santé mentale** ; lien invité ; fiche d'une page ; groupes ; preuve de neutralité. |
| 6 | **Données** (avec listes d'attente) | **~25 %** | Indicateurs NSA par semaine et par ressource + CSV (`src/nsa-indicateurs.js`), indicateurs de terrain (`src/terrain.js`), tableau national (`src/national.js`). | Vue par région ; délais Chrono et transferts ; refus par motif ; **listes d'attente par type de ressource et par région** ; masquage des petits nombres ; rôle direction régionale. |
| 7 | **Mode crise** | **~5 %** | Places, profils, classement, Arrimo Famille, coordinations. | Tout le parcours d'évacuation. |
| 8 | **Visites confirmées** | **Audit seulement (A.3)** | — | — |
| 9 | **Éviter les transferts inutiles** | **Plus tard (A.4)** | — | — |
| — | **Écran d'activation SH** | **~40 %** | Cases à cocher par catégorie (`public-sh/sh.js:296` et `:393`), statut `disponible` / `a_venir` / `etude`, dépendances déclarées (`MODULES[].dependances`), enregistrement journalisé (`PUT /hopitaux/:id/modules`, `src/sh/app.js:754`) et transmis à l'environnement. | Grille de cartes, emojis, interrupteurs, confirmation de désactivation, dépendances expliquées, cartes « Bientôt », filtre (voir C.10). |
| — | **Garantie de continuité** | **~15 %** | Export de la structure et des comptes en CSV (`exporterStructure`, `src/formation.js:75`, route SH `/sh/etablissements/:code/structure`) ; `README.md`, `INTEGRATION-ARRIMO.md`, `deploy/installer.sh`, `deploy/sauvegarde.sh`, `deploy/restaurer.sh`, `db/schema.sql`. | Export **complet** des données d'un client (CSV + JSON) depuis SH ; dossier d'entiercement (voir C.11). |

### A.3 Visites confirmées — audit

**Le besoin :** la RPA voit l'horaire des visites prévues du CLSC ou du prestataire pour ses résidents ; l'intervenant confirme arrivée et départ (même détection par la position que le Chrono) ; alerte de visite manquée ; rapport mensuel : prévues, faites, manquées, et soins donnés par la RPA à la place.

**Ce qui existe :**
- RPA : établissement `chsld` avec `type_local_code = 'rpa'`, résidents, proches, tâches (`taches_etab`), Arrimo Famille.
- Position et zone : les briques du Chrono (zone autour d'un lieu, détection d'entrée et de sortie, Horloge) seront réutilisables telles quelles, avec une zone autour de la RPA.
- Organisations sans lits : modèle `organisations_secours` (décision du 12 nov.).

**Ce qui manque :**
- **Organisation prestataire** (CLSC, entreprise de soins à domicile) et ses intervenants, avec un rôle limité : voir seulement ses visites, chez ses résidents.
- **Horaire des visites** : résident (référence), prestataire, type de visite en **liste fermée** (aide à l'hygiène, soins infirmiers, médication, réadaptation, autre), date et plage, récurrence.
- **Confirmation** : arrivée et départ par la position (zone autour de la RPA) ou par un clic, correction tracée.
- **Visite manquée** : plage dépassée sans arrivée → alerte à la RPA et au prestataire.
- **Soins donnés par la RPA à la place** : catégorie fermée, jamais de texte clinique.
- **Rapport mensuel** par RPA et par prestataire, CSV.

**Points d'attention :**
- La position d'intervenants employés par un autre organisme est un renseignement personnel sensible (Loi 25, conventions collectives) : seulement pendant la plage de visite, seulement autour de la RPA, conservée 24 h, avec consentement ; le clic doit toujours rester possible.
- Le type de visite reste une catégorie de service, jamais un diagnostic.
- Données qui pourraient servir à des retenues de paiement : même règle que le Chrono (Arrimo mesure, ne pénalise pas).

**Estimation de construction (pour plus tard) : 26 h.**

### A.4 Éviter les transferts inutiles — cadrage (plus tard)

Avant d'appeler l'ambulance, le CHSLD ou la RPA voit une **courte liste de vérification** et les **alternatives** possibles (médecin de garde, infirmière praticienne, 811, équipe de soutien à domicile, télésoins) ; l'équipe décide toujours ; Arrimo compte les transferts évités et ceux faits.
- Réutilise : la demande de transport du CHSLD (`src/transports.js`), « Urgences proches », OG.
- Attention : une liste de vérification ressemble vite à un outil d'aide à la décision clinique. Elle doit venir **de l'établissement** (son protocole, saisi par lui), pas d'Arrimo ; Arrimo n'affiche aucune recommandation clinique et ne bloque jamais l'appel. À faire valider (directions des soins infirmiers) avant de construire.
- **Estimation (pour plus tard) : 18 h.**

---

## B. Plan du moteur commun (lot 0)

Principe : **réutiliser, ne rien fusionner, ne rien casser.** Migrations additives et rejouables (`db/migrations/2026MMDD-*.sql` + `db/schema.sql`).

### B.1 Organisations et places
| Changement | Contenu | Réutilise |
|---|---|---|
| Table `regions` | code (ex. `06`), nom FR/EN, profil de pays | — |
| `etablissements.region_id`, `organisations_secours.region_id` | rattachement régional | `config_pays` intact |
| Types locaux `soins_palliatifs`, `hospitalisation_domicile`, `psychiatrie`, `sante_mentale` | même voie que RPA/RI/RTF : moteur CHSLD + `type_local_code`, nom FR/EN | `ressource_profils`, `places_a_venir` |
| `ressource_profils.places_declarees`, `places_libres_declarees` | ressources sans chambres saisies (HAD, santé mentale) | — |
| `groupes_ressources` + `etablissements.groupe_id` | groupe de résidences | — |
| Table `directions_regionales` (+ rôle `direction_regionale`) | organisation sans lits, limitée à sa région : lecture, déclenchement de crise | sessions, utilisateurs, journaux |
| Organisations `prestataire` (préparé, utilisé par Visites confirmées) | CLSC, entreprise de soins à domicile | modèle `organisations_secours` |

> Lits psychiatriques d'un **hôpital** : ce sont des lits de l'hôpital (types d'unité existants, `types_unite`) ; la bourse les lit comme places quand l'hôpital publie ses lits dans la bourse. Les ressources en santé mentale hors hôpital sont le nouveau type local.

### B.2 Demande — une couche commune, sans fusion
La décision du 12 nov. (`docs/AUDIT_PREHOSPITALIER_2026-11-12.md`, § 14.3) interdit de fusionner les moteurs. Donc :
- **vue `v_demandes`** (UNION des 5 tables) : circuit, numéro, demandeur, destinataire, statut commun, motif, créée, répondue, échéance ;
- **motifs fermés communs** (`src/motifs.js`) ; `transferts.motif_refus_code` ajouté (le texte libre existant est conservé, plus saisi) ;
- **`src/demandes.js`** : lecture, échéance commune, alerte de dépassement.

### B.3 Mouvement
Vue `v_mouvements` (transferts, hébergements admis, coordinations, transports). Nouvelles tables seulement pour le nouveau : `evacuations_residents`, `rapatriements`.

### B.4 Transport
`unites_secours.type_vehicule` (`ambulance`, `avion`, `transport_adapte`, `autre`) ; `organisations_secours.type` élargi à `transport_adapte` ; `etats_vehicules.etat` élargi à `en_preparation`, `desinfection`.

### B.5 Horloge
Table **`horodatages`** immuable (même déclencheur que `journal`) : `objet`, `objet_id`, `etape` (code fermé : `H11`…`H15`, `decision`, `depart`, `arrivee`…), `heure` (heure de la position, pas de la réception), `source` (`position`, `clic`, `connecteur`, `correction`, `systeme`), `auteur_id`, `motif_correction` (fermé), `remplace_id`, `heure_detectee`.
`horloge.marquer(...)` est appelée dans la même transaction que le changement d'état. Vue `v_horodatages_courants`. Les colonnes `*_le` existantes restent.

### B.6 Activation SH
Nouveaux codes dans `MODULES` : `chrono` (dépend de `liaison_secours` côté hôpital, de `profil_ambulance` côté entreprise), `urgences_direct`, `transferts_suivi`, `transport_planifie`, `bourse_places`, `donnees_regionales`, `mode_crise`, `visites_confirmees` (`a_venir`), `eviter_transferts` (`a_venir`). Catalogue SH mis à jour.

**Tests du lot 0** : Horloge immuable, correction = nouvelle ligne avec auteur, `v_demandes` complète, nouveaux types créables et activables depuis SH, droits de la direction régionale.
**Heures : 16 h.**

---

## C. Les modules : écrans, règles, tests, heures

> Définitions H11 à H15 et cibles (20, 25, 45 min) reprises du cahier, pensées d'abord pour le Québec ; elles vivent dans le **profil de pays** (autre pays = autres repères et cibles). À valider avec un établissement, une entreprise et le CCS avant usage réel.

### C.1 Chrono — 22 h (+ 3 h OG/Sillage)

**Écrans**
- Urgence : « En route » (arrivée prévue) et « À la porte » avec chrono (vert, orange à 15 min, **rouge à 20 min**) ; boutons « Début triage » (H12), « Fin triage » (H13), « Civière libérée » (H14), un clic chacun ; « Corriger l'heure » (motif fermé).
- Ambulance, entreprise et CCS : **les mêmes heures, le même chrono** (l'entreprise ne voit que ses véhicules).
- Rapport mensuel par hôpital, entreprise, région : moyennes, médianes, % hors cible (H11→H14 ≤ 20, H14→H15 ≤ 25, total ≤ 45), taux de complétude, CSV.
- Contrôle des écarts entre heure saisie et heure détectée.

**Règles**
- Zone par hôpital (`etablissements.zone_rayon_m`, 200 m par défaut, réglable) ; **H11 = première position dans la zone, confirmée par une 2ᵉ position** ou par « Arrivée » de l'équipage ; **H15 = première position hors zone après H14** ; heure retenue = heure de la position.
- Ambulance sans préalerte qui entre dans la zone : passage Chrono avec le numéro d'unité seulement.
- Ordre H12 < H13 < H14 imposé ; étape oubliée = correction tracée, jamais inventée.
- Arrimo mesure, ne calcule **aucune** prime ni pénalité.
- Fonctionne seul (positions du téléphone) ou branché (Arrimo Connect : heures envoyées par le système de l'entreprise, source `connecteur`).

**Tests** : entrée et sortie de zone (bruit GPS, position isolée), ordre des étapes, correction immuable, écarts, rapport avec étapes manquantes, CSV, cloisonnement entreprise / hôpital, module non activé refusé, interface (rouge à 20 min, téléphone et ordinateur), démarquage (même heure côté urgence et côté ambulance).

### C.2 Urgences en direct — 26 h (+ 3 h OG/Sillage)

**A) Dans le module Secours (CCS, ambulances, hôpitaux) — 8 h**
- Nouvel état déclaré **`fermee_temporairement`** + `reouverture_prevue_le` (en plus de ouvert, capacité limitée, saturation, délestage).
- Table **`fermetures_urgence`** : début, fin prévue, services touchés (liste fermée : pédiatrie, obstétrique, imagerie, santé mentale, toute l'urgence…), statut (planifiée, en cours, terminée, annulée), auteur.
- Une fermeture **planifiée** prévient automatiquement (notification + flux en direct + webhook Connect) le CCS de la région, les entreprises ambulancières de la région et les **urgences voisines** (les N plus proches, réglable), qui peuvent ajuster leur personnel ; rappel à H-1.
- « Urgences classées » (`src/vehicules.js`) : une urgence fermée est écartée et l'**urgence ouverte la plus proche** est proposée, avec la raison affichée ; un service touché écarte l'urgence pour la catégorie concernée.

**B) Page publique « Urgences en direct » + API — 18 h**
- Page publique sans compte, FR/EN, pensée pour le téléphone : état de chaque urgence (ouverte, capacité réduite, fermée temporairement avec heure de réouverture), services touchés, **heure de la dernière mise à jour bien visible** (une déclaration trop ancienne est marquée « non à jour », jamais présentée comme actuelle).
- Quand une urgence n'est pas ouverte : **l'urgence ouverte la plus proche** et les **autres options** (811, cliniques, pharmacie ; liste tirée du profil de pays, donc multi-pays).
- Fermetures planifiées annoncées à l'avance.
- **API ouverte** en lecture (`/api/public/v1/urgences`, JSON, versionnée) pour les médias, le 811 et les applications : sans compte, mise en cache (60 s), limite de débit, licence et attribution affichées.
- Publication **par choix de l'établissement** (module activé dans SH) : une urgence n'apparaît pas tant qu'elle n'a pas accepté d'être publiée. Aucune donnée de patient : seulement l'état, les services et les heures.
- Mention claire : « En cas d'urgence vitale, appelez le 911 » (numéro du profil de pays).

**C) Lire les données publiques existantes — étude, rien d'implanté**

| Source | Techniquement possible ? | Ce qu'on y trouve | Limites |
|---|---|---|---|
| **MSSS — « Fichier horaire des données de la situation à l'urgence »** (Données Québec) | **Oui.** Deux fichiers CSV mis à jour **chaque heure** (`Releve_horaire_urgences_7jours.csv` et la version avec le nombre de personnes), téléchargeables par URL fixe ; Données Québec offre aussi une API de type CKAN. Lecture planifiée (1 fois/heure), sans compte. | Par installation : civières fonctionnelles, patients sur civière, taux d'occupation, séjours, heure d'extraction et de mise à jour (source : Console provinciale des urgences). | Licence **CC-BY 4.0** (attribution obligatoire : à afficher). **Pas d'état « fermée » ni de services touchés** : seulement l'occupation. Retard d'environ une heure. Certaines régions signalées comme non disponibles (Mauricie–Centre-du-Québec, Nord-de-l'Île-de-Montréal, à revérifier). Correspondance à faire entre le nom d'installation du MSSS et les établissements Arrimo (table `correspondances_urgences_publiques`). |
| **MSSS — fichier cumulatif des urgences** | Oui (CSV, mise à jour mensuelle) | Historique | Utile pour le module Données, pas pour le direct. |
| **ERstat** | **Pas d'API publique trouvée.** Leurs pages indiquent que leurs données québécoises viennent de Santé Québec (Index santé) et de la Console provinciale des urgences, c'est-à-dire des mêmes données ouvertes. | — | Il faudrait leur écrire pour un accès ; **ne pas extraire leurs pages** (conditions d'utilisation). Le plus simple est de lire directement la source ouverte du MSSS. |
| **Index santé / quebec.ca « Situation dans les urgences »** | Pages web alimentées par la même console ; pas d'API documentée trouvée. | — | À vérifier ; ne pas extraire les pages sans autorisation. |

**Proposition (après vérification des conditions d'utilisation)** : lecteur horaire du CSV du MSSS (8 h de plus) pour afficher, à côté des urgences branchées sur Arrimo, les urgences qui ne l'utilisent pas encore, avec la mention « Source : MSSS, Données Québec, CC-BY 4.0, mis à jour à HH:MM » et l'occupation seulement (jamais d'état « fermée » inventé).

**Tests** : fermeture planifiée → avis aux bons destinataires seulement (région), urgence fermée écartée du classement avec raison, réouverture automatique à l'heure prévue (ou rappel si non confirmée), page publique sans aucune donnée interne, API (cache, limite, format stable), déclaration ancienne marquée « non à jour », FR/EN, téléphone, une urgence non consentante absente.

### C.3 Transferts (centrale des transferts urgents et rapatriements) — 24 h (+ 3 h)

**Écrans** : fiche de transfert **unique**, vue en même temps par l'hôpital demandeur, l'hôpital receveur, la coordination et le transporteur ; lit receveur en direct avec acceptation ; état du transport en direct (disponible, en préparation, parti, arrivé) ; bandeau d'alerte ; **centrale** : file régionale des transferts urgents (coordination, CCS) ; « Proposer un rapatriement ».

**Règles** : lien transfert ↔ préalerte ou demande de transport (lien simple, § 14.3) ; alertes de blocage (aucun lit receveur après X min, véhicule indisponible, civière en désinfection) ; **rapatriement proposé, jamais déclenché**, quand l'équipe marque « stable pour retour », vers l'hôpital de la région d'origine, proximité d'abord ; délai décision → départ → arrivée depuis l'Horloge ; motif de refus fermé.

**Tests** : les 4 acteurs voient la même fiche et seulement elle ; alertes levées et déclenchées ; rapatriement proposé, accepté, refusé ; délais ; aucune régression des tests de `services.js`.

### C.4 Transport non urgent — 16 h (+ 3 h)

**Écrans** : « Réserver un transport » (hôpital, résidence) : date, plage, type de véhicule (ambulance, transport adapté, autre), accessibilité, accompagnateur ; côté transporteur : accepter avec plage confirmée ou refuser (motif fermé) ; suivi en direct ; sur la fiche du lit : « Transport confirmé 9 h-10 h ».

**Règles** : `demandes_transport.coordination_id` devient facultatif (`motif_transport` : retour à domicile, transfert stable, départ NSA, retour CHSLD) ; réservation la veille recommandée ; transport confirmé → lit `attente_transport` (via `regles.js`) ; prise en charge → départ du lit ; petite entreprise : un seul compte qui fait tout.

**Tests** : demande sans coordination, plage confirmée, refus motivé, lit « à libérer » puis libéré, le transporteur ne voit que la référence et les lieux, idempotence, horodatages.

### C.5 Bourse des places (destinations élargies) — 24 h (+ 3 h)

**Destinations** : RPA, RI, RTF, CHSLD privés (conventionnés ou non), maisons de soins palliatifs, HAD, lits psychiatriques, ressources en santé mentale — **même moteur**, nouveaux types (B.1).

**Écrans** : bourse (places libres et à venir, filtres par type, besoins, distance) ; **fiche de transfert d'une page** (tranche d'âge, besoins en catégories, orientation, date souhaitée ; imprimable, **sans diagnostic**) ; vue de groupe ; page invitée.

**Règles**
- Classement = besoins couverts + proximité (+ langue, préférence de la famille, délai) ; **jamais d'abonnement, de licence ni de paiement dans le calcul** ; la raison est affichée partout, y compris aux invités.
- Besoins de santé mentale : catégories fermées et minimales (ex. « milieu encadré », « suivi d'intensité variable »), jamais de diagnostic ; à valider.
- **Lien invité** : nominatif, expire après 7 jours, courriel professionnel, accès limité à la bourse et à l'envoi d'une demande, journalisé, révocable.
- Groupe : une demande refusée peut être **proposée** à une autre résidence du groupe ; l'hôpital est averti et garde la main.

**Tests** : abonné et non abonné identiques = même score ; l'invité est refusé partout ailleurs ; jeton expiré ou révoqué refusé ; fiche sans texte clinique ; redirection de groupe ; nouveaux types présents ; FR/EN.

### C.6 Données (avec listes d'attente) — 16 h (+ 3 h)

**Écrans** : tableaux par région et par établissement : délais Chrono, transferts, jours NSA, places, refus par motif, **listes d'attente par type de ressource et par région** (nombre de personnes en attente, ancienneté médiane, places libres en face) ; filtres de période ; CSV.

**Règles** : agrégats calculés depuis l'Horloge et les tables existantes (liste d'attente = épisodes NSA ouverts + demandes d'hébergement en cours, par orientation) ; **cellule masquée sous 5** ; aucune référence patient ; direction régionale : sa région seulement. Possibilité de comparer avec le fichier cumulatif du MSSS (après vérification des conditions).

**Tests** : sommes cohérentes avec le détail, masquage, CSV sans référence, cloisonnement régional, liste d'attente cohérente avec les épisodes NSA.

### C.7 Mode crise — 24 h (+ 3 h)

**Écrans** : « Déclencher une évacuation » (direction régionale ou établissement) ; toutes les places libres de la région en un écran ; liste des résidents évacués, un lieu proposé par résident (classement de la bourse) à confirmer ; suivi (où, comment, heure) ; retour planifié ; état des avis aux familles.

**Règles** : proposition = suggestion confirmée par un humain ; réservation par les règles existantes ; transport par le module Transport ; familles avisées par Arrimo Famille (catégories autorisées) ; levée de crise journalisée.

**Tests** : déclenchement réservé aux rôles autorisés, proposition qui respecte les besoins, double réservation impossible, suivi et retour, avis aux familles, levée.

### C.8 Visites confirmées — audit seulement (A.3), construction plus tard : 26 h

### C.9 Éviter les transferts inutiles — plus tard (A.4) : 18 h

### C.10 SH — nouvel écran d'activation des modules — 10 h

Remplace les cases à cocher de la fiche établissement (`public-sh/sh.js:296` et `:393`) par une **grille de cartes**. Rien d'autre ne change dans SH.

| Carte | Codes existants regroupés | État aujourd'hui |
|---|---|---|
| 🏥 Hôpital | `lits`, `admissions_hopital`, `transferts`, `urgence`, `nsa`, `nettoyage`, `national` | disponible (sous-interrupteurs dans la carte) |
| 🏡 Hébergement | `residents`, `chambres`, `demandes_hebergement`, `entretien_chsld`, `taches`, `hospitalisations`, `reseau_chsld` | disponible |
| 🚑 Secours | `liaison_secours`, `transport_ambulancier`, `profil_ccs`, `profil_ambulance` | disponible |
| 👨‍👩‍👧 Famille | `proches`, `portail_proches`, `messagerie_securisee` | disponible |
| ✨ OG | `og` | inclus (licence) |
| 🧭 Sillage | (nouveau drapeau `sillage`) | disponible |
| 🔌 Arrimo Connect | (nouveau drapeau `connect`) | disponible |
| 🎓 Formation | (parcours SH existant) | disponible |
| ⏱️ Chrono · 🚨 Urgences en direct · 🔁 Transferts · 🚐 Transport · 🛏️ Bourse des places · 📊 Données · 🆘 Mode crise | nouveaux codes (B.6) | **Bientôt** jusqu'à leur livraison |
| ✅ Visites confirmées · 🛡️ Éviter les transferts inutiles | nouveaux codes | **Bientôt** |

- Carte : grand emoji, nom, une ligne de description, **interrupteur** avec le mot « Activé » / « Désactivé » à côté (sarcelle `#159895` activé, gris `#94A3B8` désactivé ; jamais la couleur seule ; accessible au clavier, `role="switch"`, `aria-checked`).
- Désactiver → confirmation « Les utilisateurs de cet établissement perdront l'accès à … » ; activer et désactiver → journal SH avec l'auteur (déjà en place, détail par module ajouté) puis transmission à l'environnement (existant).
- Dépendances : interrupteur bloqué avec la raison (« Chrono exige Secours ») et un bouton « Activer Secours aussi » ; désactiver un module dont un autre dépend → la confirmation nomme les deux.
- Modules pas construits (`a_venir`, `etude`) : carte grisée, étiquette « Bientôt », interrupteur désactivé.
- Filtre en haut : **Tous / Activés / Bientôt** ; grille sur une colonne au téléphone ; FR/EN.
- Seules les cartes qui s'appliquent au type d'établissement apparaissent (ex. Chrono pour un hôpital ou une entreprise ambulancière, pas pour une RPA).

**Tests** : rendu des 17 cartes selon le type, filtre, confirmation de désactivation, dépendance bloquante puis activée ensemble, carte « Bientôt » non activable (y compris par l'API : refus côté serveur), journal avec auteur, FR/EN, test d'interface au téléphone, ancienne route de cases (`PUT /hopitaux/:id/modules`) inchangée.

### C.11 Garantie de continuité — 18 h

**Export des données d'un client (12 h)**
- Depuis SH, fiche établissement : « Exporter toutes les données » → archive ZIP avec un **CSV par table** et un **JSON** complet, plus un fichier `LISEZMOI` qui décrit chaque colonne (dictionnaire de données généré depuis `db/schema.sql`).
- Contenu : tout ce qui appartient à l'établissement (structure, comptes sans mots de passe ni secrets, lits, historiques, journal, demandes, horodatages, indicateurs) ; **jamais** les empreintes de mot de passe, clés, jetons ni secrets de connexion.
- Route d'environnement `GET /sh/etablissements/:code/export` (clé SH existante), archive transmise à SH, lien de téléchargement à usage unique et limité dans le temps, journalisé (qui, quand, taille, empreinte SHA-256).
- Réservé à l'administration SH ; en production, l'archive contient des renseignements personnels : chiffrée, remise au responsable désigné du client (portabilité, Loi 25).

**Dossier d'entiercement (6 h)** — `docs/ENTIERCEMENT.md` et un script de vérification :
- prérequis (Node.js, PostgreSQL, Nginx, systemd), variables d'environnement (noms seulement, jamais de valeurs) ;
- installation pas à pas (`deploy/installer.sh`), environnements (`src/environnement.js`), premier compte (`db/premier-compte.js`) ;
- base de données : schéma, migrations, sauvegarde et restauration (`deploy/sauvegarde.sh`, `deploy/restaurer.sh`), journaux immuables ;
- console SH et ses migrations ;
- tests (`npm test`, interface) ;
- carte de l'architecture (fichiers et responsabilités) ;
- procédure de remise du dépôt (archive signée + empreinte) ; contrat d'entiercement à faire rédiger par un avocat.

**Tests** : l'archive contient toutes les tables de l'établissement et aucune donnée d'un autre ; aucun secret (recherche de motifs) ; JSON et CSV relisibles ; lien à usage unique ; journal.

### C.12 Activation dans la démo et référence — 2 h par module livré

Hôpitaux A, B, C (HX, HY, HC) : Chrono (urgence), Urgences en direct, Transferts, Bourse (lecture) · CHSLD des Érables et Saint-Laurent : Bourse · DEMO-AMB : Chrono, Transport · DEMO-CCS : Transferts (vue), Urgences en direct · à créer une fois : 1 RPA, 1 maison de soins palliatifs, 1 programme HAD, 1 ressource en santé mentale, 1 direction régionale. Après chaque module : script de préparation, scénario de 14 étapes rejoué, nouvelle référence de démo, droits de publication complétés. **Pas avant le vendredi 20 nov.**

---

## Récapitulatif des heures (nouvel ordre)

| Ordre | Lot | Heures | OG + Sillage | Total |
|---|---|---|---|---|
| 0 | Moteur commun | 16 | — | 16 |
| 1 | ⏱️ Chrono | 22 | 3 | 25 |
| 2 | 🚨 Urgences en direct (Secours 8 + page et API 18) | 26 | 3 | 29 |
| 3 | 🔁 Transferts (centrale, rapatriements) | 24 | 3 | 27 |
| 4 | 🚐 Transport non urgent | 16 | 3 | 19 |
| 5 | 🛏️ Bourse des places (destinations élargies) | 24 | 3 | 27 |
| 6 | 📊 Données (listes d'attente) | 16 | 3 | 19 |
| 7 | 🆘 Mode crise | 24 | 3 | 27 |
| — | SH : écran d'activation en cartes | 10 | — | 10 |
| — | Garantie de continuité (export 12 + entiercement 6) | 18 | — | 18 |
| — | Activation démo et scénario (7 × 2 h) | 14 | — | 14 |
| | **Total à construire** | | | **231 h** |
| 8 | ✅ Visites confirmées (audit fait ; plus tard) | 26 | 3 | *29* |
| 9 | 🛡️ Éviter les transferts inutiles (plus tard) | 18 | 3 | *21* |
| — | Lecteur du CSV du MSSS (après vérification des conditions) | 8 | — | *8* |
| | **Total avec les lots « plus tard »** | | | **289 h** |

Estimations de développement et de tests, hors relecture et décisions de Moustafa.

### Ce qui change par rapport à la version 1 (140 h)
- **Ordre** : Chrono, **Urgences en direct**, Transferts, Transport, Bourse, Données, Mode crise (Transferts passe avant Transport ; les états de véhicule « en préparation » et « désinfection » passent donc au lot 0).
- **Ajouts (+91 h au total)** : Urgences en direct (+26 h), écran SH en cartes (+10 h), garantie de continuité (+18 h), OG et Sillage dans chaque module (+21 h), centrale des transferts (+4 h), types psychiatrie et santé mentale (+2 h lot 0, +4 h bourse), listes d'attente (+4 h), une activation démo de plus (+2 h).
- **Audit / plus tard** : Visites confirmées (audit fait, 29 h estimées), Éviter les transferts inutiles (21 h), lecteur MSSS (8 h).
- **Abandon retiré** : la page publique est **gardée** (deuxième consigne de Moustafa).

---

## D. Ordre et raisons

0. **Moteur commun** : l'Horloge, les régions et les états de véhicule servent à tout ; les faire dans le Chrono obligerait à les refaire.
1. **Chrono** : priorité de Moustafa, pensé pour le Québec.
2. **Urgences en direct** : réutilise la zone, l'Horloge et le statut déclaré ; la fermeture planifiée améliore aussitôt le classement des urgences du Chrono et du CCS.
3. **Transferts**, 4. **Transport**, 5. **Bourse**, 6. **Données**, 7. **Mode crise** : chacun réutilise le précédent (la crise utilise la bourse, le transport et les données régionales).
- **Écran SH en cartes** : à faire **tôt** (juste après le lot 0) : toutes les cartes « Bientôt » sont alors visibles, et chaque module livré n'a qu'à passer sa carte à « disponible ».
- **Garantie de continuité** : indépendante, peut se faire à tout moment ; je propose après le Chrono, car c'est un argument de vente pour les premiers clients.

---

## E. Risques

| Risque | Mesure proposée |
|---|---|
| Position imprécise | Zone réglable, deux positions de suite, confirmation par l'équipage, source affichée, écarts listés. |
| Réseau faible | Heure de la position sur le téléphone ; positions en attente rejouées (`public/sw-secours.js`) ; heure future ou trop ancienne refusée. |
| Clics oubliés | Rappel ; saisie après coup = correction tracée ; taux de complétude ; une étape absente n'est jamais estimée. |
| Primes et pénalités (Chrono, Visites) | Arrimo mesure, ne calcule aucune pénalité ; définitions validées par écrit ; heures immuables, mêmes pour tous ; mention « indicatif » avant validation. |
| **Page publique : une information fausse ou périmée peut détourner un patient** | Heure de mise à jour visible ; « non à jour » au-delà du seuil ; 911 toujours affiché ; publication seulement si l'établissement l'a acceptée ; aucune estimation d'attente inventée ; avis juridique avant la mise en ligne réelle. |
| API ouverte (abus, charge) | Lecture seule, cache, limite de débit, aucune donnée interne, versionnée. |
| Données du MSSS | Licence CC-BY 4.0 (attribution) ; occupation seulement, jamais d'état « fermé » déduit ; régions manquantes affichées comme telles ; conditions vérifiées avant d'implanter. |
| Neutralité de la bourse | Formule affichée ; aucun champ commercial lu (test) ; invités et abonnés voient le même ordre. |
| Santé mentale et psychiatrie | Catégories minimales, sans diagnostic ; plus sensibles encore au regard de la Loi 25 ; à valider. |
| Éviter les transferts inutiles | Liste fournie par l'établissement, aucune recommandation clinique d'Arrimo, l'appel n'est jamais bloqué. |
| Export des données | Aucun secret ; lien unique et limité ; chiffré en production ; journalisé. |
| Loi 25 | EFVP complétée (besoins, positions des équipages et des intervenants, lien invité, export) ; agrégats masqués sous 5 ; aucune vraie donnée avant l'hébergement au Canada. |
| Décision du 12 nov. (pas de fusion) | Vues de lecture communes au lieu d'un objet unique. |
| Démo gelée jusqu'au 19 nov. | Branches seulement ; aucune activation démo avant le 20 nov. |
| Taille | 231 h ; chaque module livré, testé et validé séparément ; scénario de 14 étapes rejoué chaque fois. |

---

## Décisions demandées à Moustafa (avant jeudi)

1. Demande commune = **vues de lecture, sans fusion** : oui / non.
2. Direction régionale = **table à part** `directions_regionales` : oui / non.
3. Écran SH en cartes juste après le lot 0 : oui / non.
4. Page publique : publication seulement pour les urgences qui l'acceptent, et avis juridique avant la mise en ligne réelle : oui / non.
5. Avec qui valider H11 à H15 et les cibles 20 / 25 / 45 min.
6. « Oui » pour commencer jeudi : lot 0 puis Chrono, sur la branche `moteur-commun-20261119`.
