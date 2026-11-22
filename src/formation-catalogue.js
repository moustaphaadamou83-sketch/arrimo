'use strict';
/**
 * Module 🎓 Formation (22 nov. 2026, cahier « Formation » ; plan : docs/plan-module-formation.md).
 * Catalogue versionné avec le code : 17 parcours par rôle, 52 capsules (dont 8 du cahier ultime et du cahier directeur : X1 à X8) (une tâche, 2 à 3 min), FR et EN.
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
  C('S1', 'liaison_secours', '🚑', 150, 'Envoyer une préalerte', 'Send a pre-alert', {
    pret: true, compte: 'ambulance.demo@demo.arrimo',
    exercice: [{ scene: 2, consigne: ST('Choisissez l’urgence de destination.', 'Choose the destination department.') }, { scene: 3, consigne: ST('Indiquez la priorité déclarée.', 'Set the declared priority.') }, { scene: 4, consigne: ST('Envoyez la préalerte.', 'Send the pre-alert.') }],
    objectif: ST('Vous saurez prévenir l’urgence de destination en un geste, même si le réseau coupe.', 'You will know how to warn the destination emergency department in one tap, even if the network drops.'),
    scenes: [
      { onglet: 'mission', cible: '[data-onglet="mission"]', st: ST('Ouvrez « Mission » : tout se fait sur un seul écran, pensé pour le téléphone.', 'Open “Mission”: everything happens on one screen, designed for the phone.') },
      { onglet: 'mission', cible: '[data-choix="destination"]', st: ST('Choisissez l’urgence de destination. Son statut déclaré s’affiche à côté.', 'Choose the destination emergency department. Its declared status is shown alongside.') },
      { onglet: 'mission', cible: '[data-choix="priorite"]', st: ST('Indiquez la priorité que vous déclarez, puis la catégorie : jamais de diagnostic.', 'Set the priority you declare, then the category: never a diagnosis.') },
      { onglet: 'mission', cible: '[data-act="envoyer"]', st: ST('Envoyez. Sans réseau, la préalerte attend et part dès que le réseau revient, sans doublon.', 'Send. With no network, the pre-alert waits and goes out as soon as the network is back, with no duplicate.') },
      { onglet: 'mission', cible: '#contenu', st: ST('Vous voyez ensuite quand l’urgence l’a reçue, puis prise en compte.', 'You then see when the department received it, then acknowledged it.') },
    ],
    quiz: [
      Q('La préalerte contient :', 'The pre-alert contains:', ['Le diagnostic du patient', 'La priorité déclarée et une catégorie, sans diagnostic', 'Le nom du patient'], ['The patient’s diagnosis', 'The declared priority and a category, no diagnosis', 'The patient’s name'], 1),
      Q('Le réseau coupe au moment d’envoyer :', 'The network drops as you send:', ['La préalerte est perdue', 'Elle part dès que le réseau revient, sans doublon', 'Il faut tout recommencer'], ['The pre-alert is lost', 'It goes out as soon as the network is back, with no duplicate', 'You must start over'], 1),
      Q('Qui décide de la destination ?', 'Who decides the destination?', ['Arrimo', 'L’équipe et les protocoles applicables', 'L’urgence'], ['Arrimo', 'The crew and the applicable protocols', 'The emergency department'], 1),
    ] }),
  C('S2', 'liaison_secours', '🚑', 180, 'Prendre en compte une préalerte et confirmer le bon véhicule', 'Acknowledge a pre-alert and confirm the right vehicle', {
    pret: true, compte: 'hopital.a@demo.arrimo', chrono_test_s: 60,
    exercice: [{ scene: 4, consigne: ST('Prenez en compte la préalerte qui arrive.', 'Acknowledge the incoming pre-alert.') }, { scene: 5, consigne: ST('Ouvrez les détails pour vérifier l’unité et la plaque.', 'Open the details to check the unit and plate.') }, { scene: 8, consigne: ST('La plaque ne correspond pas : signalez un problème.', 'The plate does not match: report a problem.') }],
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
  C('S3', 'liaison_secours', '🚑', 150, 'Suivre les unités et les missions', 'Follow units and missions', {
    pret: true, compte: 'ccs.demo@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez la flotte.', 'Open the fleet.') }],
    objectif: ST('Vous saurez voir la flotte de la région et l’état de chaque unité.', 'You will know how to see the region’s fleet and each unit’s status.'),
    scenes: [
      { onglet: 'flotte', cible: '[data-onglet="flotte"]', st: ST('Ouvrez « Flotte » : toutes les unités de la région.', 'Open “Fleet”: every unit in the region.') },
      { onglet: 'flotte', cible: '#contenu', st: ST('Chaque unité montre son état déclaré par l’équipage : disponible, en route, à l’hôpital…', 'Each unit shows the status declared by its crew: available, en route, at hospital…') },
      { onglet: 'regional', cible: '[data-onglet="regional"]', st: ST('La vue régionale place les unités et les urgences sur la carte.', 'The regional view places units and departments on the map.') },
    ],
    quiz: [
      Q('L’état d’une unité est déclaré par :', 'A unit’s status is declared by:', ['Le CCS', 'L’équipage, en un geste', 'Arrimo, au hasard'], ['The communication centre', 'The crew, in one tap', 'Arrimo, randomly'], 1),
      Q('Arrimo attribue-t-il les unités ?', 'Does Arrimo assign units?', ['Oui', 'Non : la répartition reste dans le système du CCS'], ['Yes', 'No: dispatching stays in the centre’s system'], 1),
      Q('La vue régionale montre :', 'The regional view shows:', ['Les unités et les urgences sur la carte', 'Les diagnostics', 'Les salaires'], ['Units and departments on the map', 'Diagnoses', 'Salaries'], 0),
    ] }),
  C('S4', 'liaison_secours', '🚑', 150, 'Superviser : préalertes non reçues ou non prises en compte', 'Supervise: pre-alerts not received or not acknowledged', {
    pret: true, compte: 'ccs.demo@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les préalertes de la région.', 'Open the region’s pre-alerts.') }],
    objectif: ST('Vous saurez repérer une préalerte qui n’a pas été vue à l’urgence.', 'You will know how to spot a pre-alert that was not seen at the department.'),
    scenes: [
      { onglet: 'prealertes', cible: '[data-onglet="prealertes"]', st: ST('Ouvrez « Préalertes » : toutes celles de la région.', 'Open “Pre-alerts”: all of the region’s.') },
      { onglet: 'prealertes', cible: '#contenu', st: ST('Une préalerte non reçue ou non prise en compte au-delà du délai est signalée.', 'A pre-alert not received or not acknowledged beyond the delay is flagged.') },
      { onglet: 'prealertes', cible: '#contenu', st: ST('Contactez l’urgence concernée ; la préalerte reste tracée.', 'Contact the department concerned; the pre-alert stays logged.') },
    ],
    quiz: [
      Q('Une préalerte « non prise en compte » veut dire :', 'A pre-alert “not acknowledged” means:', ['Personne à l’urgence ne l’a confirmée', 'Elle est annulée', 'Elle est arrivée'], ['Nobody at the department has confirmed it', 'It is cancelled', 'It has arrived'], 0),
      Q('Le délai d’alerte est :', 'The alert delay is:', ['Configuré', 'Aléatoire', 'Inexistant'], ['Configured', 'Random', 'Non-existent'], 0),
      Q('Que faites-vous ?', 'What do you do?', ['Je contacte l’urgence', 'Je supprime la préalerte', 'Rien'], ['I contact the department', 'I delete the pre-alert', 'Nothing'], 0),
    ] }),
  // ---------------------------------------------------------------- ⏱️ Chrono
  C('C1', 'chrono', '⏱️', 150, 'Marquer le triage et la civière libérée', 'Mark triage and stretcher released', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez Chrono.', 'Open Chrono.') }, { scene: 3, consigne: ST('Enregistrez la prochaine étape de l’ambulance à la porte.', 'Record the next step for the ambulance at the door.') }],
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
    exercice: [{ scene: 1, consigne: ST('Une heure a été oubliée : ouvrez la correction.', 'A time was forgotten: open the correction.') }],
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
  C('C3', 'chrono', '⏱️', 150, 'Lire le rapport mensuel du Chrono', 'Read the monthly Chrono report', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez le rapport et les écarts.', 'Open the report and gaps.') }],
    objectif: ST('Vous saurez lire les moyennes, médianes et le taux hors cible, et exporter le rapport.', 'You will know how to read averages, medians and the over-target rate, and export the report.'),
    scenes: [
      { ecran: 'chrono', sous: 'rapport', cible: '#v-chrono [data-so="rapport"]', st: ST('Ouvrez Chrono, sous-onglet « Rapport et écarts ».', 'Open Chrono, “Report and gaps” sub-tab.') },
      { ecran: 'chrono', sous: 'rapport', cible: '#ch-rapport', st: ST('Pour le mois : passages, moyenne, médiane, et % hors cible pour la porte, la sortie et le total.', 'For the month: visits, average, median, and % over target for the door, departure and total.') },
      { ecran: 'chrono', sous: 'rapport', cible: '#ch-rapport', st: ST('Les étapes manquantes sont comptées, jamais estimées. Exportez en CSV.', 'Missing steps are counted, never estimated. Export as CSV.') },
    ],
    quiz: [
      Q('Une étape manquante dans le rapport est :', 'A missing step in the report is:', ['Estimée', 'Comptée comme manquante', 'Supprimée'], ['Estimated', 'Counted as missing', 'Deleted'], 1),
      Q('« Hors cible » veut dire :', '“Over target” means:', ['Au-delà du temps cible configuré', 'Un patient perdu', 'Une erreur'], ['Beyond the configured target time', 'A lost patient', 'An error'], 0),
      Q('Le rapport sert à :', 'The report is used to:', ['Calculer des pénalités', 'Mesurer et améliorer, sans prime ni pénalité', 'Rien'], ['Calculate penalties', 'Measure and improve, with no bonus or penalty', 'Nothing'], 1),
    ] }),
  // ---------------------------------------------------------------- 🚨 Urgences en direct
  C('U1', 'urgences_direct', '🚨', 120, 'Déclarer le statut de l’urgence', 'Declare the emergency department status', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Déclarez le statut de votre urgence.', 'Declare your department’s status.') }],
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
  C('U2', 'urgences_direct', '🚨', 150, 'Planifier une fermeture', 'Plan a closure', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez le statut et les fermetures.', 'Open status and closures.') }],
    objectif: ST('Vous saurez annoncer une fermeture planifiée aux secours et aux urgences voisines.', 'You will know how to announce a planned closure to emergency services and nearby departments.'),
    scenes: [
      { ecran: 'secours', sous: 'urgence', cible: '#v-secours [data-so="urgence"]', st: ST('Dans Liaison Secours, ouvrez « Statut et fermetures ».', 'In Emergency liaison, open “Status and closures”.') },
      { ecran: 'secours', sous: 'urgence', cible: '#v-secours .panneau-c', st: ST('Planifiez une fermeture : services touchés, début et fin prévue.', 'Plan a closure: services affected, start and planned end.') },
      { ecran: 'secours', sous: 'urgence', cible: '#v-secours .panneau-c', st: ST('Les secours et les urgences voisines sont prévenus ; vous pouvez la modifier ou l’annuler.', 'Emergency services and nearby departments are notified; you can change or cancel it.') },
    ],
    quiz: [
      Q('Une fermeture planifiée est annoncée :', 'A planned closure is announced:', ['Aux secours et aux urgences voisines', 'Au public seulement', 'À personne'], ['To emergency services and nearby departments', 'To the public only', 'To nobody'], 0),
      Q('On peut l’annuler ?', 'Can it be cancelled?', ['Oui', 'Non'], ['Yes', 'No'], 0),
      Q('Une fermeture doit préciser :', 'A closure must state:', ['Les services touchés, le début et la fin prévue', 'Le diagnostic', 'Rien'], ['Services affected, start and planned end', 'The diagnosis', 'Nothing'], 0),
    ] }),
  C('U3', 'urgences_direct', '🚨', 120, 'Consulter les urgences avant de partir', 'Check emergency departments before leaving', {
    pret: true, compte: 'ambulance.demo@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez la liste des urgences de la région.', 'Open the list of the region’s departments.') }],
    objectif: ST('Vous saurez voir l’état déclaré des urgences de la région avant de partir.', 'You will know how to see the declared status of the region’s emergency departments before leaving.'),
    scenes: [
      { onglet: 'urgences', cible: '[data-onglet="urgences"]', st: ST('Ouvrez « Urgences » : les urgences de votre région, de la plus proche à la plus loin.', 'Open “Emergencies”: your region’s departments, nearest first.') },
      { onglet: 'urgences', cible: '#contenu', st: ST('Chaque urgence montre son statut déclaré, l’heure et les fermetures planifiées.', 'Each department shows its declared status, the time and planned closures.') },
      { onglet: 'urgences', cible: '#contenu', st: ST('Un statut ancien est signalé comme périmé : vérifiez avant de vous y fier.', 'An old status is flagged as stale: check before relying on it.') },
    ],
    quiz: [
      Q('Le statut d’une urgence est déclaré par :', 'A department’s status is declared by:', ['L’urgence elle-même', 'Arrimo', 'L’ambulancier'], ['The department itself', 'Arrimo', 'The paramedic'], 0),
      Q('Un statut marqué « périmé » :', 'A status marked “stale”:', ['Est fiable', 'Est ancien : à vérifier', 'Veut dire fermé'], ['Is reliable', 'Is old: check it', 'Means closed'], 1),
      Q('Les urgences sont classées :', 'Departments are listed:', ['Par ordre alphabétique', 'De la plus proche à la plus loin', 'Au hasard'], ['Alphabetically', 'Nearest first', 'Randomly'], 1),
    ] }),
  // ---------------------------------------------------------------- 🔁 Transferts
  C('T1', null, '🔁', 180, 'Demander un transfert', 'Request a transfer', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez Transferts.', 'Open Transfers.') }],
    objectif: ST('Vous saurez demander un transfert vers l’établissement le plus proche qui a un lit adapté.', 'You will know how to request a transfer to the nearest facility with a suitable bed.'),
    scenes: [
      { ecran: 'transferts', cible: '#onglets button[data-v="transferts"]', st: ST('Ouvrez Transferts : les demandes envoyées et reçues.', 'Open Transfers: requests sent and received.') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Demandez un transfert : unité demandée, puis destination, la plus proche qui a un lit confirmé.', 'Request a transfer: requested unit, then destination, the nearest with a confirmed bed.') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('La destination accepte ou refuse avec un motif ; vous suivez chaque étape.', 'The destination accepts or declines with a reason; you follow each step.') },
    ],
    quiz: [
      Q('Arrimo propose d’abord :', 'Arrimo first suggests:', ['Le plus grand hôpital', 'Le plus proche qui a un lit adapté, sauf s’il est débordé', 'Au hasard'], ['The biggest hospital', 'The nearest with a suitable bed, unless it is overloaded', 'Randomly'], 1),
      Q('La destination peut refuser :', 'The destination can decline:', ['Avec un motif', 'Sans rien dire', 'Jamais'], ['With a reason', 'Silently', 'Never'], 0),
      Q('Le patient est identifié par :', 'The patient is identified by:', ['Une référence', 'Son diagnostic', 'Son nom complet'], ['A reference', 'Their diagnosis', 'Their full name'], 0),
    ] }),
  C('T2', null, '🔁', 150, 'Accepter ou refuser un transfert avec motif', 'Accept or decline a transfer with a reason', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Repérez les demandes reçues.', 'Find the received requests.') }],
    objectif: ST('Vous saurez répondre à une demande de transfert dans le délai, avec un motif si vous refusez.', 'You will know how to answer a transfer request within the delay, with a reason if you decline.'),
    scenes: [
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Les demandes reçues attendent votre réponse ; le délai configuré s’affiche.', 'Received requests await your answer; the configured delay is shown.') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Acceptez en réservant un lit, ou refusez avec un motif : pas de lit, pas de personnel, plateau technique…', 'Accept by reserving a bed, or decline with a reason: no bed, no staff, technical platform…') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Un refus motivé alimente les données régionales : il aide à comprendre les blocages.', 'A reasoned decline feeds regional data: it helps understand blockages.') },
    ],
    quiz: [
      Q('Refuser un transfert demande :', 'Declining a transfer requires:', ['Un motif de la liste', 'Un appel', 'Rien'], ['A reason from the list', 'A call', 'Nothing'], 0),
      Q('Accepter réserve :', 'Accepting reserves:', ['Un lit', 'Une ambulance', 'Un médecin'], ['A bed', 'An ambulance', 'A doctor'], 0),
      Q('Une demande sans réponse au-delà du délai :', 'A request with no answer beyond the delay:', ['Est signalée dans la Vigilance', 'Est acceptée seule', 'Disparaît'], ['Is flagged in Watch', 'Is accepted automatically', 'Disappears'], 0),
    ] }),
  C('T3', 'transferts_suivi', '🔁', 150, 'Fiche du transfert, délais et alertes', 'Transfer sheet, timelines and alerts', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Repérez un transfert à ouvrir.', 'Find a transfer to open.') }],
    objectif: ST('Vous saurez ouvrir la fiche d’un transfert et lire ses délais et alertes.', 'You will know how to open a transfer sheet and read its timelines and alerts.'),
    scenes: [
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Chaque transfert a sa fiche : ouvrez-la avec « Fiche ».', 'Each transfer has its sheet: open it with “Sheet”.') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Demande, décision, départ, arrivée : chaque heure et chaque délai.', 'Request, decision, departure, arrival: every time and every delay.') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Une alerte s’affiche quand une étape dépasse son délai ; le Sillage montre tout le parcours.', 'An alert shows when a step exceeds its delay; the Trail shows the whole journey.') },
    ],
    quiz: [
      Q('La fiche montre :', 'The sheet shows:', ['Les heures et délais de chaque étape', 'Le diagnostic', 'Les salaires'], ['Times and delays of each step', 'The diagnosis', 'Salaries'], 0),
      Q('Une alerte de délai veut dire :', 'A delay alert means:', ['Une étape dépasse son délai configuré', 'Le patient est décédé', 'Une erreur'], ['A step exceeds its configured delay', 'The patient died', 'An error'], 0),
      Q('Pour tout le parcours, ouvrez :', 'For the whole journey, open:', ['Le Sillage', 'Les paramètres', 'Le journal'], ['The Trail', 'Settings', 'The log'], 0),
    ] }),
  C('T4', 'transferts_suivi', '🔁', 120, 'Rapatriement proposé', 'Suggested repatriation', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Repérez les transferts.', 'Find the transfers.') }],
    objectif: ST('Vous saurez répondre à un rapatriement proposé quand le patient est stable.', 'You will know how to answer a suggested repatriation once the patient is stable.'),
    scenes: [
      { ecran: 'transferts', cible: '#v-transferts', st: ST('Quand l’équipe déclare le patient stable pour un retour, un rapatriement est proposé.', 'When the team declares the patient stable for return, a repatriation is suggested.') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('L’établissement d’origine accepte, ou refuse avec un motif.', 'The original facility accepts, or declines with a reason.') },
      { ecran: 'transferts', cible: '#v-transferts', st: ST('La décision reste humaine ; Arrimo ne fait que proposer.', 'The decision stays human; Arrimo only suggests.') },
    ],
    quiz: [
      Q('Un rapatriement est proposé quand :', 'A repatriation is suggested when:', ['Le patient est déclaré stable pour un retour', 'Tous les jours', 'Jamais'], ['The patient is declared stable for return', 'Every day', 'Never'], 0),
      Q('Qui décide ?', 'Who decides?', ['Arrimo', 'Les équipes'], ['Arrimo', 'The teams'], 1),
      Q('Un refus de rapatriement :', 'A repatriation decline:', ['Est motivé', 'Est interdit', 'Est automatique'], ['Is reasoned', 'Is forbidden', 'Is automatic'], 0),
    ] }),
  // ---------------------------------------------------------------- 🚐 Transport
  C('R1', 'transport_planifie', '🚐', 150, 'Réserver un transport non urgent', 'Book a non-urgent transport', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez Transports.', 'Open Transports.') }, { scene: 2, consigne: ST('Réservez un transport.', 'Book a transport.') }],
    objectif: ST('Vous saurez réserver un retour à domicile ou un départ NSA, et suivre la plage confirmée.', 'You will know how to book a return home or an ALC departure, and follow the confirmed time slot.'),
    scenes: [
      { ecran: 'transports-planifies', cible: '#onglets button[data-v="transports-planifies"]', st: ST('Ouvrez Transports : les transports non urgents de votre établissement.', 'Open Transports: your facility’s non-urgent transports.') },
      { ecran: 'transports-planifies', cible: '#v-transports-planifies .btn.pri', st: ST('Cliquez « Réserver un transport » : motif, référence, destination, plage souhaitée, type de véhicule.', 'Click “Book a transport”: reason, reference, destination, requested slot, vehicle type.') },
      { ecran: 'transports-planifies', cible: '#v-transports-planifies table', st: ST('Le transporteur confirme une plage ou refuse avec un motif ; vous le voyez ici.', 'The carrier confirms a slot or declines with a reason; you see it here.') },
      { ecran: 'transports-planifies', cible: '[data-sillage]', st: ST('Le bouton Sillage suit le transport jusqu’à l’arrivée.', 'The Trail button follows the transport to arrival.') },
    ],
    quiz: [
      Q('Le transporteur voit :', 'The carrier sees:', ['Le diagnostic', 'La référence et les lieux seulement', 'Le dossier complet'], ['The diagnosis', 'The reference and places only', 'The full record'], 1),
      Q('Une réservation pour dans 3 heures :', 'A booking 3 hours ahead:', ['Est refusée', 'Est acceptée avec un avertissement : réservez la veille si possible', 'Est automatique'], ['Is refused', 'Is accepted with a warning: book the day before if possible', 'Is automatic'], 1),
      Q('Le transporteur refuse :', 'The carrier declines:', ['Sans explication', 'Avec un motif dans une liste', 'Par téléphone seulement'], ['With no explanation', 'With a reason from a list', 'By phone only'], 1),
    ] }),
  C('R2', 'transport_planifie', '🚐', 120, 'Confirmer ou refuser une plage de transport', 'Confirm or decline a transport time slot', {
    pret: true, compte: 'ambulance.demo@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les transports.', 'Open transports.') }],
    objectif: ST('Vous saurez confirmer une plage de transport, ou la refuser avec un motif.', 'You will know how to confirm a transport time slot, or decline it with a reason.'),
    scenes: [
      { onglet: 'transports', cible: '[data-onglet="transports"]', st: ST('Ouvrez « Transports » : les demandes des établissements.', 'Open “Transports”: requests from facilities.') },
      { onglet: 'transports', cible: '#contenu', st: ST('Chaque demande : référence, lieux, plage souhaitée, véhicule. Jamais de diagnostic.', 'Each request: reference, places, requested slot, vehicle. Never a diagnosis.') },
      { onglet: 'transports', cible: '#contenu', st: ST('Confirmez une plage, ou refusez avec un motif : aucune unité, hors territoire…', 'Confirm a slot, or decline with a reason: no unit, out of area…') },
    ],
    quiz: [
      Q('Le transporteur voit :', 'The carrier sees:', ['La référence et les lieux', 'Le diagnostic', 'Le dossier'], ['The reference and the places', 'The diagnosis', 'The record'], 0),
      Q('Refuser demande :', 'Declining requires:', ['Un motif', 'Rien', 'Un appel'], ['A reason', 'Nothing', 'A call'], 0),
      Q('La plage confirmée :', 'The confirmed slot:', ['Est vue par l’établissement', 'Est secrète', 'Est effacée'], ['Is seen by the facility', 'Is secret', 'Is erased'], 0),
    ] }),
  // ---------------------------------------------------------------- 🏥 Hôpital et NSA
  C('H1', null, '🛏️', 150, 'Lits : réserver, occuper, libérer', 'Beds: reserve, occupy, release', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez Lits.', 'Open Beds.') }],
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
    exercice: [{ scene: 1, consigne: ST('Ouvrez Admissions.', 'Open Admissions.') }],
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
  C('H3', 'nettoyage', '🧽', 120, 'Nettoyage prioritaire', 'Priority cleaning', {
    pret: true, compte: 'entretien.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez la file de nettoyage.', 'Open the cleaning queue.') }],
    objectif: ST('Vous saurez quel lit nettoyer en premier, et confirmer le nettoyage.', 'You will know which bed to clean first, and confirm the cleaning.'),
    scenes: [
      { ecran: 'nettoyage', cible: '#onglets button[data-v="nettoyage"]', st: ST('Ouvrez Nettoyage : la file des lits à nettoyer, par priorité.', 'Open Cleaning: the queue of beds to clean, by priority.') },
      { ecran: 'nettoyage', cible: '#v-nettoyage', st: ST('Démarrez le nettoyage du premier lit ; l’équipe voit qu’il est en cours.', 'Start cleaning the first bed; the team sees it is in progress.') },
      { ecran: 'nettoyage', cible: '#v-nettoyage', st: ST('Confirmez la fin : le lit redevient libre, pour tous, tout de suite.', 'Confirm the end: the bed becomes free again, for everyone, right away.') },
    ],
    quiz: [
      Q('La file est classée :', 'The queue is ordered:', ['Par priorité, selon les patients qui attendent', 'Par ordre alphabétique', 'Au hasard'], ['By priority, based on patients waiting', 'Alphabetically', 'Randomly'], 0),
      Q('Le lit redevient libre quand :', 'The bed becomes free when:', ['L’entretien confirme la fin du nettoyage', 'Le patient part', 'Le soir'], ['Housekeeping confirms the end of cleaning', 'The patient leaves', 'In the evening'], 0),
      Q('Voyez-vous des données médicales ?', 'Do you see medical data?', ['Oui', 'Non'], ['Yes', 'No'], 1),
    ] }),
  C('H4', 'nsa', '🏥', 180, 'Épisode NSA et orientation', 'ALC episode and orientation', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez NSA.', 'Open ALC.') }],
    objectif: ST('Vous saurez déclarer un patient NSA et son orientation, sans diagnostic.', 'You will know how to declare an ALC patient and their orientation, with no diagnosis.'),
    scenes: [
      { ecran: 'nsa', cible: '#onglets button[data-v="nsa"]', st: ST('Ouvrez NSA : les patients qui n’ont plus besoin de soins aigus et attendent un autre milieu.', 'Open ALC: patients who no longer need acute care and wait for another setting.') },
      { ecran: 'nsa', cible: '#v-nsa', st: ST('La date de début est saisie par l’équipe et n’est jamais remise à zéro.', 'The start date is entered by the team and never reset.') },
      { ecran: 'nsa', cible: '#v-nsa', st: ST('Choisissez l’orientation (CHSLD, RPA, RI, soins palliatifs…) et les besoins en catégories.', 'Choose the orientation (long-term care, residence, palliative care…) and needs as categories.') },
      { ecran: 'nsa', cible: '#v-nsa', st: ST('Les jours NSA s’additionnent et alimentent les listes d’attente régionales.', 'ALC days add up and feed the regional waiting lists.') },
    ],
    quiz: [
      Q('La date de début NSA :', 'The ALC start date:', ['Est remise à zéro à chaque transfert', 'Est saisie par l’équipe et conservée', 'Est calculée par Arrimo'], ['Resets at each transfer', 'Is entered by the team and kept', 'Is calculated by Arrimo'], 1),
      Q('Les besoins sont saisis :', 'Needs are entered:', ['En texte libre', 'En catégories fermées', 'Avec le diagnostic'], ['As free text', 'As closed categories', 'With the diagnosis'], 1),
      Q('L’orientation sert à :', 'The orientation is used to:', ['Trouver les places compatibles', 'Facturer', 'Rien'], ['Find compatible places', 'Bill', 'Nothing'], 0),
    ] }),
  C('H5', 'nsa', '🏥', 180, 'Places compatibles et demande d’hébergement', 'Compatible places and placement request', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les places compatibles du patient NSA.', 'Open the ALC patient’s compatible places.') }],
    objectif: ST('Vous saurez trouver les places compatibles et envoyer une demande d’hébergement.', 'You will know how to find compatible places and send a placement request.'),
    scenes: [
      { ecran: 'nsa', cible: '#v-nsa', st: ST('Depuis le patient NSA, ouvrez « Places compatibles ».', 'From the ALC patient, open “Compatible places”.') },
      { ecran: 'nsa', cible: '#v-nsa', st: ST('Les trois meilleures places viennent en tête, avec la raison : besoins couverts, distance, préférences.', 'The three best places come first, with the reason: needs covered, distance, preferences.') },
      { ecran: 'nsa', cible: '#v-nsa', st: ST('Une ressource écartée l’est avec sa raison, par exemple « pas d’unité sécurisée ».', 'An excluded resource comes with its reason, for example “no secure unit”.') },
      { ecran: 'nsa', cible: '#v-nsa', st: ST('« Envoyer la demande » reste votre décision ; la ressource répond dans son délai configuré.', '“Send the request” stays your decision; the resource replies within its configured delay.') },
    ],
    quiz: [
      Q('Le classement des places est :', 'The place ranking is:', ['Une décision automatique', 'Une proposition expliquée', 'Secret'], ['An automatic decision', 'An explained suggestion', 'Secret'], 1),
      Q('Une ressource écartée :', 'An excluded resource:', ['Disparaît sans explication', 'Apparaît avec la raison de son exclusion', 'Est supprimée'], ['Disappears without explanation', 'Appears with the reason it was excluded', 'Is deleted'], 1),
      Q('Qui envoie la demande ?', 'Who sends the request?', ['OG, seul', 'Une personne de l’équipe', 'La ressource'], ['OG, alone', 'A team member', 'The resource'], 1),
    ] }),
  C('H6', null, '🏥', 150, 'Congés prévus et vigilance des lits', 'Planned discharges and bed watch', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les congés prévus.', 'Open planned discharges.') }],
    objectif: ST('Vous saurez anticiper les lits qui se libèrent et repérer les blocages.', 'You will know how to anticipate beds that free up and spot blockages.'),
    scenes: [
      { ecran: 'vigilance', sous: 'conges', cible: '#v-vigilance [data-so="conges"]', st: ST('Ouvrez Congés et alertes, sous-onglet « Congés prévus ».', 'Open Discharges & alerts, “Planned discharges” sub-tab.') },
      { ecran: 'vigilance', sous: 'conges', cible: '#v-vigilance', st: ST('Les congés prévus dans 4, 12 et 24 heures ; un congé prévu n’est jamais un lit libre.', 'Discharges planned in 4, 12 and 24 hours; a planned discharge is never a free bed.') },
      { ecran: 'vigilance', sous: 'alertes', cible: '#v-vigilance [data-so="alertes"]', st: ST('Les blocages expliqués : réservation prolongée, congé retardé, nettoyage en attente…', 'Explained blockages: long reservation, delayed discharge, cleaning pending…') },
    ],
    quiz: [
      Q('Un congé prévu est :', 'A planned discharge is:', ['Un lit libre', 'Encore occupé jusqu’au départ réel', 'Annulé'], ['A free bed', 'Still occupied until the actual departure', 'Cancelled'], 1),
      Q('Arrimo libère-t-il un lit automatiquement ?', 'Does Arrimo free a bed automatically?', ['Oui', 'Non'], ['Yes', 'No'], 1),
      Q('Chaque alerte indique :', 'Each alert states:', ['Sur quoi elle repose et une action proposée', 'Rien', 'Un diagnostic'], ['What it is based on and a suggested action', 'Nothing', 'A diagnosis'], 0),
    ] }),
  // ---------------------------------------------------------------- 🏡 Hébergement
  C('E1', null, '🏡', 150, 'Résidents et chambres', 'Residents and rooms', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les résidents.', 'Open residents.') }, { scene: 2, consigne: ST('Ouvrez les chambres et lits.', 'Open rooms and beds.') }],
    objectif: ST('Vous saurez retrouver un résident et l’état des chambres.', 'You will know how to find a resident and the status of rooms.'),
    scenes: [
      { ecran: 'c-residents', cible: '#onglets button[data-v="c-residents"]', st: ST('Ouvrez Résidents : la liste de vos résidents, avec leur chambre.', 'Open Residents: your residents, with their room.') },
      { ecran: 'c-chambres', cible: '#onglets button[data-v="c-chambres"]', st: ST('Chambres et lits : libres, occupées, réservées, à entretenir.', 'Rooms and beds: free, occupied, reserved, to clean.') },
      { ecran: 'c-chambres', cible: '#v-c-chambres', st: ST('Une chambre conservée pendant une hospitalisation reste attribuée au résident.', 'A room kept during a hospital stay stays assigned to the resident.') },
    ],
    quiz: [
      Q('Une chambre conservée :', 'A kept room:', ['Reste attribuée au résident', 'Est libre', 'Est fermée'], ['Stays assigned to the resident', 'Is free', 'Is closed'], 0),
      Q('Les résidents sont visibles par :', 'Residents are visible to:', ['Votre établissement', 'Tout le réseau', 'Le public'], ['Your facility', 'The whole network', 'The public'], 0),
      Q('L’état d’une chambre change pour :', 'A room’s status changes for:', ['Toute l’équipe en même temps', 'Vous seulement', 'Personne'], ['The whole team at once', 'You only', 'Nobody'], 0),
    ] }),
  C('E2', null, '🏡', 180, 'Recevoir une demande d’hébergement', 'Receive a placement request', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les demandes d’hébergement.', 'Open placement requests.') }],
    objectif: ST('Vous saurez traiter une demande d’hébergement : documents, place proposée, réponse motivée.', 'You will know how to handle a placement request: documents, place offered, reasoned reply.'),
    scenes: [
      { ecran: 'c-demandes', cible: '#onglets button[data-v="c-demandes"]', st: ST('Ouvrez Demandes d’hébergement : les demandes reçues des hôpitaux.', 'Open Placement requests: requests received from hospitals.') },
      { ecran: 'c-demandes', cible: '#v-c-demandes', st: ST('Vérifiez les documents ; s’il en manque, demandez-les en un clic.', 'Check the documents; if some are missing, ask for them in one click.') },
      { ecran: 'c-demandes', cible: '#v-c-demandes', st: ST('Proposez une place libre ou à venir, ou refusez avec un motif de la liste.', 'Offer a free or upcoming place, or decline with a reason from the list.') },
      { ecran: 'c-demandes', cible: '#v-c-demandes', st: ST('L’hôpital confirme avec l’usager ou la famille ; vous préparez l’arrivée.', 'The hospital confirms with the patient or family; you prepare the arrival.') },
    ],
    quiz: [
      Q('Il manque un document :', 'A document is missing:', ['Je refuse la demande', 'Je le demande en un clic', 'J’attends sans rien dire'], ['I decline the request', 'I ask for it in one click', 'I wait silently'], 1),
      Q('Un refus se fait :', 'A decline is made:', ['Avec un motif de la liste', 'Sans motif', 'Par courriel'], ['With a reason from the list', 'With no reason', 'By email'], 0),
      Q('Qui confirme l’acceptation finale ?', 'Who confirms the final acceptance?', ['La ressource seule', 'L’hôpital, avec l’usager ou la famille', 'Arrimo'], ['The resource alone', 'The hospital, with the patient or family', 'Arrimo'], 1),
    ] }),
  C('E3', null, '🏡', 150, 'Départ vers l’hôpital et retour', 'Departure to hospital and return', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les mouvements des résidents.', 'Open resident movements.') }],
    objectif: ST('Vous saurez suivre un résident parti à l’hôpital et préparer son retour sans perdre sa chambre.', 'You will know how to follow a resident gone to hospital and prepare their return without losing their room.'),
    scenes: [
      { ecran: 'c-mouvements', cible: '#onglets button[data-v="c-mouvements"]', st: ST('Ouvrez Mouvements : les résidents partis à l’hôpital.', 'Open Movements: residents gone to hospital.') },
      { ecran: 'c-mouvements', cible: '#v-c-mouvements', st: ST('La chambre reste attribuée au résident pendant son absence.', 'The room stays assigned to the resident while away.') },
      { ecran: 'c-mouvements', cible: '#v-c-mouvements', st: ST('Vous voyez le dernier statut confirmé par l’hôpital, sans téléphoner.', 'You see the last status confirmed by the hospital, without calling.') },
      { ecran: 'c-mouvements', cible: '#v-c-mouvements', st: ST('Au retour, confirmez l’arrivée : le résident retrouve son lit, sans nouveau dossier.', 'On return, confirm the arrival: the resident gets their bed back, with no new file.') },
    ],
    quiz: [
      Q('Pendant l’hospitalisation, la chambre :', 'During the hospital stay, the room:', ['Est libérée', 'Reste attribuée au résident', 'Est vendue'], ['Is released', 'Stays assigned to the resident', 'Is sold'], 1),
      Q('Pour connaître l’état du résident à l’hôpital :', 'To know the resident’s status at the hospital:', ['Je téléphone chaque jour', 'Je lis le dernier statut confirmé', 'Je ne peux pas'], ['I call daily', 'I read the last confirmed status', 'I cannot'], 1),
      Q('Au retour :', 'On return:', ['Un nouveau dossier est créé', 'Je confirme l’arrivée ; il retrouve son lit', 'Rien'], ['A new file is created', 'I confirm the arrival; they get their bed back', 'Nothing'], 1),
    ] }),
  C('E4', null, '🏡', 120, 'Tâches et entretien des chambres', 'Tasks and room upkeep', {
    pret: true, compte: 'entretien.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les tâches.', 'Open tasks.') }],
    objectif: ST('Vous saurez faire et confirmer les tâches d’entretien des chambres.', 'You will know how to do and confirm room upkeep tasks.'),
    scenes: [
      { ecran: 'c-taches', cible: '#onglets button[data-v="c-taches"]', st: ST('Ouvrez Tâches : l’entretien et la préparation des chambres.', 'Open Tasks: room upkeep and preparation.') },
      { ecran: 'c-taches', cible: '#v-c-taches', st: ST('Démarrez une tâche, puis confirmez-la quand elle est faite.', 'Start a task, then confirm it once done.') },
      { ecran: 'c-taches', cible: '#v-c-taches', st: ST('La coordination voit la chambre prête, sans téléphoner.', 'Coordination sees the room is ready, without calling.') },
    ],
    quiz: [
      Q('Une tâche confirmée :', 'A confirmed task:', ['Est vue par la coordination', 'Disparaît sans trace', 'Doit être téléphonée'], ['Is seen by coordination', 'Disappears without trace', 'Must be phoned in'], 0),
      Q('Pendant une hospitalisation, la chambre :', 'During a hospital stay, the room:', ['Est entretenue sans libérer la place', 'Est libérée', 'Est fermée'], ['Is maintained without freeing the place', 'Is freed', 'Is closed'], 0),
      Q('Voyez-vous un diagnostic ?', 'Do you see a diagnosis?', ['Oui', 'Non'], ['Yes', 'No'], 1),
    ] }),
  // ---------------------------------------------------------------- 🛏️ Bourse
  C('B1', 'bourse_places', '🛏️', 150, 'Chercher une place avec les filtres', 'Search for a place with filters', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez la Bourse.', 'Open the Exchange.') }, { scene: 3, consigne: ST('Cochez les besoins du patient.', 'Tick the patient’s needs.') }],
    objectif: ST('Vous saurez trouver la place qui convient et comprendre son classement.', 'You will know how to find the right place and understand its ranking.'),
    scenes: [
      { ecran: 'bourse', sous: 'places', cible: '#onglets button[data-v="bourse"]', st: ST('Ouvrez la Bourse : toutes les places libres et à venir, au même endroit.', 'Open the Exchange: every free and upcoming place, in one spot.') },
      { ecran: 'bourse', sous: 'places', cible: '#v-bourse select', st: ST('Filtrez par type de ressource et par distance.', 'Filter by resource type and distance.') },
      { ecran: 'bourse', sous: 'places', cible: '#v-bourse fieldset', st: ST('Cochez les besoins : lève-personne, unité sécurisée, oxygène… Le classement change.', 'Tick the needs: lift, secure unit, oxygen… The ranking changes.') },
      { ecran: 'bourse', sous: 'places', cible: '#v-bourse table', st: ST('Chaque score sur 100 est expliqué : besoins couverts (60) et proximité (40).', 'Each score out of 100 is explained: needs covered (60) and proximity (40).') },
    ],
    quiz: [
      Q('Le score d’une place tient compte :', 'A place’s score takes into account:', ['De l’abonnement de la ressource', 'Des besoins couverts et de la proximité', 'Du hasard'], ['The resource’s subscription', 'Needs covered and proximity', 'Chance'], 1),
      Q('Cocher « unité sécurisée » :', 'Ticking “secure unit”:', ['Ne change rien', 'Fait monter les ressources qui l’ont', 'Supprime les autres'], ['Changes nothing', 'Moves up resources that have it', 'Deletes the others'], 1),
      Q('Un invité voit-il le même ordre ?', 'Does a guest see the same order?', ['Oui, exactement', 'Non'], ['Yes, exactly', 'No'], 0),
    ] }),
  C('B2', 'bourse_places', '🛏️', 120, 'Fiche de transfert d’une page', 'One-page transfer sheet', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez la fiche de transfert.', 'Open the transfer sheet.') }],
    objectif: ST('Vous saurez imprimer une fiche de transfert claire, sans diagnostic.', 'You will know how to print a clear transfer sheet, with no diagnosis.'),
    scenes: [
      { ecran: 'bourse', sous: 'fiche', cible: '#v-bourse [data-so="fiche"]', st: ST('Ouvrez le sous-onglet « Fiche de transfert ».', 'Open the “Transfer sheet” sub-tab.') },
      { ecran: 'bourse', sous: 'fiche', cible: '#v-bourse', st: ST('Choisissez le patient : la fiche reprend sa tranche d’âge, ses besoins en catégories, l’orientation et la date souhaitée.', 'Choose the patient: the sheet shows age range, needs as categories, orientation and desired date.') },
      { ecran: 'bourse', sous: 'fiche', cible: '#v-bourse', st: ST('Imprimez-la ou joignez-la : une page, sans diagnostic.', 'Print or attach it: one page, no diagnosis.') },
    ],
    quiz: [
      Q('La fiche de transfert contient :', 'The transfer sheet contains:', ['Le diagnostic', 'Les besoins en catégories, sans diagnostic', 'Le dossier complet'], ['The diagnosis', 'Needs as categories, no diagnosis', 'The full record'], 1),
      Q('L’âge apparaît :', 'Age appears:', ['En tranche d’âge', 'En date de naissance', 'Pas du tout'], ['As an age range', 'As a date of birth', 'Not at all'], 0),
      Q('La fiche fait :', 'The sheet is:', ['Une page', 'Dix pages', 'Un fichier vidéo'], ['One page', 'Ten pages', 'A video file'], 0),
    ] }),
  C('B3', 'bourse_places', '🛏️', 120, 'Inviter un professionnel externe', 'Invite an external professional', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les accès invités.', 'Open guest access.') }],
    objectif: ST('Vous saurez donner un accès invité nominatif, limité dans le temps et révocable.', 'You will know how to give a named guest access, time-limited and revocable.'),
    scenes: [
      { ecran: 'bourse', sous: 'invites', cible: '#v-bourse [data-so="invites"]', st: ST('Ouvrez le sous-onglet « Accès invités ».', 'Open the “Guest access” sub-tab.') },
      { ecran: 'bourse', sous: 'invites', cible: '#v-bourse', st: ST('Indiquez le nom et le courriel du professionnel : il reçoit un lien valable 7 jours.', 'Enter the professional’s name and email: they receive a link valid for 7 days.') },
      { ecran: 'bourse', sous: 'invites', cible: '#v-bourse', st: ST('Vous pouvez révoquer l’accès à tout moment ; chaque consultation est journalisée.', 'You can revoke access at any time; every view is logged.') },
    ],
    quiz: [
      Q('Un lien invité est valable :', 'A guest link is valid for:', ['7 jours', 'Pour toujours', '1 heure'], ['7 days', 'Forever', '1 hour'], 0),
      Q('L’accès invité peut être :', 'Guest access can be:', ['Révoqué à tout moment', 'Jamais révoqué', 'Partagé librement'], ['Revoked at any time', 'Never revoked', 'Freely shared'], 0),
      Q('Les consultations d’un invité sont :', 'A guest’s views are:', ['Journalisées', 'Invisibles', 'Effacées'], ['Logged', 'Invisible', 'Erased'], 0),
    ] }),
  // ---------------------------------------------------------------- ✅ Visites confirmées
  C('V1', 'visites_confirmees', '✅', 150, 'Planifier les visites', 'Plan visits', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les visites.', 'Open visits.') }, { scene: 2, consigne: ST('Planifiez une visite.', 'Plan a visit.') }],
    objectif: ST('Vous saurez planifier les visites du CLSC ou du prestataire pour un résident.', 'You will know how to plan CLSC or provider visits for a resident.'),
    scenes: [
      { ecran: 'visites', sous: 'horaire', cible: '#onglets button[data-v="visites"]', st: ST('Ouvrez Visites : l’horaire des visites prévues.', 'Open Visits: the schedule of planned visits.') },
      { ecran: 'visites', sous: 'horaire', cible: '#v-visites .btn.pri', st: ST('« Planifier une visite » : résident, prestataire, type, plage, série quotidienne ou hebdomadaire.', '“Plan a visit”: resident, provider, type, slot, daily or weekly series.') },
      { ecran: 'visites', sous: 'horaire', cible: '#v-visites table', st: ST('Le prestataire ne voit que la référence du résident, jamais son nom.', 'The provider only sees the resident reference, never the name.') },
    ],
    quiz: [
      Q('Le prestataire voit :', 'The provider sees:', ['La référence du résident', 'Son nom', 'Son dossier'], ['The resident reference', 'Their name', 'Their record'], 0),
      Q('Une série hebdomadaire crée :', 'A weekly series creates:', ['Plusieurs visites, une par semaine', 'Une seule visite', 'Aucune'], ['Several visits, one per week', 'A single visit', 'None'], 0),
      Q('Le type de visite est :', 'The visit type is:', ['Une catégorie de service', 'Un diagnostic', 'Un texte libre'], ['A service category', 'A diagnosis', 'Free text'], 0),
    ] }),
  C('V2', 'visites_confirmees', '✅', 120, 'Confirmer son arrivée et son départ', 'Confirm arrival and departure', {
    pret: true, compte: 'intervenant.demo@demo.arrimo',
    exercice: [{ scene: 2, consigne: ST('Confirmez votre arrivée.', 'Confirm your arrival.') }],
    objectif: ST('Vous saurez confirmer votre arrivée et votre départ, au clic ou par votre position si vous l’acceptez.', 'You will know how to confirm your arrival and departure, by click or by your location if you agree.'),
    scenes: [
      { page: '/intervenant', cible: '#iv-contenu', st: ST('Votre page montre vos visites du jour : résidence, type, plage.', 'Your page shows today’s visits: residence, type, slot.') },
      { page: '/intervenant', cible: '[data-iv="arrivee"]', st: ST('À votre arrivée, touchez « Je suis arrivé ».', 'On arrival, tap “I have arrived”.') },
      { page: '/intervenant', cible: '#iv-pos', st: ST('Si vous l’acceptez, votre position confirme la visite ; elle n’est jamais conservée.', 'If you agree, your location confirms the visit; it is never kept.') },
    ],
    quiz: [
      Q('Votre position est :', 'Your location is:', ['Conservée', 'Utilisée seulement avec votre accord, jamais conservée', 'Partagée'], ['Kept', 'Used only with your agreement, never kept', 'Shared'], 1),
      Q('Vous voyez des résidents :', 'You see residents:', ['Par leur référence', 'Par leur nom', 'Pas du tout'], ['By their reference', 'By their name', 'Not at all'], 0),
      Q('Une visite sans arrivée pendant sa plage :', 'A visit with no arrival during its slot:', ['Est signalée « manquée » à la résidence', 'Est effacée', 'Est payée'], ['Is flagged “missed” to the residence', 'Is deleted', 'Is paid'], 0),
    ] }),
  C('V3', 'visites_confirmees', '✅', 120, 'Visite manquée : agir', 'Missed visit: take action', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Repérez les visites.', 'Find the visits.') }],
    objectif: ST('Vous saurez repérer une visite manquée et noter les soins donnés à la place.', 'You will know how to spot a missed visit and record care given instead.'),
    scenes: [
      { ecran: 'visites', sous: 'horaire', cible: '#v-visites table', st: ST('Une visite sans arrivée pendant sa plage passe à « Manquée ».', 'A visit with no arrival during its slot becomes “Missed”.') },
      { ecran: 'visites', sous: 'horaire', cible: '#v-visites table', st: ST('Si la résidence donne les soins, notez-le : une catégorie dans la liste.', 'If the residence gives the care, record it: a category from the list.') },
      { ecran: 'visites', sous: 'rapport', cible: '#v-visites [data-so="rapport"]', st: ST('Le rapport mensuel compte les visites prévues, faites et manquées.', 'The monthly report counts visits planned, done and missed.') },
    ],
    quiz: [
      Q('Les soins donnés à la place sont notés :', 'Care given instead is recorded:', ['Par catégorie', 'En texte libre', 'Pas du tout'], ['By category', 'As free text', 'Not at all'], 0),
      Q('Arrimo calcule-t-il une retenue ?', 'Does Arrimo calculate a deduction?', ['Oui', 'Non'], ['Yes', 'No'], 1),
      Q('Le rapport compte :', 'The report counts:', ['Prévues, faites, manquées', 'Les diagnostics', 'Rien'], ['Planned, done, missed', 'Diagnoses', 'Nothing'], 0),
    ] }),
  // ---------------------------------------------------------------- 🛡️ Avant l'appel
  C('A1', 'eviter_transferts', '🛡️', 120, 'Utiliser la liste avant l’appel', 'Use the before-calling checklist', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez la liste avant l’appel.', 'Open the before-calling checklist.') }, { scene: 3, consigne: ST('Notez un transfert fait.', 'Record a transfer made.') }],
    objectif: ST('Vous saurez parcourir la liste de votre établissement et noter votre décision.', 'You will know how to go through your facility’s checklist and record your decision.'),
    scenes: [
      { ecran: 'eviter', sous: 'appel', cible: '#onglets button[data-v="eviter"]', st: ST('Ouvrez « Avant l’appel » : la liste de votre établissement.', 'Open “Before calling”: your facility’s checklist.') },
      { ecran: 'eviter', sous: 'appel', cible: '#v-eviter', st: ST('Cochez les vérifications ; les alternatives et leurs coordonnées sont à côté.', 'Tick the checks; alternatives and their contacts are alongside.') },
      { ecran: 'eviter', sous: 'appel', cible: '#ev-fait', st: ST('Notez votre décision : transfert évité grâce à une alternative, ou transfert fait.', 'Record your decision: transfer avoided thanks to an alternative, or transfer made.') },
    ],
    quiz: [
      Q('La liste vient :', 'The checklist comes from:', ['De votre établissement (son protocole)', 'D’Arrimo', 'D’Internet'], ['Your facility (its protocol)', 'Arrimo', 'The internet'], 0),
      Q('La liste peut-elle bloquer l’appel ?', 'Can the checklist block the call?', ['Oui', 'Non'], ['Yes', 'No'], 1),
      Q('En urgence vitale :', 'In a life-threatening emergency:', ['J’appelle le 911 sans attendre', 'Je remplis la liste d’abord', 'J’attends'], ['I call 911 without waiting', 'I fill in the checklist first', 'I wait'], 0),
    ] }),
  C('A2', 'eviter_transferts', '🛡️', 120, 'Écrire la liste de l’établissement', 'Write the facility’s checklist', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez le réglage de la liste.', 'Open the list settings.') }, { scene: 3, consigne: ST('Enregistrez la liste.', 'Save the list.') }],
    objectif: ST('Vous saurez écrire la liste de vérification de votre établissement, selon son protocole.', 'You will know how to write your facility’s checklist, according to its protocol.'),
    scenes: [
      { ecran: 'eviter', sous: 'regler', cible: '#v-eviter [data-so="regler"]', st: ST('Ouvrez le sous-onglet « Régler la liste ».', 'Open the “Set the list” sub-tab.') },
      { ecran: 'eviter', sous: 'regler', cible: '#v-eviter textarea', st: ST('Une vérification par ligne, tirée de votre protocole.', 'One check per line, taken from your protocol.') },
      { ecran: 'eviter', sous: 'regler', cible: '#ev-enregistrer', st: ST('Cochez les alternatives disponibles, leurs coordonnées, puis enregistrez.', 'Tick the available alternatives, their contacts, then save.') },
    ],
    quiz: [
      Q('Qui écrit la liste ?', 'Who writes the list?', ['L’établissement', 'Arrimo', 'Le patient'], ['The facility', 'Arrimo', 'The patient'], 0),
      Q('Une vérification, c’est :', 'A check is:', ['Une ligne tirée du protocole', 'Un diagnostic', 'Une ordonnance'], ['A line from the protocol', 'A diagnosis', 'A prescription'], 0),
      Q('Les alternatives ont :', 'Alternatives have:', ['Des coordonnées', 'Un prix', 'Rien'], ['Contacts', 'A price', 'Nothing'], 0),
    ] }),
  // ---------------------------------------------------------------- 📊 Données
  C('D1', 'donnees_regionales', '📊', 150, 'Lire le tableau régional', 'Read the regional table', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les données.', 'Open data.') }],
    objectif: ST('Vous saurez lire le tableau régional : passages, transferts, NSA, places libres.', 'You will know how to read the regional table: visits, transfers, ALC, free places.'),
    scenes: [
      { ecran: 'donnees', sous: 'tableau', cible: '#onglets button[data-v="donnees"]', st: ST('Ouvrez Données, sous-onglet « Tableau régional ».', 'Open Data, “Regional table” sub-tab.') },
      { ecran: 'donnees', sous: 'tableau', cible: '#v-donnees table', st: ST('Établissements actifs en premier ; chaque transfert compte une fois, à son origine.', 'Active facilities first; each transfer counts once, at its origin.') },
      { ecran: 'donnees', sous: 'tableau', cible: '#v-donnees', st: ST('Choisissez la période ; les totaux incluent les cellules « < 5 ».', 'Choose the period; totals include the “< 5” cells.') },
    ],
    quiz: [
      Q('Un transfert compte :', 'A transfer counts:', ['Une fois, à son origine', 'Deux fois', 'Pas du tout'], ['Once, at its origin', 'Twice', 'Not at all'], 0),
      Q('Les établissements sans donnée :', 'Facilities with no data:', ['Sont repliés à la fin', 'Sont en tête', 'Sont supprimés'], ['Are folded at the end', 'Are first', 'Are deleted'], 0),
      Q('Voit-on des références patient ?', 'Are patient references shown?', ['Oui', 'Non'], ['Yes', 'No'], 1),
    ] }),
  C('D2', 'donnees_regionales', '📊', 120, 'Listes d’attente et export', 'Waiting lists and export', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez Données.', 'Open Data.') }, { scene: 4, consigne: ST('Exportez en CSV.', 'Export as CSV.') }],
    objectif: ST('Vous saurez lire les listes d’attente par type de ressource et exporter les données.', 'You will know how to read waiting lists by resource type and export the data.'),
    scenes: [
      { ecran: 'donnees', sous: 'attente', cible: '#onglets button[data-v="donnees"]', st: ST('Ouvrez Données, sous-onglet « Listes d’attente ».', 'Open Data, “Waiting lists” sub-tab.') },
      { ecran: 'donnees', sous: 'attente', cible: '#v-donnees table', st: ST('Pour chaque type de ressource : personnes en attente, ancienneté médiane, places libres en face.', 'For each resource type: people waiting, median wait, free places alongside.') },
      { ecran: 'donnees', sous: 'attente', cible: '#v-donnees', st: ST('Les nombres de 1 à 4 sont masqués « < 5 » pour protéger la vie privée.', 'Numbers from 1 to 4 are hidden as “< 5” to protect privacy.') },
      { ecran: 'donnees', sous: 'tableau', cible: '#do-csv', st: ST('Exportez en CSV pour vos rapports.', 'Export as CSV for your reports.') },
    ],
    quiz: [
      Q('« < 5 » veut dire :', '“< 5” means:', ['Une erreur', 'Un nombre de 1 à 4, masqué pour la vie privée', 'Zéro'], ['An error', 'A number from 1 to 4, hidden for privacy', 'Zero'], 1),
      Q('Les listes d’attente sont classées :', 'Waiting lists are grouped:', ['Par type de ressource', 'Par patient', 'Par diagnostic'], ['By resource type', 'By patient', 'By diagnosis'], 0),
      Q('L’export se fait en :', 'Export is in:', ['CSV', 'PDF seulement', 'Rien'], ['CSV', 'PDF only', 'Nothing'], 0),
    ] }),
  // ---------------------------------------------------------------- 🆘 Mode crise
  C('K1', 'mode_crise', '🆘', 150, 'Déclencher une évacuation', 'Start an evacuation', {
    pret: true, compte: 'coordination.saint-laurent@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez le mode crise.', 'Open crisis mode.') }, { scene: 3, consigne: ST('Déclenchez l’évacuation.', 'Start the evacuation.') }],
    objectif: ST('Vous saurez déclencher une évacuation, une décision humaine.', 'You will know how to start an evacuation, a human decision.'),
    scenes: [
      { ecran: 'crise', cible: '#onglets button[data-v="crise"]', st: ST('Ouvrez Mode crise.', 'Open Crisis mode.') },
      { ecran: 'crise', cible: '#v-crise select', st: ST('Choisissez le motif : incendie, inondation, panne…', 'Choose the reason: fire, flood, outage…') },
      { ecran: 'crise', cible: '#v-crise .btn', st: ST('Déclenchez : un lieu est proposé pour chaque résident, à confirmer.', 'Start it: a place is suggested for each resident, to confirm.') },
    ],
    quiz: [
      Q('Qui déclenche une évacuation ?', 'Who starts an evacuation?', ['Une personne habilitée', 'Arrimo seul', 'Le CCS'], ['An authorized person', 'Arrimo alone', 'The communication centre'], 0),
      Q('Après le déclenchement :', 'After starting:', ['Un lieu est proposé pour chaque résident', 'Tout est automatique', 'Rien'], ['A place is suggested for each resident', 'Everything is automatic', 'Nothing'], 0),
      Q('La direction régionale :', 'The regional authority:', ['Voit l’évacuation', 'N’en sait rien'], ['Sees the evacuation', 'Knows nothing'], 0),
    ] }),
  C('K2', 'mode_crise', '🆘', 180, 'Confirmer les lieux et suivre l’évacuation', 'Confirm places and follow the evacuation', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 2, consigne: ST('Confirmez le lieu d’un résident.', 'Confirm a resident’s place.') }],
    objectif: ST('Vous saurez confirmer le lieu de chaque résident et suivre départs et arrivées.', 'You will know how to confirm each resident’s place and follow departures and arrivals.'),
    scenes: [
      { ecran: 'crise', cible: '#v-crise table', st: ST('Pour chaque résident, un lieu est proposé : le plus proche qui convient.', 'For each resident, a place is suggested: the nearest suitable one.') },
      { ecran: 'crise', cible: '#v-crise table .btn', st: ST('Confirmez le lieu ; la place est réservée par les règles des lits.', 'Confirm the place; it is reserved by the bed rules.') },
      { ecran: 'crise', cible: '#v-crise', st: ST('Suivez les départs, les arrivées et les familles avisées, résident par résident.', 'Follow departures, arrivals and families notified, resident by resident.') },
    ],
    quiz: [
      Q('Le lieu proposé est :', 'The suggested place is:', ['À confirmer par l’équipe', 'Définitif', 'Secret'], ['To be confirmed by the team', 'Final', 'Secret'], 0),
      Q('On suit :', 'You follow:', ['Départ, arrivée, famille avisée', 'Rien', 'Les salaires'], ['Departure, arrival, family notified', 'Nothing', 'Salaries'], 0),
      Q('Les familles reçoivent :', 'Families receive:', ['Une information sans détail médical', 'Le dossier', 'Rien'], ['Information with no medical detail', 'The record', 'Nothing'], 0),
    ] }),
  // ---------------------------------------------------------------- 👨‍👩‍👧 Famille
  C('F1', 'portail_proches', '👨‍👩‍👧', 120, 'Le portail des proches', 'The relatives’ portal'),
  C('F2', 'portail_proches', '👨‍👩‍👧', 120, 'Inviter un proche', 'Invite a relative', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez les résidents.', 'Open residents.') }],
    objectif: ST('Vous saurez inviter un proche autorisé au portail des familles.', 'You will know how to invite an authorized relative to the family portal.'),
    scenes: [
      { ecran: 'c-residents', cible: '#onglets button[data-v="c-residents"]', st: ST('Ouvrez Résidents, puis la fiche du résident.', 'Open Residents, then the resident’s record.') },
      { ecran: 'c-residents', cible: '#v-c-residents', st: ST('Dans les contacts, invitez le proche autorisé : il reçoit un lien personnel.', 'In contacts, invite the authorized relative: they receive a personal link.') },
      { ecran: 'c-residents', cible: '#v-c-residents', st: ST('Le proche ne voit que les informations qu’on lui permet de voir.', 'The relative only sees the information they are allowed to see.') },
    ],
    quiz: [
      Q('Le proche voit :', 'The relative sees:', ['Les informations autorisées', 'Tout le dossier', 'Les autres résidents'], ['Authorized information', 'The whole record', 'Other residents'], 0),
      Q('L’invitation est :', 'The invitation is:', ['Personnelle', 'Publique', 'Partagée'], ['Personal', 'Public', 'Shared'], 0),
      Q('Qui invite ?', 'Who invites?', ['L’équipe de la résidence', 'Arrimo', 'N’importe qui'], ['The residence team', 'Arrimo', 'Anyone'], 0),
    ] }),
  // ---------------------------------------------------------------- Console SH
  C('SH1', null, '🧩', 150, 'Activer un module et gérer les comptes', 'Turn on a module and manage accounts'),
  // ---------------------------------------------------------------- ✨🧭👁️ Transversal
  C('O1', null, '✨', 120, 'Demander à OG', 'Ask OG', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez OG.', 'Open OG.') }],
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
    exercice: [{ scene: 1, consigne: ST('Ouvrez le Sillage.', 'Open the Trail.') }],
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
    exercice: [{ scene: 1, consigne: ST('Repérez les parcours à surveiller.', 'Find the paths to watch.') }],
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

  // ---------------------------------------------------------------- Cahier ultime (21 nov. 2026) : Flux, préalerte d'arrivée, Connect, Dossier santé, transport, Entretien
  C('X1', null, '⇄', 150, 'Arrimo Flux : arrivées et départs', 'Arrimo Flow: arrivals and departures', {
    pret: true, compte: 'hopital.b@demo.arrimo',
    exercice: [{ scene: 2, consigne: ST('Filtrez les arrivées d’aujourd’hui.', 'Filter today’s arrivals.') }],
    objectif: ST('Vous saurez voir qui arrive et qui part, avec l’heure prévue, l’heure réelle et l’arrivée estimée quand elle est connue.', 'You will know who arrives and who leaves, with scheduled time, actual time and estimated arrival when known.'),
    scenes: [
      { ecran: 'copilote', cible: '#flux-accueil-h', st: ST('Dès l’Accueil : préalertes reçues, prochains mouvements et Bourse des places.', 'Right from Home: received pre-alerts, next movements and the placement exchange.') },
      { ecran: 'flux', cible: '.flux-filtres', st: ST('Dans Flux, filtrez les arrivées, les départs, aujourd’hui ou demain.', 'In Flow, filter arrivals, departures, today or tomorrow.') },
      { ecran: 'flux', cible: '#v-flux', st: ST('Chaque ligne distingue le créneau, l’heure prévue, l’heure réelle et l’arrivée estimée. Sans donnée : « ETA indisponible ».', 'Each row separates the slot, scheduled time, actual time and estimated arrival. Without data: “ETA unavailable”.') },
      { ecran: 'flux', cible: '#v-flux', st: ST('« Fiche » ouvre la chronologie complète du mouvement, avec l’auteur de chaque étape.', '“Record” opens the movement’s full timeline, with the author of each step.') },
    ],
    quiz: [
      Q('Un créneau de 16 h 10 à 17 h 10 signifie :', 'A 4:10–5:10 pm slot means:', ['Que le trajet dure une heure', 'La fenêtre de prise en charge demandée, pas la durée du trajet', 'Que le patient arrive à 17 h 10'], ['The trip lasts one hour', 'The requested pick-up window, not the trip duration', 'The patient arrives at 5:10 pm'], 1),
      Q('Aucune préalerte ni position n’est disponible. Flux affiche :', 'No pre-alert or position is available. Flow shows:', ['Une heure estimée par défaut', '« ETA indisponible »', 'L’heure de fin du créneau'], ['A default estimated time', '“ETA unavailable”', 'The end of the slot'], 1),
      Q('Où voir qui a fait chaque étape ?', 'Where do you see who did each step?', ['Nulle part', 'Dans la fiche du mouvement', 'Dans les notifications seulement'], ['Nowhere', 'In the movement’s record', 'In notifications only'], 1),
    ] }),
  C('X2', 'transport_planifie', '📣', 150, 'Recevoir une préalerte d’arrivée et préparer la chambre', 'Receive an arrival pre-alert and prepare the room', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Repérez le panneau « Préalertes reçues ».', 'Find the “Received pre-alerts” panel.') }],
    objectif: ST('Vous saurez repérer une ambulance annoncée, accuser réception et vérifier la préparation de la chambre.', 'You will know how to spot an announced ambulance, acknowledge it and check the room preparation.'),
    scenes: [
      { ecran: 'c-accueil', cible: '#flux-accueil-c', st: ST('L’équipage annonce son arrivée : la préalerte apparaît en tête de l’Accueil, avec l’heure estimée.', 'The crew announces its arrival: the pre-alert appears at the top of Home, with the estimated time.') },
      { ecran: 'c-accueil', cible: '#flux-accueil-c', st: ST('Cliquez « Accuser réception » : l’équipage voit que vous l’attendez.', 'Click “Acknowledge”: the crew sees you are expecting them.') },
      { ecran: 'c-taches', cible: '#v-c-taches', st: ST('La tâche de préparation de la chambre est créée une seule fois pour l’entretien, avec l’échéance de l’arrivée.', 'The room preparation task is created once for housekeeping, due at the arrival time.') },
      { ecran: 'c-taches', cible: '#v-c-taches', st: ST('La chambre n’est prête que lorsque l’entretien le confirme : jamais automatiquement.', 'The room is ready only when housekeeping confirms it: never automatically.') },
    ],
    quiz: [
      Q('Une préalerte d’arrivée signifie que :', 'An arrival pre-alert means:', ['Le patient est admis', 'L’équipage annonce son arrivée ; rien n’est confirmé automatiquement', 'La chambre est prête'], ['The patient is admitted', 'The crew announces its arrival; nothing is confirmed automatically', 'The room is ready'], 1),
      Q('Qui déclare la chambre prête ?', 'Who declares the room ready?', ['Arrimo', 'L’équipe d’entretien', 'L’ambulancier'], ['Arrimo', 'Housekeeping', 'The paramedic'], 1),
      Q('Deux préalertes successives pour le même transport créent :', 'Two successive pre-alerts for the same transport create:', ['Deux tâches', 'Une seule tâche de préparation', 'Aucune tâche'], ['Two tasks', 'A single preparation task', 'No task'], 1),
    ] }),
  C('X3', null, '✉', 120, 'Arrimo Connect : contacter l’administration', 'Arrimo Connect: contact the administration', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Ouvrez Arrimo Connect.', 'Open Arrimo Connect.') }],
    objectif: ST('Vous saurez écrire à l’administration, suivre votre demande et lire les annonces, sans quitter votre écran.', 'You will know how to write to the administration, follow your request and read announcements, without leaving your screen.'),
    scenes: [
      { ecran: 'c-accueil', cible: '#b-messagerie', st: ST('L’icône ✉ ouvre Arrimo Connect ; le badge compte les messages non lus.', 'The ✉ icon opens Arrimo Connect; the badge counts unread messages.') },
      { ecran: 'c-accueil', cible: '#b-messagerie', st: ST('« Contacter l’administration » : catégorie, priorité, sujet et message. La demande est suivie jusqu’à sa résolution.', '“Contact the administration”: category, priority, subject and message. The request is followed until resolved.') },
      { ecran: 'c-accueil', cible: '#b-messagerie', st: ST('Les messages directs restent privés : même l’administration ne les lit pas.', 'Direct messages stay private: even the administration cannot read them.') },
    ],
    quiz: [
      Q('Arrimo Connect remplace-t-il les appels d’urgence ?', 'Does Arrimo Connect replace emergency calls?', ['Oui', 'Non : utilisez les canaux d’urgence officiels'], ['Yes', 'No: use the official emergency channels'], 1),
      Q('Qui lit un message direct entre deux collègues ?', 'Who reads a direct message between two colleagues?', ['Tout l’établissement', 'Les deux collègues seulement', 'L’administration aussi'], ['The whole facility', 'The two colleagues only', 'The administration too'], 1),
      Q('Où suivre votre demande de matériel ?', 'Where do you follow your equipment request?', ['Dans « Mes communications »', 'Par courriel seulement', 'Nulle part'], ['In “My communications”', 'By email only', 'Nowhere'], 0),
    ] }),
  C('X4', 'dsn', '🩺', 150, 'Dossier santé (démo) : admission sur un vrai lit', 'Health record (demo): admission on a real bed', {
    pret: true, compte: 'hopital.b@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez l’onglet Dossier santé.', 'Open the Health record tab.') }],
    objectif: ST('Vous saurez ouvrir un dossier fictif, admettre sur un lit libre réel et préparer une transition.', 'You will know how to open a fictitious record, admit on a real free bed and prepare a transition.'),
    scenes: [
      { ecran: 'dsn', cible: '#onglets button[data-v="dsn"]', st: ST('Le Dossier santé est un onglet de l’établissement, en démonstration seulement (patients fictifs).', 'The Health record is a facility tab, in demonstration only (fictitious patients).') },
      { ecran: 'dsn', cible: '#v-dsn', st: ST('Une admission se fait sur un lit libre réel : il est réservé puis occupé dans Lits, sans double occupation possible.', 'An admission uses a real free bed: it is reserved then occupied in Beds, with no double occupancy possible.') },
      { ecran: 'lits', cible: '#v-lits', st: ST('Une admission confirmée dans Lits crée aussi le séjour dans le dossier ; une sortie le termine.', 'An admission confirmed in Beds also creates the stay in the record; a discharge ends it.') },
    ],
    quiz: [
      Q('Une simple demande de transfert crée-t-elle un séjour ?', 'Does a mere transfer request create a stay?', ['Oui', 'Non : seul un lit occupé crée un séjour'], ['Yes', 'No: only an occupied bed creates a stay'], 1),
      Q('Le lit d’un séjour se change :', 'A stay’s bed is changed:', ['Dans le dossier', 'Dans Lits ; le dossier suit', 'Nulle part'], ['In the record', 'In Beds; the record follows', 'Nowhere'], 1),
      Q('Les données du Dossier santé de démonstration sont :', 'Demo Health record data is:', ['Réelles', 'Entièrement fictives'], ['Real', 'Entirely fictitious'], 1),
    ] }),
  C('X5', 'transport_ambulancier', '🚐', 150, 'Transport : étapes réelles et incident', 'Transport: real steps and incidents', {
    pret: true, compte: 'ambulance.demo@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Ouvrez vos transports.', 'Open your transports.') }],
    objectif: ST('Vous saurez déclarer chaque étape réelle de la mission, avec une confirmation explicite, et signaler un incident.', 'You will know how to declare each real step of the mission, with explicit confirmation, and report an incident.'),
    scenes: [
      { onglet: 'mission', cible: '#contenu', st: ST('« Mes missions » : à accepter, acceptées, en cours, terminées, retards et incidents.', '“My missions”: to accept, accepted, in progress, done, late and incidents.') },
      { onglet: 'transports', cible: '#contenu', st: ST('Sur place, pris en charge, arrivé, patient remis, mission terminée : chaque étape demande une confirmation et est horodatée.', 'On site, picked up, arrived, patient handed over, mission complete: each step asks for confirmation and is time-stamped.') },
      { onglet: 'transports', cible: '#contenu', st: ST('Un problème ? « Signaler un incident » avec un motif : l’établissement est avisé. Une préalerte n’est jamais une prise en charge.', 'A problem? “Report an incident” with a reason: the facility is notified. A pre-alert is never a pick-up.') },
    ],
    quiz: [
      Q('Arrivée du véhicule et remise du patient sont :', 'Vehicle arrival and patient handover are:', ['La même étape', 'Deux étapes distinctes'], ['The same step', 'Two distinct steps'], 1),
      Q('Pour signaler un incident, il faut :', 'To report an incident, you need:', ['Rien', 'Un motif', 'L’accord du CCS'], ['Nothing', 'A reason', 'The centre’s approval'], 1),
      Q('Envoyer une préalerte vaut-il prise en charge ?', 'Does sending a pre-alert count as pick-up?', ['Oui', 'Non'], ['Yes', 'No'], 1),
    ] }),
  C('X6', null, '🧽', 120, 'Mon tableau de bord Entretien', 'My housekeeping dashboard', {
    pret: true, compte: 'entretien.erables@chsld.example.invalid',
    exercice: [{ scene: 1, consigne: ST('Repérez vos tâches en retard.', 'Find your overdue tasks.') }],
    objectif: ST('Vous saurez voir votre travail du jour, les préparations de chambres et les échéances à respecter.', 'You will know your work for the day, room preparations and due times.'),
    scenes: [
      { ecran: 'nettoyage', cible: '.kpis-ent', st: ST('« Mon travail aujourd’hui » : à nettoyer, en cours, préparations, en retard, terminées.', '“My work today”: to clean, in progress, preparations, overdue, done.') },
      { ecran: 'nettoyage', cible: '#v-nettoyage', st: ST('Les préparations de chambres pour les arrivées apparaissent aussi dans Nettoyage.', 'Room preparations for arrivals also appear in Cleaning.') },
      { ecran: 'mes-taches', cible: '#v-mes-taches', st: ST('Dans « Mes tâches », commencez puis terminez la tâche pour déclarer la chambre prête : l’admission peut alors être confirmée.', 'In “My tasks”, start then finish the task to declare the room ready: the admission can then be confirmed.') },
    ],
    quiz: [
      Q('Où voir une préparation de chambre ?', 'Where do you see a room preparation?', ['Dans Nettoyage et Mes tâches', 'Nulle part'], ['In Cleaning and My tasks', 'Nowhere'], 0),
      Q('Une admission est bloquée « chambre non prête ». Qui agit ?', 'An admission is blocked “room not ready”. Who acts?', ['L’entretien, en terminant la préparation', 'L’ambulancier'], ['Housekeeping, by completing the preparation', 'The paramedic'], 0),
      Q('Les réglages du module (protocoles, habilitations) sont visibles par :', 'Module settings (protocols, authorizations) are visible to:', ['Tout le monde', 'Les responsables et l’administration'], ['Everyone', 'Managers and administration'], 1),
    ] }),
  C('X7', null, '🏠', 150, 'Accueil universel et les 8 espaces', 'Universal Home and the 8 spaces', {
    pret: true, compte: 'hopital.a@demo.arrimo',
    exercice: [{ scene: 1, consigne: ST('Cliquez sur le niveau de situation pour voir pourquoi il est vert, orange ou rouge.', 'Click the situation level to see why it is green, orange or red.') }],
    objectif: ST('Vous saurez lire l’Accueil en un coup d’œil et trouver chaque module dans son espace.', 'You will read Home at a glance and find each module in its space.'),
    scenes: [
      { ecran: 'copilote', cible: '.acc-vue', st: ST('Vue d’ensemble : le niveau de situation (cliquable, avec ses raisons) et 6 indicateurs qui ouvrent le bon module.', 'Overview: the situation level (clickable, with its reasons) and 6 indicators that open the right module.') },
      { ecran: 'copilote', cible: '#acc-flux', st: ST('Arrimo Flux et la Bourse des places côte à côte, puis Chrono, préalertes, Mes tâches et prévisions ; l’analyse détaillée d’OG reste repliée.', 'Arrimo Flow and the placement exchange side by side, then Chrono, pre-alerts, My tasks and forecasts; OG’s detailed analysis stays folded.') },
      { ecran: 'flux', cible: '#onglets', st: ST('8 espaces : Accueil, Patients et DSN, Transferts, Capacités, Urgences, Opérations, Pilotage, Administration. Chacun ne montre que vos modules.', '8 spaces: Home, Patients and EHR, Transfers, Capacity, Emergency, Operations, Steering, Administration. Each shows only your modules.') },
    ],
    quiz: [
      Q('Pour savoir pourquoi le niveau est orange :', 'To know why the level is orange:', ['Cliquer sur le niveau ou demander à OG', 'Appeler le support'], ['Click the level or ask OG', 'Call support'], 0),
      Q('Un module absent de votre espace est :', 'A module missing from your space is:', ['Supprimé', 'Non activé ou non autorisé pour votre rôle'], ['Deleted', 'Not enabled or not authorized for your role'], 1),
      Q('Le mode supervision affiche-t-il des données personnelles ?', 'Does wall display mode show personal data?', ['Oui', 'Non'], ['Yes', 'No'], 1),
    ] }),
  C('X8', null, '✔', 150, 'Mes tâches, attribution et paramètres du module', 'My tasks, assignment and module settings', {
    pret: true, compte: 'coordination.erables@chsld.example.invalid',
    exercice: [{ scene: 2, consigne: ST('Attribuez une tâche non attribuée à une personne de l’équipe.', 'Assign an unassigned task to a team member.') }],
    objectif: ST('Vous saurez suivre vos tâches, attribuer celles de la file et régler le module pour votre établissement.', 'You will follow your tasks, assign queued ones and set the module for your facility.'),
    scenes: [
      { ecran: 'mes-taches', cible: '.flux-groupes', st: ST('Une seule vue : à faire, en cours, en retard, prioritaires, terminées aujourd’hui et, pour un responsable, non attribuées.', 'One view: to do, in progress, overdue, priority, done today and, for a manager, unassigned.') },
      { ecran: 'mes-taches', cible: '#v-mes-taches', st: ST('Chaque carte dit quoi, où, quand et la priorité ; le responsable attribue, réattribue ou remet dans la file du rôle.', 'Each card says what, where, when and the priority; the manager assigns, reassigns or returns it to the role queue.') },
      { ecran: 'mes-taches', cible: '#mt-params', st: ST('Paramètres du module (responsables seulement) : échéance par défaut, seuil de priorité, délai de nettoyage, types d’intervention.', 'Module settings (managers only): default due time, priority threshold, cleaning time, intervention types.') },
    ],
    quiz: [
      Q('Qui peut attribuer une tâche ?', 'Who can assign a task?', ['Tout le monde', 'Un responsable (coordination, administration)'], ['Everyone', 'A manager (coordination, administration)'], 1),
      Q('Une chambre propre est confirmée par :', 'A clean room is confirmed by:', ['L’entretien', 'L’ambulancier'], ['Housekeeping', 'The paramedic'], 0),
      Q('Les paramètres du module sont :', 'Module settings are:', ['Les mêmes partout', 'Propres à chaque établissement'], ['The same everywhere', 'Specific to each facility'], 1),
    ] }),
];

const TRANSVERSAL = ['O1', 'O2', 'O3', 'X3'];
const ROLES_HOPITAL = ['coordonnateur', 'admin_etab', 'equipe_soins', 'gestionnaire'];
const P = (code, emoji, fr, en, { roles, types = null, locaux = null, capsules, defaut = null }) => ({ code, emoji, nom: { fr, en }, roles, types, locaux, capsules, defaut });
const PARCOURS = [
  P('triage', '🚨', 'Triage / AIC', 'Triage nurse', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['X4', 'S2', 'C1', 'C2', 'U1', 'H1', 'H2', ...TRANSVERSAL], defaut: ['equipe_soins'] }),
  P('lits', '🛏️', 'Gestion des lits', 'Bed management', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['X7', 'X8', 'X1', 'X4', 'T1', 'T2', 'T3', 'R1', 'H1', 'H2', 'H6', ...TRANSVERSAL], defaut: ['coordonnateur'] }),
  P('nsa', '🏥', 'Coordination NSA et liaison', 'ALC coordination and liaison', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['X1', 'R1', 'H4', 'H5', 'E2', 'E3', 'B1', 'B2', 'B3', 'D2', ...TRANSVERSAL] }),
  P('chef_unite', '🩺', 'Chef d’unité', 'Unit manager', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['X7', 'X8', 'X1', 'X4', 'C3', 'U1', 'U2', 'T2', 'H1', 'H4', 'H6', 'D1', ...TRANSVERSAL] }),
  P('hygiene', '🧽', 'Hygiène et salubrité', 'Housekeeping', { roles: ['entretien'], capsules: ['X6', 'X8', 'H3', 'E4', ...TRANSVERSAL], defaut: ['entretien'] }),
  P('chsld', '🏡', 'Coordination CHSLD', 'Long-term care coordination', { roles: ROLES_HOPITAL, types: ['chsld'], locaux: [null, 'chsld', 'chsld_prive', 'maison_aines'], capsules: ['X7', 'X8', 'X1', 'X2', 'R1', 'E1', 'E2', 'E3', 'E4', 'B1', 'V1', 'V3', 'A1', 'K1', 'K2', 'F2', ...TRANSVERSAL], defaut: ['coordonnateur', 'equipe_soins'] }),
  P('rpa', '🏘️', 'RPA, RI, RTF', 'Seniors’ residences and resources', { roles: ROLES_HOPITAL, types: ['chsld'], locaux: ['rpa', 'ri', 'rtf', 'maison_retraite', 'soins_palliatifs', 'hospitalisation_domicile', 'sante_mentale'], capsules: ['X1', 'X2', 'R1', 'E1', 'E2', 'E3', 'V1', 'V3', 'A1', 'K1', 'K2', 'F2', ...TRANSVERSAL], defaut: ['coordonnateur', 'equipe_soins'] }),
  P('intervenant', '✅', 'Intervenant CLSC', 'CLSC worker', { roles: ['intervenant'], capsules: ['V2', ...TRANSVERSAL], defaut: ['intervenant'] }),
  P('repartiteur', '📡', 'Répartiteur CCS', 'Communication centre dispatcher', { roles: ['repartiteur'], capsules: ['S3', 'S4', 'C3', 'U3', ...TRANSVERSAL], defaut: ['repartiteur'] }),
  P('ambulancier', '🚑', 'Ambulancier', 'Paramedic', { roles: ['paramedic'], capsules: ['X5', 'S1', 'C1', 'C2', 'U3', ...TRANSVERSAL], defaut: ['paramedic'] }),
  P('superviseur', '🧑‍✈️', 'Superviseur ambulancier', 'Paramedic supervisor', { roles: ['superviseur_secours'], capsules: ['X5', 'S1', 'S3', 'S4', 'C2', 'C3', ...TRANSVERSAL], defaut: ['superviseur_secours'] }),
  P('transporteur', '🚐', 'Transporteur', 'Carrier', { roles: ['paramedic', 'superviseur_secours'], capsules: ['X5', 'R2', ...TRANSVERSAL] }),
  P('transferts', '🔁', 'Coordination des transferts', 'Transfer coordination', { roles: ROLES_HOPITAL, types: ['hopital'], capsules: ['X1', 'T1', 'T2', 'T3', 'T4', 'R1', 'B1', ...TRANSVERSAL] }),
  P('direction', '🗺️', 'Direction régionale', 'Regional health authority', { roles: ['direction_regionale'], capsules: ['C3', 'T3', 'B1', 'D1', 'D2', 'K2', ...TRANSVERSAL], defaut: ['direction_regionale'] }),
  P('famille', '👨‍👩‍👧', 'Famille', 'Family', { roles: [], capsules: ['F1'] }),
  P('admin', '🧩', 'Administrateur d’établissement', 'Facility administrator', { roles: ['admin_etab', 'gestionnaire'], capsules: ['U2', 'B3', 'A2', 'K1', 'SH1', ...TRANSVERSAL], defaut: ['admin_etab'] }),
  P('formateur', '🎓', 'Formateur / superutilisateur', 'Trainer / super-user', { roles: ['gestionnaire'], capsules: CAPSULES.map((c) => c.code), defaut: ['gestionnaire'] }),
];

const capsule = (code) => CAPSULES.find((c) => c.code === code) || null;
const parcours = (code) => PARCOURS.find((p) => p.code === code) || null;
module.exports = { CAPSULES, PARCOURS, TRANSVERSAL, capsule, parcours };
