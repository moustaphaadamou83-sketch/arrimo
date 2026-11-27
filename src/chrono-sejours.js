'use strict';
/**
 * Chrono · Patients et séjours (audit du 27 nov. 2026). Lecture seule, aucune donnée copiée : les séjours actifs sont lus dans les
 * sources qui les tiennent déjà (lits, civières, demandes d'admission, congés, NSA, passages des patients, séjours DSN, transferts,
 * transports). Rien n'est écrit : tous les historiques restent intacts dans leurs tables (journal, nsa_episodes, horodatages…).
 * - Étape actuelle : urgence sur civière → attente de lit → lit assigné → hospitalisé → NSA → congé prévu.
 * - Seuils OPÉRATIONNELS tirés de la configuration de l'établissement (même source que la Vigilance) ; à défaut d'une valeur
 *   configurée, l'indicateur public existant (civière > 24 h / > 48 h). Une étape sans seuil défini est « en cours » (bleu),
 *   jamais « verte » par défaut ; une durée sans horodatage est inconnue (gris), jamais 0.
 * - Une alerte temporelle n'est JAMAIS une priorité clinique : la priorité d'admission n'entre ni dans la couleur ni dans l'ordre.
 * - Référence patient seulement (aucun nom, aucune donnée DSN : seule l'heure d'ouverture d'un séjour DSN est lue, jamais son contenu).
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

const JOUR = 24 * 60;
/** Seuils [vigilance, escalade] en minutes, par étape, d'après la configuration (config_pays de l'établissement). */
function seuilsDe(cfg = {}) {
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const adm = n(cfg.attente_admission_max_min, 240); const res = n(cfg.reservation_max_min, 120);
  return {
    // Indicateurs publics des urgences (patients sur civière > 24 h, > 48 h), déjà utilisés par Urgences et l'extraction MSSS
    urgence_civiere: { vigilance: JOUR, escalade: 2 * JOUR, source: 'indicateur_public_24_48h' },
    attente_lit: { vigilance: adm, escalade: 2 * adm, source: 'attente_admission_max_min' },
    lit_assigne: { vigilance: res, escalade: 2 * res, source: 'reservation_max_min' },
    nsa: { vigilance: 7 * JOUR, escalade: 30 * JOUR, source: 'defaut_indicatif' },
    hospitalise: null,
    conge_prevu: { echeance: true, marge: n(cfg.marge_conge_min, 60), source: 'marge_conge_min' },
    // Hébergement (CHSLD, RPA…) : mêmes règles, étapes propres ; place conservée pendant l'hospitalisation (durée de l'établissement)
    attente_admission_heb: { vigilance: 7 * JOUR, escalade: 14 * JOUR, source: 'defaut_indicatif' },
    resident_present: null, absent: null,
    hospitalise_externe: { vigilance: Math.max(1, n(cfg.conservation_place_jours, 7) - 1) * JOUR, escalade: n(cfg.conservation_place_jours, 7) * JOUR, source: 'conservation_place_jours' },
    retour_a_reintegrer: { vigilance: 2 * 60, escalade: 4 * 60, source: 'defaut_indicatif' },
    transfert_en_cours: { vigilance: n(cfg.transport_retard_marge_min, 30), escalade: 2 * n(cfg.transport_retard_marge_min, 30), source: 'transport_retard_marge_min' },
  };
}
const RANG = { rouge: 4, orange: 3, gris: 2, vert: 1, bleu: 0 };
const pire = (...n) => n.filter(Boolean).sort((a, b) => RANG[b] - RANG[a])[0] || 'gris';
const minutes = (d, now) => (d ? (now - new Date(d).getTime()) / 60000 : null);
/** Niveau d'une durée : gris sans horodatage, bleu sans seuil, sinon vert / orange (seuil dépassé) / rouge (escalade). */
function niveauDuree(depuis, s, now, echeance = null) {
  if (s?.echeance) {
    if (!echeance) return depuis ? 'bleu' : 'gris';
    const m = minutes(echeance, now);
    return m >= s.marge ? 'rouge' : m >= 0 ? 'orange' : 'vert';
  }
  const m = minutes(depuis, now); if (m == null) return 'gris';
  if (!s) return 'bleu';
  return m >= s.escalade ? 'rouge' : m >= s.vigilance ? 'orange' : 'vert';
}
const ORGA = `LEFT JOIN services sv ON sv.id = un.service_id
  LEFT JOIN departements dp ON dp.id = COALESCE(un.departement_id, sv.departement_id)`;

