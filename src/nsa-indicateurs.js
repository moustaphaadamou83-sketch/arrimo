/**
 * Indicateurs du parcours NSA vers l'hébergement (lot D, 17 nov. 2026), pour l'hôpital demandeur.
 * - Par semaine : nouveaux patients NSA, épisodes terminés et leur durée moyenne, délai pour trouver une place, demandes, refus, lits libérés.
 * - Par ressource : demandes, places proposées, refus, délai médian de réponse, admissions.
 * - Motifs de refus (liste fermée).
 * Codes, dates et nombres seulement : aucune référence de patient, aucune catégorie de besoin.
 */
const { ErreurHttp } = require('./db');
const { exigerEtablissement } = require('./auth');
const s = require('./services');
const TE = require('./types-etablissement');

const PREMIERE_REPONSE = `(SELECT min(x.date) FROM demande_hebergement_etapes x WHERE x.demande_id = d.id AND x.date > d.cree_le
  AND x.statut IN ('en_verification', 'place_proposee', 'acceptee', 'refusee'))`;
const PLACE_PROPOSEE = `(SELECT min(x.date) FROM demande_hebergement_etapes x WHERE x.demande_id = d.id AND x.statut = 'place_proposee')`;
const arrondi = (v, n = 1) => (v == null ? null : Math.round(Number(v) * 10 ** n) / 10 ** n);

async function indicateurs(pool, u, etabId, { semaines = 8 } = {}) {
  exigerEtablissement(u, etabId);
  if (u.role === 'entretien') throw new ErreurHttp(403, 'role_insuffisant');
  await s.exigerModule(pool, etabId, 'nsa');
  const n = Math.min(26, Math.max(1, Number(semaines) || 8));
  const fz = (await pool.query(`SELECT COALESCE(cp.fuseau, 'America/Toronto') AS fuseau FROM etablissements e LEFT JOIN config_pays cp ON cp.id = e.config_id WHERE e.id = $1`, [etabId])).rows[0]?.fuseau || 'America/Toronto';
  const args = [etabId, n, fz];
  const semaine = (col) => `date_trunc('week', (${col}) AT TIME ZONE $3)::date`;
  const parSemaine = (await pool.query(`WITH s AS (SELECT generate_series(date_trunc('week', now() AT TIME ZONE $3)::date - (($2 - 1) * 7), date_trunc('week', now() AT TIME ZONE $3)::date, interval '7 days')::date AS debut)
    SELECT s.debut::text AS semaine,
      (SELECT count(*)::int FROM nsa_episodes ep WHERE ep.etablissement_id = $1 AND ${semaine('ep.debut_le')} = s.debut) AS nouveaux_nsa,
      (SELECT count(*)::int FROM nsa_episodes ep WHERE ep.etablissement_id = $1 AND ep.statut = 'parti' AND ${semaine('ep.fin_le')} = s.debut) AS sorties,
      (SELECT avg(EXTRACT(EPOCH FROM (ep.fin_le - ep.debut_le)) / 86400)::float FROM nsa_episodes ep WHERE ep.etablissement_id = $1 AND ep.statut = 'parti' AND ${semaine('ep.fin_le')} = s.debut) AS jours_nsa_moyens,
      (SELECT count(*)::int FROM demandes_hebergement d WHERE d.hopital_id = $1 AND ${semaine('d.cree_le')} = s.debut) AS demandes,
      (SELECT count(*)::int FROM demandes_hebergement d WHERE d.hopital_id = $1 AND d.statut = 'refusee' AND ${semaine('d.modifie_le')} = s.debut) AS refus,
      (SELECT avg(EXTRACT(EPOCH FROM (${PLACE_PROPOSEE} - ep.debut_le)) / 86400)::float FROM demandes_hebergement d
         JOIN nsa_episodes ep ON ep.lit_id = d.hopital_lit_id AND ep.patient_ref = d.reference_externe AND d.cree_le >= ep.debut_le - interval '1 day'
        WHERE d.hopital_id = $1 AND ${PLACE_PROPOSEE} IS NOT NULL AND ${semaine(PLACE_PROPOSEE)} = s.debut) AS delai_place_jours,
      (SELECT count(*)::int FROM demandes_hebergement d WHERE d.hopital_id = $1 AND d.depart_hopital_le IS NOT NULL AND ${semaine('d.depart_hopital_le')} = s.debut) AS lits_liberes
    FROM s ORDER BY s.debut`, args)).rows.map((r) => ({ ...r, jours_nsa_moyens: arrondi(r.jours_nsa_moyens), delai_place_jours: arrondi(r.delai_place_jours) }));
  const depuis = parSemaine[0].semaine;
  const parRessource = (await pool.query(`SELECT e.id, e.nom, e.type_local_code, count(*)::int AS demandes,
      count(*) FILTER (WHERE ${PLACE_PROPOSEE} IS NOT NULL)::int AS places_proposees,
      count(*) FILTER (WHERE d.statut = 'refusee')::int AS refus,
      count(*) FILTER (WHERE d.statut = 'admise')::int AS admissions,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${PREMIERE_REPONSE} - d.cree_le)) / 3600)::float AS reponse_mediane_h
    FROM demandes_hebergement d JOIN etablissements e ON e.id = d.etablissement_id
    WHERE d.hopital_id = $1 AND (d.cree_le AT TIME ZONE $3)::date >= $2::date GROUP BY e.id ORDER BY e.nom`, [etabId, depuis, fz])).rows
    .map((r) => ({ id: r.id, nom: r.nom, type: TE.nomCourt(r), demandes: r.demandes, places_proposees: r.places_proposees, refus: r.refus, admissions: r.admissions,
      reponse_mediane_h: arrondi(r.reponse_mediane_h) }));
  const motifs = Object.fromEntries((await pool.query(`SELECT COALESCE(motif_refus_code, 'non_precise') AS code, count(*)::int AS n FROM demandes_hebergement
    WHERE hopital_id = $1 AND statut = 'refusee' AND (modifie_le AT TIME ZONE $3)::date >= $2::date GROUP BY 1 ORDER BY 2 DESC`, [etabId, depuis, fz])).rows.map((x) => [x.code, x.n]));
  const enCours = (await pool.query(`SELECT count(*)::int AS patients, COALESCE(sum(floor(EXTRACT(EPOCH FROM (now() - debut_le)) / 86400)), 0)::int AS jours,
      COALESCE(max(floor(EXTRACT(EPOCH FROM (now() - debut_le)) / 86400)), 0)::int AS plus_long FROM nsa_episodes WHERE etablissement_id = $1 AND statut = 'actif'`, [etabId])).rows[0];
  const total = (k) => parSemaine.reduce((a, r) => a + (r[k] || 0), 0);
  return { semaines: n, depuis, fuseau: fz, en_cours: enCours, par_semaine: parSemaine, par_ressource: parRessource, motifs_refus: motifs,
    totaux: { nouveaux_nsa: total('nouveaux_nsa'), sorties: total('sorties'), demandes: total('demandes'), refus: total('refus'), lits_liberes: total('lits_liberes') } };
}

