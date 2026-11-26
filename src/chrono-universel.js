'use strict';
/**
 * Chrono universel (27 nov. 2026) : une seule lecture, en lecture seule, des durées EN COURS dans l'établissement, tirées des
 * horodatages déjà enregistrés (civières, lits, NSA, nettoyage, ambulances, transports, alertes) — aucune donnée copiée, aucun
 * second moteur. Les historiques restent dans l'horloge, Sillage et Performance.
 * - Une durée sans horodatage est « inconnue » (null, niveau gris), jamais 0.
 * - Niveaux : vert (normal), orange (vigilance), rouge (escalade), gris (inconnu) ; seuils par défaut, indicatifs, jamais cliniques.
 * - Référence patient seulement ; aucune identité, aucun diagnostic.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');

// Seuils indicatifs (minutes) : orange, rouge. Une alerte temporelle ne remplace jamais une priorité clinique.
const SEUILS = {
  civiere: [24 * 60, 48 * 60], nsa: [7 * 24 * 60, 30 * 24 * 60], nettoyage_attente: [30, 60], nettoyage_en_cours: [45, 90],
  reserve: [120, 240], indispo: [24 * 60, 72 * 60], alerte: [15, 30],
};
const minutes = (d, now) => (d ? (now - new Date(d).getTime()) / 60000 : null);
function niveau(type, depuis, now) {
  const m = minutes(depuis, now); if (m == null) return 'gris';
  const [o, r] = SEUILS[type] || [Infinity, Infinity];
  return m >= r ? 'rouge' : m >= o ? 'orange' : 'vert';
}
const item = (type, x, depuis, now, extra = {}) => ({ type, depuis: depuis || null, niveau: niveau(type, depuis, now),
  objectif_min: SEUILS[type] ? SEUILS[type][0] : null, ...x, ...extra });

async function universel(pool, u, etabId) {
  exigerEtablissement(u, etabId);
  const e = (await pool.query('SELECT id, type_etablissement FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  const now = Date.now(); const entretien = u.role === 'entretien';
  const [civ, lits, prealertes, transports, alertes, qualiteBrute] = await Promise.all([
    pool.query(`SELECT id, code, etat, patient_ref, arrivee_le, etat_depuis FROM civieres WHERE etablissement_id = $1 AND etat <> 'libre' ORDER BY code`, [etabId]),
    pool.query(`SELECT l.id, l.code, l.etat, l.patient_ref, l.etat_depuis, l.nsa_depuis, l.nettoyage_debut, un.nom AS unite
      FROM lits l LEFT JOIN unites un ON un.id = l.unite_id WHERE l.etablissement_id = $1 AND (l.etat IN ('nettoyage', 'reserve', 'indispo') OR l.nsa_depuis IS NOT NULL) ORDER BY un.nom, l.code`, [etabId]),
    pool.query(`SELECT p.id, p.numero, p.statut, p.priorite, p.heure_prevue, p.cree_le, p.recue_le, p.arrivee_signalee_le, p.arrivee_confirmee_le, un.numero AS unite,
        (SELECT json_build_object('minutes', ea.minutes, 'distance_km', ea.distance_km::float, 'le', ea.calcule_le) FROM eta_prealertes ea WHERE ea.prealerte_id = p.id) AS eta,
        (SELECT max(pu.enregistree_le) FROM positions_unites pu WHERE pu.unite_id = p.unite_id) AS derniere_position
      FROM prealertes p JOIN unites_secours un ON un.id = p.unite_id
      WHERE p.destination_id = $1 AND p.statut NOT IN ('cloturee', 'annulee', 'remplacee') ORDER BY p.cree_le`, [etabId]),
    pool.query(`SELECT d.id, d.numero, d.statut, d.origine_id, d.destination_id, d.en_route_le, d.sur_place_le, d.pris_en_charge_le, d.arrivee_le,
        d.patient_etat, d.patient_pret_le, d.accueil_pret_le, d.prealerte_eta_min, d.prealerte_eta_le, un.numero AS unite
      FROM demandes_transport d LEFT JOIN unites_secours un ON un.id = d.unite_id
      WHERE (d.origine_id = $1 OR d.destination_id = $1) AND d.statut IN ('acceptee', 'en_route', 'pris_en_charge') ORDER BY d.id`, [etabId]),
    entretien ? { rows: [] } : pool.query(`SELECT id, titre, niveau, statut, cree_le, accuse_le, echeance, escalade_niveau FROM suivis_alertes
      WHERE etablissement_id = $1 AND statut IN ('ouverte', 'accusee', 'en_action') ORDER BY cree_le`, [etabId]).catch(() => ({ rows: [] })),
    entretien ? null : pool.query(`SELECT
        (SELECT count(*)::int FROM notifications WHERE etablissement_id = $1 AND NOT lu AND date < now() - interval '15 minutes') AS notifications_non_lues_15min,
        (SELECT count(*)::int FROM prealertes WHERE destination_id = $1 AND statut NOT IN ('cloturee', 'annulee', 'remplacee') AND recue_le IS NULL AND cree_le < now() - interval '2 minutes') AS prealertes_non_recues,
        (SELECT count(*)::int FROM demandes_transport WHERE (origine_id = $1 OR destination_id = $1) AND statut IN ('en_route', 'pris_en_charge')
           AND prealerte_eta_le IS NOT NULL AND prealerte_eta_le < now() - interval '10 minutes') AS eta_transport_obsoletes`, [etabId]).catch(() => null),
  ]);
  const patients = entretien ? [] : [
    ...civ.rows.filter((c) => c.etat === 'occupee').map((c) => item('civiere', { objet: 'civiere', id: c.id, ressource: c.code, reference: c.patient_ref, phase: 'occupation_civiere' }, c.arrivee_le || c.etat_depuis, now)),
    ...lits.rows.filter((l) => l.nsa_depuis).map((l) => item('nsa', { objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, reference: l.patient_ref, phase: 'nsa' }, l.nsa_depuis, now)),
  ];
  const capacites = [
    ...lits.rows.filter((l) => l.etat === 'nettoyage').map((l) => (l.nettoyage_debut
      ? item('nettoyage_en_cours', { objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, phase: 'nettoyage_en_cours', attente_avant_nettoyage_min: Math.max(0, Math.round((new Date(l.nettoyage_debut) - new Date(l.etat_depuis)) / 60000)) }, l.nettoyage_debut, now)
      : item('nettoyage_attente', { objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, phase: 'attente_nettoyage' }, l.etat_depuis, now))),
    ...lits.rows.filter((l) => ['reserve', 'indispo'].includes(l.etat)).map((l) => item(l.etat, { objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, phase: l.etat }, l.etat_depuis, now)),
    ...civ.rows.filter((c) => ['nettoyage', 'indispo'].includes(c.etat)).map((c) => item(c.etat === 'nettoyage' ? 'nettoyage_attente' : 'indispo', { objet: 'civiere', id: c.id, ressource: c.code, phase: c.etat === 'nettoyage' ? 'attente_nettoyage' : 'indispo' }, c.etat_depuis, now)),
  ];
  const finEta = (p) => (p.eta?.minutes != null && p.eta?.le ? new Date(new Date(p.eta.le).getTime() + p.eta.minutes * 60000).toISOString() : p.heure_prevue ? new Date(p.heure_prevue).toISOString() : null);
  const ambulances = entretien ? [] : [
    ...prealertes.rows.map((p) => {
      const arrivee = p.arrivee_confirmee_le || p.arrivee_signalee_le;
      const gpsAge = minutes(p.derniere_position, now);
      return { objet: 'prealerte', id: p.id, numero: p.numero, unite: p.unite, priorite: p.priorite, phase: arrivee ? 'sur_place' : 'en_approche',
        depuis: arrivee || null, arrivee_estimee: arrivee ? null : finEta(p), estimation_fiable: !arrivee && gpsAge != null && gpsAge <= 2,
        derniere_position: p.derniere_position, niveau: arrivee ? niveau('alerte', arrivee, now) : finEta(p) ? 'vert' : 'gris' };
    }),
    ...transports.rows.map((d) => {
      const fin = d.prealerte_eta_min != null && d.prealerte_eta_le ? new Date(new Date(d.prealerte_eta_le).getTime() + d.prealerte_eta_min * 60000).toISOString() : null;
      const depuis = d.pris_en_charge_le || d.sur_place_le || d.en_route_le || null;
      return { objet: 'transport', id: d.id, numero: d.numero, unite: d.unite, sens: d.origine_id === etabId ? 'depart' : 'arrivee', phase: d.statut === 'en_route' && d.sur_place_le ? 'sur_place_depart' : d.statut,
        depuis, arrivee_estimee: fin, objectif_t5: fin ? new Date(new Date(fin).getTime() - 5 * 60000).toISOString() : null, patient_etat: d.patient_etat, patient_pret_le: d.patient_pret_le, accueil_pret_le: d.accueil_pret_le,
        niveau: d.patient_etat === 'pret' || d.accueil_pret_le ? 'vert' : ['retarde', 'indisponible'].includes(d.patient_etat) ? 'orange' : depuis ? 'vert' : 'gris' };
    }),
  ];
  const alertesItems = alertes.rows.map((a) => item('alerte', { objet: 'alerte', id: Number(a.id), titre: a.titre, statut: a.statut, escalade_niveau: a.escalade_niveau,
    reaction_min: a.accuse_le ? Math.round((new Date(a.accuse_le) - new Date(a.cree_le)) / 60000) : null, echeance: a.echeance }, a.cree_le, now));
  let previsions = null;
  if (!entretien) { try { previsions = await require('./previsions').previsions(pool, u, etabId); } catch { previsions = null; } }
  const q = qualiteBrute?.rows?.[0] || null;
  const fluxEtat = require('./flux').etat();
  const qualite = entretien ? null : {
    synchronisation_ms: fluxEtat.regroupement_ms, signaux_emis: fluxEtat.emis,
    notifications_non_lues_15min: q?.notifications_non_lues_15min ?? null, prealertes_non_recues: q?.prealertes_non_recues ?? null,
    eta_transport_obsoletes: q?.eta_transport_obsoletes ?? null,
    gps_obsoletes: ambulances.filter((a) => a.objet === 'prealerte' && a.phase === 'en_approche' && !a.estimation_fiable).length,
  };
  const compte = (l) => ({ total: l.length, rouge: l.filter((x) => x.niveau === 'rouge').length, orange: l.filter((x) => x.niveau === 'orange').length, gris: l.filter((x) => x.niveau === 'gris').length });
  return { etablissement_id: etabId, genere_le: new Date(now).toISOString(), seuils_min: SEUILS,
    resume: { patients: compte(patients), capacites: compte(capacites), ambulances: compte(ambulances), alertes: compte(alertesItems) },
    patients, capacites, ambulances, alertes: alertesItems, previsions, qualite };
}

module.exports = { universel, SEUILS, niveau };