async function configDe(db, etabId) {
  return (await db.query('SELECT c.*, e.type_etablissement, e.conservation_place_jours FROM etablissements e JOIN config_pays c ON c.id = e.config_id WHERE e.id = $1', [etabId])).rows[0] || {};
}
const ETAPE_RESIDENT = { preadmission: 'attente_admission_heb', present: 'resident_present', hospitalise: 'hospitalise_externe', retour_a_reintegrer: 'retour_a_reintegrer', absent: 'absent', transfert_en_cours: 'transfert_en_cours' };
/** Résidents et séjours (hébergement) : même moteur ; référence R-00000 seulement ; l'étape suit le statut du résident et son dernier mouvement. */
async function residentsActifs(db, etabId, cfg, now) {
  const S = seuilsDe(cfg);
  const r = await db.query(`SELECT r.id, r.reference, r.statut, r.admis_le, r.cree_le, l.id AS lit_id, l.code, ch.numero AS chambre, un.id AS unite_id, un.nom AS unite,
      dp.id AS departement_id, dp.nom AS departement, sv.id AS service_id, sv.nom AS service,
      (SELECT max(m.date) FROM resident_mouvements m WHERE m.resident_id = r.id) AS dernier_mvt,
      (SELECT min(m.date) FROM resident_mouvements m WHERE m.resident_id = r.id AND m.type IN ('admission', 'transfert_entrant')) AS admission_mvt,
      (SELECT json_build_object('numero', d.numero, 'statut', d.statut, 'depuis', d.cree_le, 'destination', e.nom) FROM demandes_transport d JOIN etablissements e ON e.id = d.destination_id
        WHERE d.origine_id = $1 AND d.resident_ref = r.reference AND d.statut IN ('demandee', 'acceptee', 'en_route', 'pris_en_charge') ORDER BY d.id DESC LIMIT 1) AS transport
    FROM residents r LEFT JOIN lits l ON l.id = r.lit_id LEFT JOIN chambres ch ON ch.id = l.chambre_id LEFT JOIN unites un ON un.id = l.unite_id ${ORGA}
    WHERE r.etablissement_id = $1 AND r.statut = ANY($2)`, [etabId, Object.keys(ETAPE_RESIDENT)]).catch(() => ({ rows: [] }));
  return r.rows.map((x) => {
    const etape = ETAPE_RESIDENT[x.statut]; const s = S[etape];
    const depuis = x.statut === 'present' ? (x.admis_le || x.admission_mvt || x.dernier_mvt) : x.statut === 'preadmission' ? x.cree_le : (x.dernier_mvt || x.admis_le);
    const sejourDepuis = x.admis_le || x.admission_mvt || (x.statut === 'preadmission' ? x.cree_le : depuis);
    const niveauEtape = niveauDuree(depuis, s, now);
    const paralleles = x.transport ? [{ type: 'transport', ...x.transport }] : [];
    return { type: 'sejour', objet: x.lit_id ? 'lit' : 'resident', id: x.lit_id || x.id, resident_id: x.id, reference: x.reference, ressource: x.code || null, chambre: x.chambre,
      unite: x.unite, unite_id: x.unite_id, departement: x.departement, departement_id: x.departement_id, service: x.service, service_id: x.service_id,
      ressource_depuis: null, statut_ressource: x.lit_id ? (['hospitalise', 'retour_a_reintegrer', 'absent'].includes(x.statut) ? 'conserve' : 'occupe') : null,
      etape, phase: etape, depuis: depuis || null, seuils_min: s ? { vigilance: s.vigilance, escalade: s.escalade } : null, seuil_source: s?.source || null, objectif_min: s ? s.vigilance : null,
      sejour_depuis: sejourDepuis || null, sejour_seuils_min: null, niveau_etape: niveauEtape, niveau_sejour: null, niveau: niveauEtape,
      place_conservee: ['hospitalise', 'retour_a_reintegrer', 'absent'].includes(x.statut) && !!x.lit_id,
      arrivee_le: sejourDepuis || null, destination_prevue: x.transport?.destination || null, paralleles,
      motif_attente: x.statut === 'retour_a_reintegrer' ? { code: 'reintegration', source: 'residents' } : x.statut === 'transfert_en_cours' ? { code: 'attente_transport', source: 'residents' } : null,
      recommandation: ['orange', 'rouge'].includes(niveauEtape) ? { attente_admission_heb: 'suivre_admission_heb', hospitalise_externe: 'verifier_retour', retour_a_reintegrer: 'preparer_reintegration', transfert_en_cours: 'organiser_transport_transfert' }[etape] || null : null };
  }).sort((a, b) => RANG[b.niveau] - RANG[a.niveau] || (minutes(b.depuis, now) ?? -1) - (minutes(a.depuis, now) ?? -1));
}

