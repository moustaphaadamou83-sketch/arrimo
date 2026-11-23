'use strict';
/**
 * OG, copilote central (exigence transversale du 21 nov. 2026) : réponses opérationnelles sourcées sur Arrimo Flux, Transport,
 * Chambres et lits, Nettoyage/Personnel et tâches, Préalertes et Admissions, avec les MÊMES droits que l'interface.
 * Chaque réponse : état actuel, source, heure d'actualisation, données manquantes signalées, action suivante. OG n'agit jamais,
 * n'invente aucune disponibilité, heure d'arrivée ni confirmation ; aucune donnée clinique.
 */
const { BROUILLON_PRIVE_SQL } = require('./transports');
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
    LEFT JOIN etablissements ed ON ed.id = d.destination_id LEFT JOIN unites_secours un ON un.id = d.unite_id WHERE upper(d.numero) = $1 AND (d.origine_id = ANY($2) OR (d.destination_id = ANY($2) AND NOT ${BROUILLON_PRIVE_SQL}))`, [numero, etabs])).rows[0];
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
  // K. Explication d'un indicateur (catalogue central des KPI) : formule, source, période ; jamais une valeur inventée
  if (/\b(comment (est|sont) calcule\w*|que (signifie|veut dire)|explique\w* (l.?indicateur|le kpi|le chiffre)|how is .* calculated|what does .* mean|explain (the )?(kpi|indicator))\b/.test(qn)) {
    const cat = require('./kpi-catalogue').catalogue(L);
    const k = cat.find((x) => qn.includes(norm(x.nom))) || cat.find((x) => norm(x.nom).split(' ').filter((m) => m.length > 4).some((m) => qn.includes(m)));
    if (k) return rep(`${k.nom} : ${k.description}\n${T(L, 'Formule', 'Formula')} : ${k.formule}\n${T(L, 'Source', 'Source')} : ${k.source}\n${T(L, 'Période', 'Period')} : ${k.periode} · ${T(L, 'Actualisation', 'Refresh')} : ${k.actualisation}\n${T(L, 'Exclusions', 'Exclusions')} : ${k.exclusions}`, 'kpi');
  }
  // N. Niveau opérationnel : expliqué d'après le moteur existant (terrain.niveauAlerte) et les seuils configurés ; rien d'inventé
  if (/\b(niveau|level)\b/.test(qn) && /\b(pourquoi|why|explique\w*|explain|passer|faire passer|pourrai\w*|could)\b/.test(qn) && u.role !== 'entretien') {
    const n = await require('./terrain').niveauAlerte(pool, etabId, L); if (!n) return null;
    const c = (await pool.query('SELECT c.seuil_jaune, c.seuil_orange, c.seuil_rouge, c.attente_admission_max_min FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1', [etabId])).rows[0];
    const NOM = { vert: T(L, 'vert', 'green'), jaune: T(L, 'jaune', 'yellow'), orange: 'orange', rouge: T(L, 'rouge', 'red') };
    const lignes = [T(L, `Niveau ${NOM[n.niveau]} (le plus élevé des niveaux lits et urgence).`, `${NOM[n.niveau]} level (the higher of the bed and emergency levels).`),
      T(L, `Lits : pression ${n.pression} % (lits non libres + patients en attente d’un lit, sur ${n.dotes} lits en service) → niveau ${NOM[n.niveau_lits]} ; seuils : jaune ${c.seuil_jaune} %, orange ${c.seuil_orange} %, rouge ${c.seuil_rouge} %.`,
        `Beds: pressure ${n.pression}% (non-free beds + patients waiting for a bed, out of ${n.dotes} beds in service) → ${NOM[n.niveau_lits]} level; thresholds: yellow ${c.seuil_jaune}%, orange ${c.seuil_orange}%, red ${c.seuil_rouge}%.`),
      T(L, `Patients en attente d’un lit : ${n.en_attente} (dont ${n.attente_longue} au-delà de ${c.attente_admission_max_min} min ; une seule attente longue suffit pour l’orange).`, `Patients waiting for a bed: ${n.en_attente} (${n.attente_longue} beyond ${c.attente_admission_max_min} min; one long wait is enough for orange).`)];
    if (n.urgence) lignes.push(T(L, `Urgence : ${n.urgence.occupees}/${n.urgence.fonctionnelles} civières occupées (${n.urgence.taux} %) → niveau ${NOM[n.urgence.niveau] || n.urgence.niveau}.`, `Emergency: ${n.urgence.occupees}/${n.urgence.fonctionnelles} stretchers occupied (${n.urgence.taux}%) → ${NOM[n.urgence.niveau] || n.urgence.niveau} level.`));
    const prochain = n.pression < c.seuil_jaune ? ['jaune', c.seuil_jaune] : n.pression < c.seuil_orange ? ['orange', c.seuil_orange] : n.pression < c.seuil_rouge ? ['rouge', c.seuil_rouge] : null;
    if (prochain && n.dotes) { const lits = Math.max(1, Math.ceil(((prochain[1] - n.pression) / 100) * n.dotes)); lignes.push(T(L, `Passage au ${NOM[prochain[0]]} : environ ${lits} ${lits > 1 ? 'lits libres de moins ou patients' : 'lit libre de moins ou patient'} en attente de plus, ou une attente au-delà du délai.`, `Moving to ${NOM[prochain[0]]}: about ${lits} fewer free ${lits > 1 ? 'beds or more waiting patients' : 'bed or one more waiting patient'}, or one wait beyond the limit.`)); }
    if (n.protocole) lignes.push(T(L, `Protocole de l’établissement : ${n.protocole}`, `Facility protocol: ${n.protocole}`));
    return rep(lignes.join('\n') + pied(L, T(L, 'Lits, Urgence (règles de niveau de l’établissement)', 'Beds, Emergency (facility level rules)')), 'niveau', 'copilote');
  }
  // C. Chrono : ambulances à la porte, attentes, dépassements, tendance (moteur Chrono existant, événements enregistrés)
  if (/\b(ambulances?|chrono)\b/.test(qn) && /\b(depasse\w*|seuil|threshold|overrun\w*|tendance|trend|liberables?|freeable)\b/.test(qn) && !/\b(combien|how many)\b/.test(qn) && u.role !== 'entretien') {
    const e = (await pool.query('SELECT modules FROM etablissements WHERE id = $1', [etabId])).rows[0];
    if (!require('./types-etablissement').moduleActif(e, 'chrono')) return null;
    const c = await require('./chrono').tableau(pool, u, { etablissement_id: etabId });
    const s = c.cibles?.porte || 20; const porte = c.a_la_porte || [];
    const lignes = [T(L, `Ambulances à la porte : ${porte.length}${porte.length ? ` — ${porte.map((p) => `${p.unite || p.numero} depuis ${p.a_la_porte_min ?? '—'} min${p.a_la_porte_min > s ? ' (au-delà du seuil)' : ''}`).join(' ; ')}` : ''}.`,
      `Ambulances at the door: ${porte.length}${porte.length ? ` — ${porte.map((p) => `${p.unite || p.numero} for ${p.a_la_porte_min ?? '—'} min${p.a_la_porte_min > s ? ' (over threshold)' : ''}`).join('; ')}` : ''}.`)];
    lignes.push(T(L, `Seuil configuré (H11 → H14) : ${s} min ; dépassements en cours : ${porte.filter((p) => p.a_la_porte_min > s).length}.`, `Configured threshold (H11 → H14): ${s} min; current overruns: ${porte.filter((p) => p.a_la_porte_min > s).length}.`));
    const fini = (c.termines || []).filter((p) => p.durees?.porte != null);
    lignes.push(fini.length ? T(L, `Tendance aujourd’hui : ${fini.length} ${fini.length > 1 ? 'prises en charge terminées' : 'prise en charge terminée'}, délai moyen ${Math.round(fini.reduce((a, p) => a + p.durees.porte, 0) / fini.length)} min.`, `Trend today: ${fini.length} completed ${fini.length > 1 ? 'handovers' : 'handover'}, average ${Math.round(fini.reduce((a, p) => a + p.durees.porte, 0) / fini.length)} min.`) : T(L, 'Tendance aujourd’hui : aucune prise en charge terminée enregistrée.', 'Trend today: no completed handover recorded.'));
    lignes.push(T(L, `Annoncées en route : ${(c.en_route || []).length}.`, `Announced on the way: ${(c.en_route || []).length}.`));
    if (/civiere|stretcher|liberable|freeable/.test(qn)) { const cv = (await pool.query("SELECT code FROM civieres WHERE etablissement_id = $1 AND etat = 'nettoyage' ORDER BY code", [etabId]).catch(() => ({ rows: [] }))).rows; lignes.push(T(L, `Civières qui peuvent être remises en service après nettoyage : ${cv.map((x) => x.code).join(', ') || 'aucune'}. Une civière occupée n’est libérée que par l’équipe, au départ réel du patient.`, `Stretchers that can return to service after cleaning: ${cv.map((x) => x.code).join(', ') || 'none'}. An occupied stretcher is freed only by the team, at the patient’s actual departure.`)); }
    return rep(lignes.join('\n') + pied(L, 'Chrono'), 'chrono', 'chrono');
  }
  // T. Mes tâches (moteur unique)
  if (/\b(mes taches|my tasks|taches? (prioritaires?|en retard)|taches? sont (prioritaires?|en retard)|tasks? (overdue|priority)|dois-je|should i|ai-je a faire)\b/.test(qn)) {
    const m = await require('./taches').miennes(pool, u, { etablissement_id: etabId }); const now = Date.now();
    const retard = m.taches.filter((x) => x.en_retard || (x.echeance && new Date(x.echeance).getTime() < now));
    if (/retard|overdue|late/.test(qn)) return rep(`${T(L, 'Tâches en retard', 'Overdue tasks')} (${retard.length}) :\n${retard.length ? retard.slice(0, 10).map((x) => `• ${x.lieu ? `${x.lieu} · ` : ''}${x.titre} · ${T(L, 'échéance', 'due')} ${dh(L, x.echeance)}`).join('\n') : T(L, 'aucune.', 'none.')}` + pied(L, T(L, 'Personnel et tâches, Nettoyage', 'Staff and tasks, Cleaning')), 'taches', m.ecran);
    const l = m.taches;
    return rep(`${T(L, 'Vos tâches ouvertes', 'Your open tasks')} (${l.length}) :\n${l.length ? l.slice(0, 10).map((x) => `• ${x.lieu ? `${x.lieu} · ` : ''}${x.titre} · ${x.statut === 'en_cours' ? T(L, 'en cours', 'in progress') : T(L, 'à faire', 'to do')}${x.echeance ? ` · ${T(L, 'échéance', 'due')} ${dh(L, x.echeance)}` : ''}`).join('\n') : T(L, 'aucune.', 'none.')}${retard.length ? `\n${T(L, `En retard : ${retard.length}.`, `Overdue: ${retard.length}.`)}` : ''}` + pied(L, T(L, 'Personnel et tâches, Nettoyage', 'Staff and tasks, Cleaning')), 'taches', m.ecran);
  }
  // P. Parcours d'un patient (référence P-…) : demande d'hébergement, transport, préparation de la chambre, arrivée — sources réelles, droits
  const refP = String(question || '').match(/\bP-\d{4,6}\b/i);
  if (refP && /\b(arrive|parti|ambulance|chambre|parcours|transport|qui|prete|path|trip|arrived|left|room|who)\b/.test(qn) && u.role !== 'entretien') {
    const ref = refP[0].toUpperCase(); const lignes = [];
    const dhs = (await pool.query(`SELECT d.*, ed.nom AS destination, eo.nom AS origine FROM demandes_hebergement d JOIN etablissements ed ON ed.id = d.etablissement_id LEFT JOIN etablissements eo ON eo.id = d.hopital_id
      WHERE upper(d.reference_externe) = $1 AND (d.etablissement_id = ANY($2) OR d.hopital_id = ANY($2)) ORDER BY d.id DESC LIMIT 1`, [ref, etabs])).rows[0];
    const tr = (await pool.query(`SELECT d.*, un.numero AS unite FROM demandes_transport d LEFT JOIN unites_secours un ON un.id = d.unite_id WHERE upper(d.resident_ref) = $1 AND (d.origine_id = ANY($2) OR (d.destination_id = ANY($2) AND NOT ${BROUILLON_PRIVE_SQL})) AND d.statut <> 'annulee' ORDER BY d.id DESC LIMIT 1`, [ref, etabs])).rows[0];
    if (!dhs && !tr) return rep(T(L, `Aucun parcours enregistré pour ${ref} dans vos établissements.`, `No recorded path for ${ref} in your facilities.`), 'parcours');
    if (dhs) lignes.push(T(L, `Demande d’hébergement ${dhs.numero} : ${dhs.origine || '—'} → ${dhs.destination} (statut ${dhs.statut}).`, `Housing request ${dhs.numero}: ${dhs.origine || '—'} → ${dhs.destination} (status ${dhs.statut}).`));
    if (dhs?.depart_prevu_le) lignes.push(T(L, `Départ prévu : ${dh(L, dhs.depart_prevu_le)} ; départ réel : ${dhs.depart_hopital_le ? dh(L, dhs.depart_hopital_le) : 'non enregistré'}.`, `Planned departure: ${dh(L, dhs.depart_prevu_le)}; actual departure: ${dhs.depart_hopital_le ? dh(L, dhs.depart_hopital_le) : 'not recorded'}.`));
    if (tr) lignes.push(T(L, `Transport ${tr.numero} : ${ST_TR.fr[tr.statut] || tr.statut}${tr.unite ? `, ambulance ${tr.unite}` : ', aucune ambulance affectée'}${tr.pris_en_charge_le ? `, pris en charge ${dh(L, tr.pris_en_charge_le)}` : ''}${tr.arrivee_le ? `, arrivé ${dh(L, tr.arrivee_le)}` : ''}${tr.remis_le ? `, patient remis ${dh(L, tr.remis_le)}` : ''}.`,
      `Transport ${tr.numero}: ${ST_TR.en[tr.statut] || tr.statut}${tr.unite ? `, ambulance ${tr.unite}` : ', no ambulance assigned'}${tr.pris_en_charge_le ? `, picked up ${dh(L, tr.pris_en_charge_le)}` : ''}${tr.arrivee_le ? `, arrived ${dh(L, tr.arrivee_le)}` : ''}${tr.remis_le ? `, handed over ${dh(L, tr.remis_le)}` : ''}.`));
    const litId = dhs?.lit_propose_id || (dhs?.resident_id ? (await pool.query('SELECT lit_id FROM residents WHERE id = $1', [dhs.resident_id])).rows[0]?.lit_id : null);
    if (litId) { const t = (await pool.query(`SELECT t.statut, t.fait_le, x.nom, l.code FROM taches_etab t JOIN lits l ON l.id = t.lit_id LEFT JOIN utilisateurs x ON x.id = t.fait_par WHERE t.lit_id = $1 AND t.type = 'preparation_chambre' ORDER BY t.id DESC LIMIT 1`, [litId])).rows[0];
      if (t) lignes.push(t.statut === 'faite' ? T(L, `Chambre ${t.code} : déclarée prête ${t.nom ? `par ${t.nom} ` : ''}le ${dh(L, t.fait_le)}.`, `Room ${t.code}: declared ready ${t.nom ? `by ${t.nom} ` : ''}on ${dh(L, t.fait_le)}.`) : T(L, `Chambre ${t.code} : préparation ${t.statut === 'en_cours' ? 'en cours' : 'à faire'} (pas encore prête).`, `Room ${t.code}: preparation ${t.statut === 'en_cours' ? 'in progress' : 'to do'} (not ready yet).`)); }
    if (dhs) { const arr = (await pool.query(`SELECT e.date AS cree_le, x.nom, e.detail FROM demande_hebergement_etapes e LEFT JOIN utilisateurs x ON x.id = e.par WHERE e.demande_id = $1 AND (e.statut IN ('admise', 'arrivee') OR e.detail ILIKE '%arriv%') ORDER BY e.id DESC LIMIT 1`, [dhs.id])).rows[0];
      lignes.push(arr ? T(L, `Arrivée : ${arr.detail || 'confirmée'} ${arr.nom ? `par ${arr.nom} ` : ''}le ${dh(L, arr.cree_le)}.`, `Arrival: ${arr.detail || 'confirmed'} ${arr.nom ? `by ${arr.nom} ` : ''}on ${dh(L, arr.cree_le)}.`) : T(L, 'Arrivée à destination : non confirmée à ce jour.', 'Arrival at destination: not confirmed yet.')); }
    return rep(lignes.join('\n') + pied(L, T(L, 'Hébergement, Transport, Personnel et tâches', 'Housing, Transport, Staff and tasks')), 'parcours', 'flux');
  }
  const typeEtabConnect = (await pool.query('SELECT type_etablissement FROM etablissements WHERE id = $1', [etabId])).rows[0]?.type_etablissement;
  // 0. Arrimo Connect : messages et demandes (seulement les fils de la personne, ou la boîte de l'administration pour l'administration)
  if (!/\b(famil\w*|proches?|relatives?)\b/.test(qn) && !(typeEtabConnect === 'chsld' && !/\b(administration|admin\w*|connect|collegues?|colleagues?|responsable|manager|annonces?|announcements?)\b/.test(qn)) && /\b(messages?|administration|responsable|demandes? administratives?|annonces?|contacter|manager|admin\w*|announcements?)\b/.test(qn) && /\b(recu|non lus?|ouvert\w*|contacter|comment|ai-je|en attente|unread|open|received|how|contact|any)\b/.test(qn)) {
    const f = await require('./connect-interne').fils(pool, u, { etablissement_id: etabId });
    const ouvertes = f.fils.filter((x) => x.boite === 'administration' && x.statut !== 'resolue');
    const lignes = [T(L, `Messages non lus : ${f.non_lus}.`, `Unread messages: ${f.non_lus}.`)];
    if (f.fils[0]) lignes.push(T(L, `Dernier fil : « ${f.fils[0].sujet || '—'} » (${f.fils[0].expediteur}).`, `Latest thread: “${f.fils[0].sujet || '—'}” (${f.fils[0].expediteur}).`));
    lignes.push(T(L, `Demandes à l’administration encore ouvertes : ${ouvertes.length}${ouvertes.length ? ` (${ouvertes.slice(0, 5).map((x) => x.sujet).join(', ')})` : ''}.`, `Requests to the administration still open: ${ouvertes.length}${ouvertes.length ? ` (${ouvertes.slice(0, 5).map((x) => x.sujet).join(', ')})` : ''}.`));
    lignes.push(T(L, 'Pour contacter l’administration ou un responsable : icône enveloppe (Arrimo Connect) en haut de l’écran, puis « Contacter l’administration ». Arrimo Connect ne remplace pas les appels d’urgence.', 'To contact the administration or a manager: envelope icon (Arrimo Connect) at the top of the screen, then “Contact the administration”. Arrimo Connect does not replace emergency calls.'));
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
  // Résidents de CHSLD attendus ou partis : réponse plus précise de Liaison CHSLD (référence, établissement, dernière confirmation)
  if (typeEtab !== 'chsld' && (arrivees || departs) && /\b(residents?|chslds?|long-term care|erables|saint-laurent)\b/.test(qn)) return null;
  // Demande d'action (« confirme… », « valide… ») : jamais une liste ; le garde-fou d'OG (aucune confirmation à la place d'un humain) répond
  if (/^(confirme\w*|valide\w*|marque\w*|declare\w*|accepte\w*|annule\w*|confirm|validate|mark|accept|cancel)\b/.test(qn.trim())) return null;
  // Liste générale seulement : une question sur une personne (référence, nom, il/elle…) ou, en CHSLD, sur les admissions et résidents
  // reste aux réponses spécialisées (Liaison CHSLD, admissions, hospitalisations)
  const personne = /\b[RP]-\d{4,6}\b/i.test(String(question || '')) || /\b(il|elle|lui|son|sa|ses|he|she|him|his|her)\b/.test(qn) || /\b(hopital|hospital)\b/.test(qn) && /\b(est[- ]il|est[- ]elle|has|is)\b/.test(qn);
  if ((arrivees || departs) && !prealertes && personne) return null;
  if (typeEtab === 'chsld' && (arrivees || departs) && !prealertes && !/\b(flux|mouvements?|movements?|transports?|ambulances?|vehicules?|vehicles?|aujourd\w*|demain|today|tomorrow)\b/.test(qn)) return null;
  if (prealertes || arrivees || departs || retard) {
    if (u.role === 'entretien' && !/\b(chambres?|rooms?)\b/.test(qn)) return null;
    const f = await require('./arrimo-flux').mouvements(pool, u, { etablissement_id: etabId });
    let l = f.mouvements;
    if (prealertes) l = l.filter((x) => x.prealerte || x.type === 'prealerte');
    else if (retard) l = l.filter((x) => x.retard);
    else l = l.filter((x) => (arrivees && x.mouvement === 'arrivee') || (departs && x.mouvement === 'depart'));
    l = l.filter((x) => !['annule', 'refuse'].includes(x.statut));
    const lib = (x) => `• ${x.mouvement === 'arrivee' ? T(L, 'Arrivée', 'Arrival') : T(L, 'Départ', 'Departure')} ${x.reference} · ${x.origine} → ${x.destination || '—'} · ${x.prevue ? dh(L, x.prevue) : '—'}${x.vehicule ? ` · ${x.vehicule}` : ''}`
      + `${x.mouvement === 'arrivee' ? ` · ${x.arrivee_reelle ? T(L, `arrivé ${h(L, x.arrivee_reelle)}`, `arrived ${h(L, x.arrivee_reelle)}`) : x.eta ? T(L, `estimée ${h(L, x.eta)}`, `estimated ${h(L, x.eta)}`) : T(L, 'ETA indisponible', 'ETA unavailable')}` : ''}`
      + `${x.prealerte ? ` · ${x.prealerte.recue_le ? T(L, 'préalerte reçue', 'pre-alert received') : T(L, 'préalerte À ACQUITTER', 'pre-alert TO ACKNOWLEDGE')}` : ''}${x.retard ? ` · ${T(L, 'EN RETARD', 'DELAYED')}` : ''}`
      + `${x.preparation ? ` · ${T(L, 'chambre', 'room')} ${x.preparation.chambre || ''} ${({ prete: T(L, 'prête', 'ready'), a_faire: T(L, 'à préparer', 'to prepare'), en_cours: T(L, 'en préparation', 'being prepared'), a_verifier: T(L, 'à vérifier', 'to check') })[x.preparation.etat] || ''}` : ''}`;
    const titre = prealertes ? T(L, 'Préalertes', 'Pre-alerts') : retard ? T(L, 'Mouvements en retard', 'Delayed movements') : arrivees && !departs ? T(L, 'Arrivées', 'Arrivals') : departs && !arrivees ? T(L, 'Départs', 'Departures') : T(L, 'Arrivées et départs', 'Arrivals and departures');
    return rep(`${titre} (${l.length}) :\n${l.length ? l.slice(0, 12).map(lib).join('\n') : T(L, 'aucun pour le moment.', 'none at the moment.')}${l.some((x) => x.actions.includes('accuser_prealerte')) ? `\n${T(L, 'Action : accuser réception dans l’Accueil ou dans Arrimo Flux.', 'Action: acknowledge from Home or Arrimo Flow.')}` : ''}` + pied(L, 'Arrimo Flux'), 'flux', 'flux');
  }
  // 4b. Lits qui viennent de se libérer (journal immuable des lits, 12 dernières heures) ; un lit libre est prêt, un lit en nettoyage ne l'est pas
  if (/\b(lits?|beds?|chambres?|rooms?)\b.*\b(viennent? de se liberer|liberee?s? recemment|recently freed|just freed|freed up)\b/.test(qn)) {
    const l = (await pool.query(`SELECT DISTINCT ON (l.id) l.code, l.etat, j.date FROM journal j JOIN lits l ON l.id = j.lit_id
      WHERE j.etablissement_id = $1 AND NOT j.refuse AND j.ancien_etat = 'occupe' AND j.date > now() - interval '12 hours' ORDER BY l.id, j.date DESC`, [etabId])).rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    const ET = { libre: T(L, 'libre et prêt', 'free and ready'), nettoyage: T(L, 'en nettoyage (pas encore prêt)', 'being cleaned (not ready yet)'), occupe: T(L, 'de nouveau occupé', 'occupied again'), reserve: T(L, 'réservé', 'reserved'), indispo: T(L, 'bloqué', 'blocked') };
    return rep(`${T(L, 'Lits libérés dans les 12 dernières heures', 'Beds freed in the last 12 hours')} (${l.length}) :\n${l.length ? l.map((x) => `• ${x.code} · ${T(L, 'libéré à', 'freed at')} ${h(L, x.date)} · ${ET[x.etat] || x.etat}`).join('\n') : T(L, 'aucun.', 'none.')}`
      + pied(L, T(L, 'Lits (journal)', 'Beds (log)')), 'lits_liberes', 'lits');
  }
  // 5. Chambres à préparer (avant une heure donnée)
  // Liste générale seulement : pas une demande d'action (« prépare une tâche… »), ni une question sur une chambre ou un résident précis
  const precis = /\b[A-Z]{2,5}-\d{2,4}[A-Z]?\b|\b[RP]-\d{4,6}\b|\bchambre \d{2,4}\b|\broom \d{2,4}\b/i.test(String(question || ''));
  const demandeAction = /^(prepare|cree|creer|propose|ajoute|lance|planifie|programme|create|add|draft|start|schedule|plan|launch)\b/.test(qn.trim()) || /\b(sa|son|cette|his|her|this) (chambre|room)\b/.test(qn) || /\b(conserv\w*|held|gardee?s?|kept)\b/.test(qn);
  if (!precis && !demandeAction && (/\b(chambres?|rooms?)\b.*\b(prepar\w*|nettoy\w*|clean\w*)\b|\b(prepar\w*|nettoy\w*|clean\w*)\b.*\b(chambres?|rooms?)\b/.test(qn))) {
    const avant = qn.match(/\b(?:avant|before)\s+(\d{1,2})\s*h?\s*(\d{2})?/);
    let limite = null; if (avant) { limite = new Date(); limite.setHours(Number(avant[1]), Number(avant[2] || 0), 0, 0); }
    const t = (await pool.query(`SELECT t.statut, t.echeance, l.code FROM taches_etab t LEFT JOIN lits l ON l.id = t.lit_id WHERE t.etablissement_id = $1 AND t.type IN ('preparation_chambre', 'entretien') AND t.statut IN ('a_faire', 'en_cours')
      AND ($2::timestamptz IS NULL OR t.echeance <= $2) ORDER BY t.echeance NULLS LAST`, [etabId, limite])).rows;
    // Lits à l'état « nettoyage » (source unique tenue par regles.js) sans tâche ouverte : aussi en attente de nettoyage
    const deja = new Set(t.map((x) => x.code));
    for (const l of (await pool.query(`SELECT code, nettoyage_debut, etat_depuis FROM lits WHERE etablissement_id = $1 AND etat = 'nettoyage' AND actif ORDER BY etat_depuis`, [etabId])).rows)
      if (!deja.has(l.code)) t.push({ code: l.code, statut: l.nettoyage_debut ? 'en_cours' : 'a_faire', echeance: null });
    return rep(`${T(L, 'Chambres à préparer', 'Rooms to prepare')}${limite ? T(L, ` avant ${h(L, limite)}`, ` before ${h(L, limite)}`) : ''} (${t.length}) :\n${t.length ? t.map((x) => `• ${x.code || '—'} · ${x.statut === 'en_cours' ? T(L, 'en cours', 'in progress') : T(L, 'à faire', 'to do')}${x.echeance ? ` · ${T(L, 'échéance', 'due')} ${dh(L, x.echeance)}` : ` · ${T(L, 'sans échéance', 'no due time')}`}`).join('\n') : T(L, 'aucune.', 'none.')}\n${T(L, 'La chambre est déclarée prête par l’entretien, jamais automatiquement.', 'A room is declared ready by housekeeping, never automatically.')}` + pied(L, T(L, 'Personnel et tâches', 'Staff and tasks')), 'preparations', 'c-taches');
  }
  // 6. Admission bloquée (résident R-xxxxx)
  const res = String(question || '').match(/\bR-\d{4,6}\b/i);
  if (res && /\b(bloque\w*|pourquoi|admission|arrivee|blocked|why|admit\w*)\b/.test(qn)) {
    const r = (await pool.query('SELECT r.*, l.code AS lit FROM residents r LEFT JOIN lits l ON l.id = r.lit_id WHERE r.etablissement_id = $1 AND upper(r.reference) = $2', [etabId, res[0].toUpperCase()])).rows[0];
    if (!r) return rep(T(L, `Je ne trouve pas ${res[0]} dans cet établissement.`, `I cannot find ${res[0]} in this facility.`), 'admission');
    // Résident qui n'est pas en préadmission (retour, réintégration, hospitalisation) : la réponse spécialisée du CHSLD prend le relais
    if (r.statut !== 'preadmission' && /\b(reintegr\w*|retour|return|hospitalis\w*)\b/.test(qn)) return null;
    if (r.statut !== 'preadmission') return rep(T(L, `${r.reference} n’est pas en attente d’admission (statut : ${r.statut}).`, `${r.reference} is not awaiting admission (status: ${r.statut}).`) + pied(L, T(L, 'Admissions et sorties', 'Admissions and discharges')), 'admission', 'c-admissions');
    if (!r.lit_id) return rep(T(L, `${r.reference} : aucune chambre attribuée. Action : attribuer une chambre (Admissions et sorties).`, `${r.reference}: no room assigned. Action: assign a room (Admissions and discharges).`) + pied(L, T(L, 'Admissions et sorties', 'Admissions and discharges')), 'admission', 'c-admissions');
    const c = await chambre(pool, etabs, r.lit, L);
    const t = (await pool.query(`SELECT 1 FROM taches_etab WHERE lit_id = $1 AND type IN ('preparation_chambre', 'entretien') AND statut IN ('a_faire', 'en_cours')`, [r.lit_id])).rowCount;
    return rep(`${r.reference} → ${r.lit}. ${t ? T(L, 'Admission bloquée : la chambre n’est pas encore prête. Responsable de la prochaine action : l’équipe d’entretien (« Chambre prête » dans Personnel et tâches ou Nettoyage).', 'Admission blocked: the room is not ready yet. Next action owner: housekeeping (“Room ready” in Staff and tasks or Cleaning).') : T(L, 'Aucun blocage de chambre : l’admission peut être confirmée (« Confirmer l’arrivée »).', 'No room block: the admission can be confirmed (“Confirm arrival”).')}\n${c || ''}`, 'admission', t ? 'c-taches' : 'c-admissions');
  }
  return null;
}

module.exports = { repondre };
