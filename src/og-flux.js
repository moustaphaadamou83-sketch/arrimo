'use strict';
/**
 * OG, copilote central (exigence transversale du 21 nov. 2026) : réponses opérationnelles sourcées sur Arrimo Flux, Transport,
 * Chambres et lits, Nettoyage/Personnel et tâches, Préalertes et Admissions, avec les MÊMES droits que l'interface.
 * Chaque réponse : état actuel, source, heure d'actualisation, données manquantes signalées, action suivante. OG n'agit jamais,
 * n'invente aucune disponibilité, heure d'arrivée ni confirmation ; aucune donnée clinique.
 */
const norm = (q) => String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const T = (L, fr, en) => (L === 'en' ? en : fr);
const h = (L, d) => new Date(d).toLocaleTimeString(L === 'en' ? 'en-CA' : 'fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' });
const dh = (L, d) => new Date(d).toLocaleString(L === 'en' ? 'en-CA' : 'fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' });
const pied = (L, source) => `\n${T(L, 'Source', 'Source')} : ${source} · ${T(L, 'actualisé à', 'updated at')} ${h(L, new Date())}`;
const rep = (texte, intention, ouvrir) => ({ mode: 'local', reponse: texte, sources: ['arrimo'], intentions: [intention], ...(ouvrir ? { ouvrir } : {}) });
const ST_TR = { fr: { a_valider: 'à valider (pas encore transmis)', demandee: 'demandé, en attente d’acceptation', acceptee: 'accepté', en_route: 'ambulance en route vers le départ', pris_en_charge: 'patient pris en charge, en transport', arrivee: 'arrivé à destination', refusee: 'refusé', annulee: 'annulé' },
  en: { a_valider: 'to validate (not sent yet)', demandee: 'requested, awaiting acceptance', acceptee: 'accepted', en_route: 'ambulance on the way to pick-up', pris_en_charge: 'patient picked up, in transport', arrivee: 'arrived at destination', refusee: 'declined', annulee: 'cancelled' } };

async function transport(pool, u, etabs, numero, L) {
  const d = (await pool.query(`SELECT d.*, eo.nom AS origine, COALESCE(ed.nom, d.destination_libelle) AS destination, un.numero AS unite FROM demandes_transport d JOIN etablissements eo ON eo.id = d.origine_id
    LEFT JOIN etablissements ed ON ed.id = d.destination_id LEFT JOIN unites_secours un ON un.id = d.unite_id WHERE upper(d.numero) = $1`, [numero])).rows[0];
  if (!d || !(etabs.includes(d.origine_id) || etabs.includes(d.destination_id))) return T(L, `Je ne trouve pas le transport ${numero} parmi ceux de votre établissement.`, `I cannot find transport ${numero} among your facility’s transports.`);
  const lignes = [`${d.numero} · ${d.origine} → ${d.destination} · ${ST_TR[L][d.statut] || d.statut}.`];
  lignes.push(d.unite ? T(L, `Véhicule : ${d.unite}.`, `Vehicle: ${d.unite}.`) : T(L, 'Aucun véhicule affecté pour l’instant (la demande n’est pas une affectation).', 'No vehicle assigned yet (the request is not an assignment).'));
  if (d.plage_debut) lignes.push(T(L, `Créneau ${d.plage_confirmee_debut ? 'confirmé' : 'demandé'} : ${dh(L, d.plage_confirmee_debut || d.plage_debut)} – ${h(L, d.plage_confirmee_fin || d.plage_fin)} (un créneau n’est pas une durée de trajet).`, `${d.plage_confirmee_debut ? 'Confirmed' : 'Requested'} slot: ${dh(L, d.plage_confirmee_debut || d.plage_debut)} – ${h(L, d.plage_confirmee_fin || d.plage_fin)} (a slot is not a travel time).`));
  if (d.pris_en_charge_le) lignes.push(T(L, `Prise en charge réelle : ${dh(L, d.pris_en_charge_le)}.`, `Actual pick-up: ${dh(L, d.pris_en_charge_le)}.`));
  if (d.arrivee_le) lignes.push(T(L, `Arrivée réelle : ${dh(L, d.arrivee_le)}.`, `Actual arrival: ${dh(L, d.arrivee_le)}.`));
  else if (d.prealerte_eta_min != null && d.prealerte_eta_le) lignes.push(T(L, `Arrivée estimée : ${h(L, new Date(new Date(d.prealerte_eta_le).getTime() + d.prealerte_eta_min * 60000))} (préalerte de l’équipage).`, `Estimated arrival: ${h(L, new Date(new Date(d.prealerte_eta_le).getTime() + d.prealerte_eta_min * 60000))} (crew pre-alert).`));
  else if (!['arrivee', 'refusee', 'annulee'].includes(d.statut)) lignes.push(T(L, 'Heure d’arrivée estimée : indisponible (aucune préalerte ni position).', 'Estimated arrival time: unavailable (no pre-alert or position).'));
  if (d.prealerte_le) lignes.push(d.prealerte_recue_le ? T(L, 'Préalerte reçue par la destination.', 'Pre-alert received by the destination.') : T(L, 'Préalerte envoyée, pas encore acquittée par la destination.', 'Pre-alert sent, not yet acknowledged by the destination.'));
  return lignes.join('\n') + pied(L, T(L, 'Transport', 'Transport'));
}