/** Séjours actifs de l'établissement : un élément par patient, avec son emplacement, son étape et ses deux durées. */
async function sejoursActifs(db, etabId, cfg, now = Date.now()) {
  if (cfg.type_etablissement && cfg.type_etablissement !== 'hopital') return residentsActifs(db, etabId, cfg, now);
  const S = seuilsDe(cfg);
  const [lits, civ, adm] = await Promise.all([
    db.query(`SELECT l.id, l.code, l.patient_ref, l.etat_depuis, l.nsa_depuis, ch.numero AS chambre, un.id AS unite_id, un.nom AS unite,
        dp.id AS departement_id, dp.nom AS departement, sv.id AS service_id, sv.nom AS service,
        cg.statut AS conge_statut, cg.sortie_prevue, cg.cree_le AS conge_le, l.nsa_orientation, l.blocage_code, l.blocage_vars
      FROM lits l JOIN chambres ch ON ch.id = l.chambre_id JOIN unites un ON un.id = l.unite_id ${ORGA}
      LEFT JOIN conges cg ON cg.lit_id = l.id AND cg.statut IN ('prevu', 'confirme', 'attente_transport', 'reporte')
      WHERE l.etablissement_id = $1 AND l.etat = 'occupe' AND l.patient_ref IS NOT NULL ORDER BY dp.nom NULLS LAST, un.nom, l.code`, [etabId]),
    db.query(`SELECT c.id, c.code, c.categorie, c.patient_ref, c.arrivee_le, un.id AS unite_id, un.nom AS unite,
        COALESCE(dp.id, durg.id) AS departement_id, COALESCE(dp.nom, durg.nom) AS departement, sv.id AS service_id, sv.nom AS service
      FROM civieres c LEFT JOIN unites un ON un.id = c.unite_id ${ORGA}
      LEFT JOIN departements durg ON un.id IS NULL AND durg.etablissement_id = c.etablissement_id AND durg.code = 'URG' AND durg.actif
      WHERE c.etablissement_id = $1 AND c.etat = 'occupee' ORDER BY c.arrivee_le`, [etabId]),
    db.query(`SELECT a.id, a.patient_ref, a.statut, a.provenance, a.cree_le, a.assignee_le, l.code AS lit_code
      FROM demandes_admission a LEFT JOIN lits l ON l.id = a.lit_id WHERE a.etablissement_id = $1 AND a.statut IN ('attente', 'assignee')`, [etabId]),
  ]);
  const refs = [...new Set([...lits.rows, ...civ.rows, ...adm.rows].map((x) => x.patient_ref))];
  // Début du séjour : passage en cours (Patients) ou séjour DSN ouvert, s'ils existent ; jamais leur contenu
  const debuts = refs.length ? (await db.query(`SELECT p.reference,
      (SELECT min(pp.arrivee_le) FROM patient_passages pp WHERE pp.patient_id = p.id AND pp.resultat = 'en_cours') AS passage_le,
      (SELECT min(de.cree_le) FROM dsn_elements de WHERE de.patient_id = p.id AND de.genre = 'sejour' AND de.statut IN ('en_cours', 'sortie_preparee') AND de.remplace_par IS NULL) AS dsn_le
    FROM patients p WHERE p.etablissement_id = $1 AND p.reference = ANY($2)`, [etabId, refs]).catch(() => ({ rows: [] }))).rows : [];
  const debutDe = new Map(debuts.map((d) => [d.reference, d]));
  const admDe = new Map(adm.rows.map((a) => [a.patient_ref, a]));
  // Continuité du séjour : tout ce qui s'est produit depuis la DERNIÈRE sortie (congé réalisé, transfert reçu ailleurs, transport arrivé)
  // fait partie du même séjour ; un changement de civière, de lit ou de département ne remet jamais la durée totale à zéro.
  const contexte = refs.length ? (await db.query(`WITH r AS (SELECT unnest($2::text[]) AS ref),
    s AS (SELECT r.ref, GREATEST(
        (SELECT max(depart_reel_le) FROM conges WHERE etablissement_id = $1 AND patient_ref = r.ref AND statut = 'realise'),
        (SELECT max(date_reception) FROM transferts WHERE origine_id = $1 AND patient_ref = r.ref AND statut = 'recu'),
        (SELECT max(arrivee_le) FROM demandes_transport WHERE origine_id = $1 AND resident_ref = r.ref AND statut = 'arrivee')) AS sortie_le FROM r)
    SELECT s.ref, s.sortie_le, LEAST(
        (SELECT min(a.cree_le) FROM demandes_admission a WHERE a.etablissement_id = $1 AND a.patient_ref = s.ref AND a.statut <> 'annulee' AND a.cree_le > COALESCE(s.sortie_le, '-infinity')),
        (SELECT min(n.debut_le) FROM nsa_episodes n WHERE n.etablissement_id = $1 AND n.patient_ref = s.ref AND n.debut_le > COALESCE(s.sortie_le, '-infinity')),
        (SELECT min(t.date_reception) FROM transferts t WHERE t.destination_id = $1 AND t.patient_ref = s.ref AND t.statut = 'recu' AND t.date_reception > COALESCE(s.sortie_le, '-infinity')),
        (SELECT min(j.date) FROM journal j WHERE j.etablissement_id = $1 AND j.detail = 'Référence ' || s.ref AND NOT j.refuse AND j.date > COALESCE(s.sortie_le, '-infinity'))) AS premier_le,
      (SELECT json_build_object('numero', t.numero, 'statut', t.statut, 'depuis', t.date_demande, 'destination', e.nom) FROM transferts t JOIN etablissements e ON e.id = t.destination_id
        WHERE t.origine_id = $1 AND t.patient_ref = s.ref AND t.statut IN ('demande', 'validee', 'transport', 'en_route') ORDER BY t.id DESC LIMIT 1) AS transfert,
      (SELECT json_build_object('numero', d.numero, 'statut', d.statut, 'depuis', d.cree_le, 'destination', e.nom) FROM demandes_transport d JOIN etablissements e ON e.id = d.destination_id
        WHERE d.origine_id = $1 AND d.resident_ref = s.ref AND d.statut IN ('demandee', 'acceptee', 'en_route', 'pris_en_charge') ORDER BY d.id DESC LIMIT 1) AS transport,
      (SELECT json_build_object('numero', h.numero, 'statut', h.statut, 'depuis', h.cree_le, 'destination', e.nom) FROM demandes_hebergement h JOIN etablissements e ON e.id = h.etablissement_id
        WHERE h.hopital_id = $1 AND h.reference_externe = s.ref AND h.statut NOT IN ('admise', 'refusee', 'annulee') ORDER BY h.id DESC LIMIT 1) AS hebergement
    FROM s`, [etabId, refs]).catch(() => ({ rows: [] }))).rows : [];
  const ctxDe = new Map(contexte.map((x) => [x.ref, x]));
  const plusTot = (...d) => d.filter(Boolean).map((x) => new Date(x)).sort((a, b) => a - b)[0]?.toISOString() || null;
  const fabriquer = (base, etape, etapeDepuis, extra = {}) => {
    const d = debutDe.get(base.reference) || {}; const a = admDe.get(base.reference); const cx = ctxDe.get(base.reference) || {};
    const sejourDepuis = plusTot(d.passage_le, d.dsn_le, a?.cree_le, cx.premier_le, base.debut_ressource, etapeDepuis);
    // Mouvements en parallèle (transfert, transport, hébergement) : signalés À CÔTÉ de l'étape, jamais additionnés (aucun double comptage)
    const paralleles = [cx.transfert && { type: 'transfert', ...cx.transfert }, cx.transport && { type: 'transport', ...cx.transport }, cx.hebergement && { type: 'hebergement', ...cx.hebergement }].filter(Boolean);
    const destination = cx.transfert?.destination || cx.transport?.destination || cx.hebergement?.destination
      || (a?.lit_code ? `lit ${a.lit_code}` : a ? 'admission' : extra.nsa_orientation ? `nsa:${extra.nsa_orientation}` : null);
    // Motif d'attente DOCUMENTÉ seulement (blocage détecté, orientation NSA, statut de congé, statut d'admission) ; sinon null, jamais inventé
    const motif = extra.blocage_code ? { code: extra.blocage_code, source: 'blocages' } : etape === 'nsa' && extra.nsa_orientation ? { code: `nsa_${extra.nsa_orientation}`, source: 'nsa' }
      : etape === 'conge_prevu' && extra.conge_statut === 'attente_transport' ? { code: 'attente_transport', source: 'conges' }
      : etape === 'attente_lit' ? { code: 'attente_lit', source: 'admissions' } : etape === 'lit_assigne' ? { code: 'attente_deplacement', source: 'admissions' } : null;
    // À l'urgence, la durée TOTALE sur civière compte aussi (indicateur public) ; ailleurs, seule l'étape a un seuil
    const sSejour = base.objet === 'civiere' ? S.urgence_civiere : null;
    const niveauEtape = niveauDuree(etapeDepuis, S[etape], now, extra.echeance);
    const niveauSejour = sSejour ? niveauDuree(base.debut_ressource, sSejour, now) : null;
    const sEt = S[etape];
    // Trois durées distinctes, jamais confondues : séjour total, occupation de la ressource actuelle (même heure que Capacités), étape
    return { type: 'sejour', ...base, debut_ressource: undefined, ressource_depuis: base.debut_ressource || null,
      statut_ressource: ['lit', 'civiere'].includes(base.objet) ? 'occupe' : null, etape, phase: etape, depuis: etapeDepuis || null,
      seuils_min: sEt && !sEt.echeance ? { vigilance: sEt.vigilance, escalade: sEt.escalade } : null, seuil_source: sEt?.source || null,
      objectif_min: sEt && !sEt.echeance ? sEt.vigilance : null,
      sejour_depuis: sejourDepuis, sejour_seuils_min: sSejour ? { vigilance: sSejour.vigilance, escalade: sSejour.escalade } : null,
      niveau_etape: niveauEtape, niveau_sejour: niveauSejour, niveau: pire(niveauEtape, niveauSejour),
      demande_admission: a ? { id: a.id, statut: a.statut, provenance: a.provenance, lit: a.lit_code || null } : null,
      arrivee_le: sejourDepuis, destination_prevue: destination, motif_attente: motif, paralleles,
      recommandation: recommander(etape, pire(niveauEtape, niveauSejour), { paralleles, motif, a }), ...extra, blocage_vars: undefined };
  };
  const vus = new Set(); const out = [];
  for (const l of lits.rows) {
    vus.add(l.patient_ref);
    const base = { objet: 'lit', id: l.id, reference: l.patient_ref, ressource: l.code, chambre: l.chambre, unite: l.unite, unite_id: l.unite_id,
      departement: l.departement, departement_id: l.departement_id, service: l.service, service_id: l.service_id, debut_ressource: l.etat_depuis };
    const doc = { nsa_orientation: l.nsa_orientation || null, blocage_code: l.blocage_code || null };
    if (l.nsa_depuis) out.push(fabriquer(base, 'nsa', l.nsa_depuis, { hospitalise_depuis: l.etat_depuis, ...doc }));
    else if (l.conge_statut) out.push(fabriquer(base, 'conge_prevu', l.conge_le, { echeance: l.sortie_prevue, conge_statut: l.conge_statut, marge_min: S.conge_prevu.marge, hospitalise_depuis: l.etat_depuis, ...doc }));
    else out.push(fabriquer(base, 'hospitalise', l.etat_depuis, doc));
  }
  for (const c of civ.rows) {
    if (vus.has(c.patient_ref)) continue; vus.add(c.patient_ref);
    const a = admDe.get(c.patient_ref);
    const base = { objet: 'civiere', id: c.id, reference: c.patient_ref, ressource: c.code, chambre: null, corridor: c.categorie === 'debordement', unite: c.unite, unite_id: c.unite_id,
      departement: c.departement, departement_id: c.departement_id, service: c.service, service_id: c.service_id, debut_ressource: c.arrivee_le };
    if (a?.statut === 'assignee') out.push(fabriquer(base, 'lit_assigne', a.assignee_le));
    else if (a) out.push(fabriquer(base, 'attente_lit', a.cree_le));
    else out.push(fabriquer(base, 'urgence_civiere', c.arrivee_le));
  }
  // Demandes d'admission sans civière ni lit occupé (bloc, externe) : le patient attend tout de même un lit
  for (const a of adm.rows) {
    if (vus.has(a.patient_ref)) continue; vus.add(a.patient_ref);
    const base = { objet: 'admission', id: a.id, reference: a.patient_ref, ressource: null, provenance: a.provenance, debut_ressource: null };
    out.push(fabriquer(base, a.statut === 'assignee' ? 'lit_assigne' : 'attente_lit', a.statut === 'assignee' ? a.assignee_le : a.cree_le));
  }
  return out.sort((x, y) => RANG[y.niveau] - RANG[x.niveau] || (minutes(y.depuis, now) ?? -1) - (minutes(x.depuis, now) ?? -1));
}

