# Audit du DSN — 22 novembre 2026 (phase 1 : constat, aucune correction)

**Environnement :** copie isolée de la démo (base `audit_dsn`, restaurée depuis `reference-demo-ciusss-20261122-dsn.dump`), serveurs locaux `127.0.0.1:3099` (démo) et `127.0.0.1:3098` (pilote), configuration **sans aucun canal sortant** (courriel, notifications push, SH, support, IA d’OG retirés). Données entièrement fictives. Aucune donnée en ligne n’a été modifiée.

**Bilan :** 50 cas — **36 réussis**, **13 échecs**, 0 bloqués, 1 non testé.

Scripts rejouables : `audit-api.cjs` (API et base) et `audit-ui.cjs` (Chromium). Chaque cas a sa preuve dans `preuves/<ID>.json` (échanges API, statuts, état de la base) ou `preuves/<ID>.png`.

## 1. Tableau des résultats

| ID | Module | Cas | Attendu | Obtenu | Statut |
|---|---|---|---|---|---|
| DP-01 | Dossier patient | Création d’un patient fictif (fonction admission) | 200 ; référence unique P-xxxxx ; date de naissance exacte | statut 200, référence P-01042, naissance en base 1950-06-15 | **RÉUSSI** |
| DP-02 | Dossier patient | Doublon d’identité refusé sans confirmation | 409 patient_doublon_possible | statut 409 patient_doublon_possible | **RÉUSSI** |
| DP-03 | Dossier patient | Recherche par nom, référence et date de naissance | Le patient est trouvé par chacun des trois critères ; date affichée = 1950-06-15 | démo-test → trouvé (1950-06-15) ; p-01042 → trouvé (1950-06-15) ; 1950-06-15 → trouvé (1950-06-15) | **RÉUSSI** |
| DP-04 | Dossier patient | Modification de l’identité : motif exigé, réservée à l’admission | 400 ; 200 ; 403 | sans motif 400 ; avec motif 200 (naissance 1950-06-16) ; médecin 403 | **RÉUSSI** |
| DP-05 | Dossier patient | Allergie (infirmier) : enregistrée, alerte dans la liste et l’en-tête | Allergie active ; compteur d’allergies = 1 | création 200 ; compteur 1 ; allergies du dossier 1 | **RÉUSSI** |
| DP-06 | Dossier patient | Antécédent, diagnostic (médecin seulement), observation | 200 ; 403 ; 200 ; 200 ; 403 | 200 ; 403 ; 200 ; 200 ; 403 | **RÉUSSI** |
| DP-07 | Dossier patient | Consultation (rencontre), note liée et signée | 200 ; 400 ; 200 ; statut signee | rencontre 200 ; note sans rencontre 400 ; note 200 ; signature signee | **RÉUSSI** |
| DP-08 | Dossier patient | Prescription simulée : brouillon, validation par le médecin seulement, jamais envoyée | brouillon ; 403 ; validee + simulee=true + envoyee=false | brouillon ; 403 ; validee simulee=true envoyee=false | **RÉUSSI** |
| DP-09 | Dossier patient | Examen : demande (médecin) puis résultat | demande puis resultat | demande → resultat | **RÉUSSI** |
| DP-10 | Dossier patient | Hospitalisation (séjour) : parcours « hospitalisé » | 200 ; patient hospitalise | séjour 200 ; parcours hospitalise | **RÉUSSI** |
| DP-11 | Dossier patient | Documents : PDF valide accepté ; faux PDF et > 5 Mo refusés ; téléchargement journalisé | 200 ; 400 ; 400 ; 200 + empreinte identique + accès « export » | valide 200 (rapport) ; faux 400 ; 6 Mo 413 ; téléchargement 200 identique=true ; accès ecriture,export | **RÉUSSI** |
| DP-11b | Dossier patient | Type de document hors liste : refus propre | 400 parametre_invalide (pas d’erreur serveur) | statut 500 erreur_interne | **ÉCHEC** |
| DP-12 | Dossier patient | Amendement (nouvelle version) et annulation tracée ; aucune suppression | v2 ; 409 ; 400 ; annule ; 404/405 (aucune route) | v2 ; 409 ; 400 ; annule ; DELETE 404 ; lignes conservées 2/2 | **RÉUSSI** |
| DP-13 | Dossier patient | Historique chronologique du dossier | Chronologie triée du plus récent au plus ancien, avec éléments, documents | 11 entrées, triées=true, genres : allergie, document, sejour, examen, prescription, note, rencontre, observation, diagnostic, antecedent | **RÉUSSI** |
| DP-14 | Dossier patient | Journal d’accès : auditeur seulement, complet, sans contenu clinique, immuable | 403 ; lecture/écriture/signature/export présents, aucun libellé clinique ; refus de modification | médecin 403 ; auditeur 200, actions : lecture,ecriture,export,signature ; contenu clinique : aucun ; UPDATE refusé ; DELETE refusé (même par un superutilisateur) | **RÉUSSI** |
| DP-15 | Dossier patient | Accès non autorisés : sans fonction, autre établissement, autre organisation, sans session | Aucun ne lit le dossier (403/404/401) | {"res":404,"ha":404,"amb":404,"ccs":404,"ent":403,"stl":404,"sans":401} | **RÉUSSI** |
| DP-16 | Dossier patient | Habilitations : l’administrateur ne s’ouvre pas les dossiers ; accès d’urgence justifié | 403 ; 400 ; 200 + lecture permise + journal « urgence » | auto-habilitation : dsn_auto_habilitation ; avant urgence 403 ; sans justification 400 ; justifiée 200 ; lecture ensuite 200 ; journal urgence 1 | **RÉUSSI** |
| AD-01 | Admissions | Admission DSN avec unité et lit : le lit d’Arrimo est-il réservé/occupé ? | Le lit passe à « occupé » (ou réservé) par les règles des lits ; capacités mises à jour | séjour 200 sur CHIR-303A ; état du lit avant « libre », après « libre » (patient_ref —) | **ÉCHEC** |
| AD-02 | Admissions | Affectation d’un lit déjà occupé refusée | 409 (lit occupé) | lit CHIR-301A (occupé) : statut 200 | **ÉCHEC** |
| AD-03 | Admissions | Admission visible dans les modules autorisés (Patients, Lits) | Le patient DSN apparaît dans Patients ; son lit dans Lits | module Patients : visible ; lit relié dans Lits : non | **ÉCHEC** |
| AD-04 | Admissions | Modification et annulation d’un séjour | v2 ; annule ; parcours patient cohérent | amendement v2 ; annulation annule ; parcours du patient après annulation : hospitalise | **ÉCHEC** |
| ST-01 | Sorties et transferts | Préparer la sortie (fonction sortie) avec destination et synthèse | sortie_preparee | statut 200 sortie_preparee | **RÉUSSI** |
| ST-02 | Sorties et transferts | Transition vers un partenaire : création, validation (figée), envoi | 200 ; 409 ; valide ; envoye | 200 ; 409 ; valide ; envoye | **RÉUSSI** |
| ST-03 | Sorties et transferts | Une demande de transfert (ou d’hébergement) Arrimo est générée par la transition | Une demande dans le module Transferts ou Demandes d’hébergement, sans ressaisie | transferts : 0 ; demandes d’hébergement : 0 | **ÉCHEC** |
| ST-04 | Sorties et transferts | Réception par le destinataire : avis sans contenu clinique, paquet seul visible | Avis présent sans clinique ; paquet = éléments choisis ; dossier source 404 | avis : « Transition TRX-001104 reçue de Hôpital B — Mont-Clair : ouvrez le paquet de transition pour l’accepter ou la refuser. » ; paquet : diagnostic, prescription ; dossier source 404 | **RÉUSSI** |
| ST-05 | Sorties et transferts | Refus motivé, puis nouvelle transition acceptée et reçue ; ordre imposé | 409 ; 400 ; refuse ; accepte ; 409 ; recu | 409 ; 400 ; refuse ; accepte ; 409 ; recu | **RÉUSSI** |
| ST-06 | Sorties et transferts | Avis à l’origine après refus / acceptation | L’Hôpital B est avisé du refus et de l’acceptation | 0 avis : aucun | **ÉCHEC** |
| ST-07 | Sorties et transferts | Départ, arrivée, clôture : Horloge et Sillage | demande, décision, départ, arrivée ; Sillage lisible par l’origine et la destination | Horloge : demande → decision → arrivee ; Sillage origine 200, destination 200 ; chronologie DSN : recu, refuse | **ÉCHEC** |
| ST-08 | Sorties et transferts | Le destinataire ouvre son propre dossier depuis le paquet ; pas de doublon si on recommence | 1er : patient créé ; 2e : refus ou même patient | 1er 200 ; 2e 500 ; dossiers créés aux Érables : 2 | **ÉCHEC** |
| PA-01 | Partenaires | Hôpital A (sans DSN) destinataire : reçoit seulement le paquet | Paquet visible ; dossier 404 | transitions reçues 200 (1) ; dossier source 404 | **RÉUSSI** |
| PA-02 | Partenaires | CCS et ambulance : aucun accès DSN | 401/403 partout | 403,403,403,403,403,403,403,403,403 | **RÉUSSI** |
| TR-01 | Transport | Envoi de transition avec transport : demande créée et préremplie (origine, destination, horaire, référence) | Une demande_transport liée, origine/destination/plage/référence corrects, statut « demandée » (pas d’unité affectée) | envoi 200  ; demande DT-000004 demandee, origine 2, destination 22, réf P-01042, unité aucune | **RÉUSSI** |
| TR-02 | Transport | Échec de la demande de transport : pas de transport orphelin, transition inchangée | Refus ; transition toujours « valide » ; aucune demande créée | envoi 404 organisation_introuvable ; demandes avant 4, après 4 ; transition valide | **RÉUSSI** |
| TR-03 | Transport | Le répartiteur compétent reçoit la demande ; acceptation, affectation, suivi ; aucun doublon | Visible côté ambulance sans données cliniques ; statuts successifs ; une seule demande | vue ambulance : oui, données cliniques : aucune ; accepter:200 en_route:200 pris_en_charge:200 arrivee:200 ; demandes actives pour ce patient : 1 | **RÉUSSI** |
| TR-04 | Transport | Synchronisation des statuts transport ↔ DSN ↔ Sillage | Le DSN montre l’état du transport (accepté, en route, arrivé) ; Sillage relie transition et transport | transition dans le DSN : {"id":5,"numero":"TRX-001107","statut":"envoye","destination_id":22,"destination":"CHSLD 1 — des Érables","cree_le":"2026-11-21T04:38:56.966Z","envoye_le":"2026 ; Sillage relie le transport : tru | **ÉCHEC** |
| TR-05 | Transport | Double envoi (clic répété / reprise réseau) : une seule demande de transport | 409 ; pas de seconde demande | renvoi 409 ; demandes avant 4, après 4 | **RÉUSSI** |
| TR-06 | Transport | Envois simultanés de la même transition (course) | Une seule demande créée | réponses 200 / 200 ; demandes créées : 2 | **ÉCHEC** |
| TRR-01 | Transitions reçues | Seul le destinataire voit le paquet ; rôle entretien refusé ; autre établissement refusé | 403 ; 403 ; 404 | 403 ; 403 ; 404 | **RÉUSSI** |
| TRR-02 | Transitions reçues | Admission/sortie/transfert émis par un module opérationnel (Transferts, NSA, Liaison CHSLD) reçu dans le DSN | Le DSN reçoit l’événement (séjour/sortie) du module émetteur | aucun lien : les admissions, sorties et transferts des modules Lits/Transferts/NSA/Liaison ne créent aucun élément DSN (éléments d’autre source : 103) | **ÉCHEC** |
| TRR-03 | Transitions reçues | Messages ADT dans le désordre / en double (connecteur) | Idempotence et ordre gérés | Le connecteur HL7 (A01…A22) alimente Lits et Civières, pas le DSN clinique ; aucun flux entrant vers le DSN à tester. Idempotence du connecteur déjà couverte par tests/dsn.test.cjs (hors périmètre DSN clinique). | **NON TESTÉ** |
| SEC-01 | Sécurité | DSN refusé hors démo/recette (serveur en mode « pilote » sur la même copie) | 403 dsn_reserve_demo partout | patients 403 dsn_reserve_demo ; reçues 403 dsn_reserve_demo ; page /dsn 200 | **RÉUSSI** |
| SEC-02 | Sécurité | Appels directs sans jeton, jeton falsifié, identifiants devinés | 401 ; 401 ; 403/404 | 401 ; 401 ; 404 | **RÉUSSI** |
| SEC-03 | Sécurité | Messages d’erreur en anglais (X-Langue: en) | Message anglais | 403 « Vous n'avez pas accès à cet établissement. » (code etab_interdit) | **ÉCHEC** |
| SEC-04 | Sécurité | Notifications et journal général sans donnée clinique | Aucun terme clinique | notifications : 0 ; journal : 0 | **RÉUSSI** |
| UI-01 | Interface | Hôpital B : onglet « Dossier santé » dans la barre, liste des patients | Onglet visible ; patients listés ; aucune erreur | 15 patients ; erreurs : aucune | **RÉUSSI** |
| UI-02 | Interface | Ouvrir un dossier : alerte d’allergie, sections, sous-onglets | Dossier affiché avec l’alerte d’allergie | alerte allergie : 1 ; en-tête patient : 1 | **RÉUSSI** |
| UI-03 | Interface | Ajouter une allergie depuis l’interface (formulaire) | Allergie ajoutée et affichée | occurrences avant 0, après 2 | **RÉUSSI** |
| UI-04 | Interface | Interface DSN en anglais | Libellés anglais (Patients/Record/Received transitions), statuts traduits | onglets : Patients Dashboard Record Received transitions Settings ; texte français restant : non | **RÉUSSI** |
| UI-05 | Interface | CHSLD des Érables : transitions reçues et acceptation à l’écran | Paquet visible ; « Accepter » change le statut | après acceptation : bouton « Confirmer la réception » proposé ; erreurs : aucune | **RÉUSSI** |
| UI-06 | Interface | Tablette (820 px) : DSN sans débordement horizontal | Aucun débordement | débordement 0 px | **RÉUSSI** |

## 2. Anomalies, par priorité

1. **AD-01 — gravité haute** (Admissions) : Le séjour DSN n’est pas relié au lit : le champ « lit » est un texte libre ; aucune réservation, aucune mise à jour des capacités (risque de double affectation)  
   Preuve : `preuves/AD-01.json` — obtenu : séjour 200 sur CHIR-303A ; état du lit avant « libre », après « libre » (patient_ref —)  
   Correction recommandée : Relier le séjour DSN à un vrai lit (`lit_id`) et passer par `src/regles.js` (réservé → occupé), verrou et journal ; choix du lit dans une liste des lits libres de l’unité.
2. **AD-02 — gravité haute** (Admissions) : Un séjour DSN peut être placé sur un lit occupé : double affectation possible  
   Preuve : `preuves/AD-02.json` — obtenu : lit CHIR-301A (occupé) : statut 200  
   Correction recommandée : Même correctif : refuser (409) un lit non libre ; aucune affectation hors des règles des lits.
3. **AD-03 — gravité haute** (Admissions) : Admission DSN visible dans Patients mais aucun lit relié dans Lits  
   Preuve : `preuves/AD-03.json` — obtenu : module Patients : visible ; lit relié dans Lits : non  
   Correction recommandée : Même correctif : l’admission DSN occupe le lit dans Lits (patient_ref) et apparaît dans les capacités.
4. **ST-03 — gravité haute** (Sorties et transferts) : La transition DSN ne crée ni transfert ni demande d’hébergement : la destination doit ressaisir dans les modules opérationnels (parcours en double)  
   Preuve : `preuves/ST-03.json` — obtenu : transferts : 0 ; demandes d’hébergement : 0  
   Correction recommandée : À l’envoi d’une transition vers une ressource d’hébergement : créer (ou lier) la demande d’hébergement ; vers un hôpital : la demande de transfert ; idempotent, sans ressaisie.
5. **ST-08 — gravité haute** (Sorties et transferts) : Ouvrir deux fois le dossier depuis le même paquet crée deux patients (doublon)  
   Preuve : `preuves/ST-08.json` — obtenu : 1er 200 ; 2e 500 ; dossiers créés aux Érables : 2  
   Correction recommandée : Rendre l’ouverture du dossier depuis un paquet transactionnelle et idempotente (mémoriser le patient créé sur la transition ; 2e appel = même patient).
6. **TR-04 — gravité haute** (Transport) : Le DSN n’affiche pas le statut du transport lié et la transition reste « envoyée » après l’arrivée réelle ; Sillage ne relie pas la transition à son transport  
   Preuve : `preuves/TR-04.json` — obtenu : transition dans le DSN : {"id":5,"numero":"TRX-001107","statut":"envoye","destination_id":22,"destination":"CHSLD 1 — des Érables","cree_le":"2026-11-21T04:38:56.966Z","envoye_le":"2026 ; Sillage relie le transport : true ; statut transition après arrivée du t  
   Correction recommandée : Afficher dans le DSN le statut du transport lié (demandé, accepté, véhicule affecté, en route, arrivé) ; l’arrivée du transport marque l’étape « départ/arrivée » de la transition (fait constaté, la réception reste confirmée par la destination).
7. **TR-06 — gravité haute** (Transport) : Deux envois simultanés créent deux demandes de transport (la demande est créée hors transaction, avant le contrôle du statut)  
   Preuve : `preuves/TR-06.json` — obtenu : réponses 200 / 200 ; demandes créées : 2  
   Correction recommandée : Créer la demande de transport DANS la transaction, après verrou de la transition (`FOR UPDATE`) et contrôle du statut.
8. **TRR-02 — gravité haute** (Transitions reçues) : Pas de réception dans le DSN des événements des autres modules (seuls les paquets DSN→DSN existent)  
   Preuve : `preuves/TRR-02.json` — obtenu : aucun lien : les admissions, sorties et transferts des modules Lits/Transferts/NSA/Liaison ne créent aucun élément DSN (éléments d’autre source : 103)  
   Correction recommandée : Décision à prendre : faut-il qu’une admission/sortie/transfert des modules opérationnels crée un séjour DSN ? (proposition : séjour créé « à compléter » pour les établissements qui ont le DSN).
9. **AD-04 — gravité moyenne** (Admissions) : Après annulation du séjour, le patient reste « hospitalisé » (parcours non recalculé)  
   Preuve : `preuves/AD-04.json` — obtenu : amendement v2 ; annulation annule ; parcours du patient après annulation : hospitalise  
   Correction recommandée : Recalculer le parcours du patient à l’annulation d’un séjour (dernier séjour actif) et libérer le lit par les règles.
10. **ST-06 — gravité moyenne** (Sorties et transferts) : L’établissement d’origine n’est pas avisé de la décision (refus ou acceptation) du destinataire ; il doit surveiller l’écran  
   Preuve : `preuves/ST-06.json` — obtenu : 0 avis : aucun  
   Correction recommandée : Aviser l’établissement d’origine du refus (avec motif) et de l’acceptation (avec date prévue), sans contenu clinique.
11. **ST-07 — gravité moyenne** (Sorties et transferts) : Aucune étape « départ » : le départ réel du patient n’est jamais enregistré pour une transition DSN  
   Preuve : `preuves/ST-07.json` — obtenu : Horloge : demande → decision → arrivee ; Sillage origine 200, destination 200 ; chronologie DSN : recu, refuse  
   Correction recommandée : Ajouter l’étape « départ » (confirmée par l’origine ou par la prise en charge du transport).
12. **DP-11b — gravité faible** (Dossier patient) : Un type de document inconnu provoque une erreur serveur 500 (contrôle d’entrée manquant)  
   Preuve : `preuves/DP-11b.json` — obtenu : statut 500 erreur_interne  
   Correction recommandée : Valider `type_doc` dans la liste avant l’insertion (400 au lieu de 500).
13. **SEC-03 — gravité faible** (Sécurité) : Constat général (pas propre au DSN) : les messages d’erreur du serveur restent en français ; l’interface DSN traduit les refus principaux par leur code  
   Preuve : `preuves/SEC-03.json` — obtenu : 403 « Vous n'avez pas accès à cet établissement. » (code etab_interdit)  
   Correction recommandée : Constat général : traduire les messages d’erreur du serveur selon `X-Langue` (catalogue anglais d’erreurs).

## 3. Points vérifiés et conformes (extraits)
- Création, recherche (nom, référence, date), modification d’identité avec motif ; doublon refusé ; dates exactes.
- Droits par fonction : diagnostic réservé au médecin, prescription **simulée** validée par le médecin seulement (`simulee=true`, `envoyee=false`).
- Aucune suppression : amendement (v2), annulation motivée, version remplacée figée ; `DELETE` inexistant.
- Journal d’accès : auditeur seulement, lecture/écriture/signature/export tracés, **aucun contenu clinique**, modification et suppression refusées même par un superutilisateur.
- Accès refusés : réseau, autre hôpital, CCS, ambulance, entretien, autre CHSLD, sans jeton, jeton falsifié ; accès d’urgence justifié et journalisé ; auto-habilitation refusée.
- Paquet de transition : seul visible au destinataire ; avis **sans clinique** ; refus motivé ; ordre imposé (réception avant acceptation refusée, double acceptation refusée).
- Transport : demande préremplie (origine, destination, plage, référence), **sans unité affectée** à la création ; cycle accepter → en route → pris en charge → arrivée ; aucune donnée clinique côté ambulance ; renvoi refusé (409) ; échec de la demande sans transport orphelin.
- DSN refusé en mode « pilote » (`dsn_reserve_demo`) ; notifications et journal général sans clinique.
- Interface : onglet dans la barre de l’Hôpital B, dossier, ajout d’allergie au formulaire, anglais complet, acceptation par le CHSLD, tablette sans débordement.

## 4. Verdict pour une démonstration intégrée
**Démontrable avec réserves.** Le dossier clinique, les habilitations, la traçabilité et le paquet de transition fonctionnent et sont sûrs (aucune fuite constatée). Mais le DSN n’est **pas encore relié aux opérations** : un séjour DSN ne réserve ni n’occupe de lit (double affectation possible), une transition ne crée ni transfert ni demande d’hébergement, le statut du transport n’est pas visible dans le DSN, et deux défauts d’idempotence peuvent créer des doublons (ouverture de dossier, envois simultanés). En démonstration, éviter : séjour sur un lit, double clic sur « Ouvrir notre dossier ».

## 5. Validations nécessaires avant un pilote réel (hors portée de ces tests)
- Validation clinique (contenu du dossier, paquet de transition, prescriptions) par des cliniciens du pays.
- Validation réglementaire et juridique (Loi 25 au Québec, évaluation des facteurs relatifs à la vie privée), hébergement au Canada.
- Évaluation de sécurité indépendante et test d’intrusion ; revue des journaux immuables et des sauvegardes.
- Interopérabilité réelle (HL7/FHIR) avec l’équipe informatique d’un établissement.
- Autorisation écrite de Moustafa et de l’établissement (règle du 22 nov. 2026) ; le DSN reste refusé hors démo et recette.

## 6. Suite proposée
Après votre validation : corriger dans l’ordre AD-01/02/03 (lits), TR-06 et ST-08 (doublons), TR-04 et ST-03 (liaisons), puis ST-06, ST-07, AD-04, DP-11b ; relancer `audit-api.cjs`, `audit-ui.cjs` et toute la batterie de non-régression.