async function chambre(pool, etabs, code, L) {
  const l = (await pool.query(`SELECT l.*, e.nom AS etab FROM lits l JOIN etablissements e ON e.id = l.etablissement_id WHERE upper(l.code) = $1 AND l.etablissement_id = ANY($2) LIMIT 1`, [code, etabs])).rows[0];
  if (!l) return null;
  const ETAT = { libre: T(L, 'libre', 'free'), reserve: T(L, 'réservée', 'reserved'), occupe: T(L, 'occupée', 'occupied'), nettoyage: T(L, 'en nettoyage', 'being cleaned'), indispo: T(L, 'fermée (hors service)', 'closed (out of service)') };
  const t = (await pool.query(`SELECT statut, echeance, titre FROM taches_etab WHERE lit_id = $1 AND type IN ('preparation_chambre', 'entretien') AND statut IN ('a_faire', 'en_cours') ORDER BY id DESC LIMIT 1`, [l.id])).rows[0];
  const fini = (await pool.query(`SELECT t.fait_le AS termine_le, u.nom FROM taches_etab t LEFT JOIN utilisateurs u ON u.id = t.fait_par WHERE t.lit_id = $1 AND t.type IN ('preparation_chambre', 'entretien') AND t.statut = 'faite' ORDER BY t.fait_le DESC NULLS LAST LIMIT 1`, [l.id]).catch(() => ({ rows: [] }))).rows[0];
  const lignes = [`${l.code} (${l.etab}) : ${ETAT[l.etat] || l.etat}${l.patient_ref ? ` · ${l.patient_ref}` : ''}.`];
  if (t) lignes.push(T(L, `Préparation ${t.statut === 'en_cours' ? 'en cours' : 'à faire'} par l’entretien${t.echeance ? `, échéance ${dh(L, t.echeance)}` : ''} : la chambre n’est PAS encore prête.`, `Preparation ${t.statut === 'en_cours' ? 'in progress' : 'to do'} by housekeeping${t.echeance ? `, due ${dh(L, t.echeance)}` : ''}: the room is NOT ready yet.`));
  else if (l.entretien_statut === 'propre') lignes.push(T(L, 'Chambre déclarée prête par l’entretien.', 'Room declared ready by housekeeping.'));
  if (fini?.termine_le) lignes.push(T(L, `Dernière préparation confirmée ${fini.nom ? `par ${fini.nom} ` : ''}le ${dh(L, fini.termine_le)}.`, `Last preparation confirmed ${fini.nom ? `by ${fini.nom} ` : ''}on ${dh(L, fini.termine_le)}.`));
  return lignes.join('\n') + pied(L, T(L, 'Chambres et lits, Personnel et tâches', 'Rooms and beds, Staff and tasks'));
}

