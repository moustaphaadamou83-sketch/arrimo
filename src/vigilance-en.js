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
