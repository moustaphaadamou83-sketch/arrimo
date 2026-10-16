/**
 * Textes produits par le serveur (Copilote, recommandations, notifications, blocages), en français et en anglais.
 * La langue vient de l'en-tête X-Langue ou du paramètre `langue` (fr par défaut) et suit l'utilisateur
 * (utilisateur.langue) dans les fonctions de service.
 */
const F = require('../public/i18n/format');

const LANGUES = ['fr', 'en'];

const TEXTES = {
  fr: {
    locale: 'fr-CA',
    niveau: { vert: 'vert', jaune: 'jaune', orange: 'orange', rouge: 'rouge' },
    niveau_maj: { vert: 'Vert', jaune: 'Jaune', orange: 'Orange', rouge: 'Rouge' },
    besoin: { isolement: 'isolement', pression_negative: 'pression négative', ventilation: 'ventilation', telemetrie: 'télémétrie' },
    provenance: { urgence: 'urgence', bloc: 'bloc opératoire', externe: 'externe', autre: 'autre' },
    orientation: { chsld: 'CHSLD', ri: 'ressource intermédiaire', readaptation: 'réadaptation', domicile: 'retour à domicile', palliatif: 'soins palliatifs', autre: 'autre' },
    // recherche d'un lit ailleurs
    route: '≈ {duree} de route ({km} km)',
    dispo_libres: '{n|# lit adapté libre|# lits adaptés libres}',
    dispo_prevus: 'aucun lit libre, {n|aucun prévu|# prévu|# prévus} d’ici {h} h',
    tension_vert: 'niveau vert',
    tension: 'niveau {niveau}, pression {p}\u00a0%',
    pourquoi_proche: 'Recommandé : le plus proche avec un lit adapté',
    pourquoi_un: 'Recommandé : {noms} est plus proche mais en {niveaux}',
    pourquoi_plusieurs: 'Recommandé : {noms} sont plus proches mais en {niveaux}',
    // nettoyage
    net_attente: '{n|# patient attend|# patients attendent} un lit en {type}',
    net_long: 'En attente depuis plus de {duree}',
    net_ordre: 'Ordre d’arrivée',
    net_civiere_corridor: '{n|# patient attend|# patients attendent} en corridor une civière régulière',
    // Copilote : civières de l'urgence
    r_civ_demande: 'Demander un lit pour {ref}',
    r_civ_demande_raison: 'Sur la civière {code} depuis {duree}, sans demande de lit. Au-delà de 24 h sur civière, le risque augmente pour le patient.',
    r_civ_demande_action: 'Ouvrir l’urgence',
    r_civ_nettoyer: 'Nettoyer la civière {code}',
    r_civ_nettoyer_raison: '{n|# patient attend|# patients attendent} en corridor : cette civière régulière accueillera le premier.',
    r_civ_nettoyer_action: 'Confirmer le nettoyage',
    r_civ_deplacer: 'Déplacer {ref} du corridor vers {code}',
    r_civ_deplacer_raison: 'En corridor sur {de} depuis {duree} ; la civière régulière {code} est libre.',
    r_civ_deplacer_action: 'Déplacer le patient',
    r_urgence: 'Urgence à {taux}\u00a0% : {occ|# patient|# patients} pour {fonc|# civière|# civières}',
    r_urgence_raison: '{h24|Aucun patient|# patient|# patients} sur civière depuis plus de 24 h, dont {h48} depuis plus de 48 h. Accélérez les admissions et préparez des transferts sortants.',
    resume_urgence: ' Urgence : {occ|aucun patient|# patient|# patients} sur civière pour {fonc|# civière|# civières} ({taux}\u00a0%), {h24} depuis plus de 24 h.',
    q_civieres: 'Urgence de {etab} : {occ|aucun patient|# patient|# patients} sur civière pour {fonc|# civière fonctionnelle|# civières fonctionnelles} ({taux}\u00a0%), dont {corridor} en corridor.\n{h24|Aucun patient|# patient|# patients} depuis plus de 24 h, {h48} depuis plus de 48 h. Durée moyenne actuelle : {duree}.',
    q_civieres_ligne: '• {ref} · civière {code} · {duree}{demande}',
    q_civieres_demande: ' · demande en {type}',
    q_civieres_sans_demande: ' · sans demande de lit',
    q_civieres_vide: 'Aucune civière n’est configurée pour l’urgence de {etab}.',
    q_reseau_urgence: ', urgence {taux}\u00a0%',
    // blocages
    blocage: {
      nettoyage_long: 'Nettoyage depuis {duree} (cible {cible})',
      reserve_long: 'Réservé depuis {duree} sans admission',
      conge_depasse: 'Congé prévu dépassé de {duree} (attente d’hébergement ?)',
      hors_service_long: 'Hors service depuis {duree}',
    },
    // notifications
    notif: {
      transfert_demande: 'Nouvelle demande {numero}{urgent} : {type}, lit {lit} réservé, depuis {origine}.',
      transfert_accepte: '{dest} accepte le transfert {numero} (lit {lit}).',
      transfert_refuse: '{dest} refuse le transfert {numero}. Cherchez un autre lit.',
      transfert_depart: 'Le patient {ref} du transfert {numero} est en route. Arrivée prévue vers {heure}.',
      chambre_prete: '{dest} : la chambre du lit {lit} est prête pour le transfert {numero}.',
      dispo_lit: '{n|Lit|# lits} de {type} {n|libre|libres} à côté : {etab}, {km} km, environ {duree}{autres|| (et # autre établissement proche)| (et # autres établissements proches)}.',
      dispo_civiere: 'Civière libre à côté : urgence de {etab}, {km} km, environ {duree}{autres|| (et # autre urgence proche)| (et # autres urgences proches)}.',
      transfert_recu: 'Patient {ref} reçu à {dest}.',
    },
    // Copilote : recommandations
    r_assigner: 'Assigner le lit {lit} à {ref}',
    r_assigner_raison: 'Attend un lit en {type} depuis {duree} ({prio}, {prov}). Ce lit libre respecte ses besoins.',
    r_assigner_action: 'Assigner ce lit',
    r_nettoyer: 'Prioriser le nettoyage du lit {lit}',
    r_nettoyer_raison: '{ref} attend un lit en {type} depuis {duree} et aucun lit adapté n’est libre. Ce lit sera le premier disponible.',
    r_nettoyer_action: 'Lancer le nettoyage',
    r_transferer: 'Transférer {ref} vers {etab}',
    r_transferer_raison: 'Aucun lit adapté ici. {etab} : {raison}.{pourquoi}',
    r_transferer_action: 'Demander le transfert à {etab}',
    r_aucun: 'Aucun lit pour {ref}',
    r_aucun_raison: 'Aucun lit adapté ici ni dans le rayon de {km} km. Escaladez à la coordination régionale.',
    r_repondre: 'Répondre à la demande {numero}',
    r_repondre_raison: '{origine} attend votre réponse depuis {duree}{urgent}. Le lit {lit} est déjà bloqué pour ce patient.',
    r_urgent: ' (urgent)',
    r_repondre_action: 'Accepter',
    r_chambre: 'Préparer la chambre du lit {lit} ({numero})',
    r_chambre_raison: '{origine} envoie {ref} en {type}{besoins}. {arrivee}',
    r_chambre_arrivee: 'Arrivée prévue vers {heure}, dans {duree}.',
    r_chambre_attente: 'Le départ n’est pas encore confirmé.',
    r_chambre_besoins: ', besoins : {liste}',
    r_chambre_action: 'Chambre prête',
    r_dispo: '{type} : lit libre à côté, {etab} ({km} km)',
    r_dispo_raison: 'Signalé il y a {il_y_a}, {n|# lit encore libre|# lit encore libre|# lits encore libres}, environ {route} de route. {ref} attend un lit de ce type ici depuis {attente}.',
    r_prevision: '{type} : saturation prévue d’ici {h} h',
    r_prevision_raison: '{manque|Aucun lit libre ne serait disponible|Il manquerait environ # lit|Il manquerait environ # lits} (± {marge}) : {liberations|aucune libération|# libération|# libérations} et {arrivees|aucune arrivée|# arrivée|# arrivées} attendues. Confirmez les congés et préparez des transferts.',
    r_prevision_civ: 'Urgence : {taux}\u00a0% prévus d’ici {h} h',
    r_prevision_civ_raison: 'Environ {occ|aucun patient|# patient|# patients} sur civière (± {marge}) selon les arrivées habituelles à ces heures. Accélérez les admissions.',
    q_prev_oui: 'Oui, probablement : d’ici {h} h, saturation prévue en {liste}.',
    q_prev_non: 'Non, probablement pas d’ici {h} h. Prévision par type d’unité :',
    q_prev_sature: '• {type} : saturée, {manque|aucun lit libre prévu|il manquerait # lit|il manquerait # lits} (± {marge})',
    q_prev_libres: '• {type} : {n|aucun lit libre|# lit libre|# lits libres} prévus (± {marge})',
    q_prev_civ: '• Urgence : {occ|aucun patient|# patient|# patients} sur civière, {taux}\u00a0% (± {marge})',
    q_prev_methode: 'Calculé à partir des congés prévus, des nettoyages en cours et des {s|# dernière semaine|# dernières semaines} (moyennes par heure et par jour). Le Copilote propose ; vous décidez.',
    r_transport: 'Organiser le transport de {numero}',
    r_transport_raison: '{dest} a accepté. Le lit est réservé.',
    r_transport_action: 'Organiser le transport',
    r_reservation: 'Libérer la réservation du lit {lit}',
    r_reservation_action: 'Annuler la réservation',
    r_net_retard: 'Nettoyage en retard : {lit}',
    r_net_retard_raison: 'En attente depuis {duree} (cible {cible}).',
    r_net_retard_action: 'Confirmer le nettoyage',
    r_conge: 'Confirmer le congé du lit {lit}',
    r_conge_raison: 'Congé prévu à {heure}. Le confirmer permet de planifier le nettoyage et l’admission suivante.',
    r_conge_action: 'Confirmer le congé',
    r_depasses: '{n|# congé prévu dépassé|# congés prévus dépassés}',
    r_depasses_raison: '{n|Lit|Lits} {lits}. Vérifiez ce qui bloque la sortie (transport, hébergement, résultats) ou mettez la date à jour.',
    r_nsa: 'NSA : {taux}\u00a0% des lits occupés (cible {cible}\u00a0%)',
    r_nsa_raison: '{n|# patient n’a|# patients n’ont} plus besoin de soins aigus{longs}. Orientations : {orient}. Relancez le mécanisme d’accès à l’hébergement.',
    r_nsa_longs: ', dont {n} depuis plus de 30 jours',
    r_sature: '{type} : saturé, aucun lit prévu d’ici {h} h',
    r_sature_option: 'Préparez des transferts sortants. Meilleure option : {etab} ({raison}).',
    r_sature_aucun: 'Aucune place dans le rayon. Escaladez à la coordination régionale.',
    r_fermes: '{n|# lit fermé|# lits fermés} faute de personnel',
    r_fermes_raison: 'Capacité perdue. À signaler à la direction des soins infirmiers si du personnel peut être redéployé.',
    resume: 'Niveau {niveau} (pression {p}\u00a0%). {libres|Aucun lit libre|# lit libre|# lits libres}, {prevus|aucun prévu|# prévu|# prévus} d’ici {h} h, {attente|aucun patient en attente d’un lit|# patient en attente d’un lit|# patients en attente d’un lit}{longue}. {net|Aucun lit à nettoyer|# lit à nettoyer|# lits à nettoyer}, {nsa|aucun patient NSA|# patient NSA|# patients NSA} ({taux}\u00a0%).',
    resume_longue: ', dont {n} depuis plus de {h} h',
    delestage: '{de} est au niveau {niveau} ; {vers}, le plus proche avec de la place, a {n|# lit libre|# lits libres} en {type}.',
    // Copilote : questions
    q_nsa: '{n|Aucun patient NSA|# patient NSA|# patients NSA}, soit {taux}\u00a0% des lits occupés (cible {cible}\u00a0%), pour {jl|# jour-lit|# jours-lits}.',
    q_ligne: '• {a} : {b}',
    q_attente: '{n|# patient attend|# patients attendent} un lit :',
    q_attente_ligne: '• {ref} · {type} · {prio} · {duree}',
    q_attente_lit: ' · lit {lit} disponible',
    q_attente_aucun_lit: ' · aucun lit adapté ici',
    q_attente_vide: 'Aucun patient en attente d’un lit. Tout est à jour.',
    q_nettoyage: 'Ordre de nettoyage recommandé :',
    q_nettoyage_vide: 'Aucun lit à nettoyer. Tout est prêt.',
    q_reseau_ligne: '• {nom} : niveau {niveau} (pression {p}\u00a0%), {libres|aucun lit libre|# lit libre|# lits libres}',
    q_delestages: 'Délestages possibles :',
    q_blocages: '{n|# blocage|# blocages} à {etab} :',
    q_blocages_vide: 'Aucun blocage détecté à {etab}.',
    q_prevus: 'Lits qui devraient se libérer d’ici {h} h à {etab} :',
    q_prevus_note: 'Prévision basée sur les congés prévus et les nettoyages en cours.',
    q_ou_aucun: 'Aucun lit {type} libre dans le rayon de {km} km.',
    q_ou: 'Meilleure option en {type} : {etab} ({ville}, {km} km, environ {duree} de route), {libres|# lit libre|# lits libres}, {prevus|aucun prévu|# prévu|# prévus}.\nUtilisez « Chercher un lit ailleurs » pour réserver. La réservation demande toujours une validation.',
    q_combien: '• {type} : {ici|aucun lit libre|# lit libre|# lits libres} ici, {reseau} dans le réseau',
    q_combien_sans: '• {type} : pas d’unité ici, {reseau|aucun lit libre|# lit libre|# lits libres} dans le réseau',
    q_aide: 'Je peux répondre à des questions comme :\n• Combien de civières occupées depuis plus de 24 h ?\n• Combien de lits libres en soins intensifs ?\n• Où trouver un lit de chirurgie le plus proche ?\n• Quels lits bloquent chez nous ?\n• Combien de lits vont se libérer d’ici ce soir ?',
    ia_langue: 'Réponds en français',
    courriel_sujet: 'Arrimo · Réinitialiser votre mot de passe',
    courriel_texte: 'Bonjour {nom},\n\nVous avez demandé à réinitialiser votre mot de passe Arrimo. Ouvrez ce lien pour en choisir un nouveau ; il est valable {min} minutes et ne sert qu’une fois :\n\n{lien}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce courriel : votre mot de passe ne change pas.\n\nArrimo',
  },
  en: {
    locale: 'en-CA',
    niveau: { vert: 'green', jaune: 'yellow', orange: 'orange', rouge: 'red' },
    niveau_maj: { vert: 'Green', jaune: 'Yellow', orange: 'Orange', rouge: 'Red' },
    besoin: { isolement: 'isolation', pression_negative: 'negative pressure', ventilation: 'ventilation', telemetrie: 'telemetry' },
    provenance: { urgence: 'emergency', bloc: 'operating room', externe: 'external', autre: 'other' },
    orientation: { chsld: 'long-term care (CHSLD)', ri: 'intermediate resource', readaptation: 'rehabilitation', domicile: 'home with support', palliatif: 'palliative care', autre: 'other' },
    route: '≈ {duree} drive ({km} km)',
    dispo_libres: '{n|# suitable bed free|# suitable beds free}',
    dispo_prevus: 'no free bed, {n|none expected|# expected|# expected} within {h} h',
    tension_vert: 'green level',
    tension: '{niveau} level, pressure {p}%',
    pourquoi_proche: 'Recommended: the closest with a suitable bed',
    pourquoi_un: 'Recommended: {noms} is closer but at {niveaux} level',
    pourquoi_plusieurs: 'Recommended: {noms} are closer but at {niveaux} level',
    net_attente: '{n|# patient|# patients} waiting for a bed in {type}',
    net_long: 'Waiting for more than {duree}',
    net_ordre: 'Order of arrival',
    net_civiere_corridor: '{n|# patient|# patients} waiting in the hallway for a regular stretcher',
    r_civ_demande: 'Request a bed for {ref}',
    r_civ_demande_raison: 'On stretcher {code} for {duree}, with no bed request. Beyond 24 h on a stretcher, the risk to the patient increases.',
    r_civ_demande_action: 'Open the ER',
    r_civ_nettoyer: 'Clean stretcher {code}',
    r_civ_nettoyer_raison: '{n|# patient|# patients} waiting in the hallway: this regular stretcher will take the first one.',
    r_civ_nettoyer_action: 'Confirm cleaning',
    r_civ_deplacer: 'Move {ref} from the hallway to {code}',
    r_civ_deplacer_raison: 'In the hallway on {de} for {duree}; regular stretcher {code} is free.',
    r_civ_deplacer_action: 'Move the patient',
    r_urgence: 'ER at {taux}%: {occ|# patient|# patients} for {fonc|# stretcher|# stretchers}',
    r_urgence_raison: '{h24|No patient|# patient|# patients} on a stretcher for more than 24 h, including {h48} for more than 48 h. Speed up admissions and prepare outgoing transfers.',
    resume_urgence: ' ER: {occ|no patients|# patient|# patients} on stretchers for {fonc|# stretcher|# stretchers} ({taux}%), {h24} for more than 24 h.',
    q_civieres: 'ER at {etab}: {occ|no patients|# patient|# patients} on stretchers for {fonc|# working stretcher|# working stretchers} ({taux}%), including {corridor} in the hallway.\n{h24|No patient|# patient|# patients} for more than 24 h, {h48} for more than 48 h. Current average time: {duree}.',
    q_civieres_ligne: '• {ref} · stretcher {code} · {duree}{demande}',
    q_civieres_demande: ' · {type} request',
    q_civieres_sans_demande: ' · no bed request',
    q_civieres_vide: 'No stretcher is set up for the ER at {etab}.',
    q_reseau_urgence: ', ER {taux}%',
    blocage: {
      nettoyage_long: 'Cleaning for {duree} (target {cible})',
      reserve_long: 'Reserved for {duree} without admission',
      conge_depasse: 'Planned discharge overdue by {duree} (waiting for placement?)',
      hors_service_long: 'Out of service for {duree}',
    },
    notif: {
      transfert_demande: 'New request {numero}{urgent}: {type}, bed {lit} reserved, from {origine}.',
      transfert_accepte: '{dest} accepted transfer {numero} (bed {lit}).',
      transfert_refuse: '{dest} declined transfer {numero}. Look for another bed.',
      transfert_depart: 'Patient {ref} from transfer {numero} is on the way. Expected arrival around {heure}.',
      chambre_prete: '{dest}: the room for bed {lit} is ready for transfer {numero}.',
      dispo_lit: '{n|# free|# free} {type} {n|bed|beds} nearby: {etab}, {km} km, about {duree}{autres|| (and # other nearby facility)| (and # other nearby facilities)}.',
      dispo_civiere: 'Free ER stretcher nearby: {etab}, {km} km, about {duree}{autres|| (and # other nearby ER)| (and # other nearby ERs)}.',
      transfert_recu: 'Patient {ref} received at {dest}.',
    },
    r_assigner: 'Assign bed {lit} to {ref}',
    r_assigner_raison: 'Waiting for a bed in {type} for {duree} ({prio}, {prov}). This free bed meets their needs.',
    r_assigner_action: 'Assign this bed',
    r_nettoyer: 'Prioritize cleaning of bed {lit}',
    r_nettoyer_raison: '{ref} has been waiting for a bed in {type} for {duree} and no suitable bed is free. This bed will be the first available.',
    r_nettoyer_action: 'Start cleaning',
    r_transferer: 'Transfer {ref} to {etab}',
    r_transferer_raison: 'No suitable bed here. {etab}: {raison}.{pourquoi}',
    r_transferer_action: 'Request transfer to {etab}',
    r_aucun: 'No bed for {ref}',
    r_aucun_raison: 'No suitable bed here or within {km} km. Escalate to regional coordination.',
    r_repondre: 'Respond to request {numero}',
    r_repondre_raison: '{origine} has been waiting for your answer for {duree}{urgent}. Bed {lit} is already held for this patient.',
    r_urgent: ' (urgent)',
    r_repondre_action: 'Accept',
    r_chambre: 'Prepare the room for bed {lit} ({numero})',
    r_chambre_raison: '{origine} is sending {ref} to {type}{besoins}. {arrivee}',
    r_chambre_arrivee: 'Expected arrival around {heure}, in {duree}.',
    r_chambre_attente: 'Departure is not confirmed yet.',
    r_chambre_besoins: ', needs: {liste}',
    r_chambre_action: 'Room ready',
    r_dispo: '{type}: free bed nearby, {etab} ({km} km)',
    r_dispo_raison: 'Reported {il_y_a} ago, {n|# bed still free|# bed still free|# beds still free}, about {route} away. {ref} has been waiting here for this type of bed for {attente}.',
    r_prevision: '{type}: expected to be full within {h} h',
    r_prevision_raison: '{manque|No free bed would be available|About # bed short|About # beds short} (± {marge}): {liberations|no departures|# departure|# departures} and {arrivees|no arrivals|# arrival|# arrivals} expected. Confirm discharges and prepare transfers.',
    r_prevision_civ: 'ER: {taux}% expected within {h} h',
    r_prevision_civ_raison: 'About {occ|no patients|# patient|# patients} on stretchers (± {marge}) based on usual arrivals at these hours. Speed up admissions.',
    q_prev_oui: 'Yes, probably: within {h} h, expected to be full in {liste}.',
    q_prev_non: 'No, probably not within {h} h. Forecast by unit type:',
    q_prev_sature: '• {type}: full, {manque|no free bed expected|about # bed short|about # beds short} (± {marge})',
    q_prev_libres: '• {type}: {n|no free beds|# free bed|# free beds} expected (± {marge})',
    q_prev_civ: '• ER: {occ|no patients|# patient|# patients} on stretchers, {taux}% (± {marge})',
    q_prev_methode: 'Based on planned discharges, cleanings in progress and the last {s|# week|# weeks} (averages by hour and day of week). The Copilot proposes; you decide.',
    r_transport: 'Arrange transport for {numero}',
    r_transport_raison: '{dest} accepted. The bed is reserved.',
    r_transport_action: 'Arrange transport',
    r_reservation: 'Release the reservation on bed {lit}',
    r_reservation_action: 'Cancel reservation',
    r_net_retard: 'Cleaning overdue: {lit}',
    r_net_retard_raison: 'Waiting for {duree} (target {cible}).',
    r_net_retard_action: 'Confirm cleaning',
    r_conge: 'Confirm discharge for bed {lit}',
    r_conge_raison: 'Discharge planned at {heure}. Confirming it helps plan cleaning and the next admission.',
    r_conge_action: 'Confirm discharge',
    r_depasses: '{n|# planned discharge|# planned discharges} overdue',
    r_depasses_raison: '{n|Bed|Beds} {lits}. Check what is holding up the discharge (transport, placement, results) or update the date.',
    r_nsa: 'ALC: {taux}% of occupied beds (target {cible}%)',
    r_nsa_raison: '{n|# patient no longer needs|# patients no longer need} acute care{longs}. Destinations: {orient}. Follow up with the placement access process.',
    r_nsa_longs: ', including {n} for more than 30 days',
    r_sature: '{type}: full, no bed expected within {h} h',
    r_sature_option: 'Prepare outgoing transfers. Best option: {etab} ({raison}).',
    r_sature_aucun: 'No room within range. Escalate to regional coordination.',
    r_fermes: '{n|# bed|# beds} closed for lack of staff',
    r_fermes_raison: 'Lost capacity. Report to nursing management if staff can be redeployed.',
    resume: '{niveau} level (pressure {p}%). {libres|No free beds|# free bed|# free beds}, {prevus|none expected|# expected|# expected} within {h} h, {attente|no patients waiting for a bed|# patient waiting for a bed|# patients waiting for a bed}{longue}. {net|No beds to clean|# bed to clean|# beds to clean}, {nsa|no ALC patients|# ALC patient|# ALC patients} ({taux}%).',
    resume_longue: ', including {n} for more than {h} h',
    delestage: '{de} is at {niveau} level; {vers}, the closest with room, has {n|# free bed|# free beds} in {type}.',
    q_nsa: '{n|No ALC patients|# ALC patient|# ALC patients}, i.e. {taux}% of occupied beds (target {cible}%), for {jl|# bed-day|# bed-days}.',
    q_ligne: '• {a}: {b}',
    q_attente: '{n|# patient|# patients} waiting for a bed:',
    q_attente_ligne: '• {ref} · {type} · {prio} · {duree}',
    q_attente_lit: ' · bed {lit} available',
    q_attente_aucun_lit: ' · no suitable bed here',
    q_attente_vide: 'No patients waiting for a bed. Everything is up to date.',
    q_nettoyage: 'Recommended cleaning order:',
    q_nettoyage_vide: 'No beds to clean. Everything is ready.',
    q_reseau_ligne: '• {nom}: {niveau} level (pressure {p}%), {libres|no free beds|# free bed|# free beds}',
    q_delestages: 'Possible offloading:',
    q_blocages: '{n|# blockage|# blockages} at {etab}:',
    q_blocages_vide: 'No blockage detected at {etab}.',
    q_prevus: 'Beds expected to free up within {h} h at {etab}:',
    q_prevus_note: 'Forecast based on planned discharges and cleanings in progress.',
    q_ou_aucun: 'No free {type} bed within {km} km.',
    q_ou: 'Best option for {type}: {etab} ({ville}, {km} km, about {duree} drive), {libres|# free bed|# free beds}, {prevus|none expected|# expected|# expected}.\nUse “Find a bed elsewhere” to reserve. A reservation always requires confirmation.',
    q_combien: '• {type}: {ici|no free beds|# free bed|# free beds} here, {reseau} in the network',
    q_combien_sans: '• {type}: no unit here, {reseau|no free beds|# free bed|# free beds} in the network',
    q_aide: 'I can answer questions such as:\n• How many stretchers have been occupied for more than 24 h?\n• How many free intensive care beds?\n• Where is the closest surgery bed?\n• Which beds are blocked here?\n• How many beds will free up by tonight?',
    ia_langue: 'Answer in English',
    courriel_sujet: 'Arrimo · Reset your password',
    courriel_texte: 'Hello {nom},\n\nYou asked to reset your Arrimo password. Open this link to choose a new one; it is valid for {min} minutes and can be used only once:\n\n{lien}\n\nIf you did not make this request, ignore this email: your password does not change.\n\nArrimo',
  },
};

