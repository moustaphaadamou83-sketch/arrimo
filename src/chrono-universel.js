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
  civiere: [24 * 60, 48 * 60], nsa: [7 * 24 * 60, 30 * 24 * 60], nettoyage_attente: [30, 60], nettoyage_en_cours: [45, 90], nettoyage_civiere: [15, 30],
  reserve: [120, 240], indispo: [24 * 60, 72 * 60], alerte: [15, 30],
};
const minutes = (d, now) => (d ? (now - new Date(d).getTime()) / 60000 : null);
/** Seuils effectifs : ceux de la configuration de l'établissement quand elle en définit (même source que la Vigilance). */
function seuilsEffectifs(cfg = {}) {
  const n = (v) => (Number(v) > 0 ? Number(v) : null);
  const s = { ...SEUILS };
  if (n(cfg.reservation_max_min)) s.reserve = [n(cfg.reservation_max_min), 2 * n(cfg.reservation_max_min)];
  if (n(cfg.nettoyage_cible_min)) s.nettoyage_en_cours = [n(cfg.nettoyage_cible_min), 2 * n(cfg.nettoyage_cible_min)];
  if (n(cfg.nettoyage_civiere_cible_min)) s.nettoyage_civiere = [n(cfg.nettoyage_civiere_cible_min), 2 * n(cfg.nettoyage_civiere_cible_min)];
  return s;
}
function niveau(type, depuis, now, seuils = SEUILS) {
  const m = minutes(depuis, now); if (m == null) return 'gris';
  const [o, r] = seuils[type] || SEUILS[type] || [Infinity, Infinity];
  return m >= r ? 'rouge' : m >= o ? 'orange' : 'vert';
}
const item = (type, x, depuis, now, extra = {}, seuils = SEUILS) => {
  const s = seuils[type] || SEUILS[type];
  return { type, depuis: depuis || null, niveau: niveau(type, depuis, now, seuils),
    objectif_min: s ? s[0] : null, seuils_min: s ? { vigilance: s[0], escalade: s[1] } : null, ...x, ...extra };
};

