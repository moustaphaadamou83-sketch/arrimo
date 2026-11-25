'use strict';
/**
 * Vigilance en anglais (audit de l'anglais, 19 nov. 2026) : les textes produits par src/vigilance.js sont traduits à la sortie,
 * par modèles FR → EN ({x} = valeur conservée telle quelle). Un texte sans modèle reste en français : le test
 * tests/anglais-ecrans.test.cjs échoue alors (aucune traduction manquante tolérée).
 */
const { EVENEMENTS } = require('./og-localisation');
const MODELES = [
  ['Coordination des lits de l’établissement', 'Facility bed coordination'],
  ['Équipe de soins de l’unité, avec la coordination', 'Unit care team, with coordination'],
  ['Équipe d’entretien', 'Housekeeping team'],
  ['Gestion de l’unité', 'Unit management'],
  ['Équipe d’entretien de l’urgence', 'Emergency housekeeping team'],
  ['Équipe médicale de l’urgence', 'Emergency medical team'],
  ['heure de congé confirmée + durée cible de nettoyage ({n} min, configuration)', 'confirmed discharge time + target cleaning time ({n} min, configuration)'],
  ['Les congés listés sont des événements enregistrés (saisie ou interface autorisée). Un congé prévu n’est pas un lit libre.', 'Listed discharges are recorded events (entry or authorized interface). A planned discharge is not a free bed.'],
  ['Heure prévue dépassée sans départ enregistré : vérification nécessaire. Le lit n’est jamais libéré automatiquement.', 'Planned time passed with no recorded departure: check needed. The bed is never freed automatically.'],
  ['Les prévisions statistiques (OG, Prévisions) sont séparées : elles s’appuient sur l’historique et donnent une marge.', 'Statistical forecasts (OG, Forecasts) are separate: they rely on history and give a margin.'],
  ['{lit} — Réservé depuis {d} sans admission enregistrée.', '{lit} — Reserved for {d} with no recorded admission.'],
  ['Passage à l’état « réservé »', 'Changed to “reserved”'],
  ['Réservation plus longue que la durée maximale configurée (config. pays : reservation_max_min).', 'Reservation longer than the configured maximum (country config: reservation_max_min).'],
  ['Lit réservé pour le transfert {n} (statut : {s}).', 'Bed reserved for transfer {n} (status: {s}).'],
  ['Lit assigné à la demande d’admission n° {n} ({p}), admission non enregistrée.', 'Bed assigned to admission request no. {n} ({p}), admission not recorded.'],
  ['Réservation locale sans demande liée : le patient est peut-être déjà arrivé sans que l’admission soit saisie, ou la réservation n’est plus utile.', 'Local reservation with no linked request: the patient may already have arrived without the admission being entered, or the reservation is no longer needed.'],
  ['Vérifier auprès de l’équipe responsable si la réservation doit être maintenue ; sinon admettre ou annuler (décision humaine).', 'Check with the responsible team whether the reservation should be kept; otherwise admit or cancel (human decision).'],
  ['{lit} — Congé prévu dépassé de {d}, départ non enregistré.', '{lit} — Planned discharge overdue by {d}, departure not recorded.'],
  ['Congé prévu le {date}', 'Discharge planned for {date}'],
  ['Alerte dès l’heure dépassée ; niveau relevé après la marge configurée ({n} min).', 'Alert as soon as the time is passed; level raised after the configured margin ({n} min).'],
  ['Départ peut-être fait sans être saisi, ou congé reporté (transport, attente d’un résultat).', 'Departure possibly done without being entered, or discharge postponed (transport, waiting for a result).'],
  ['Vérifier avec l’unité : enregistrer le départ, ou mettre à jour le congé (reporté, nouvelle heure). Le lit n’est pas libéré automatiquement.', 'Check with the unit: record the departure, or update the discharge (postponed, new time). The bed is not freed automatically.'],
  ['{lit} — En nettoyage depuis {d}, nettoyage non commencé.', '{lit} — In cleaning for {d}, cleaning not started.'],
  ['{lit} — En nettoyage depuis {d}.', '{lit} — In cleaning for {d}.'],
  ['Départ du patient (lit passé au nettoyage)', 'Patient departure (bed moved to cleaning)'],
  ['Durée cible de nettoyage configurée (nettoyage_cible_min).', 'Configured target cleaning time (nettoyage_cible_min).'],
  ['Nettoyage commencé, fin non confirmée.', 'Cleaning started, end not confirmed.'],
  ['Aucun début de nettoyage enregistré.', 'No cleaning start recorded.'],
  ['Confirmer la fin du nettoyage dans l’écran Nettoyage, ou signaler l’empêchement.', 'Confirm the end of cleaning in the Cleaning screen, or report the obstacle.'],
  ['{lit} — Hors service depuis {d} (motif : non précisé).', '{lit} — Out of service for {d} (reason: not specified).'],
  ['{lit} — Hors service depuis {d} (motif : {m}).', '{lit} — Out of service for {d} (reason: {m}).'],
  ['Mise hors service', 'Taken out of service'],
  ['Hors service plus long que {n} h (hors_service_max_h).', 'Out of service longer than {n} h (hors_service_max_h).'],
  ['Motif enregistré : non précisé.', 'Recorded reason: not specified.'],
  ['Motif enregistré : {m}.', 'Recorded reason: {m}.'],
  ['Vérifier si le lit peut être remis en service.', 'Check whether the bed can be put back in service.'],
  ['{lit} — Libre, disponibilité jamais confirmée : invisible pour le réseau.', '{lit} — Free, availability never confirmed: invisible to the network.'],
  ['{lit} — Confirmation de disponibilité périmée ({d}).', '{lit} — Availability confirmation expired ({d}).'],
  ['Lit devenu libre', 'Bed became free'],
  ['Dernière confirmation humaine', 'Last human confirmation'],
  ['Une confirmation reste valable {n} min (confirmation_lit_validite_min).', 'A confirmation stays valid for {n} min (confirmation_lit_validite_min).'],
  ['Le réseau ne propose un lit que si sa disponibilité est confirmée et récente.', 'The network only offers a bed whose availability is confirmed and recent.'],
  ['Vérifier physiquement le lit puis « Confirmer la disponibilité ».', 'Check the bed physically, then “Confirm availability”.'],
  ['Demande n° {n} ({r})', 'Request no. {n} ({r})'],
  ['{r} attend un lit de {t} depuis {d} (civière {c}).', '{r} has been waiting for a {t} bed for {d} (stretcher {c}).'],
  ['{r} attend un lit de {t} depuis {d}.', '{r} has been waiting for a {t} bed for {d}.'],
  ['Création de la demande de lit', 'Bed request created'],
  ['Attente maximale configurée ({n} min).', 'Configured maximum wait ({n} min).'],
  ['Aucun lit compatible assigné à cette demande.', 'No compatible bed assigned to this request.'],
  ['Assigner un lit compatible, ou chercher ailleurs (Réseau) ; la décision reste humaine.', 'Assign a compatible bed, or search elsewhere (Network); the decision stays human.'],
  ['Urgence', 'Emergency'],
  ['Civière {c} — en nettoyage depuis {d}.', 'Stretcher {c} — in cleaning for {d}.'],
  ['Départ du patient de la civière', 'Patient left the stretcher'],
  ['Durée cible de nettoyage d’une civière (nettoyage_civiere_cible_min).', 'Target cleaning time for a stretcher (nettoyage_civiere_cible_min).'],
  ['Fin du nettoyage non confirmée.', 'End of cleaning not confirmed.'],
  ['Confirmer le nettoyage de la civière.', 'Confirm stretcher cleaning.'],
  ['Civière {c} — {r} présent depuis {d}, sans demande de lit.', 'Stretcher {c} — {r} present for {d}, with no bed request.'],
  ['Arrivée sur civière', 'Arrival on stretcher'],
  ['Présence de plus de 24 h sans demande de lit enregistrée.', 'Present for more than 24 h with no recorded bed request.'],
  ['Une longue présence n’indique pas à elle seule une hospitalisation : à interpréter par l’équipe de l’urgence.', 'A long stay alone does not indicate admission: to be interpreted by the emergency team.'],
  ['Faire valider par l’équipe compétente si une demande de lit est nécessaire.', 'Have the competent team confirm whether a bed request is needed.'],
  ['Rouge : bloque une admission ou un transfert (réservation sans suite, demande prioritaire en attente au-delà du seuil).', 'Red: blocks an admission or a transfer (reservation with no follow-up, priority request waiting beyond the threshold).'],
  ['Orange : retard au-delà de la marge configurée (congé, nettoyage deux fois plus long que la cible, attente).', 'Orange: delay beyond the configured margin (discharge, cleaning twice as long as the target, wait).'],
  ['Jaune : à vérifier (seuil atteint, sans effet bloquant établi).', 'Yellow: to check (threshold reached, no established blocking effect).'],
  // Vigilance transversale (lot 1 du chantier coordination, 26 nov. 2026)
  ['Responsable opérationnel de l’urgence', 'Emergency operations lead'],
  ['Responsable opérationnel de l’urgence, avec la coordination des lits', 'Emergency operations lead, with bed coordination'],
  ['Responsable du transport', 'Transport lead'],
  ['Coordination des sorties et placements', 'Discharge and placement coordination'],
  ['Établissement d’accueil', 'Receiving facility'],
  ['Responsable des intégrations de l’établissement', 'Facility integrations lead'],
  ['Identifier le blocage, accuser réception et consigner le motif dans Chrono.', 'Identify the blockage, acknowledge and record the reason in Chrono.'],
  ['Mobiliser la coordination hospitalière et informer le CCS ; consigner le motif dans Chrono.', 'Involve hospital coordination and inform the dispatch centre; record the reason in Chrono.'],
  ['Mobiliser les responsables de garde et la coordination ambulancière selon le protocole local.', 'Involve the on-call managers and ambulance coordination according to the local protocol.'],
  ['civière indisponible', 'stretcher unavailable'], ['personnel indisponible', 'staff unavailable'], ['chambre en préparation', 'room being prepared'],
  ['attente de transmission du dossier', 'waiting for record transfer'], ['saturation du service', 'department at capacity'],
  ['incident technique', 'technical incident'], ['triage saturé', 'triage at capacity'], ['contraintes cliniques', 'clinical constraints'],
  ['cause inconnue', 'unknown cause'], ['autre motif', 'other reason'],
  ['Ambulance {u} ({o}) à la porte depuis {d}, responsabilité non transférée — palier vigilance.', 'Ambulance {u} ({o}) at the door for {d}, responsibility not transferred — watch level.'],
  ['Ambulance {u} ({o}) à la porte depuis {d}, responsabilité non transférée — palier escalade.', 'Ambulance {u} ({o}) at the door for {d}, responsibility not transferred — escalation level.'],
  ['Ambulance {u} ({o}) à la porte depuis {d}, responsabilité non transférée — palier critique.', 'Ambulance {u} ({o}) at the door for {d}, responsibility not transferred — critical level.'],
  ['Arrivée de l’ambulance à l’urgence (H11)', 'Ambulance arrival at the emergency department (H11)'],
  ['Paliers indicatifs du profil de pays : vigilance {a} min, escalade {b} min, critique {c} min (non cliniques, à valider localement).', 'Indicative levels from the country profile: watch {a} min, escalation {b} min, critical {c} min (non-clinical, to be validated locally).'],
  ['Motif consigné dans Chrono : {m}.', 'Reason recorded in Chrono: {m}.'],
  ['Aucun motif consigné : la cause reste inconnue tant que l’équipe ne l’a pas documentée.', 'No reason recorded: the cause remains unknown until the team documents it.'],
  ['{a} ambulance(s) annoncée(s) pour {c} civière(s) libre(s) à l’urgence.', '{a} ambulance(s) announced for {c} free stretcher(s) in the emergency department.'],
  ['Préalertes reçues de Liaison Secours', 'Pre-alerts received from Liaison Secours'],
  ['Ambulances annoncées non encore arrivées supérieures aux civières libres enregistrées.', 'Announced ambulances not yet arrived exceed the recorded free stretchers.'],
  ['Comptes lus dans les préalertes ouvertes et l’état des civières ; une civière libre non confirmée peut ne pas être prête.', 'Counts read from open pre-alerts and stretcher status; an unconfirmed free stretcher may not be ready.'],
  ['Préparer l’accueil (civières, nettoyage, congés) ; informer le CCS si la réception est contrainte. La destination reste décidée par le CCS.', 'Prepare reception (stretchers, cleaning, discharges); inform the dispatch centre if reception is constrained. The destination remains the dispatch centre’s decision.'],
  ['Transport {n} ({t}) : heure souhaitée dépassée de {d}, résident non pris en charge.', 'Transport {n} ({t}): requested time exceeded by {d}, resident not picked up.'],
  ['Heure souhaitée du transport', 'Requested transport time'],
  ['Marge de retard configurée ({n} min, transport_retard_marge_min).', 'Configured delay margin ({n} min, transport_retard_marge_min).'],
  ['La demande n’a pas été acceptée par le transporteur.', 'The request has not been accepted by the carrier.'],
  ['Transport accepté, prise en charge non enregistrée.', 'Transport accepted, pickup not recorded.'],
  ['Joindre le transporteur ; si le transport n’est plus possible, reprogrammer ou chercher une autre solution autorisée (décision humaine).', 'Contact the carrier; if the transport is no longer possible, reschedule or look for another authorized option (human decision).'],
  ['Transport {n} ({t}) prévu dans {d}, pas encore accepté.', 'Transport {n} ({t}) scheduled in {d}, not yet accepted.'],
  ['Demande de transport transmise', 'Transport request sent'],
  ['Transport prévu dans les 2 h sans acceptation du transporteur.', 'Transport scheduled within 2 h with no carrier acceptance.'],
  ['Aucune acceptation enregistrée.', 'No acceptance recorded.'],
  ['Vérifier la disponibilité du transporteur avant l’heure prévue.', 'Check the carrier’s availability before the scheduled time.'],
  ['Placement {n} accepté : départ prévu dépassé de {d}, départ de l’hôpital non enregistré.', 'Placement {n} accepted: planned departure exceeded by {d}, hospital departure not recorded.'],
  ['Placement {n} accepté depuis {d} sans départ planifié.', 'Placement {n} accepted for {d} with no departure planned.'],
  ['Départ prévu du placement', 'Planned placement departure'],
  ['Acceptation du placement', 'Placement acceptance'],
  ['Heure de départ prévue dépassée.', 'Planned departure time exceeded.'],
  ['Acceptation plus ancienne que la durée configurée ({n} h, placement_accepte_max_h).', 'Acceptance older than the configured duration ({n} h, placement_accepte_max_h).'],
  ['Obstacle possible : transport, chambre, documents ou famille ; à vérifier dans Liaison CHSLD.', 'Possible obstacle: transport, room, documents or family; to be checked in Liaison CHSLD.'],
  ['Identifier l’obstacle et le responsable dans Liaison CHSLD ; planifier le transport et confirmer la date de départ.', 'Identify the obstacle and the person responsible in Liaison CHSLD; plan the transport and confirm the departure date.'],
  ['Transfert {n} vers {e} sans réponse depuis {d}.', 'Transfer {n} to {e} with no response for {d}.'],
  ['Demande de transfert', 'Transfer request'],
  ['Délai de réponse configuré ({n} min, transfert_reponse_max_min).', 'Configured response time ({n} min, transfert_reponse_max_min).'],
  ['Ni acceptation ni refus enregistré par l’établissement d’accueil.', 'Neither acceptance nor refusal recorded by the receiving facility.'],
  ['Relancer l’établissement d’accueil depuis Transferts, ou consulter les solutions de rechange (décision humaine).', 'Follow up with the receiving facility from Transfers, or review the alternatives (human decision).'],
  ['Connecteur {c} : aucun message reçu depuis {d} ; les données qu’il alimente peuvent être périmées.', 'Connector {c}: no message received for {d}; the data it feeds may be outdated.'],
  ['Connecteur {c} : aucun message reçu depuis sa création.', 'Connector {c}: no message received since it was created.'],
  ['Dernier message reçu du connecteur', 'Last message received from the connector'],
  ['Création du connecteur', 'Connector creation'],
  ['Silence maximal configuré ({n} min, connecteur_silence_max_min).', 'Configured maximum silence ({n} min, connecteur_silence_max_min).'],
  ['Interruption possible de la synchronisation ; les disponibilités non confirmées ne doivent pas être tenues pour certaines.', 'Possible synchronization interruption; unconfirmed availability must not be treated as certain.'],
  ['Responsable opérationnel de l’urgence, avec le CCS', 'Emergency operations lead, with the dispatch centre'],
  ['Quote-part non atteinte ({r} reçue(s) et {a} attendue(s) sur {v} par {p} min) alors qu’aucune civière n’est libre.', 'Quota not reached ({r} received and {a} expected out of {v} per {p} min) while no stretcher is free.'],
  ['Quote-part saisie par l’autorité', 'Quota entered by the authority'],
  ['Comparaison de deux informations distinctes ; aucune marge n’est calculée (formule non définie officiellement).', 'Comparison of two separate pieces of information; no margin is calculated (formula not officially defined).'],
  ['Quote-part fixée par {a} ; civières libres enregistrées : 0.', 'Quota set by {a}; recorded free stretchers: 0.'],
  ['Informer le CCS de la contrainte de réception ; la destination reste décidée par le répartiteur.', 'Inform the dispatch centre of the reception constraint; the destination remains the dispatcher’s decision.'],
  ['Vérifier la liaison avec l’équipe informatique ; confirmer les disponibilités manuellement en attendant.', 'Check the link with the IT team; confirm availability manually in the meantime.'],
];
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILES = MODELES.map(([fr, en]) => {
  const noms = [...fr.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
  return { re: new RegExp(`^${fr.split(/\{\w+\}/).map(echapper).join('([\\s\\S]+?)')}$`), noms, en };
});
/** Durée « 3 j 4 h » → « 3 d 4 h » (les autres formes sont identiques en anglais). */
const duree = (s) => String(s).replace(/(\d+) j (\d+) h/g, '$1 d $2 h');
function traduireTexte(s) {
  if (typeof s !== 'string' || !s) return s;
  if (EVENEMENTS[s]) return EVENEMENTS[s];
  for (const m of COMPILES) {
    const x = m.re.exec(s);
    if (x) return m.en.replace(/\{(\w+)\}/g, (_, k) => duree(x[m.noms.indexOf(k) + 1]));
  }
  return s;
}
const CLES = new Set(['responsable', 'titre', 'evenement', 'regle', 'texte', 'action', 'disponibilite_estimee_regle', 'deterministe', 'retard', 'estimation', 'eleve', 'modere', 'faible', 'unite', 'ressource']);
/** Traduit en profondeur les champs de texte connus d'une réponse de Vigilance (données saisies, noms propres : inchangés). */
function traduire(obj, langue) {
  if (langue !== 'en') return obj;
  const visiter = (v, cle) => {
    if (Array.isArray(v)) return v.map((x) => visiter(x, cle));
    if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visiter(x, k)]));
    if (typeof v === 'string' && CLES.has(cle)) return traduireTexte(v);
    if (typeof v === 'string' && cle === 'action' && EVENEMENTS[v]) return EVENEMENTS[v];
    return v;
  };
  return visiter(obj);
}
module.exports = { traduire, traduireTexte, MODELES };
