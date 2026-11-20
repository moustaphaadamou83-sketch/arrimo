'use strict';
/**
 * Module 🎓 Formation (22 nov. 2026, cahier « Formation » ; plan : docs/plan-module-formation.md).
 * Catalogue versionné avec le code : 17 parcours par rôle, 42 capsules (une tâche, 2 à 3 min), FR et EN.
 * Une capsule : scènes (écran de la démo, élément mis en évidence, sous-titres FR/EN ; la voix viendra du service de synthèse vocale),
 * exercice « À vous de jouer » dans le bac à sable (lot 2), mini-test (3 questions ; certaines chronométrées).
 * Une capsule `pret: false` est annoncée « en préparation » : son contenu arrive au lot 4 ou 7.
 * Chaque personne ne voit que les capsules de SES parcours et des modules ACTIVÉS de son établissement.
 */

// Module requis pour voir la capsule (null = socle commun, toujours visible)
const C = (code, module, emoji, duree, fr, en, extra = {}) => ({ code, module, emoji, duree, titre: { fr, en }, pret: false, ...extra });
const ST = (fr, en) => ({ fr, en });
const Q = (fr, en, choixFr, choixEn, bonne) => ({ q: { fr, en }, choix: { fr: choixFr, en: choixEn }, bonne });

const CAPSULES = [
  // ---------------------------------------------------------------- 🚑 Secours
  C('S1', 'liaison_secours', '🚑', 150, 'Envoyer une préalerte', 'Send a pre-alert'),
  C('S2', 'liaison_secours', '🚑', 180, 'Prendre en compte une préalerte et confirmer le bon véhicule', 'Acknowledge a pre-alert and confirm the right vehicle', {
    pret: true, compte: 'hopital.a@demo.arrimo', chrono_test_s: 60,
    objectif: ST('Vous saurez prendre en compte une ambulance annoncée, vérifier l’unité et la plaque à l’arrivée, et réorienter avec un motif.',
      'You will know how to acknowledge an announced ambulance, check the unit and plate on arrival, and redirect with a reason.'),
    scenes: [
      { ecran: 'secours', cible: '#onglets button[data-v="secours"]', st: ST('Une ambulance vous est annoncée : ouvrez l’onglet Liaison Secours.', 'An ambulance is announced to you: open the Emergency liaison tab.') },
      { ecran: 'secours', cible: '[data-prealerte]', st: ST('Chaque préalerte arrive ici : numéro, priorité déclarée par le paramédic, état.', 'Each pre-alert lands here: number, priority declared by the paramedic, status.') },
      { ecran: 'secours', cible: '.ls-eta', st: ST('L’heure d’arrivée est calculée à partir de la position de l’ambulance.', 'Arrival time is calculated from the ambulance’s position.') },
      { ecran: 'secours', cible: '[data-ls="prendre_en_compte"]', st: ST('Cliquez « Prendre en compte » : l’équipe ambulancière sait qu’une personne a vu l’annonce.', 'Click “Acknowledge”: the crew knows a person has seen the announcement.') },
      { ecran: 'secours', cible: '[data-ls="details"]', st: ST('Les détails montrent l’unité, la plaque et l’équipage. Jamais de diagnostic.', 'Details show the unit, plate and crew. Never a diagnosis.') },
      { ecran: 'secours', cible: '[data-prealerte]', st: ST('À l’arrivée, comparez l’unité et la plaque avec celles de la préalerte.', 'On arrival, compare the unit and plate with those of the pre-alert.') },
      { ecran: 'secours', cible: '[data-ls="confirmer_vehicule"]', st: ST('Si elles correspondent, confirmez le bon véhicule.', 'If they match, confirm the right vehicle.') },
      { ecran: 'secours', cible: '[data-ls="signaler_probleme"]', st: ST('Sinon, ou si l’urgence ne peut pas recevoir, signalez-le avec un motif : l’ambulance est réorientée.', 'Otherwise, or if the department cannot receive, report it with a reason: the ambulance is redirected.') },
      { ecran: 'chrono', cible: '.ch-porte', st: ST('Dans Chrono, la même ambulance apparaît « à la porte », avec son temps d’attente.', 'In Chrono, the same ambulance appears “at the door”, with its waiting time.') },
      { ecran: 'secours', cible: '[data-sillage]', st: ST('Le bouton Sillage montre toutes les étapes, horodatées une seule fois pour tous.', 'The Trail button shows every step, time-stamped once for everyone.') },
    ],
    quiz: [
      Q('Une ambulance arrive. L’unité affichée est DM-101, la plaque ne correspond pas à la préalerte. Que faites-vous ?', 'An ambulance arrives. The unit shown is DM-101 but the plate does not match the pre-alert. What do you do?',
        ['Je confirme le véhicule quand même', 'Je signale un problème avec le motif « mauvais véhicule »', 'J’attends sans rien faire'], ['I confirm the vehicle anyway', 'I report a problem with the reason “wrong vehicle”', 'I wait and do nothing'], 1),
      Q('L’urgence ne peut plus recevoir cette ambulance. Comment la réorienter ?', 'The department can no longer receive this ambulance. How do you redirect it?',
        ['Par téléphone seulement', 'En signalant un problème avec un motif dans la préalerte', 'En supprimant la préalerte'], ['By phone only', 'By reporting a problem with a reason in the pre-alert', 'By deleting the pre-alert'], 1),
      Q('Que montre la préalerte au personnel de l’urgence ?', 'What does the pre-alert show emergency staff?',
        ['Le diagnostic du patient', 'L’unité, la plaque, la priorité déclarée et l’heure d’arrivée', 'Le dossier médical complet'], ['The patient’s diagnosis', 'Unit, plate, declared priority and arrival time', 'The full medical record'], 1),
    ] }),
  C('S3', 'liaison_secours', '🚑', 150, 'Suivre les unités et les missions', 'Follow units and missions'),
  C('S4', 'liaison_secours', '🚑', 150, 'Superviser : préalertes non reçues ou non prises en compte', 'Supervise: pre-alerts not received or not acknowledged'),
  // ---------------------------------------------------------------- ⏱️ Chrono
  C('C1', 'chrono', '⏱️', 150, 'Marquer le triage et la civière libérée', 'Mark triage and stretcher released', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez enregistrer, d’un clic, les heures de triage et de civière libérée.', 'You will know how to record triage and stretcher-released times in one click.'),
    scenes: [
      { ecran: 'chrono', cible: '#onglets button[data-v="chrono"]', st: ST('Ouvrez Chrono : les ambulances en route, à la porte et terminées.', 'Open Chrono: ambulances en route, at the door and completed.') },
      { ecran: 'chrono', cible: '.ch-porte', st: ST('Chaque ambulance à la porte a son temps d’attente, en orange puis en rouge selon la cible.', 'Each ambulance at the door shows its waiting time, orange then red against the target.') },
      { ecran: 'chrono', cible: '[data-ch-etape]', st: ST('Le bouton propose la prochaine étape : début du triage, fin du triage, civière libérée.', 'The button offers the next step: triage start, triage end, stretcher released.') },
      { ecran: 'chrono', cible: '.ch-porte', st: ST('Un clic suffit : l’heure est la même pour l’urgence, l’ambulance et le CCS.', 'One click is enough: the time is the same for the department, the ambulance and the communication centre.') },
    ],
    quiz: [
      Q('Que se passe-t-il quand vous cliquez « Civière libérée » ?', 'What happens when you click “Stretcher released”?',
        ['L’heure est enregistrée une fois, pour tous', 'Une prime est calculée', 'Le patient est transféré'], ['The time is recorded once, for everyone', 'A bonus is calculated', 'The patient is transferred'], 0),
      Q('Le chrono d’une ambulance à la porte passe au rouge. Cela veut dire :', 'An ambulance timer at the door turns red. This means:',
        ['La cible de temps est dépassée', 'L’ambulance est repartie', 'Le patient est instable'], ['The time target is exceeded', 'The ambulance has left', 'The patient is unstable'], 0),
      Q('Qui voit les heures du Chrono ?', 'Who sees Chrono times?',
        ['Seulement l’urgence', 'L’urgence, l’entreprise ambulancière et le CCS', 'Le public'], ['Only the emergency department', 'The department, the ambulance company and the communication centre', 'The public'], 1),
    ] }),
  C('C2', 'chrono', '⏱️', 120, 'Corriger une heure avec un motif', 'Correct a time with a reason', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez corriger une heure oubliée sans effacer l’originale.', 'You will know how to correct a forgotten time without erasing the original.'),
    scenes: [
      { ecran: 'chrono', cible: '[data-ch-corriger]', st: ST('Vous avez oublié de cliquer au bon moment ? Ouvrez « Corriger l’heure ».', 'Forgot to click at the right moment? Open “Correct the time”.') },
      { ecran: 'chrono', cible: '.ch-porte', st: ST('Choisissez l’étape, l’heure réelle et un motif dans la liste : oubli, erreur de saisie, panne du réseau…', 'Choose the step, the actual time and a reason from the list: forgotten, input error, network outage…') },
      { ecran: 'chrono', cible: '[data-sillage]', st: ST('L’heure d’origine reste lisible : la correction est tracée avec votre nom et le motif.', 'The original time stays readable: the correction is logged with your name and the reason.') },
    ],
    quiz: [
      Q('Une correction d’heure…', 'A time correction…', ['Efface l’heure d’origine', 'Ajoute une nouvelle heure, tracée avec l’auteur et le motif', 'Est invisible'], ['Erases the original time', 'Adds a new time, logged with author and reason', 'Is invisible'], 1),
      Q('Le motif d’une correction est :', 'The reason for a correction is:', ['Un texte libre', 'Choisi dans une liste fermée', 'Facultatif'], ['Free text', 'Chosen from a closed list', 'Optional'], 1),
      Q('Une étape jamais cliquée est-elle estimée par Arrimo ?', 'Is a step never clicked estimated by Arrimo?', ['Oui, automatiquement', 'Non, jamais', 'Seulement la nuit'], ['Yes, automatically', 'No, never', 'Only at night'], 1),
    ] }),
  C('C3', 'chrono', '⏱️', 150, 'Lire le rapport mensuel du Chrono', 'Read the monthly Chrono report'),
  // ---------------------------------------------------------------- 🚨 Urgences en direct
  C('U1', 'urgences_direct', '🚨', 120, 'Déclarer le statut de l’urgence', 'Declare the emergency department status', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez déclarer l’état de votre urgence pour que les ambulances le voient avant de partir.', 'You will know how to declare your department’s status so ambulances see it before leaving.'),
    scenes: [
      { ecran: 'secours', sous: 'urgence', cible: '.chips:has([data-ls-urg])', st: ST('Dans Liaison Secours, déclarez l’état de votre urgence en un clic.', 'In Emergency liaison, declare your department’s status in one click.') },
      { ecran: 'secours', sous: 'urgence', cible: '.chips:has([data-ls-urg])', st: ST('L’heure et votre nom accompagnent chaque déclaration ; une déclaration ancienne est signalée comme périmée.', 'Each declaration carries the time and your name; an old declaration is flagged as stale.') },
      { ecran: 'secours', sous: 'urgence', cible: '#onglets button[data-v="secours"]', st: ST('Les ambulances et le CCS voient votre statut sur leur téléphone avant de partir.', 'Ambulances and the communication centre see your status on their phone before leaving.') },
    ],
    quiz: [
      Q('Qui déclare le statut de l’urgence ?', 'Who declares the department status?', ['Arrimo, automatiquement', 'Une personne de l’urgence', 'Le CCS'], ['Arrimo, automatically', 'A person from the department', 'The communication centre'], 1),
      Q('Une déclaration vieille de plusieurs heures :', 'A declaration several hours old:', ['Est signalée comme périmée', 'Est effacée', 'Devient « fermée »'], ['Is flagged as stale', 'Is deleted', 'Becomes “closed”'], 0),
      Q('Arrimo peut-il déduire que votre urgence est fermée ?', 'Can Arrimo infer that your department is closed?', ['Oui', 'Non, jamais'], ['Yes', 'No, never'], 1),
    ] }),
  C('U2', 'urgences_direct', '🚨', 150, 'Planifier une fermeture', 'Plan a closure'),
  C('U3', 'urgences_direct', '🚨', 120, 'Consulter les urgences avant de partir', 'Check emergency departments before leaving'),
  // ---------------------------------------------------------------- 🔁 Transferts
  C('T1', null, '🔁', 180, 'Demander un transfert', 'Request a transfer'),
  C('T2', null, '🔁', 150, 'Accepter ou refuser un transfert avec motif', 'Accept or decline a transfer with a reason'),
  C('T3', 'transferts_suivi', '🔁', 150, 'Fiche du transfert, délais et alertes', 'Transfer sheet, timelines and alerts'),
  C('T4', 'transferts_suivi', '🔁', 120, 'Rapatriement proposé', 'Suggested repatriation'),
  // ---------------------------------------------------------------- 🚐 Transport
  C('R1', 'transport_planifie', '🚐', 150, 'Réserver un transport non urgent', 'Book a non-urgent transport'),
  C('R2', 'transport_planifie', '🚐', 120, 'Confirmer ou refuser une plage de transport', 'Confirm or decline a transport time slot'),
  // ---------------------------------------------------------------- 🏥 Hôpital et NSA
  C('H1', null, '🛏️', 150, 'Lits : réserver, occuper, libérer', 'Beds: reserve, occupy, release', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez changer l’état d’un lit, et pourquoi certaines actions vous sont refusées.', 'You will know how to change a bed’s status, and why some actions are refused.'),
    scenes: [
      { ecran: 'lits', cible: '#onglets button[data-v="lits"]', st: ST('Ouvrez Lits : chaque lit, unité par unité, avec son état.', 'Open Beds: every bed, unit by unit, with its status.') },
      { ecran: 'lits', cible: '#v-lits', st: ST('Libre, réservé, occupé, en nettoyage ou fermé : l’état se met à jour pour toute l’équipe.', 'Free, reserved, occupied, cleaning or closed: the status updates for the whole team.') },
      { ecran: 'lits', cible: '#v-lits', st: ST('Choisissez un lit, puis l’action proposée. Seules les actions permises par votre rôle apparaissent.', 'Pick a bed, then the offered action. Only actions allowed by your role appear.') },
      { ecran: 'lits', cible: '#v-lits', st: ST('Si un collègue a changé le lit avant vous, Arrimo refuse et vous montre le nouvel état.', 'If a colleague changed the bed before you, Arrimo refuses and shows the new status.') },
    ],
    quiz: [
      Q('Un lit libéré par un congé devient :', 'A bed freed by a discharge becomes:', ['Libre immédiatement', 'À nettoyer, puis libre après confirmation de l’entretien', 'Fermé'], ['Free immediately', 'To clean, then free once housekeeping confirms', 'Closed'], 1),
      Q('Deux personnes réservent le même lit en même temps :', 'Two people reserve the same bed at the same time:', ['Les deux réussissent', 'Une seule réussit, l’autre voit le nouvel état', 'Le lit est bloqué'], ['Both succeed', 'Only one succeeds, the other sees the new status', 'The bed is locked'], 1),
      Q('Que voit-on d’un patient sur un lit ?', 'What is shown about a patient in a bed?', ['Son diagnostic', 'Une référence, jamais de diagnostic', 'Son adresse'], ['Their diagnosis', 'A reference, never a diagnosis', 'Their address'], 1),
    ] }),
  C('H2', null, '🛏️', 150, 'Admissions et file d’attente', 'Admissions and queue', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez créer une demande d’admission et suivre la file priorisée.', 'You will know how to create an admission request and follow the prioritized queue.'),
    scenes: [
      { ecran: 'admissions', cible: '#onglets button[data-v="admissions"]', st: ST('Ouvrez Admissions : la file des patients qui attendent un lit.', 'Open Admissions: the queue of patients waiting for a bed.') },
      { ecran: 'admissions', cible: '#v-admissions', st: ST('Créez une demande avec la référence du patient et l’unité souhaitée.', 'Create a request with the patient reference and the requested unit.') },
      { ecran: 'admissions', cible: '#v-admissions', st: ST('La file est priorisée ; la coordination attribue le lit qui respecte les besoins du patient.', 'The queue is prioritized; coordination assigns a bed that meets the patient’s needs.') },
    ],
    quiz: [
      Q('Pour créer une demande d’admission, il faut :', 'To create an admission request, you need:', ['La référence du patient et l’unité', 'Le diagnostic', 'Le numéro d’assurance maladie'], ['The patient reference and the unit', 'The diagnosis', 'The health insurance number'], 0),
      Q('Qui attribue le lit ?', 'Who assigns the bed?', ['Arrimo, seul', 'La coordination, avec l’aide d’OG', 'Le patient'], ['Arrimo, alone', 'Coordination, helped by OG', 'The patient'], 1),
      Q('OG peut-il préparer une demande ?', 'Can OG prepare a request?', ['Oui, une personne la confirme', 'Non', 'Oui, il l’envoie seul'], ['Yes, a person confirms it', 'No', 'Yes, it sends it alone'], 0),
    ] }),
  C('H3', 'nettoyage', '🧽', 120, 'Nettoyage prioritaire', 'Priority cleaning'),
  C('H4', 'nsa', '🏥', 180, 'Épisode NSA et orientation', 'ALC episode and orientation'),
  C('H5', 'nsa', '🏥', 180, 'Places compatibles et demande d’hébergement', 'Compatible places and placement request'),
  C('H6', null, '🏥', 150, 'Congés prévus et vigilance des lits', 'Planned discharges and bed watch'),
  // ---------------------------------------------------------------- 🏡 Hébergement
  C('E1', null, '🏡', 150, 'Résidents et chambres', 'Residents and rooms'),
  C('E2', 'demandes_hebergement', '🏡', 180, 'Recevoir une demande d’hébergement', 'Receive a placement request'),
  C('E3', 'hospitalisations', '🏡', 150, 'Départ vers l’hôpital et retour', 'Departure to hospital and return'),
  C('E4', 'taches', '🏡', 120, 'Tâches et entretien des chambres', 'Tasks and room upkeep'),
  // ---------------------------------------------------------------- 🛏️ Bourse
  C('B1', 'bourse_places', '🛏️', 150, 'Chercher une place avec les filtres', 'Search for a place with filters'),
  C('B2', 'bourse_places', '🛏️', 120, 'Fiche de transfert d’une page', 'One-page transfer sheet'),
  C('B3', 'bourse_places', '🛏️', 120, 'Inviter un professionnel externe', 'Invite an external professional'),
  // ---------------------------------------------------------------- ✅ Visites confirmées
  C('V1', 'visites_confirmees', '✅', 150, 'Planifier les visites', 'Plan visits'),
  C('V2', 'visites_confirmees', '✅', 120, 'Confirmer son arrivée et son départ', 'Confirm arrival and departure'),
  C('V3', 'visites_confirmees', '✅', 120, 'Visite manquée : agir', 'Missed visit: take action'),
  // ---------------------------------------------------------------- 🛡️ Avant l'appel
  C('A1', 'eviter_transferts', '🛡️', 120, 'Utiliser la liste avant l’appel', 'Use the before-calling checklist'),
  C('A2', 'eviter_transferts', '🛡️', 120, 'Écrire la liste de l’établissement', 'Write the facility’s checklist'),
  // ---------------------------------------------------------------- 📊 Données
  C('D1', 'donnees_regionales', '📊', 150, 'Lire le tableau régional', 'Read the regional table'),
  C('D2', 'donnees_regionales', '📊', 120, 'Listes d’attente et export', 'Waiting lists and export'),
  // ---------------------------------------------------------------- 🆘 Mode crise
  C('K1', 'mode_crise', '🆘', 150, 'Déclencher une évacuation', 'Start an evacuation'),
  C('K2', 'mode_crise', '🆘', 180, 'Confirmer les lieux et suivre l’évacuation', 'Confirm places and follow the evacuation'),
  // ---------------------------------------------------------------- 👨‍👩‍👧 Famille
  C('F1', 'portail_proches', '👨‍👩‍👧', 120, 'Le portail des proches', 'The relatives’ portal'),
  C('F2', 'portail_proches', '👨‍👩‍👧', 120, 'Inviter un proche', 'Invite a relative'),
  // ---------------------------------------------------------------- Console SH
  C('SH1', null, '🧩', 150, 'Activer un module et gérer les comptes', 'Turn on a module and manage accounts'),
  // ---------------------------------------------------------------- ✨🧭👁️ Transversal
  C('O1', null, '✨', 120, 'Demander à OG', 'Ask OG', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez poser une question à OG et utiliser sa réponse, sans lui laisser la décision.', 'You will know how to ask OG a question and use its answer, without leaving the decision to it.'),
    scenes: [
      { ecran: 'copilote', cible: '#og-open', st: ST('OG est présent sur chaque écran : ouvrez-le avec ce bouton.', 'OG is on every screen: open it with this button.') },
      { ecran: 'copilote', cible: '#og-open', st: ST('Demandez par exemple : « Qu’est-ce qui est en attente ? » ou « Explique le parcours PA-000002 ».', 'Ask for example: “What is pending?” or “Explain path PA-000002”.') },
      { ecran: 'copilote', cible: '#v-copilote', st: ST('OG explique et propose. Il ne voit que ce que vous avez le droit de voir, et ne décide jamais.', 'OG explains and suggests. It only sees what you are allowed to see, and never decides.') },
    ],
    quiz: [
      Q('OG peut-il valider une action à votre place ?', 'Can OG approve an action for you?', ['Oui', 'Non, une personne confirme toujours'], ['Yes', 'No, a person always confirms'], 1),
      Q('OG voit :', 'OG sees:', ['Toutes les données du réseau', 'Seulement ce que votre rôle permet', 'Les diagnostics'], ['All network data', 'Only what your role allows', 'Diagnoses'], 1),
      Q('Pour comprendre où en est une ambulance annoncée, vous pouvez demander :', 'To understand where an announced ambulance stands, you can ask:', ['« Explique le parcours PA-… »', '« Supprime la préalerte »', 'Rien'], ['“Explain path PA-…”', '“Delete the pre-alert”', 'Nothing'], 0),
    ] }),
  C('O2', null, '🧭', 120, 'Ouvrir le Sillage d’un parcours', 'Open a journey Trail', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez retrouver toutes les étapes d’un parcours, d’un module à l’autre.', 'You will know how to find every step of a journey, across modules.'),
    scenes: [
      { ecran: 'chrono', cible: '[data-sillage]', st: ST('Le bouton Sillage est présent dans chaque module.', 'The Trail button is in every module.') },
      { ecran: 'chrono', cible: '[data-sillage]', st: ST('Il montre les étapes liées sous un même numéro, avec l’heure, la source et l’auteur.', 'It shows linked steps under one number, with time, source and author.') },
      { ecran: 'chrono', cible: '[data-sillage]', st: ST('Une étape non confirmée est signalée ; une étape chez un autre organisme reste cachée.', 'An unconfirmed step is flagged; a step at another organization stays hidden.') },
    ],
    quiz: [
      Q('Le Sillage montre les étapes :', 'The Trail shows steps:', ['De tous les patients du réseau', 'Du parcours, selon vos droits', 'Inventées par Arrimo'], ['Of every patient in the network', 'Of the journey, per your permissions', 'Invented by Arrimo'], 1),
      Q('Une heure corrigée apparaît :', 'A corrected time appears:', ['Avec la mention « corrigée »', 'Sans aucune trace', 'En rouge clignotant'], ['Marked “corrected”', 'With no trace', 'Flashing red'], 0),
      Q('Les étapes liées partagent :', 'Linked steps share:', ['Le même numéro de parcours', 'Le diagnostic', 'Le même mot de passe'], ['The same journey number', 'The diagnosis', 'The same password'], 0),
    ] }),
  C('O3', null, '👁️', 120, 'Lire la Vigilance', 'Read the Watch list', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    objectif: ST('Vous saurez repérer ce qui attend une action : confirmations manquantes et délais dépassés.', 'You will know how to spot what needs action: missing confirmations and passed deadlines.'),
    scenes: [
      { ecran: 'vigilance', sous: 'parcours', cible: '#sillage-vigilance', st: ST('Ouvrez Congés et alertes : la section « Parcours à surveiller » liste ce qui attend.', 'Open Discharges & alerts: “Paths to watch” lists what is waiting.') },
      { ecran: 'vigilance', sous: 'parcours', cible: '#sillage-vigilance', st: ST('Une ligne par fait : confirmation manquante, civière au-delà de la cible, étape non confirmée.', 'One line per fact: missing confirmation, stretcher beyond target, unconfirmed step.') },
      { ecran: 'vigilance', sous: 'parcours', cible: '#sillage-vigilance', st: ST('Quand l’étape est faite, la ligne disparaît d’elle-même : pas d’alerte répétée.', 'Once the step is done, the line disappears on its own: no repeated alerts.') },
    ],
    quiz: [
      Q('Une ligne de Vigilance disparaît quand :', 'A Watch line disappears when:', ['On la masque', 'L’étape attendue est faite', 'Le lendemain'], ['You hide it', 'The expected step is done', 'The next day'], 1),
      Q('« Confirmation manquante » veut dire :', '“Missing confirmation” means:', ['Une demande attend au-delà de son délai configuré', 'Le patient est absent', 'Une erreur informatique'], ['A request is waiting beyond its configured delay', 'The patient is absent', 'A computer error'], 0),
      Q('La Vigilance envoie-t-elle la même alerte plusieurs fois ?', 'Does Watch send the same alert several times?', ['Oui, toutes les minutes', 'Non, une ligne par fait'], ['Yes, every minute', 'No, one line per fact'], 1),
    ] }),
];