const ENTETES = {
  fr: { semaine: 'Semaine du', nouveaux_nsa: 'Nouveaux NSA', sorties: 'Sorties vers l’hébergement', jours_nsa_moyens: 'Jours NSA moyens (sorties)', demandes: 'Demandes envoyées',
    refus: 'Refus', delai_place_jours: 'Délai pour une place (jours)', lits_liberes: 'Lits libérés', ressource: 'Ressource', type: 'Type', places_proposees: 'Places proposées',
    admissions: 'Admissions', reponse_mediane_h: 'Réponse médiane (h)', motif: 'Motif de refus', nombre: 'Nombre' },
  en: { semaine: 'Week of', nouveaux_nsa: 'New ALC', sorties: 'Discharges to care settings', jours_nsa_moyens: 'Average ALC days (discharges)', demandes: 'Requests sent',
    refus: 'Refusals', delai_place_jours: 'Time to a place (days)', lits_liberes: 'Beds freed', ressource: 'Care setting', type: 'Type', places_proposees: 'Places offered',
    admissions: 'Admissions', reponse_mediane_h: 'Median response (h)', motif: 'Refusal reason', nombre: 'Count' },
};
const cellule = (v) => { const t = v == null ? '' : String(v); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
function csv(ind, langue = 'fr') {
  const E = ENTETES[langue] || ENTETES.fr; const L = [];
  const cols = ['nouveaux_nsa', 'sorties', 'jours_nsa_moyens', 'demandes', 'refus', 'delai_place_jours', 'lits_liberes'];
  L.push([E.semaine, ...cols.map((k) => E[k])].map(cellule).join(';'));
  for (const r of ind.par_semaine) L.push([r.semaine, ...cols.map((k) => r[k])].map(cellule).join(';'));
  L.push('');
  const rc = ['demandes', 'places_proposees', 'refus', 'admissions', 'reponse_mediane_h'];
  L.push([E.ressource, E.type, ...rc.map((k) => E[k])].map(cellule).join(';'));
  for (const r of ind.par_ressource) L.push([r.nom, r.type, ...rc.map((k) => r[k])].map(cellule).join(';'));
  L.push('');
  L.push([E.motif, E.nombre].join(';'));
  for (const [k, v] of Object.entries(ind.motifs_refus)) L.push([k, v].map(cellule).join(';'));
  return `${L.join('\r\n')}\r\n`;
}

module.exports = { indicateurs, csv };