async function repondre(pool, u, etabId, question, langue) {
  const L = require('./og-localisation').langueDemandee(question, langue);
  const qn = norm(question); const etabs = (u.etabs || []).map(Number);
  if (!etabs.length) return null;
  // 1. Transport par numéro
  const dt = String(question || '').match(/\bDT-\d{3,6}\b/i);
  if (dt && /\b(ou en est|transport|ambulance|vehicule|arrive\w*|heure|statut|status|where|vehicle|eta|when)\b/.test(qn)) return rep(await transport(pool, u, etabs, dt[0].toUpperCase(), L), 'transport', 'transports-planifies');
  // 2. Chambre par code (ERA-309, MED-202A…)
  const code = String(question || '').match(/\b[A-Z]{2,6}-\d{2,4}[A-Z]?\b/);
  if (code && !/^(DT|PA|TR|TRX|DH|CH|VI|MC|CO|EV|SIM|DSN|DOC|P|R)-/i.test(code[0]) && /\b(prete?s?|pret|nettoy\w*|propre|preparee?s?|ready|clean\w*|prepared)\b/.test(qn) && !/\b(conge|sortie|compatibles?|nsa|orient\w*|discharge)\b/.test(qn)) {
    const r = await chambre(pool, etabs, code[0].toUpperCase(), L); if (r) return rep(r, 'chambre', 'c-chambres');
  }
  if (!etabId || !etabs.includes(Number(etabId))) return null;
  // 0. Arrimo Connect : messages et demandes (seulement les fils de la personne, ou la boîte de l'administration pour l'administration)
  if (/\b(messages?|administration|responsable|demandes? administratives?|annonces?|contacter|manager|admin\w*|announcements?)\b/.test(qn) && /\b(recu|non lus?|ouvert\w*|contacter|comment|ai-je|en attente|unread|open|received|how|contact|any)\b/.test(qn)) {
    const f = await require('./connect-interne').fils(pool, u, { etablissement_id: etabId });
    const ouvertes = f.fils.filter((x) => x.boite === 'administration' && x.statut !== 'resolue');
    const lignes = [T(L, `Messages non lus : ${f.non_lus}.`, `Unread messages: ${f.non_lus}.`)];
    if (f.fils[0]) lignes.push(T(L, `Dernier fil : « ${f.fils[0].sujet || '—'} » (${f.fils[0].expediteur}).`, `Latest thread: “${f.fils[0].sujet || '—'}” (${f.fils[0].expediteur}).`));
    lignes.push(T(L, `Demandes à l’administration encore ouvertes : ${ouvertes.length}${ouvertes.length ? ` (${ouvertes.slice(0, 5).map((x) => x.sujet).join(', ')})` : ''}.`, `Requests to the administration still open: ${ouvertes.length}${ouvertes.length ? ` (${ouvertes.slice(0, 5).map((x) => x.sujet).join(', ')})` : ''}.`));
    lignes.push(T(L, 'Pour contacter l’administration ou un responsable : icône ✉ en haut de l’écran, puis « Contacter l’administration ». Arrimo Connect ne remplace pas les appels d’urgence.', 'To contact the administration or a manager: ✉ icon at the top of the screen, then “Contact the administration”. Arrimo Connect does not replace emergency calls.'));
    return rep(lignes.join('\n') + pied(L, 'Arrimo Connect'), 'connect', 'messagerie');
  }
  // 3. Préalertes (à acquitter) et 4. arrivées / départs : Arrimo Flux, mêmes droits
  const prealertes = /\b(prealertes?|pre-?alerts?)\b/.test(qn);
  const arrivees = /\b(arriv\w*|qui arrive|attendu\w*|expected|incoming)\b/.test(qn); const departs = /\b(depart\w*|qui part|departures?|leaving)\b/.test(qn);
  const retard = /\b(retard\w*|late|delay\w*|overdue)\b/.test(qn) && /\b(transports?|ambulances?|arriv\w*|depart\w*|mouvements?)\b/.test(qn);
  // À l'hôpital, les préalertes d'ambulances d'urgence relèvent de Liaison Secours (src/og-secours.js) ; ici : préalertes d'arrivée, reçues ou non acquittées
  const typeEtab = (await pool.query('SELECT type_etablissement FROM etablissements WHERE id = $1', [etabId])).rows[0]?.type_etablissement;
  if (typeEtab !== 'chsld' && prealertes && !/\b(non acquitt\w*|recues?|d.?arrivee|transports?|flux|unacknowledged|received|arrival)\b/.test(qn)) return null;
  if (typeEtab !== 'chsld' && (arrivees || departs) && !prealertes && /\b(ambulances?|urgences?|emergency)\b/.test(qn)) return null;
  if (prealertes || arrivees || departs || retard) {
    if (u.role === 'entretien' && !/\b(chambres?|rooms?)\b/.test(qn)) return null;
    const f = await require('./arrimo-flux').mouvements(pool, u, { etablissement_id: etabId });
    let l = f.mouvements;
    if (prealertes) l = l.filter((x) => x.prealerte || x.type === 'prealerte');
    else if (retard) l = l.filter((x) => x.retard);
    else l = l.filter((x) => (arrivees && x.mouvement === 'arrivee') || (departs && x.mouvement === 'depart'));
    l = l.filter((x) => !['annule', 'refuse'].includes(x.statut));
    const lib = (x) => `• ${x.mouvement === 'arrivee' ? '↘' : '↗'} ${x.reference} · ${x.origine} → ${x.destination || '—'} · ${x.prevue ? dh(L, x.prevue) : '—'}${x.vehicule ? ` · ${x.vehicule}` : ''}`
      + `${x.mouvement === 'arrivee' ? ` · ${x.arrivee_reelle ? T(L, `arrivé ${h(L, x.arrivee_reelle)}`, `arrived ${h(L, x.arrivee_reelle)}`) : x.eta ? T(L, `estimée ${h(L, x.eta)}`, `estimated ${h(L, x.eta)}`) : T(L, 'ETA indisponible', 'ETA unavailable')}` : ''}`
      + `${x.prealerte ? ` · ${x.prealerte.recue_le ? T(L, 'préalerte reçue', 'pre-alert received') : T(L, 'préalerte À ACQUITTER', 'pre-alert TO ACKNOWLEDGE')}` : ''}${x.retard ? ` · ${T(L, 'EN RETARD', 'DELAYED')}` : ''}`
      + `${x.preparation ? ` · ${T(L, 'chambre', 'room')} ${x.preparation.chambre || ''} ${({ prete: T(L, 'prête', 'ready'), a_faire: T(L, 'à préparer', 'to prepare'), en_cours: T(L, 'en préparation', 'being prepared'), a_verifier: T(L, 'à vérifier', 'to check') })[x.preparation.etat] || ''}` : ''}`;
    const titre = prealertes ? T(L, 'Préalertes', 'Pre-alerts') : retard ? T(L, 'Mouvements en retard', 'Delayed movements') : arrivees && !departs ? T(L, 'Arrivées', 'Arrivals') : departs && !arrivees ? T(L, 'Départs', 'Departures') : T(L, 'Arrivées et départs', 'Arrivals and departures');
    return rep(`${titre} (${l.length}) :\n${l.length ? l.slice(0, 12).map(lib).join('\n') : T(L, 'aucun pour le moment.', 'none at the moment.')}${l.some((x) => x.actions.includes('accuser_prealerte')) ? `\n${T(L, 'Action : accuser réception dans l’Accueil ou dans Arrimo Flux.', 'Action: acknowledge from Home or Arrimo Flow.')}` : ''}` + pied(L, 'Arrimo Flux'), 'flux', 'flux');
  }
  // 5. Chambres à préparer (avant une heure donnée)
  if (/\b(chambres?|rooms?)\b.*\b(prepar\w*|nettoy\w*|clean\w*)\b|\b(prepar\w*|nettoy\w*|clean\w*)\b.*\b(chambres?|rooms?)\b/.test(qn)) {
    const avant = qn.match(/\b(?:avant|before)\s+(\d{1,2})\s*h?\s*(\d{2})?/);
    let limite = null; if (avant) { limite = new Date(); limite.setHours(Number(avant[1]), Number(avant[2] || 0), 0, 0); }
    const t = (await pool.query(`SELECT t.statut, t.echeance, l.code FROM taches_etab t LEFT JOIN lits l ON l.id = t.lit_id WHERE t.etablissement_id = $1 AND t.type IN ('preparation_chambre', 'entretien') AND t.statut IN ('a_faire', 'en_cours')
      AND ($2::timestamptz IS NULL OR t.echeance <= $2) ORDER BY t.echeance NULLS LAST`, [etabId, limite])).rows;
    return rep(`${T(L, 'Chambres à préparer', 'Rooms to prepare')}${limite ? T(L, ` avant ${h(L, limite)}`, ` before ${h(L, limite)}`) : ''} (${t.length}) :\n${t.length ? t.map((x) => `• ${x.code || '—'} · ${x.statut === 'en_cours' ? T(L, 'en cours', 'in progress') : T(L, 'à faire', 'to do')}${x.echeance ? ` · ${T(L, 'échéance', 'due')} ${dh(L, x.echeance)}` : ` · ${T(L, 'sans échéance', 'no due time')}`}`).join('\n') : T(L, 'aucune.', 'none.')}\n${T(L, 'La chambre est déclarée prête par l’entretien, jamais automatiquement.', 'A room is declared ready by housekeeping, never automatically.')}` + pied(L, T(L, 'Personnel et tâches', 'Staff and tasks')), 'preparations', 'c-taches');
  }
  // 6. Admission bloquée (résident R-xxxxx)
  const res = String(question || '').match(/\bR-\d{4,6}\b/i);
  if (res && /\b(bloque\w*|pourquoi|admission|arrivee|blocked|why|admit\w*)\b/.test(qn)) {
    const r = (await pool.query('SELECT r.*, l.code AS lit FROM residents r LEFT JOIN lits l ON l.id = r.lit_id WHERE r.etablissement_id = $1 AND upper(r.reference) = $2', [etabId, res[0].toUpperCase()])).rows[0];
    if (!r) return rep(T(L, `Je ne trouve pas ${res[0]} dans cet établissement.`, `I cannot find ${res[0]} in this facility.`), 'admission');
    if (r.statut !== 'preadmission') return rep(T(L, `${r.reference} n’est pas en attente d’admission (statut : ${r.statut}).`, `${r.reference} is not awaiting admission (status: ${r.statut}).`) + pied(L, T(L, 'Admissions et sorties', 'Admissions and discharges')), 'admission', 'c-admissions');
    if (!r.lit_id) return rep(T(L, `${r.reference} : aucune chambre attribuée. Action : attribuer une chambre (Admissions et sorties).`, `${r.reference}: no room assigned. Action: assign a room (Admissions and discharges).`) + pied(L, T(L, 'Admissions et sorties', 'Admissions and discharges')), 'admission', 'c-admissions');
    const c = await chambre(pool, etabs, r.lit, L);
    const t = (await pool.query(`SELECT 1 FROM taches_etab WHERE lit_id = $1 AND type IN ('preparation_chambre', 'entretien') AND statut IN ('a_faire', 'en_cours')`, [r.lit_id])).rowCount;
    return rep(`${r.reference} → ${r.lit}. ${t ? T(L, 'Admission bloquée : la chambre n’est pas encore prête. Responsable de la prochaine action : l’équipe d’entretien (« Chambre prête » dans Personnel et tâches ou Nettoyage).', 'Admission blocked: the room is not ready yet. Next action owner: housekeeping (“Room ready” in Staff and tasks or Cleaning).') : T(L, 'Aucun blocage de chambre : l’admission peut être confirmée (« Confirmer l’arrivée »).', 'No room block: the admission can be confirmed (“Confirm arrival”).')}\n${c || ''}`, 'admission', t ? 'c-taches' : 'c-admissions');
  }
  return null;
}

module.exports = { repondre };