const TRANSVERSAL = ['O1', 'O2', 'O3'];
const ROLES_HOPITAL = ['coordonnateur', 'admin_etab', 'equipe_soins', 'gestionnaire'];
const P = (code, emoji, fr, en, { roles, types = null, locaux = null, capsules, defaut = null }) => ({ code, emoji, nom: { fr, en }, roles, types, locaux, capsules, defaut });
const PARCOURS = [
  P('triage', '🚨', 'Triage / AIC', 'Triage nurse', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['S2', 'C1', 'C2', 'U1', 'H1', 'H2', ...TRANSVERSAL], defaut: ['equipe_soins'] }),
  P('lits', '🛏️', 'Gestion des lits', 'Bed management', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['T1', 'T2', 'T3', 'R1', 'H1', 'H2', 'H6', ...TRANSVERSAL], defaut: ['coordonnateur'] }),
  P('nsa', '🏥', 'Coordination NSA et liaison', 'ALC coordination and liaison', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['R1', 'H4', 'H5', 'E2', 'E3', 'B1', 'B2', 'B3', 'D2', ...TRANSVERSAL] }),
  P('chef_unite', '🩺', 'Chef d’unité', 'Unit manager', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['C3', 'U1', 'U2', 'T2', 'H1', 'H4', 'H6', 'D1', ...TRANSVERSAL] }),
  P('hygiene', '🧽', 'Hygiène et salubrité', 'Housekeeping', { roles: ['entretien'], capsules: ['H3', 'E4', ...TRANSVERSAL], defaut: ['entretien'] }),
  P('chsld', '🏡', 'Coordination CHSLD', 'Long-term care coordination', { roles: ROLES_HOPITAL, types: ['chsld'], locaux: [null, 'chsld', 'chsld_prive', 'maison_aines'], capsules: ['R1', 'E1', 'E2', 'E3', 'E4', 'B1', 'V1', 'V3', 'A1', 'K1', 'K2', 'F2', ...TRANSVERSAL], defaut: ['coordonnateur', 'equipe_soins'] }),
  P('rpa', '🏘️', 'RPA, RI, RTF', 'Seniors’ residences and resources', { roles: ROLES_HOPITAL, types: ['chsld'], locaux: ['rpa', 'ri', 'rtf', 'maison_retraite', 'soins_palliatifs', 'hospitalisation_domicile', 'sante_mentale'], capsules: ['R1', 'E1', 'E2', 'E3', 'V1', 'V3', 'A1', 'K1', 'K2', 'F2', ...TRANSVERSAL], defaut: ['coordonnateur', 'equipe_soins'] }),
  P('intervenant', '✅', 'Intervenant CLSC', 'CLSC worker', { roles: ['intervenant'], capsules: ['V2', ...TRANSVERSAL], defaut: ['intervenant'] }),
  P('repartiteur', '📡', 'Répartiteur CCS', 'Communication centre dispatcher', { roles: ['repartiteur'], capsules: ['S3', 'S4', 'C3', 'U3', ...TRANSVERSAL], defaut: ['repartiteur'] }),
  P('ambulancier', '🚑', 'Ambulancier', 'Paramedic', { roles: ['paramedic'], capsules: ['S1', 'C1', 'C2', 'U3', ...TRANSVERSAL], defaut: ['paramedic'] }),
  P('superviseur', '🧑‍✈️', 'Superviseur ambulancier', 'Paramedic supervisor', { roles: ['superviseur_secours'], capsules: ['S1', 'S3', 'S4', 'C2', 'C3', ...TRANSVERSAL], defaut: ['superviseur_secours'] }),
  P('transporteur', '🚐', 'Transporteur', 'Carrier', { roles: ['paramedic', 'superviseur_secours'], capsules: ['R2', ...TRANSVERSAL] }),
  P('transferts', '🔁', 'Coordination des transferts', 'Transfer coordination', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['T1', 'T2', 'T3', 'T4', 'R1', 'B1', ...TRANSVERSAL] }),
  P('direction', '🗺️', 'Direction régionale', 'Regional health authority', { roles: ['direction_regionale'], capsules: ['C3', 'T3', 'B1', 'D1', 'D2', 'K2', ...TRANSVERSAL], defaut: ['direction_regionale'] }),
  P('famille', '👨‍👩‍👧', 'Famille', 'Family', { roles: [], capsules: ['F1'] }),
  P('admin', '🧩', 'Administrateur d’établissement', 'Facility administrator', { roles: ['admin_etab', 'gestionnaire'], capsules: ['U2', 'B3', 'A2', 'K1', 'SH1', ...TRANSVERSAL], defaut: ['admin_etab'] }),
  P('formateur', '🎓', 'Formateur / superutilisateur', 'Trainer / super-user', { roles: ['gestionnaire'], capsules: CAPSULES.map((c) => c.code), defaut: ['gestionnaire'] }),
];

const capsule = (code) => CAPSULES.find((c) => c.code === code) || null;
const parcours = (code) => PARCOURS.find((p) => p.code === code) || null;
module.exports = { CAPSULES, PARCOURS, TRANSVERSAL, capsule, parcours };
