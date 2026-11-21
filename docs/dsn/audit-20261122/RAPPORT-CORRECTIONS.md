# DSN natif — corrections et nouvel audit (23 novembre 2026)

Phase 2 de l’audit du 22 nov. (validée par Moustafa) : corriger les 12 anomalies et rendre le DSN natif (synchronisation contrôlée dans les deux sens). **Travail fait et testé uniquement sur la copie isolée de la démo** (base `audit_dsn`, serveurs locaux sans canal sortant). **Rien n’a été déployé.**

**Résultat final (copie neuve, exécution unique) : 53 cas — 51 réussis, 1 échec (constat général hors DSN), 1 non testé, 0 bloqué.** Avant : 37 réussis, 12 échecs.

## 1. Ce qui a été construit

| Exigence | Réalisation | Preuve |
|---|---|---|
| 1. Admission confirmée dans Lits/Admissions → séjour DSN | `src/dsn-sync.js`, appelé par `src/regles.js` (seul endroit qui change un lit) : séjour créé ou mis à jour (nouvelle version si changement de lit), une seule fois | TRR-02, SYNC-01, tests/dsn-sync.test.cjs |
| 2. Admission DSN → vrai lit, atomique | Le séjour exige un lit libre réel : réservé puis occupé par les règles des lits (verrou, version, journal) ; verrou par patient ; refus 409 si lit pris | AD-01, AD-02, UI-07, test « deux admissions simultanées » |
| 3. Une demande de transfert ne crée pas de séjour actif | Seul l’état « occupé » crée un séjour ; une réservation (transfert demandé) n’en crée aucun | TRR-02 (réservation → 0 séjour) |
| 4. Transferts, sorties, statuts synchronisés | Transition → demande d’hébergement (ressource) ou demande de transfert (hôpital, lit réservé) ; décision → avis à l’origine ; départ (origine ou prise en charge du transport) → Horloge, lit au nettoyage, séjour terminé ; le DSN affiche transport, hébergement, transfert ; Sillage (demande, décision, départ, arrivée) | ST-03, ST-06, ST-07, TR-04, SYNC-01 |
| 5. Aucune duplication | Envoi atomique (valide → envoyé avant tout effet), lien unique transition ↔ transport, ouverture de dossier idempotente, verrou par patient | TR-05, TR-06, ST-08, TRR-02 |
| 6. Historique complet | Table `dsn_evenements` : type, source (dsn, lits, transferts, transport, hébergement), objet, statut, auteur (ou système), heure ; immuable (déclencheur) ; sans contenu clinique ; affichée dans l’historique du dossier | SYNC-02, test « Historique » |

Migration additive `db/migrations/20261123-dsn-sync.sql` (rejouée deux fois avec garde d’empreinte : aucune donnée existante modifiée). Données de démo : les séjours des patients fictifs sont reliés à de vrais lits (4) ou terminés (6), par les règles des lits (`db/demo-dsn.js`, rejouable).

## 2. Les 12 anomalies : avant / après

