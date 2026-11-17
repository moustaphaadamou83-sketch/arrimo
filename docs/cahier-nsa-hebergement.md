# Cahier — Parcours NSA vers l'hébergement

**Étape 1 : audit et plan seulement. Rien n'est construit.**
Date : 17 nov. 2026 · Base auditée : branche `prehospitalier-20261112`, commit `3ab4141`.

Règles du cahier : démo `demo_abc` gelée jusqu'après la rencontre ; travail futur sur une branche dédiée (`nsa-hebergement`), jamais en production sans le « oui » de Moustafa ; autres sites intouchables ; aucun secret affiché ; données fictives seulement.

Principe directeur : **Arrimo ne décide jamais de l'orientation.** L'équipe (médecin, travailleur social) et le mécanisme d'accès à l'hébergement décident. Arrimo enregistre, propose des places compatibles, explique pourquoi ; l'équipe choisit. Aucun envoi automatique, aucun classement clinique.

Données minimales (Loi 25) : aucun diagnostic. Des **catégories de besoins** en listes fermées. À noter : même sans diagnostic, « oxygène », « errance » ou « soins particuliers » restent des renseignements de santé au sens de la Loi 25. Ils doivent donc figurer dans l'EFVP (`docs/LOI25_REGISTRE_ET_EFVP.md`), être visibles seulement de la coordination de l'hôpital et de la ressource destinataire, et ne jamais apparaître dans le journal, les notifications, Arrimo Famille ni l'écran de l'entretien.

---

## A. Ce qui existe pour chacun des 11 points