/**
 * Recommandation OG (règles explicites, jamais clinique) : une action opérationnelle proposée, qu'un humain décide.
 * Seulement quand un seuil de temps est atteint ou qu'un mouvement attend ; sinon null.
 */
function recommander(etape, niveau, { paralleles = [], motif } = {}) {
  if (!['orange', 'rouge'].includes(niveau) && !paralleles.length) return null;
  if (paralleles.some((p) => p.type === 'transfert' && ['demande', 'validee'].includes(p.statut))) return 'organiser_transport_transfert';
  if (paralleles.some((p) => p.type === 'hebergement')) return 'suivre_hebergement';
  return { urgence_civiere: 'evaluer_orientation', attente_lit: 'chercher_lit', lit_assigne: 'confirmer_deplacement', nsa: 'relancer_placement_nsa',
    conge_prevu: motif?.code === 'attente_transport' ? 'organiser_transport_conge' : 'confirmer_conge', hospitalise: null }[etape] || null;
}

/** Départements, services et unités actifs de l'établissement (filtres de Chrono, même lorsqu'ils sont vides). */
async function organisation(db, etabId) {
  const [dp, sv, un] = await Promise.all([
    db.query('SELECT id, nom FROM departements WHERE etablissement_id = $1 AND actif ORDER BY nom', [etabId]),
    db.query('SELECT id, nom, departement_id FROM services WHERE etablissement_id = $1 AND actif ORDER BY nom', [etabId]),
    db.query('SELECT id, nom, service_id, departement_id FROM unites WHERE etablissement_id = $1 AND actif ORDER BY nom', [etabId]),
  ]);
  return { departements: dp.rows, services: sv.rows, unites: un.rows };
}