| ID | Gravité | Avant | Après | Preuve après |
|---|---|---|---|---|
| AD-01 | haute | ÉCHEC : séjour 200 sur CHIR-303A ; état du lit avant « libre », après « libre » (patient_ref —) | **RÉUSSI** : séjour 200 sur MED-201B ; état du lit avant « libre », après « occupe » (patient_ref P-01043) | `preuves-apres/AD-01.json` |
| AD-02 | haute | ÉCHEC : lit CHIR-301A (occupé) : statut 200 | **RÉUSSI** : lit CHIR-301A (occupé) : statut 409 | `preuves-apres/AD-02.json` |
| AD-03 | haute | ÉCHEC : module Patients : visible ; lit relié dans Lits : non | **RÉUSSI** : module Patients : visible ; lit relié dans Lits : oui | `preuves-apres/AD-03.json` |
| ST-03 | haute | ÉCHEC : transferts : 0 ; demandes d’hébergement : 0 | **RÉUSSI** : transferts : 0 ; demandes d’hébergement : 1 | `preuves-apres/ST-03.json` |
| ST-08 | haute | ÉCHEC : 1er 200 ; 2e 500 ; dossiers créés aux Érables : 2 | **RÉUSSI** : 1er 200 ; 2e 200 ; dossiers créés aux Érables : 1 | `preuves-apres/ST-08.json` |
| TR-04 | haute | ÉCHEC : transition dans le DSN : {"id":5,"numero":"TRX-001107","statut":"envoye","destination_id":22,"destination":"CHSLD 1 — de | **RÉUSSI** : transition dans le DSN : {"id":5,"numero":"TRX-001106","statut":"envoye","destination_id":22,"destination":"CHSLD 1 — des Érables","cree_le":"2026-11-21T05:00:3 | `preuves-apres/TR-04.json` |
| TR-06 | haute | ÉCHEC : réponses 200 / 200 ; demandes créées : 2 | **RÉUSSI** : réponses 200 / 409 ; demandes créées : 1 | `preuves-apres/TR-06.json` |
| TRR-02 | haute | ÉCHEC : aucun lien : les admissions, sorties et transferts des modules Lits/Transferts/NSA/Liaison ne créent aucun élément DSN ( | **RÉUSSI** : réservation 200 → séjours 0 ; admission 200 → 1 séjour (en_cours, source lits) ; 2e admission 409 | `preuves-apres/TRR-02.json` |
| ST-06 | moyenne | ÉCHEC : 0 avis : aucun | **RÉUSSI** : 2 avis : dsn_transition_acceptee, dsn_transition_refusee | `preuves-apres/ST-06.json` |
| ST-07 | moyenne | ÉCHEC : Horloge : demande → decision → arrivee ; Sillage origine 200, destination 200 ; chronologie DSN : recu, refuse | **RÉUSSI** : Horloge : demande → decision → depart → arrivee ; Sillage origine 200, destination 200 ; chronologie DSN : recu, refuse | `preuves-apres/ST-07.json` |
| AD-04 | moyenne | ÉCHEC : amendement v2 ; annulation annule ; parcours du patient après annulation : hospitalise | **RÉUSSI** : amendement v2 ; annulation annule ; parcours du patient après annulation : enregistre | `preuves-apres/AD-04.json` |
| DP-11b | faible | ÉCHEC : statut 500 erreur_interne | **RÉUSSI** : statut 400 parametre_invalide | `preuves-apres/DP-11b.json` |

## 3. Tous les cas (exécution finale)

| ID | Module | Cas | Statut | Obtenu |
|---|---|---|---|---|
| DP-01 | Dossier patient | Création d’un patient fictif (fonction admission) | **RÉUSSI** | statut 200, référence P-01042, naissance en base 1950-06-15 |
| DP-02 | Dossier patient | Doublon d’identité refusé sans confirmation | **RÉUSSI** | statut 409 patient_doublon_possible |
| DP-03 | Dossier patient | Recherche par nom, référence et date de naissance | **RÉUSSI** | démo-test → trouvé (1950-06-15) ; p-01042 → trouvé (1950-06-15) ; 1950-06-15 → trouvé (1950-06-15) |
| DP-04 | Dossier patient | Modification de l’identité : motif exigé, réservée à l’admission | **RÉUSSI** | sans motif 400 ; avec motif 200 (naissance 1950-06-16) ; médecin 403 |
| DP-05 | Dossier patient | Allergie (infirmier) : enregistrée, alerte dans la liste et l’en-tête | **RÉUSSI** | création 200 ; compteur 1 ; allergies du dossier 1 |
| DP-06 | Dossier patient | Antécédent, diagnostic (médecin seulement), observation | **RÉUSSI** | 200 ; 403 ; 200 ; 200 ; 403 |
| DP-07 | Dossier patient | Consultation (rencontre), note liée et signée | **RÉUSSI** | rencontre 200 ; note sans rencontre 400 ; note 200 ; signature signee |
| DP-08 | Dossier patient | Prescription simulée : brouillon, validation par le médecin seulement, jamais envoyée | **RÉUSSI** | brouillon ; 403 ; validee simulee=true envoyee=false |
| DP-09 | Dossier patient | Examen : demande (médecin) puis résultat | **RÉUSSI** | demande → resultat |
| DP-10 | Dossier patient | Hospitalisation (séjour) : parcours « hospitalisé » | **RÉUSSI** | séjour 200 ; parcours hospitalise |
| DP-11 | Dossier patient | Documents : PDF valide accepté ; faux PDF et > 5 Mo refusés ; téléchargement journalisé | **RÉUSSI** | valide 200 (rapport) ; faux 400 ; 6 Mo 413 ; téléchargement 200 identique=true ; accès ecriture,export |
| DP-11b | Dossier patient | Type de document hors liste : refus propre | **RÉUSSI** | statut 400 parametre_invalide |
| DP-12 | Dossier patient | Amendement (nouvelle version) et annulation tracée ; aucune suppression | **RÉUSSI** | v2 ; 409 ; 400 ; annule ; DELETE 404 ; lignes conservées 2/2 |
| DP-13 | Dossier patient | Historique chronologique du dossier | **RÉUSSI** | 12 entrées, triées=true, genres : allergie, document, sejour, evenement, examen, prescription, note, rencontre, observation, diagnostic, antecedent |
| DP-14 | Dossier patient | Journal d’accès : auditeur seulement, complet, sans contenu clinique, immuable | **RÉUSSI** | médecin 403 ; auditeur 200, actions : lecture,ecriture,export,signature ; contenu clinique : aucun ; UPDATE refusé ; DELETE refusé (même par un superutilisateur) |
| DP-15 | Dossier patient | Accès non autorisés : sans fonction, autre établissement, autre organisation, sans session | **RÉUSSI** | {"res":404,"ha":404,"amb":404,"ccs":404,"ent":403,"stl":404,"sans":401} |
| DP-16 | Dossier patient | Habilitations : l’administrateur ne s’ouvre pas les dossiers ; accès d’urgence justifié | **RÉUSSI** | auto-habilitation : dsn_auto_habilitation ; avant urgence 403 ; sans justification 400 ; justifiée 200 ; lecture ensuite 200 ; journal urgence 1 |
| AD-01 | Admissions | Admission DSN avec unité et lit : le lit d’Arrimo est-il réservé/occupé ? | **RÉUSSI** | séjour 200 sur MED-201B ; état du lit avant « libre », après « occupe » (patient_ref P-01043) |
| AD-02 | Admissions | Affectation d’un lit déjà occupé refusée | **RÉUSSI** | lit CHIR-301A (occupé) : statut 409 |
| AD-03 | Admissions | Admission visible dans les modules autorisés (Patients, Lits) | **RÉUSSI** | module Patients : visible ; lit relié dans Lits : oui |
| AD-04 | Admissions | Modification et annulation d’un séjour | **RÉUSSI** | amendement v2 ; annulation annule ; parcours du patient après annulation : enregistre |
| ST-01 | Sorties et transferts | Préparer la sortie (fonction sortie) avec destination et synthèse | **RÉUSSI** | statut 200 sortie_preparee |
| ST-02 | Sorties et transferts | Transition vers un partenaire : création, validation (figée), envoi | **RÉUSSI** | 200 ; 409 ; valide ; envoye |
| ST-03 | Sorties et transferts | Une demande de transfert (ou d’hébergement) Arrimo est générée par la transition | **RÉUSSI** | transferts : 0 ; demandes d’hébergement : 1 |
| ST-04 | Sorties et transferts | Réception par le destinataire : avis sans contenu clinique, paquet seul visible | **RÉUSSI** | avis : « Transition TRX-001102 reçue de Hôpital B — Mont-Clair : ouvrez le paquet de transition pour l’accepter ou la refuser. » ; paquet : diagnostic, prescription ; dossier source 404 |
| ST-05 | Sorties et transferts | Refus motivé, puis nouvelle transition acceptée et reçue ; ordre imposé | **RÉUSSI** | 409 ; 400 ; refuse ; accepte ; 409 ; recu |
| ST-06 | Sorties et transferts | Avis à l’origine après refus / acceptation | **RÉUSSI** | 2 avis : dsn_transition_acceptee, dsn_transition_refusee |
| ST-07 | Sorties et transferts | Départ, arrivée, clôture : Horloge et Sillage | **RÉUSSI** | Horloge : demande → decision → depart → arrivee ; Sillage origine 200, destination 200 ; chronologie DSN : recu, refuse |
| ST-08 | Sorties et transferts | Le destinataire ouvre son propre dossier depuis le paquet ; pas de doublon si on recommence | **RÉUSSI** | 1er 200 ; 2e 200 ; dossiers créés aux Érables : 1 |
| PA-01 | Partenaires | Hôpital A (sans DSN) destinataire : reçoit seulement le paquet | **RÉUSSI** | transitions reçues 200 (1) ; dossier source 404 |
| PA-02 | Partenaires | CCS et ambulance : aucun accès DSN | **RÉUSSI** | 403,403,403,403,403,403,403,403,403 |
| TR-01 | Transport | Envoi de transition avec transport : demande créée et préremplie (origine, destination, horaire, référence) | **RÉUSSI** | envoi 200  ; demande DT-000004 demandee, origine 2, destination 22, réf P-01042, unité aucune |
| TR-02 | Transport | Échec de la demande de transport : pas de transport orphelin, transition inchangée | **RÉUSSI** | envoi 404 organisation_introuvable ; demandes avant 4, après 4 ; transition valide |
| TR-03 | Transport | Le répartiteur compétent reçoit la demande ; acceptation, affectation, suivi ; aucun doublon | **RÉUSSI** | vue ambulance : oui, données cliniques : aucune ; accepter:200 en_route:200 pris_en_charge:200 arrivee:200 ; demandes actives pour ce patient : 1 |
| TR-04 | Transport | Synchronisation des statuts transport ↔ DSN ↔ Sillage | **RÉUSSI** | transition dans le DSN : {"id":5,"numero":"TRX-001106","statut":"envoye","destination_id":22,"destination":"CHSLD 1 — des Érables","cree_le":"2026-11-21T05:00:35.419Z","envoye_le":"2026 ; Sillage reli |
| TR-05 | Transport | Double envoi (clic répété / reprise réseau) : une seule demande de transport | **RÉUSSI** | renvoi 409 ; demandes avant 4, après 4 |
| TR-06 | Transport | Envois simultanés de la même transition (course) | **RÉUSSI** | réponses 200 / 409 ; demandes créées : 1 |
| TRR-01 | Transitions reçues | Seul le destinataire voit le paquet ; rôle entretien refusé ; autre établissement refusé | **RÉUSSI** | 403 ; 403 ; 404 |
| TRR-02 | Transitions reçues | Admission confirmée dans Lits → séjour DSN créé une seule fois ; une simple réservation (demande) n’en crée aucun | **RÉUSSI** | réservation 200 → séjours 0 ; admission 200 → 1 séjour (en_cours, source lits) ; 2e admission 409 |
| SYNC-01 | Synchronisation | Sortie faite dans Lits → séjour DSN terminé, parcours recalculé, événement historisé | **RÉUSSI** | libérer 200 ; séjour termine ; parcours enregistre ; événements : admission/lits/sejour_cree/hopital.b@demo.arrimo, sortie_lit/lits/sejour_termine/hopital.b@demo.arrimo |
| SYNC-02 | Synchronisation | Historique des événements : auteur, source, statut, heure ; immuable ; sans clinique | **RÉUSSI** | 33 événements ; types : changement_lit, admission, admission_annulee, demande_hebergement, transition, depart, dossier_ouvert, transport, sortie_lit ; modification refusée ; clinique : aucun |
| TRR-03 | Transitions reçues | Messages ADT dans le désordre / en double (connecteur) | **NON TESTÉ** | Le connecteur HL7 (A01…A22) alimente Lits et Civières, pas le DSN clinique ; aucun flux entrant vers le DSN à tester. Idempotence du connecteur déjà couverte par tests/dsn.test.cjs (hors périmètre DSN |
| SEC-01 | Sécurité | DSN refusé hors démo/recette (serveur en mode « pilote » sur la même copie) | **RÉUSSI** | patients 403 dsn_reserve_demo ; reçues 403 dsn_reserve_demo ; page /dsn 200 |
| SEC-02 | Sécurité | Appels directs sans jeton, jeton falsifié, identifiants devinés | **RÉUSSI** | 401 ; 401 ; 404 |
| SEC-03 | Sécurité | Messages d’erreur en anglais (X-Langue: en) | **ÉCHEC** | 403 « Vous n'avez pas accès à cet établissement. » (code etab_interdit) |
| SEC-04 | Sécurité | Notifications et journal général sans donnée clinique | **RÉUSSI** | notifications : 0 ; journal : 0 |
| UI-01 | Interface | Hôpital B : onglet « Dossier santé » dans la barre, liste des patients | **RÉUSSI** | 16 patients ; erreurs : aucune |
| UI-02 | Interface | Ouvrir un dossier : alerte d’allergie, sections, sous-onglets | **RÉUSSI** | alerte allergie : 1 ; en-tête patient : 1 |
| UI-03 | Interface | Ajouter une allergie depuis l’interface (formulaire) | **RÉUSSI** | occurrences avant 0, après 2 |
| UI-04 | Interface | Interface DSN en anglais | **RÉUSSI** | onglets : Patients Dashboard Record Received transitions Settings ; texte français restant : non |
| UI-07 | Interface | Admission depuis le DSN : choix d’un lit libre réel, puis le lit apparaît occupé dans l’onglet Lits | **RÉUSSI** | lits proposés : 4 ; colonne « Occupé » : MED-202A 0 min Médecine · chambre 202 Patient P-01046 · Interface D. ISO TÉLÉ Libérer (dép ; base : lit occupe, P-01046, séjour en_cours sur MED-202A ; erreurs |
| UI-05 | Interface | CHSLD des Érables : transitions reçues et acceptation à l’écran | **RÉUSSI** | après acceptation : bouton « Confirmer la réception » proposé ; erreurs : aucune |
| UI-06 | Interface | Tablette (820 px) : DSN sans débordement horizontal | **RÉUSSI** | débordement 0 px |

## Non-régression
- `npm test` : **344 réussis, 0 échec** (dont les 6 nouveaux tests de synchronisation `tests/dsn-sync.test.cjs` et les 4 tests DSN cliniques).
- `npm run test:interface` (Chromium) : **16 réussis, 0 échec**.

## 4. Restes et constats
- **TRR-03 (non testé)** : aucun flux entrant (HL7/FHIR) ne vise encore le DSN clinique ; à tester avec un vrai connecteur lors d’un pilote.
- **SEC-03 (constat général, hors DSN)** : les messages d’erreur du serveur restent en français pour tout Arrimo ; l’interface DSN traduit ses refus par leur code. Correction transversale à planifier.
- **Constat hors DSN** : le module Patients renvoie la date de naissance en heure universelle (décalage d’un jour à l’affichage possible) ; corrigé dans le DSN, à corriger dans `src/patients.js`.
- Lits libres : la synchronisation est stricte ; une démonstration d’admission DSN exige un lit libre à l’Hôpital B.

## 5. Verdict
**Le DSN fonctionne comme un module natif d’Arrimo** dans l’environnement de démonstration isolé : les admissions, sorties, transferts, demandes d’hébergement et transports sont synchronisés dans les deux sens, sans doublon, historisés, avec les autorisations existantes. Il reste réservé à la démonstration et à la recette ; un pilote réel exige toujours les validations clinique, réglementaire (Loi 25, hébergement au Canada) et de sécurité indépendantes, ainsi que l’autorisation écrite.

## 6. Rejouer
`bash preparer-copie.sh` (copie neuve, migration, données) puis `node audit-api.cjs <dossier>` et `node audit-ui.cjs <dossier>`.