const langueDe = (v) => (LANGUES.includes(v) ? v : 'fr');

/** Texte `cle` dans la langue, avec ses variables {nom}. Les clés imbriquées s'écrivent « blocage.reserve_long ». */
function tr(langue, cle, vars = {}) {
  const chercher = (l) => cle.split('.').reduce((o, k) => (o == null ? o : o[k]), TEXTES[l]);
  const modele = chercher(langueDe(langue)) ?? chercher('fr') ?? cle;
  return F.remplir(TEXTES[langueDe(langue)].locale, modele, vars);
}
/** Mise en forme selon la langue (mêmes règles que l'interface, public/i18n/format.js). */
const nombre = (langue, n, dec = 1) => F.nombre(TEXTES[langueDe(langue)].locale, n, dec);
const pourcent = (langue, n, dec = 1) => F.pourcent(TEXTES[langueDe(langue)].locale, n, dec);
const duree = (langue, min) => F.duree(TEXTES[langueDe(langue)].locale, min);
const dico = (langue, nom) => TEXTES[langueDe(langue)][nom];

/* Noms des types d'unité dans la langue (types_unite.nom_en), avec un petit cache. */
let cacheTypes = { quand: 0, carte: new Map() };
async function chargerTypes(db) {
  if (Date.now() - cacheTypes.quand > 30000) {
    const { rows } = await db.query('SELECT nom, nom_en FROM types_unite');
    cacheTypes = { quand: Date.now(), carte: new Map(rows.map((r) => [r.nom, r.nom_en || r.nom])) };
  }
  return cacheTypes.carte;
}
function viderCacheTypes() { cacheTypes = { quand: 0, carte: new Map() }; }
/** Fonction de traduction d'un nom de type pour la langue donnée (identité en français). */
async function traducteurTypes(db, langue) {
  if (langueDe(langue) === 'fr') return (n) => n;
  const carte = await chargerTypes(db);
  return (n) => (n == null ? n : carte.get(n) || n);
}

/** Remplace en place les champs type_nom d'une réponse (objets et tableaux imbriqués). */
function traduireTypes(valeur, nomType) {
  if (Array.isArray(valeur)) valeur.forEach((v) => traduireTypes(v, nomType));
  else if (valeur && typeof valeur === 'object' && !(valeur instanceof Date)) {
    for (const [k, v] of Object.entries(valeur)) {
      if (k === 'type_nom' && typeof v === 'string') valeur[k] = nomType(v);
      else if (v && typeof v === 'object') traduireTypes(v, nomType);
    }
  }
  return valeur;
}

module.exports = { LANGUES, TEXTES, langueDe, tr, dico, traducteurTypes, traduireTypes, viderCacheTypes, nombre, pourcent, duree };