const MVT_ETAPE = { preadmission: 'attente_admission_heb', admission: 'resident_present', changement_chambre: 'resident_present', retour: 'resident_present', fin_absence: 'resident_present',
  transfert_entrant: 'resident_present', depart_hopital: 'hospitalise_externe', hospitalisation_confirmee: 'hospitalise_externe', absence: 'absent', transfert_prepare: 'transfert_en_cours',
  retour_prevu: 'hospitalise_externe', sortie: 'sortie', transfert_sortant: 'sortie' };
/**
 * Décomposition complète d'un séjour (fiche cliquable) : chaque étape, ouverte ou close, avec début, fin, durée, seuil et niveau.
 * Lecture des historiques existants seulement ; une étape close garde sa durée réelle (jamais recalculée ni écrasée).
 */
async function decomposition(pool, u, etabId, reference) {
  exigerEtablissement(u, etabId);
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  const ref = String(reference || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(ref)) throw new ErreurHttp(400, 'parametre_invalide', { nom: 'reference' });
  const now = Date.now(); const cfg = await configDe(pool, etabId); const S = seuilsDe(cfg);
  const q = (sql) => pool.query(sql, [etabId, ref]).then((r) => r.rows).catch(() => []);
  const [civ, adm, lits, nsa, conges, transferts, transports, passages, dsn] = await Promise.all([
    // Occupations de civière : journal immuable (« Référence … » à l'occupation) ; fin = événement suivant de la même civière
    q(`SELECT c.code, j.date AS debut, (SELECT min(j2.date) FROM journal j2 WHERE j2.civiere_id = j.civiere_id AND j2.date > j.date AND j2.ancien_etat = 'occupee') AS fin,
         COALESCE((SELECT dp.nom FROM unites un JOIN departements dp ON dp.id = un.departement_id WHERE un.id = c.unite_id), (SELECT nom FROM departements WHERE etablissement_id = $1 AND code = 'URG')) AS departement
       FROM journal j JOIN civieres c ON c.id = j.civiere_id WHERE j.etablissement_id = $1 AND j.action = 'Civière' AND j.nouvel_etat = 'occupee' AND NOT j.refuse AND j.detail = 'Référence ' || $2 ORDER BY j.date`),
    q(`SELECT a.id, a.statut, a.provenance, a.cree_le, a.assignee_le, a.terminee_le, l.code AS lit FROM demandes_admission a LEFT JOIN lits l ON l.id = a.lit_id
       WHERE a.etablissement_id = $1 AND a.patient_ref = $2 ORDER BY a.cree_le`),
    q(`SELECT l.code, l.etat_depuis, ch.numero AS chambre, un.nom AS unite, dp.nom AS departement FROM lits l JOIN chambres ch ON ch.id = l.chambre_id JOIN unites un ON un.id = l.unite_id
       LEFT JOIN services sv ON sv.id = un.service_id LEFT JOIN departements dp ON dp.id = COALESCE(un.departement_id, sv.departement_id)
       WHERE l.etablissement_id = $1 AND l.patient_ref = $2 AND l.etat = 'occupe'`),
    q('SELECT debut_le, fin_le, statut FROM nsa_episodes WHERE etablissement_id = $1 AND patient_ref = $2 ORDER BY debut_le'),
    q('SELECT cree_le, sortie_prevue, depart_reel_le, statut, maj_le FROM conges WHERE etablissement_id = $1 AND patient_ref = $2 ORDER BY cree_le'),
    q(`SELECT numero, statut, origine_id = $1 AS sortant, date_demande, date_validation, date_depart, date_reception FROM transferts
       WHERE (origine_id = $1 OR destination_id = $1) AND patient_ref = $2 ORDER BY date_demande`),
    q(`SELECT d.numero, d.statut, d.origine_id = $1 AS sortant, d.cree_le, d.en_route_le, d.pris_en_charge_le, d.arrivee_le, d.modifie_le FROM demandes_transport d
       WHERE (d.origine_id = $1 OR (d.destination_id = $1 AND NOT ${require('./transports').BROUILLON_PRIVE_SQL})) AND d.resident_ref = $2 ORDER BY d.cree_le`),
    q(`SELECT pp.reference AS numero, pp.type, pp.arrivee_le, pp.sortie_le, pp.resultat FROM patient_passages pp JOIN patients p ON p.id = pp.patient_id
       WHERE p.etablissement_id = $1 AND p.reference = $2 ORDER BY pp.arrivee_le`),
    q(`SELECT de.numero, de.statut, de.cree_le, de.modifie_le FROM dsn_elements de JOIN patients p ON p.id = de.patient_id
       WHERE p.etablissement_id = $1 AND p.reference = $2 AND de.genre = 'sejour' AND de.remplace_par IS NULL ORDER BY de.cree_le`),
  ]);
  const mvts = cfg.type_etablissement && cfg.type_etablissement !== 'hopital' ? await q(`SELECT m.type, m.date, l.code AS lit, ae.nom AS autre FROM resident_mouvements m
      JOIN residents r ON r.id = m.resident_id LEFT JOIN lits l ON l.id = COALESCE(m.vers_lit_id, m.de_lit_id) LEFT JOIN etablissements ae ON ae.id = m.autre_etablissement_id
      WHERE r.etablissement_id = $1 AND r.reference = $2 ORDER BY m.date, m.id`) : [];
  const seg = (etape, debut, fin, extra = {}) => {
    const s = S[etape] && !S[etape].echeance ? S[etape] : null;
    const dureeMin = debut ? Math.round(((fin ? new Date(fin).getTime() : now) - new Date(debut).getTime()) / 60000) : null;
    // Étape close : niveau sur sa durée réelle ; étape en cours : niveau à l'instant
    const niveau = etape === 'conge_prevu' ? niveauDuree(debut, S.conge_prevu, fin ? new Date(fin).getTime() : now, extra.echeance)
      : niveauDuree(debut, s, fin ? new Date(fin).getTime() : now);
    return { etape, debut: debut ? new Date(debut).toISOString() : null, fin: fin ? new Date(fin).toISOString() : null, en_cours: !fin, duree_min: dureeMin,
      seuils_min: s ? { vigilance: s.vigilance, escalade: s.escalade } : null, niveau, ...extra };
  };
  const etapes = [
    ...passages.map((p) => seg(`passage_${p.type}`, p.arrivee_le, p.sortie_le, { numero: p.numero, resultat: p.resultat, source: 'patients' })),
    ...civ.map((c) => seg('urgence_civiere', c.debut, c.fin, { ressource: c.code, departement: c.departement, source: 'urgences' })),
    ...adm.flatMap((a) => [
      seg('attente_lit', a.cree_le, a.assignee_le || a.terminee_le || (['attente'].includes(a.statut) ? null : a.cree_le), { provenance: a.provenance, statut: a.statut, source: 'admissions' }),
      ...(a.assignee_le ? [seg('lit_assigne', a.assignee_le, a.terminee_le || (a.statut === 'assignee' ? null : a.assignee_le), { ressource: a.lit, statut: a.statut, source: 'admissions' })] : []),
    ]),
    // Hébergement : la présence est décrite par les mouvements du résident (jamais comptée deux fois avec l'occupation du lit)
    ...(mvts.length ? [] : lits).map((l) => seg('hospitalise', l.etat_depuis, null, { ressource: l.code, chambre: l.chambre, unite: l.unite, departement: l.departement, source: 'capacites' })),
    ...nsa.map((n) => seg('nsa', n.debut_le, n.fin_le || (n.statut === 'actif' ? null : n.debut_le), { statut: n.statut, source: 'nsa' })),
    ...conges.map((c) => seg('conge_prevu', c.cree_le, c.depart_reel_le || (['annule', 'realise'].includes(c.statut) ? c.maj_le : null), { echeance: c.sortie_prevue, statut: c.statut, source: 'conges' })),
    ...transferts.map((t) => seg(t.sortant ? 'transfert_sortant' : 'transfert_entrant', t.date_demande, t.date_reception || (t.statut === 'refuse' ? (t.date_validation || t.date_demande) : null), { numero: t.numero, statut: t.statut, source: 'transferts' })),
    ...transports.map((d) => seg(d.sortant ? 'transport_sortant' : 'transport_entrant', d.cree_le, d.arrivee_le || (['annulee', 'refusee', 'arrivee'].includes(d.statut) ? d.modifie_le : null), { numero: d.numero, statut: d.statut, source: 'transports' })),
    // Hébergement : chaque mouvement ouvre une étape qui se clôt au mouvement suivant (historique immuable des mouvements)
    ...mvts.map((m, i) => [m, mvts[i + 1]]).filter(([m]) => MVT_ETAPE[m.type]).map(([m, suiv]) => seg(MVT_ETAPE[m.type], m.date, suiv ? suiv.date : (['sortie', 'transfert_sortant'].includes(m.type) ? m.date : null), { ressource: m.lit, numero: m.autre || null, mouvement: m.type, source: 'residents' })),
    ...dsn.map((x) => seg('sejour_dsn', x.cree_le, ['en_cours', 'sortie_preparee'].includes(x.statut) ? null : x.modifie_le, { numero: x.numero, statut: x.statut, source: 'dsn' })),
  ].sort((a, b) => new Date(a.debut || 0) - new Date(b.debut || 0));
  const actif = (await sejoursActifs(pool, etabId, cfg, now)).find((x) => x.reference === ref) || null;
  // Occupation de civière en cours absente du journal (données sans référence au journal) : lue dans l'état courant de la civière
  if (actif?.objet === 'civiere' && !etapes.some((e) => e.etape === 'urgence_civiere' && e.en_cours)) {
    const c = (await pool.query('SELECT arrivee_le FROM civieres WHERE id = $1', [actif.id])).rows[0];
    if (c?.arrivee_le) etapes.push(seg('urgence_civiere', c.arrivee_le, null, { ressource: actif.ressource, departement: actif.departement, source: 'urgences' }));
    etapes.sort((a, b) => new Date(a.debut || 0) - new Date(b.debut || 0));
  }
  if (!etapes.length) throw new ErreurHttp(404, 'introuvable');
  // Temps par département (étapes de présence physique seulement : civière, lit) et étapes les plus longues (hors enveloppes)
  const PRESENCE = ['urgence_civiere', 'hospitalise', 'resident_present']; const ENVELOPPES = ['sejour_dsn', 'passage_urgence', 'passage_consultation', 'passage_admission'];
  const parDep = new Map();
  for (const e of etapes.filter((x) => PRESENCE.includes(x.etape) && x.duree_min != null)) {
    const k = e.departement || null; const v = parDep.get(k) || { departement: k, duree_min: 0, en_cours: false };
    v.duree_min += e.duree_min; v.en_cours = v.en_cours || e.en_cours; parDep.set(k, v);
  }
  const classees = etapes.map((e, i) => [i, e]).filter(([, e]) => !ENVELOPPES.includes(e.etape) && e.duree_min != null).sort((a, b) => b[1].duree_min - a[1].duree_min);
  classees.slice(0, 3).forEach(([i], rang) => { etapes[i].rang_delai = rang + 1; });
  const debut = etapes.find((e) => e.debut)?.debut || null;
  return { reference: ref, genere_le: new Date(now).toISOString(), actif, sejour_depuis: actif?.sejour_depuis || debut,
    duree_totale_min: (actif?.sejour_depuis || debut) ? Math.round((now - new Date(actif?.sejour_depuis || debut).getTime()) / 60000) : null,
    etapes, par_departement: [...parDep.values()], etape_plus_longue: classees[0] ? classees[0][1].etape : null, seuils: seuilsDe(cfg), note: 'operationnel_non_clinique' };
}

module.exports = { recommander, sejoursActifs, decomposition, organisation, seuilsDe, niveauDuree, configDe, pire };