async function universel(pool, u, etabId) {
  exigerEtablissement(u, etabId);
  const e = (await pool.query('SELECT id, type_etablissement FROM etablissements WHERE id = $1', [etabId])).rows[0];
  if (!e) throw new ErreurHttp(404, 'etab_introuvable');
  const now = Date.now(); const entretien = u.role === 'entretien';
  const CS = require('./chrono-sejours'); const cfg = await CS.configDe(pool, etabId);
  // Seuils propres à CETTE requête (jamais partagés entre établissements)
  const SC = seuilsEffectifs(cfg); const it = (type, x, depuis, n, extra = {}) => item(type, x, depuis, n, extra, SC);
  const [civ, lits, prealertes, transports, alertes, qualiteBrute] = await Promise.all([
    pool.query(`SELECT id, code, etat, categorie, patient_ref, arrivee_le, etat_depuis FROM civieres WHERE etablissement_id = $1 ORDER BY code`, [etabId]),
    pool.query(`SELECT l.id, l.code, l.etat, l.patient_ref, l.etat_depuis, l.nsa_depuis, l.nettoyage_debut, un.nom AS unite
      , l.disponibilite_confirmee_le FROM lits l LEFT JOIN unites un ON un.id = l.unite_id WHERE l.etablissement_id = $1 ORDER BY un.nom, l.code`, [etabId]),
    pool.query(`SELECT p.id, p.numero, p.statut, p.priorite, p.heure_prevue, p.cree_le, p.recue_le, p.arrivee_signalee_le, p.arrivee_confirmee_le, un.numero AS unite,
        (SELECT json_build_object('minutes', ea.minutes, 'distance_km', ea.distance_km::float, 'le', ea.calcule_le) FROM eta_prealertes ea WHERE ea.prealerte_id = p.id) AS eta,
        (SELECT max(pu.enregistree_le) FROM positions_unites pu WHERE pu.unite_id = p.unite_id) AS derniere_position
      FROM prealertes p JOIN unites_secours un ON un.id = p.unite_id
      WHERE p.destination_id = $1 AND p.statut NOT IN ('cloturee', 'annulee', 'remplacee') ORDER BY p.cree_le`, [etabId]),
    pool.query(`SELECT d.id, d.numero, d.statut, d.cree_le, d.origine_id, d.destination_id, d.en_route_le, d.sur_place_le, d.pris_en_charge_le, d.arrivee_le,
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
  // Patients et séjours : TOUS les séjours actifs autorisés (lits occupés, civières, demandes d'admission), étape et seuils configurés
  const [patients, organisation] = entretien ? [[], null] : await Promise.all([CS.sejoursActifs(pool, etabId, cfg, now), CS.organisation(pool, etabId)]);
  const capacites = [
    ...lits.rows.filter((l) => l.etat === 'nettoyage').map((l) => (l.nettoyage_debut
      ? it('nettoyage_en_cours', { objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, phase: 'nettoyage_en_cours', attente_avant_nettoyage_min: Math.max(0, Math.round((new Date(l.nettoyage_debut) - new Date(l.etat_depuis)) / 60000)) }, l.nettoyage_debut, now)
      : it('nettoyage_attente', { objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, phase: 'attente_nettoyage' }, l.etat_depuis, now))),
    ...lits.rows.filter((l) => ['reserve', 'indispo'].includes(l.etat)).map((l) => it(l.etat, { objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, phase: l.etat }, l.etat_depuis, now)),
    ...civ.rows.filter((c) => ['nettoyage', 'indispo'].includes(c.etat)).map((c) => it(c.etat === 'nettoyage' ? 'nettoyage_civiere' : 'indispo', { objet: 'civiere', id: c.id, ressource: c.code, phase: c.etat === 'nettoyage' ? 'attente_nettoyage' : 'indispo' }, c.etat_depuis, now)),
  ];
  // Lits et civières OCCUPÉS et DISPONIBLES (27 nov. 2026) : statut réel, depuis la même heure que Capacités (etat_depuis / arrivee_le).
  // Aucun seuil : niveau « sans seuil » ; le statut (occupé rouge, disponible vert) est distinct du niveau de vigilance.
  const sansSeuil = (x, depuis) => ({ ...x, depuis: depuis || null, niveau: depuis ? 'bleu' : 'gris', seuils_min: null, objectif_min: null });
  for (const l of lits.rows.filter((x) => ['occupe', 'libre'].includes(x.etat))) {
    capacites.push(sansSeuil({ type: l.etat === 'occupe' ? 'occupe' : 'disponible', objet: 'lit', id: l.id, ressource: l.code, unite: l.unite, phase: l.etat === 'occupe' ? 'occupe' : 'disponible',
      statut: l.etat === 'occupe' ? 'occupe' : 'disponible', reference: entretien ? undefined : (l.patient_ref || undefined), disponibilite_confirmee_le: l.etat === 'libre' ? l.disponibilite_confirmee_le : undefined }, l.etat_depuis));
  }
  for (const c of civ.rows.filter((x) => ['occupee', 'libre'].includes(x.etat))) {
    capacites.push(sansSeuil({ type: c.etat === 'occupee' ? 'occupe' : 'disponible', objet: 'civiere', id: c.id, ressource: c.code, phase: c.etat === 'occupee' ? 'occupe' : 'disponible',
      statut: c.etat === 'occupee' ? 'occupe' : 'disponible', corridor: c.categorie === 'debordement', reference: entretien ? undefined : (c.patient_ref || undefined) }, c.etat === 'occupee' ? (c.arrivee_le || c.etat_depuis) : c.etat_depuis));
  }
  // Hébergement : place conservée (résident hospitalisé ou absent) — jamais disponible ; même entretien seulement par le module Entretien
  for (const p of patients.filter((x) => x.place_conservee)) capacites.push({ type: 'conservee', objet: 'lit', id: p.id, ressource: p.ressource, unite: p.unite, phase: 'place_conservee',
    depuis: p.depuis, niveau: p.niveau, seuils_min: p.seuils_min, objectif_min: p.objectif_min, reference: entretien ? undefined : p.reference });
  const finEta = (p) => (p.eta?.minutes != null && p.eta?.le ? new Date(new Date(p.eta.le).getTime() + p.eta.minutes * 60000).toISOString() : p.heure_prevue ? new Date(p.heure_prevue).toISOString() : null);
  const ambulances = entretien ? [] : [
    ...prealertes.rows.map((p) => {
      const arrivee = p.arrivee_confirmee_le || p.arrivee_signalee_le;
      const gpsAge = minutes(p.derniere_position, now);
      return { objet: 'prealerte', id: p.id, numero: p.numero, unite: p.unite, priorite: p.priorite, phase: arrivee ? 'sur_place' : 'en_approche',
        depuis: arrivee || null, arrivee_estimee: arrivee ? null : finEta(p), estimation_fiable: !arrivee && gpsAge != null && gpsAge <= 2,
        derniere_position: p.derniere_position,
        // Préalerte jamais arrivée et créée il y a plus de 24 h : non clôturée (à vérifier), jamais « normale »
        obsolete: !arrivee && minutes(p.cree_le, now) >= 24 * 60, cause: !arrivee && minutes(p.cree_le, now) >= 24 * 60 ? 'mission_non_cloturee' : null,
        niveau: arrivee ? niveau('alerte', arrivee, now, SC) : minutes(p.cree_le, now) >= 24 * 60 ? 'gris' : finEta(p) ? 'vert' : 'gris' };
    }),
    ...transports.rows.map((d) => {
      const fin = d.prealerte_eta_min != null && d.prealerte_eta_le ? new Date(new Date(d.prealerte_eta_le).getTime() + d.prealerte_eta_min * 60000).toISOString() : null;
      const depuis = d.pris_en_charge_le || d.sur_place_le || d.en_route_le || null;
      return { objet: 'transport', id: d.id, numero: d.numero, unite: d.unite, sens: d.origine_id === etabId ? 'depart' : 'arrivee', phase: d.statut === 'en_route' && d.sur_place_le ? 'sur_place_depart' : d.statut,
        depuis, arrivee_estimee: fin, objectif_t5: fin ? new Date(new Date(fin).getTime() - 5 * 60000).toISOString() : null, patient_etat: d.patient_etat, patient_pret_le: d.patient_pret_le, accueil_pret_le: d.accueil_pret_le,
        // Mission ouverte depuis plus de 24 h : jamais « normale » ; signalée non clôturée (à vérifier), conservée telle quelle (aucune suppression)
        ...(() => { const age = minutes(depuis || d.cree_le, now); const obsolete = age != null && age >= 24 * 60; const lent = age != null && age >= Math.max(60, 2 * (cfg.transport_retard_marge_min || 30)) && !obsolete;
          return { obsolete, cause: obsolete ? 'mission_non_cloturee' : null,
            niveau: obsolete ? 'gris' : ['retarde', 'indisponible'].includes(d.patient_etat) || lent ? 'orange' : d.patient_etat === 'pret' || d.accueil_pret_le ? 'vert' : depuis ? 'vert' : 'gris' }; })() };
    }),
  ];
  const alertesItems = alertes.rows.map((a) => it('alerte', { objet: 'alerte', id: Number(a.id), titre: a.titre, statut: a.statut, escalade_niveau: a.escalade_niveau,
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
  // Indicateurs T−5 (30 jours) : tirés des confirmations enregistrées ; taux null (inconnu) sans données, jamais 0 %
  const t5 = entretien ? null : (await pool.query(`SELECT
      count(*) FILTER (WHERE d.origine_id = $1 AND d.patient_pret_eta_min IS NOT NULL)::int AS patients_mesures,
      count(*) FILTER (WHERE d.origine_id = $1 AND d.patient_pret_eta_min >= 5)::int AS patients_prets_t5,
      count(*) FILTER (WHERE d.destination_id = $1 AND d.accueil_pret_eta_min IS NOT NULL)::int AS accueils_mesures,
      count(*) FILTER (WHERE d.destination_id = $1 AND d.accueil_pret_eta_min >= 5)::int AS accueils_prets_t5,
      count(*) FILTER (WHERE d.origine_id = $1 AND d.patient_pret_le IS NOT NULL AND d.sur_place_le IS NOT NULL AND d.patient_pret_le <= d.sur_place_le)::int AS prets_avant_arrivee,
      count(*) FILTER (WHERE d.origine_id = $1 AND d.sur_place_le IS NOT NULL AND d.patient_etat IS NOT NULL)::int AS arrivees_mesurees
    FROM demandes_transport d WHERE (d.origine_id = $1 OR d.destination_id = $1) AND d.cree_le > now() - interval '30 days'`, [etabId])).rows[0];
  const motifs = entretien ? [] : (await pool.query(`SELECT ev.detail->>'motif' AS motif, count(*)::int AS n FROM demande_transport_evenements ev JOIN demandes_transport d ON d.id = ev.demande_id
    WHERE d.origine_id = $1 AND ev.type = 'etat_patient' AND ev.detail->>'motif' IS NOT NULL AND ev.cree_le > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC`, [etabId])).rows;
  const taux = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const performanceT5 = t5 && { periode_jours: 30, patients_prets_t5_pct: taux(t5.patients_prets_t5, t5.patients_mesures), patients_mesures: t5.patients_mesures,
    accueils_prets_t5_pct: taux(t5.accueils_prets_t5, t5.accueils_mesures), accueils_mesures: t5.accueils_mesures,
    prets_avant_arrivee_pct: taux(t5.prets_avant_arrivee, t5.arrivees_mesurees), arrivees_mesurees: t5.arrivees_mesurees, motifs_non_preparation: motifs };
  const compte = (l) => ({ total: l.length, rouge: l.filter((x) => x.niveau === 'rouge').length, orange: l.filter((x) => x.niveau === 'orange').length, gris: l.filter((x) => x.niveau === 'gris').length });
  return { etablissement_id: etabId, genere_le: new Date(now).toISOString(), seuils_min: SC, seuils_etapes: entretien ? null : CS.seuilsDe(cfg),
    resume: { patients: compte(patients), capacites: compte(capacites), ambulances: compte(ambulances), alertes: compte(alertesItems) },
    patients, organisation, capacites, ambulances, alertes: alertesItems, previsions, qualite, performance_t5: performanceT5 };
}

module.exports = { universel, SEUILS, niveau, seuilsEffectifs };