| # | Point | État | Ce qui existe (fichiers) | Ce qui manque |
|---|---|---|---|---|
| 1 | Statut NSA, date de début, compteur de jours | **Partiel** | `lits.nsa_depuis`, `lits.nsa_orientation` (`db/schema.sql:266`) ; `designerNsa` / `retirerNsa` / `changerNsaOrientation` (`src/terrain.js:44`) ; onglet NSA avec jours, taux et cible (`listeNsa`, `detailNsa`) ; badge sur la carte du lit (`public/app.js:1088`) ; journalisé. | La date de début est toujours `now()` : on ne peut pas saisir « NSA depuis le 3 nov. ». Le statut vit sur le **lit**, pas sur l'épisode du patient : un changement de lit fait perdre l'historique. Le déclarant (rôle « équipe ») n'est pas distingué. |
| 2 | Orientation choisie par l'équipe | **Partiel** | Liste fermée `chsld, ri, readaptation, domicile, palliatif, autre` (`db/schema.sql:268`, libellés dans `src/langue.js:22`). | Pas de distinction CHSLD public / privé conventionné / privé ; RTF, RPA et maison des aînés absents ; pas de « place transitoire en attendant la permanente » ; pas d'historique des changements d'orientation (seulement le journal). |
| 3 | Besoins en catégories, sans diagnostic | **Absent** | Côté CHSLD seulement, après l'admission : `residents.accessibilite` (fauteuil, déambulateur, lève-personne, lit électrique, malentendant, malvoyant). Les besoins de `demandes_admission` (isolement, ventilation…) concernent les soins aigus. `evaluations_fictives` est en texte libre et réservé à la démo. | Aucune grille de besoins NSA (mobilité, unité sécurisée, oxygène, soins particuliers, sexe de la chambre, langue, secteur, jusqu'à 3 milieux préférés). |
| 4 | Recherche de places et classement, 3 meilleures avec la raison | **Partiel (faible)** | `destinations()` (`src/nsa-chsld.js:35`) : CHSLD actifs avec le module « demandes d'hébergement », du plus proche au plus loin, avec le **nombre** de lits libres. | Pas de filtre par type de ressource ; pas de compatibilité avec les besoins ; aucune place « qui va se libérer » ; pas de secteur de la famille, de délai ni de préférences ; OG ne propose pas les 3 meilleures et ne donne pas de raison. |
| 5 | Demande, acceptation ou refus motivé, délai mesuré, proposer la suivante | **Partiel** | `orienter()` crée une `demandes_hebergement` (provenance `hopital`) ; étapes CHSLD documents → vérification → place proposée (réservée) → acceptée / refusée / annulée (`src/chsld.js:456`) ; avis à l'hôpital (`avertirHopital`) ; une seule demande ouverte par lit et patient. | Motif de refus en **texte libre** (risque d'y voir une information clinique) au lieu d'une liste fermée ; délai de réponse non mesuré (seul le délai jusqu'à l'admission existe) ; rien ne propose la ressource suivante après un refus. Ambiguïté : c'est le CHSLD qui clique « Proposition acceptée », l'hôpital et l'usager n'ont pas d'étape pour accepter ou décliner la place proposée. |
| 6 | Organisation du départ : date, heure, transport, documents, famille | **Partiel** | `arrivee_souhaitee` (date seule) ; 5 documents suivis (`DOCUMENTS`, `src/chsld.js:26`) ; `confirmerDepart` ; transports ambulanciers depuis l'hôpital (`src/transports.js`) ; Arrimo Famille et le portail des proches existent, côté ressource. | Heure de départ, mode de transport et lien vers la demande de transport ; liste des documents **à transmettre** par l'hôpital (aujourd'hui, c'est ce que le CHSLD a reçu) ; avis à la famille avant l'admission (les proches n'existent qu'une fois le résident créé à la ressource). |
| 7 | Admission : lit d'hôpital « à libérer » → libre ; place de la ressource occupée | **Fait, à affiner** | Départ confirmé → lit d'hôpital en nettoyage par `regles.js` (`src/nsa-chsld.js:96`) ; arrivée refusée tant que le départ n'est pas confirmé ; place réservée → occupée ; demande « admise » ; hôpital averti (`src/chsld.js:359`). | L'état intermédiaire « à libérer » n'est pas montré quand la place est acceptée : on peut réutiliser `lits.conge_statut` (`prevu` → `attente_transport`) pour que le tableau des lits et les prévisions (`src/previsions.js:71`) le voient. |
| 8 | Retour : chambre conservée, retour préparé | **Fait (à revérifier)** | Moteur `coordinations` : hospitalisation, retour, place conservée (`conservation_place_jours`), réintégration bloquée tant que la chambre n'est pas prête (`etatReintegration`), Arrimo Sillage en six étapes (`src/continuite.js`), OG (`src/og-chsld.js`). | Vérifier que ça fonctionne pour une RPA, une RI ou une RTF (même moteur) et pour un patient venu par le parcours NSA ; ajouter un test de bout en bout. |
| 9 | Indicateurs : jours NSA, délai pour trouver une place, refus et motifs, lits libérés, par semaine et par ressource | **Partiel** | Jours NSA par lit, taux, cible et jours-lits (`src/terrain.js:504`, tableau d'indicateurs et CSV) ; délai moyen demande → admission côté CHSLD (`src/chsld.js:1074`). | Délai déclaration NSA → place trouvée ; refus par motif ; délai de réponse par ressource ; lits d'hôpital libérés ; découpage par semaine et par ressource ; vue réseau. |
| 10 | Côté ressource : places libres et à venir, capacités, demandes, arrivées prévues | **Partiel** | Places et états (`places()`), demandes reçues et traitement, arrivées en préadmission (accueil), unité prothétique `PROT` (sécurisée) dans les types d'unité CHSLD, `chambres.attributs` en JSON libre. | Pas de déclaration de **places à venir** (départ prévu, date) ; capacités non structurées (lève-personne, oxygène, unité sécurisée, sexe, langues) ; pas de délai d'admission déclaré. |
| 11 | Lien futur avec Epic | **Absent (fondation présente)** | Réception HL7 ADT traduite en JSON (`src/connecteurs.js`, `src/hl7v2.js`), FHIR (`src/fhir.js`), Arrimo Connect signé (`src/connect.js`). | Aucune correspondance pour le statut NSA ni pour l'admission en hébergement. Saisie simple dans Arrimo pour l'instant, comme demandé. |

**Bilan A** : 2 points faits (7, 8), 7 partiels (1, 2, 4, 5, 6, 9, 10), 2 absents (3, 11). La boucle hôpital → CHSLD → départ → arrivée existe et elle est journalisée (16 nov.) ; ce qui manque, c'est **l'intelligence de la recherche** (besoins, capacités, places à venir, classement expliqué) et **la mesure** (délais, refus).

---

## B. RPA, RI, RTF, maisons des aînés : ce qui manque pour qu'ils soient opérationnels comme les CHSLD

Ce qui existe aujourd'hui :
- Les types `rpa`, `ressource_intermediaire`, `maison_aines` sont déclarés, mais au statut **« à venir » : leur création est refusée** (`src/types-etablissement.js:14`). RTF n'existe pas comme type.
- La voie réellement utilisée est un établissement de type `chsld` avec un `type_local_code` (`rpa`, `ri`, `rtf`, `maison_aines`…) : **même moteur, mêmes écrans, seul le nom affiché change** (`nommer()`). Une RPA de démonstration existe (`peuplerDemoRpa`, `src/demo-chsld.js:110`).

Ce qui manque :
1. **Le type compte, pas seulement le nom.** La recherche NSA (`destinations()`) prend tout ce qui est `chsld` : une RPA y apparaît comme un CHSLD. Il faut filtrer et classer selon le type de ressource et le statut (public, privé conventionné, privé), et associer chaque orientation aux types de ressources admissibles.
2. **Le circuit d'admission diffère.** CHSLD, RI et RTF passent par le mécanisme d'accès (documents et étapes actuels). Une RPA, une maison des aînés privée ou un CHSLD privé non conventionné, c'est un choix de l'usager ou de la famille et un bail ou un contrat : les étapes et les documents (`DOCUMENTS`) doivent être configurables par type.
3. **Des unités adaptées à la taille.** Une RTF accueille de 1 à 9 personnes dans une résidence familiale, sans équipe d'entretien ni coordination : il faut des rôles allégés (un responsable qui fait tout), aucune tâche d'entretien imposée, et un écran sur téléphone. Une RPA, ce sont des logements ou des unités, pas des « lits ».
4. **Capacités déclarées** (commun à tous) : unité sécurisée, lève-personne, oxygène, chambre selon le sexe, langues offertes, accessibilité. Une RPA sans soins doit pouvoir déclarer « pas de lève-personne » pour ne jamais être proposée à tort.
5. **Places à venir** déclarées par la ressource (départ prévu, date estimée).
6. **Catalogue des modules** : dans `MODULES`, les modules communs et ceux du CHSLD ne visent que `['hopital', 'chsld']`. Il faut décider quels modules s'appliquent à chaque type (une RTF n'a pas besoin du réseau inter-CHSLD) et passer le statut des types à « opérationnel » seulement après les tests.
7. **SH** : création et activation de ces types depuis la console, profils de pays, catalogue facturable.
8. **Démonstration et tests** : au moins une RI, une RTF et une maison des aînés fictives, avec des capacités différentes, pour montrer un classement crédible ; tests d'API par type ; libellés en anglais.
9. **Thème** : vérifier que le thème CHSLD (`public/chsld.css`) convient aux autres types, ou décider d'en dériver un.

Recommandation : **garder un seul moteur** (celui du CHSLD) et ajouter une couche « profil de ressource » (type, statut, circuit, capacités, rôles), plutôt que quatre modules séparés. C'est cohérent avec ce qui existe et ça évite de dupliquer les règles.

---

## C. Le plan

### C.1 Tables (migrations idempotentes dans `db/schema.sql`, rejouables)

| Table / changement | Contenu | Remarques |
|---|---|---|
| `nsa_episodes` | `id, etablissement_id, lit_id, patient_ref, debut_le` (saisissable, au plus 365 jours en arrière, jamais dans le futur), `declare_par, orientation, sous_type, transitoire bool, statut (actif, place_trouvee, parti, retire), fin_le, version` | L'épisode suit le patient, plus seulement le lit. `lits.nsa_depuis` est conservé et synchronisé (compatibilité avec les vues et la démo actuelles). |
| `nsa_orientations` | Historique : `episode_id, orientation, sous_type, transitoire, motif_code, par, le` | Qui a changé l'orientation, quand. Codes fermés. |
| Orientation élargie | `chsld_public, chsld_prive_conventionne, chsld_prive, ri, rtf, rpa, maison_aines, domicile_soutien, readaptation, palliatif, autre` | On conserve les anciennes valeurs (`chsld` est lu comme `chsld_public`) : aucune donnée ne casse. |
| `nsa_besoins` | `episode_id, codes text[]` (liste fermée : `marchette, fauteuil, leve_personne, unite_securisee, oxygene, soins_particuliers`), `chambre_sexe (F, M, indifferent)`, `langue (fr, en, autre)`, `secteur_famille` (municipalité ou 3 premiers caractères du code postal), `preferences int[]` (au plus 3 établissements), `version` | **Aucun texte libre.** Accès : coordination de l'hôpital et ressource destinataire seulement. Jamais dans le journal (on y écrit « besoins mis à jour »). |
| `ressource_profils` | `etablissement_id, type_ressource, statut_ressource (public, conventionne, prive), circuit (mecanisme_acces, direct), capacites text[]` (mêmes codes que les besoins), `sexes_acceptes, langues text[], delai_admission_jours, accepte_transitoire bool` | Déclaré par la ressource. Sert à la compatibilité. |
| `places_a_venir` | `etablissement_id, lit_id (facultatif), date_prevue, certitude (confirmee, probable), motif_code (depart_prevu, transfert, autre), statut, version` | Sans identité ni motif clinique. Expire seule à J+1 si elle n'est pas confirmée. |
| `demandes_hebergement` (ajouts) | `episode_id, envoyee_le, repondue_le, motif_refus_code` (liste fermée : `capacite_insuffisante, besoin_non_couvert, place_plus_disponible, dossier_incomplet, choix_usager, autre`), `depart_prevu_le timestamptz, transport_id, documents_transmis jsonb, famille_avisee_le, acceptation_equipe_le` | Motif fermé à la place du texte libre (le texte libre reste interdit pour l'hôpital). |
| `lits.conge_statut` | Réutilisé : `prevu` quand la place est acceptée, `attente_transport` le jour du départ | État « à libérer » visible dans le tableau des lits et les prévisions. |

### C.2 Règles de classement (proposition, jamais décision)

1. **Filtre dur, jamais contourné** : type de ressource conforme à l'orientation choisie par l'équipe ; chaque besoin coché est couvert par une capacité déclarée ; sexe de la chambre compatible ; module actif ; place libre maintenant **ou** place à venir dans l'horizon choisi (14 jours par défaut, réglable par profil de pays). Une ressource exclue est listée à part avec la raison (« pas d'unité sécurisée »), pour que l'équipe le voie.
2. **Score** sur 100 (barème affiché, réglable dans la configuration du pays) :
   - préférence de l'usager ou de la famille : 1er choix 30, 2e 20, 3e 10 ;
   - proximité du secteur de la famille (à défaut, de l'hôpital) : 25 points à 0 km, puis dégressif jusqu'au rayon du profil ;
   - délai : place libre maintenant 25 ; à venir, de 20 à 5 selon la date ; délai d'admission déclaré soustrait ;
   - langue offerte : 10 ;
   - pénalité de 10 si la ressource a refusé une demande pour le même épisode.
3. **Égalité** : proximité, puis nom (classement stable, reproductible dans les tests).
4. **Explication en une phrase** produite à partir des mêmes composantes, par exemple : « 1er choix de la famille, 4 km du secteur Rosemont, place libre aujourd'hui, unité sécurisée disponible. »
5. **OG** montre les 3 meilleures avec leur phrase ; l'action « Envoyer la demande » reste un bouton humain, avec les mêmes règles que l'interface (`og-intentions-actions`). OG ne dit jamais « je recommande d'orienter vers… » : il dit « places compatibles avec l'orientation choisie par l'équipe ».
6. **Proximité d'abord**, fidèle à la règle permanente, mais la préférence de l'usager pèse plus que la distance : c'est l'usager qui vivra là.

### C.3 Écrans

| Où | Écran | Contenu |
|---|---|---|
| Hôpital, onglet NSA | Fiche de l'épisode | Date de début modifiable, jours NSA, orientation et sous-type, transitoire, historique. |
| Hôpital | Grille des besoins | Cases à cocher, sexe, langue, secteur, 3 milieux préférés (liste déroulante des ressources). |
| Hôpital | Places compatibles | Les 3 meilleures en tête, puis le reste ; libres maintenant et à venir ; ressources exclues avec leur raison ; « Envoyer la demande ». |
| Hôpital | Suivi des demandes | Statut, délai de réponse en direct, motif de refus, « Proposer la suivante » (ouvre la liste sans la ressource qui a refusé). |
| Hôpital | Organisation du départ | Date et heure, transport (crée une demande de transport ou « transport par la famille »), documents à transmettre (cases), « Famille avisée ». |
| Ressource | Profil et capacités | Type, statut, circuit, capacités, sexes acceptés, langues, délai d'admission. |
| Ressource | Places à venir | Ajout rapide : place, date, certitude. |
| Ressource | Demandes reçues | Existe : on y ajoute le besoin en catégories, le motif de refus fermé et le chronomètre de réponse. |
| Ressource | Arrivées prévues | Existe (préadmission) : on y ajoute l'heure et le transport. |
| Réseau / gestion | Indicateurs NSA | Par semaine et par ressource : jours NSA, délai pour trouver une place, délai de réponse, refus par motif, lits libérés. CSV. |
| Famille | Arrimo Famille | Étapes sans aucune information médicale : « Place trouvée », « Départ prévu le… », « Arrivé(e) ». |

### C.4 Ordre des étapes et heures

| Étape | Contenu | Heures |
|---|---|---|
| 0 | Branche `nsa-hebergement`, migrations (épisodes, orientations élargies, compatibilité avec `lits.nsa_*`), mise à jour de l'EFVP | 5 |
| 1 | Statut NSA par épisode : date de début saisissable, orientation et sous-type, transitoire, historique, onglet NSA mis à jour | 7 |
| 2 | Grille des besoins (codes fermés, préférences, secteur), droits d'accès, rien dans le journal | 6 |
| 3 | Profils de ressource : type, statut, circuit, capacités ; écran côté ressource (point B) | 9 |
| 4 | Places à venir : table, écran ressource, expiration | 5 |
| 5 | Moteur de recherche et de classement (`src/nsa-recherche.js`) : filtre, score, phrase d'explication, ressources exclues ; écran hôpital | 12 |
| 6 | OG : 3 meilleures et leur phrase, questions « où en est la demande », bouton humain | 4 |
| 7 | Demandes : envoi, motif de refus fermé, délai de réponse, acceptation de l'équipe, « proposer la suivante » (refonte de `nsa-chsld.js` en `nsa-hebergement.js`, tout reste compatible) | 10 |
| 8 | Organisation du départ : date et heure, transport (`transports.js`), documents transmis, famille avisée (Arrimo Famille) | 8 |
| 9 | Admission : lit d'hôpital « à libérer » (`conge_statut`) puis nettoyage puis libre, place de la ressource occupée, épisode clos | 4 |
| 10 | Retour : vérification pour RPA, RI et RTF, test de bout en bout | 3 |
| 11 | Circuits par type (documents et étapes configurables), rôles allégés pour une RTF, statut « opérationnel » des types (point B) | 8 |
| 12 | Indicateurs NSA par semaine et par ressource, CSV, vue réseau | 8 |
| 13 | Tests : API (`tests/api.test.js` et un fichier dédié), interface Chromium, bilingue, refus prouvés (aucune identité ni catégorie dans le journal ou les notifications) | 12 |
| 14 | Démo fictive : une RI, une RTF, une maison des aînés, un CHSLD privé conventionné, avec des capacités variées ; mise à jour du guide de démo | 5 |
| 15 | Epic : note de correspondance seulement (événements ADT de statut NSA, de congé et d'admission, avec le champ attendu), sans code | 2 |
| | **Total** | **108 h** |

Marge d'imprévus conseillée : 15 % (environ 16 h), soit **environ 124 h** au total.

Ordre de livraison suggéré, en lots testables :
- **Lot 1** (étapes 0 à 2) : NSA solide.
- **Lot 2** (3 à 6) : recherche expliquée.
- **Lot 3** (7 à 10) : boucle complète.
- **Lot 4** (11 à 15) : ressources, indicateurs, démo.

Chaque lot : `npm test` vert, revue, puis le « oui » de Moustafa avant toute publication (recette d'abord).

---

## D. Avant le pilote et pendant le pilote

**Avant le pilote** (étapes 0 à 14, démontrable sur données fictives, 106 h hors marge) :
- Lots 1, 2 et 3 au complet : statut NSA par épisode, besoins en catégories, profils de ressource, places libres **et** à venir, classement expliqué, 3 meilleures dans OG, demande avec refus motivé et « proposer la suivante », organisation du départ, lit « à libérer », retour vérifié.
- Indicateurs de base (jours NSA, délai pour trouver une place, refus par motif, lits libérés) par semaine et par ressource.
- RI, RTF et maison des aînés opérationnels sur le moteur commun, avec démo fictive.
- EFVP mise à jour pour les catégories de besoins.

**Pendant le pilote** (avec l'établissement, sur ses règles réelles ; seule la note Epic de 2 h est chiffrée, le reste dépend de l'établissement) :
- Barème du classement **validé par l'équipe** du pilote (poids des préférences, de la distance, horizon des places à venir) ; il reste réglable sans code.
- Délais d'admission et places à venir alimentés par les vraies ressources, puis prévision des libérations à partir de l'historique.
- Arrimage avec le mécanisme d'accès à l'hébergement de l'établissement (documents exigés, étapes, qui accepte quoi).
- Lien avec Epic (ADT : statut NSA, congés, admissions) avec l'équipe informatique de l'hôpital.
- Indicateurs comparés aux tableaux de bord de l'établissement ; export vers ses outils.
- Circuits privés (RPA, CHSLD privé) affinés avec de vraies résidences.
- Tout cela suppose l'hébergement au Canada et l'évaluation Loi 25 faits : **aucune vraie donnée avant**.

---

## Décisions de Moustafa (17 nov. 2026)

1. **Acceptation** : la ressource accepte, puis l'hôpital confirme (équipe avec l'usager ou la famille) : étape `acceptation_equipe_le` au lot C.
2. **Famille située par la municipalité**, jamais le code postal (fait au lot A : contrôle par l'API, aucun chiffre accepté).
3. **Sexe de la chambre facultatif**, « indifférent » par défaut (fait au lot A).
4. **Poids du classement : total 100, réglables par établissement sans code.** Proposition pour les 10 points manquants : **réactivité de la ressource** (délai médian de réponse aux demandes des 90 derniers jours : 10 points sous 24 h, dégressif jusqu'à 0 à 7 jours). Ce critère réduit directement les jours NSA et ne touche aucune donnée du patient. Barème par défaut : préférence 30, proximité 25, délai de la place 25, langue 10, réactivité 10 ; pénalité après refus pour le même épisode, à part. Réglage par établissement (lot B, table `nsa_poids`, écran Paramètres, total contrôlé à 100) : environ 3 h de plus au lot B.
5. **RTF = profil allégé sur le moteur commun.**
6. Loi 25 : catégories de besoins hors du journal et des notifications, ajoutées au registre (`docs/LOI25_REGISTRE_ET_EFVP.md`, fait au lot A).

## Lot A livré (branche `nsa-hebergement-lotA`, non publié)

- `nsa_episodes` : un épisode par patient NSA, ouvert, synchronisé et fermé par un déclencheur sur `lits` (« retiré » si le statut est enlevé, « parti » si le patient quitte le lit) ; il couvre aussi les scripts de démonstration. Reprise des lits déjà NSA.
- Date de début saisie par l'équipe (jamais future, au plus 365 jours) ; correction possible et journalisée ; une nouvelle désignation d'un lit déjà NSA est refusée (le compteur n'est jamais remis à zéro par erreur).
- Orientation élargie : `chsld` (CHSLD public, code historique conservé), `chsld_prive_conventionne`, `chsld_prive`, `ri`, `rtf`, `rpa`, `maison_aines`, `domicile`, `readaptation`, `palliatif`, `autre` ; place transitoire ; historique `nsa_orientations` (qui, quand).
- Besoins `nsa_besoins` : listes fermées, municipalité, sexe facultatif, langue, 3 milieux préférés ; accès équipe et coordination seulement.
- Déclaration, modification et retrait du statut NSA refusés au rôle entretien.

## Lot B livré (branche `nsa-hebergement-lotB`)

- **Côté ressource** (écran « Chambres et lits » d'un CHSLD, d'une RPA, d'une RI, d'une RTF ou d'une maison des aînés) : profil d'hébergement (statut public, conventionné ou privé, admission par le mécanisme d'accès ou directe, capacités, chambres mixtes ou réservées, langues, délai d'admission, places transitoires) et places à venir (date, certitude, place facultative ; ignorées le lendemain de la date). Aucune donnée de patient. Tables `ressource_profils`, `places_a_venir`.
- **Côté hôpital** (onglet NSA → « Places ») : places compatibles avec l'orientation choisie par l'équipe. Filtre strict : genre de ressource (et statut pour un CHSLD) ; tous les besoins couverts ; chambre selon le sexe ; ressource qui reçoit des demandes ; place libre ou à venir dans l'horizon (14 jours par défaut). Une place transitoire acceptée par l'équipe ouvre les ressources qui en offrent. Les milieux écartés sont listés avec leur raison.
- **Classement sur 100** (table `nsa_poids`, réglable par l'administration de l'établissement dans Paramètres, total contrôlé à 100) : préférence 30 / 20 / 10 selon le rang, proximité de la municipalité de la famille (à défaut, de l'hôpital) sur 100 km au plus, délai (libre maintenant : plein ; à venir : 80 % à 20 %, moins le délai d'admission), langue, réactivité (délai médian de réponse sur 90 jours ; sans historique : moitié des points) ; pénalité après un refus pour le même patient.
- **Explication** en une phrase, en français ou en anglais (« 1er choix de la famille, 5 km de Ville X, place prévue le 21 novembre (confirmée), besoins couverts… »). Les besoins ne sont jamais nommés à une ressource.
- **OG** : « Quelles places compatibles pour le lit X ? » → les 3 meilleures avec leur score et leur phrase ; l'envoi reste dans l'onglet NSA.
- **Envoi** : « Transmettre une demande » ouvre la fenêtre habituelle avec le milieu présélectionné ; l'humain confirme.
- **Limite connue** : la municipalité de la famille est localisée par les établissements connus d'Arrimo qui s'y trouvent ; sinon la distance est mesurée depuis l'hôpital (dit à l'écran). Un vrai géocodage viendra avec le pilote.

## Questions ouvertes pour Moustafa

1. **Qui accepte la place proposée ?** Aujourd'hui, c'est la ressource qui clique « Proposition acceptée ». Faut-il une étape « acceptée par l'équipe et l'usager » côté hôpital ? Le plan prévoit `acceptation_equipe_le`.
2. **Secteur de la famille** : municipalité, ou les 3 premiers caractères du code postal ? (Le code postal complet serait trop précis.)
3. **Sexe de la chambre** : c'est un renseignement personnel nouveau ; on le garde facultatif, avec la valeur « indifférent » par défaut ?
4. **Barème** : les poids proposés en C.2 vous conviennent-ils pour la démo ?
5. **RTF** : la créer comme type à part entière, ou rester sur `type_local_code` avec un profil allégé ? (Recommandation : profil allégé sur le moteur commun.)
